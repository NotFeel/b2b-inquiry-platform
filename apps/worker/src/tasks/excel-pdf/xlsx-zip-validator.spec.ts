import { deflateRawSync } from 'node:zlib';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ERROR_CODES } from '@b2b/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { validateXlsxArchive } from './xlsx-zip-validator';

interface ZipFixtureEntry {
  name: string;
  data: Buffer | string;
  method?: 0 | 8;
  flags?: number;
  declaredCompressedBytes?: number;
  declaredUncompressedBytes?: number;
}

const CONTENT_TYPES =
  '<?xml version="1.0" encoding="UTF-8"?>' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Override PartName="/xl/workbook.xml" ' +
  'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
  '</Types>';
const WORKBOOK =
  '<?xml version="1.0" encoding="UTF-8"?>' +
  '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"/>';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => fs.rm(path, { recursive: true, force: true })),
  );
});

describe('XLSX ZIP security validation', () => {
  it('accepts a minimal non-macro XLSX package', async () => {
    const path = await fixture([
      { name: '[Content_Types].xml', data: CONTENT_TYPES },
      { name: 'xl/workbook.xml', data: WORKBOOK },
    ]);

    await expect(validateXlsxArchive(path)).resolves.toEqual({
      entryCount: 2,
      uncompressedBytes: Buffer.byteLength(CONTENT_TYPES) + Buffer.byteLength(WORKBOOK),
    });
  });

  it('rejects fake and truncated ZIP files', async () => {
    const fake = await fixtureBytes(Buffer.from('not a zip workbook'));
    await expect(validateXlsxArchive(fake)).rejects.toMatchObject({
      code: ERROR_CODES.excelPdfFileInvalid,
    });

    const truncated = await fixtureBytes(
      Buffer.from(buildZip([{ name: 'x', data: 'x' }])).subarray(0, 20),
    );
    await expect(validateXlsxArchive(truncated)).rejects.toMatchObject({
      code: ERROR_CODES.excelPdfFileInvalid,
    });
  });

  it('requires the workbook package entry point', async () => {
    const path = await fixture([{ name: '[Content_Types].xml', data: CONTENT_TYPES }]);
    await expect(validateXlsxArchive(path)).rejects.toMatchObject({
      code: ERROR_CODES.excelPdfFileInvalid,
    });
  });

  it('rejects macro content types even when the binary part is absent', async () => {
    const path = await fixture([
      {
        name: '[Content_Types].xml',
        data: CONTENT_TYPES.replace(
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml',
          'application/vnd.ms-excel.sheet.macroEnabled.main+xml',
        ),
      },
      { name: 'xl/workbook.xml', data: WORKBOOK },
    ]);
    await expect(validateXlsxArchive(path)).rejects.toMatchObject({
      code: ERROR_CODES.excelPdfMacroNotAllowed,
    });
  });

  it.each([
    'xl/vbaProject.bin',
    'xl/embeddings/oleObject1.bin',
    'xl/externalLinks/externalLink1.xml',
  ])('rejects the unsafe workbook part %s', async (name) => {
    const path = await fixture([
      { name: '[Content_Types].xml', data: CONTENT_TYPES },
      { name: 'xl/workbook.xml', data: WORKBOOK },
      { name, data: 'unsafe' },
    ]);
    await expect(validateXlsxArchive(path)).rejects.toMatchObject({
      code: name.includes('vbaProject')
        ? ERROR_CODES.excelPdfMacroNotAllowed
        : ERROR_CODES.excelPdfExternalLinkNotAllowed,
    });
  });

  it('rejects external relationship targets', async () => {
    const path = await fixture([
      { name: '[Content_Types].xml', data: CONTENT_TYPES },
      { name: 'xl/workbook.xml', data: WORKBOOK },
      {
        name: 'xl/_rels/workbook.xml.rels',
        data:
          '<Relationships><Relationship Id="rId1" Target="https://example.com/data" ' +
          'TargetMode="External"/></Relationships>',
      },
    ]);
    await expect(validateXlsxArchive(path)).rejects.toMatchObject({
      code: ERROR_CODES.excelPdfExternalLinkNotAllowed,
    });
  });

  it('rejects encrypted entries', async () => {
    const path = await fixture([
      { name: '[Content_Types].xml', data: CONTENT_TYPES, flags: 0x0001 },
      { name: 'xl/workbook.xml', data: WORKBOOK },
    ]);
    await expect(validateXlsxArchive(path)).rejects.toMatchObject({
      code: ERROR_CODES.excelPdfPasswordProtected,
    });
  });

  it('rejects an excessive expansion ratio before inflating the entry', async () => {
    const path = await fixture([
      { name: '[Content_Types].xml', data: CONTENT_TYPES },
      { name: 'xl/workbook.xml', data: WORKBOOK },
      { name: 'xl/media/bomb.bin', data: Buffer.alloc(1_200_000) },
    ]);
    await expect(validateXlsxArchive(path)).rejects.toMatchObject({
      code: ERROR_CODES.excelPdfZipBomb,
    });
  });

  it('rejects a declared entry larger than the configured expansion limit', async () => {
    const path = await fixture([
      { name: '[Content_Types].xml', data: CONTENT_TYPES },
      { name: 'xl/workbook.xml', data: WORKBOOK },
      {
        name: 'xl/media/oversized.bin',
        data: Buffer.from('small-central-directory-fixture'),
        declaredUncompressedBytes: 256 * 1024 * 1024 + 1,
      },
    ]);
    await expect(validateXlsxArchive(path)).rejects.toMatchObject({
      code: ERROR_CODES.excelPdfZipBomb,
    });
  });
});

async function fixture(entries: ZipFixtureEntry[]): Promise<string> {
  return fixtureBytes(buildZip(entries));
}

async function fixtureBytes(bytes: Buffer): Promise<string> {
  const root = await fs.mkdtemp(join(tmpdir(), 'b2b-xlsx-validator-'));
  temporaryDirectories.push(root);
  const path = join(root, 'fixture.xlsx');
  await fs.writeFile(path, bytes, { mode: 0o600 });
  return path;
}

function buildZip(entries: ZipFixtureEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data);
    const method = entry.method ?? 8;
    const compressed = method === 8 ? deflateRawSync(data) : data;
    const flags = 0x0800 | (entry.flags ?? 0);
    const crc = crc32(data);
    const compressedBytes = entry.declaredCompressedBytes ?? compressed.byteLength;
    const uncompressedBytes = entry.declaredUncompressedBytes ?? data.byteLength;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressedBytes, 18);
    local.writeUInt32LE(uncompressedBytes, 22);
    local.writeUInt16LE(name.byteLength, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressedBytes, 20);
    central.writeUInt32LE(uncompressedBytes, 24);
    central.writeUInt16LE(name.byteLength, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(localOffset, 42);
    centralParts.push(central, name);
    localOffset += local.byteLength + name.byteLength + compressed.byteLength;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirectory.byteLength, 12);
  eocd.writeUInt32LE(localOffset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, eocd]);
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
