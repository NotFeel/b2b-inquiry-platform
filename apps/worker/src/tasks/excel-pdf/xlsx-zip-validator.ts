import { constants as fsConstants, promises as fs } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { ERROR_CODES, EXCEL_PDF_LIMITS } from '@b2b/contracts';
import { ExcelPdfProcessingError } from './excel-pdf-errors';

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const EOCD_SIZE = 22;
const MAX_COMMENT = 0xffff;
const MAX_CENTRAL_DIRECTORY_BYTES = 16 * 1024 * 1024;
const MAX_METADATA_ENTRY_BYTES = 4 * 1024 * 1024;
const MAX_METADATA_TOTAL_BYTES = 8 * 1024 * 1024;

interface ZipEntry {
  name: string;
  flags: number;
  method: number;
  crc32: number;
  compressedBytes: number;
  uncompressedBytes: number;
  localHeaderOffset: number;
}

export interface XlsxValidationResult {
  entryCount: number;
  uncompressedBytes: number;
}

/**
 * Validates the XLSX ZIP envelope without inflating the complete workbook.
 * Central-directory limits prevent zip bombs before LibreOffice sees the file;
 * small OOXML relationship files are inflated with CRC/size checks to reject
 * external links and malformed metadata.
 */
export async function validateXlsxArchive(path: string): Promise<XlsxValidationResult> {
  let handle;
  try {
    handle = await fs.open(path, fsConstants.O_RDONLY);
  } catch {
    throw invalidFile();
  }

  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size < EOCD_SIZE) throw invalidFile();
    if (stat.size > EXCEL_PDF_LIMITS.maxUploadBytes) throw invalidFile();

    const eocd = await findEndOfCentralDirectory(handle, stat.size);
    assertSingleDiskArchive(eocd);
    if (eocd.entryCount === 0) throw invalidFile();
    if (eocd.entryCount > EXCEL_PDF_LIMITS.maxZipEntries) throw zipBomb();
    if (
      eocd.centralDirectorySize <= 0 ||
      eocd.centralDirectorySize > MAX_CENTRAL_DIRECTORY_BYTES ||
      eocd.centralDirectoryOffset + eocd.centralDirectorySize > eocd.offset
    ) {
      throw invalidFile();
    }

    const central = Buffer.alloc(eocd.centralDirectorySize);
    await readExactly(handle, central, 0, central.byteLength, eocd.centralDirectoryOffset);
    const entries = parseCentralDirectory(central, eocd.entryCount);
    validateEntrySet(entries, central.byteLength);

    const contentTypes = entries.find(
      (entry) => entry.name.toLowerCase() === '[content_types].xml',
    );
    if (!contentTypes || contentTypes.uncompressedBytes > MAX_METADATA_ENTRY_BYTES) {
      throw invalidFile();
    }
    const contentTypesXml = await readEntry(handle, contentTypes).then((buffer) =>
      buffer.toString('utf8'),
    );
    if (
      /(?:macroEnabled|vbaProject|ms-excel\.addin\.|application\/vnd\.ms-excel\.sheet)/i.test(
        contentTypesXml,
      )
    ) {
      throw new ExcelPdfProcessingError(
        ERROR_CODES.excelPdfMacroNotAllowed,
        'Macro-enabled workbooks are not supported.',
      );
    }

    let metadataBytes = 0;
    for (const entry of entries) {
      if (!entry.name.toLowerCase().endsWith('.rels')) continue;
      if (entry.uncompressedBytes > MAX_METADATA_ENTRY_BYTES) throw invalidFile();
      metadataBytes += entry.uncompressedBytes;
      if (metadataBytes > MAX_METADATA_TOTAL_BYTES) throw invalidFile();
      const xml = await readEntry(handle, entry).then((buffer) => buffer.toString('utf8'));
      if (/<Relationship\b[^>]*\bTargetMode\s*=\s*["']External["']/i.test(xml)) {
        throw new ExcelPdfProcessingError(
          ERROR_CODES.excelPdfExternalLinkNotAllowed,
          'The workbook contains an external relationship.',
        );
      }
    }

    return {
      entryCount: entries.length,
      uncompressedBytes: entries.reduce((sum, entry) => sum + entry.uncompressedBytes, 0),
    };
  } finally {
    await handle.close();
  }
}

async function findEndOfCentralDirectory(
  handle: Awaited<ReturnType<typeof fs.open>>,
  fileSize: number,
): Promise<{
  offset: number;
  entryCount: number;
  centralDirectorySize: number;
  centralDirectoryOffset: number;
  diskNumber: number;
  centralDirectoryDisk: number;
  entriesOnDisk: number;
}> {
  const tailLength = Math.min(fileSize, EOCD_SIZE + MAX_COMMENT);
  const tailStart = fileSize - tailLength;
  const tail = Buffer.alloc(tailLength);
  await readExactly(handle, tail, 0, tailLength, tailStart);
  for (let offset = tail.length - EOCD_SIZE; offset >= 0; offset -= 1) {
    if (tail.readUInt32LE(offset) !== EOCD_SIGNATURE) continue;
    const commentLength = tail.readUInt16LE(offset + 20);
    if (offset + EOCD_SIZE + commentLength !== tail.length) continue;
    return {
      offset: tailStart + offset,
      diskNumber: tail.readUInt16LE(offset + 4),
      centralDirectoryDisk: tail.readUInt16LE(offset + 6),
      entriesOnDisk: tail.readUInt16LE(offset + 8),
      entryCount: tail.readUInt16LE(offset + 10),
      centralDirectorySize: tail.readUInt32LE(offset + 12),
      centralDirectoryOffset: tail.readUInt32LE(offset + 16),
    };
  }
  throw invalidFile();
}

function assertSingleDiskArchive(eocd: {
  diskNumber: number;
  centralDirectoryDisk: number;
  entriesOnDisk: number;
  entryCount: number;
  centralDirectorySize: number;
  centralDirectoryOffset: number;
}): void {
  if (
    eocd.diskNumber !== 0 ||
    eocd.centralDirectoryDisk !== 0 ||
    eocd.entriesOnDisk !== eocd.entryCount ||
    eocd.entryCount === 0xffff ||
    eocd.centralDirectorySize === 0xffffffff ||
    eocd.centralDirectoryOffset === 0xffffffff
  ) {
    // ZIP64/multi-disk workbooks exceed the safe conversion envelope.
    throw zipBomb();
  }
}

function parseCentralDirectory(buffer: Buffer, expectedEntries: number): ZipEntry[] {
  const entries: ZipEntry[] = [];
  let offset = 0;
  while (offset < buffer.byteLength) {
    if (offset + 46 > buffer.byteLength || buffer.readUInt32LE(offset) !== CENTRAL_SIGNATURE) {
      throw invalidFile();
    }
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const crc32 = buffer.readUInt32LE(offset + 16);
    const compressedBytes = buffer.readUInt32LE(offset + 20);
    const uncompressedBytes = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const diskStart = buffer.readUInt16LE(offset + 34);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const end = offset + 46 + nameLength + extraLength + commentLength;
    if (end > buffer.byteLength || diskStart !== 0) throw invalidFile();
    if (compressedBytes === 0xffffffff || uncompressedBytes === 0xffffffff) throw zipBomb();
    const rawName = buffer.subarray(offset + 46, offset + 46 + nameLength);
    const name = rawName.toString((flags & 0x0800) !== 0 ? 'utf8' : 'latin1');
    entries.push({
      name,
      flags,
      method,
      crc32,
      compressedBytes,
      uncompressedBytes,
      localHeaderOffset,
    });
    offset = end;
  }
  if (offset !== buffer.byteLength || entries.length !== expectedEntries) throw invalidFile();
  return entries;
}

function validateEntrySet(entries: ZipEntry[], centralDirectoryBytes: number): void {
  const names = new Set<string>();
  let totalUncompressed = 0;
  let totalCompressed = 0;
  for (const entry of entries) {
    assertSafeName(entry.name);
    if (names.has(entry.name.toLowerCase())) throw invalidFile();
    names.add(entry.name.toLowerCase());
    if ((entry.flags & 0x0001) !== 0) {
      throw new ExcelPdfProcessingError(
        ERROR_CODES.excelPdfPasswordProtected,
        'Encrypted ZIP entries are not supported.',
      );
    }
    if (entry.method !== 0 && entry.method !== 8) throw invalidFile();
    if (entry.uncompressedBytes > EXCEL_PDF_LIMITS.maxZipEntryBytes) throw zipBomb();
    totalUncompressed += entry.uncompressedBytes;
    totalCompressed += entry.compressedBytes;
    if (totalUncompressed > EXCEL_PDF_LIMITS.maxZipUncompressedBytes) throw zipBomb();
    if (
      entry.uncompressedBytes > 1024 * 1024 &&
      entry.compressedBytes > 0 &&
      entry.uncompressedBytes / entry.compressedBytes > EXCEL_PDF_LIMITS.maxCompressionRatio
    ) {
      throw zipBomb();
    }
    if (entry.method === 0 && entry.compressedBytes !== entry.uncompressedBytes)
      throw invalidFile();
    if (isDisallowedEntry(entry.name)) {
      throw new ExcelPdfProcessingError(
        /vbaProject\.bin$/i.test(entry.name)
          ? ERROR_CODES.excelPdfMacroNotAllowed
          : ERROR_CODES.excelPdfExternalLinkNotAllowed,
        'The workbook contains a feature that is not allowed during PDF conversion.',
      );
    }
  }
  const normalized = new Set([...names].map((name) => name.replace(/^\/+/, '')));
  if (!normalized.has('[content_types].xml') || !normalized.has('xl/workbook.xml')) {
    throw invalidFile();
  }
  if (totalCompressed === 0 || totalCompressed > totalUncompressed + centralDirectoryBytes) {
    throw invalidFile();
  }
}

function assertSafeName(name: string): void {
  const withoutDirectorySlash = name.endsWith('/') ? name.slice(0, -1) : name;
  if (
    !name ||
    name.includes('\u0000') ||
    name.includes('\\') ||
    name.startsWith('/') ||
    withoutDirectorySlash
      .split('/')
      .some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw invalidFile();
  }
}

function isDisallowedEntry(name: string): boolean {
  return /(^|\/)(vbaProject\.bin|externalLinks\/|embeddings\/|activeX\/|connections\.xml)/i.test(
    name,
  );
}

async function readEntry(
  handle: Awaited<ReturnType<typeof fs.open>>,
  entry: ZipEntry,
): Promise<Buffer> {
  const header = Buffer.alloc(30);
  await readExactly(handle, header, 0, header.byteLength, entry.localHeaderOffset);
  if (header.readUInt32LE(0) !== LOCAL_SIGNATURE) throw invalidFile();
  const flags = header.readUInt16LE(6);
  const method = header.readUInt16LE(8);
  const nameLength = header.readUInt16LE(26);
  const extraLength = header.readUInt16LE(28);
  if ((flags & 0x0001) !== 0) {
    throw new ExcelPdfProcessingError(
      ERROR_CODES.excelPdfPasswordProtected,
      'Encrypted ZIP entries are not supported.',
    );
  }
  if (method !== entry.method) throw invalidFile();
  const localName = Buffer.alloc(nameLength);
  await readExactly(handle, localName, 0, nameLength, entry.localHeaderOffset + 30);
  if (localName.toString('utf8') !== entry.name) throw invalidFile();
  const compressed = Buffer.alloc(entry.compressedBytes);
  await readExactly(
    handle,
    compressed,
    0,
    compressed.byteLength,
    entry.localHeaderOffset + 30 + nameLength + extraLength,
  );

  let output: Buffer;
  if (entry.method === 0) {
    output = compressed;
  } else {
    try {
      output = inflateRawSync(compressed, {
        maxOutputLength: Math.max(1, entry.uncompressedBytes + 1),
      });
    } catch {
      throw invalidFile();
    }
  }
  if (output.byteLength !== entry.uncompressedBytes || crc32(output) !== entry.crc32) {
    throw invalidFile();
  }
  return output;
}

async function readExactly(
  handle: Awaited<ReturnType<typeof fs.open>>,
  buffer: Buffer,
  offset: number,
  length: number,
  position: number,
): Promise<void> {
  let read = 0;
  while (read < length) {
    const result = await handle.read(buffer, offset + read, length - read, position + read);
    if (result.bytesRead === 0) throw invalidFile();
    read += result.bytesRead;
  }
}

function invalidFile(): ExcelPdfProcessingError {
  return new ExcelPdfProcessingError(
    ERROR_CODES.excelPdfFileInvalid,
    'The uploaded workbook is not a valid XLSX archive.',
  );
}

function zipBomb(): ExcelPdfProcessingError {
  return new ExcelPdfProcessingError(
    ERROR_CODES.excelPdfZipBomb,
    'The uploaded workbook exceeds safe archive expansion limits.',
  );
}

let crcTable: Uint32Array | null = null;

function crc32(buffer: Buffer): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) {
        value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      }
      crcTable[index] = value >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
