import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { ERROR_CODES } from '@b2b/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { normaliseXlsxForPdf, validateXlsxArchive } from './xlsx-zip-validator';

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

describe('XLSX print normalisation', () => {
  it('sets every sheet to A4 landscape and removes repeated print titles without changing media', async () => {
    const workbook =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<definedNames><definedName name="_xlnm.Print_Titles" localSheetId="0">' +
      "'Products'!$1:$6</definedName></definedNames>" +
      '<sheets><sheet name="Products" sheetId="1" r:id="rId1" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/>' +
      '</sheets></workbook>';
    const worksheet =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<sheetPr/><dimension ref="A1:D20"/>' +
      '<pageMargins left="0.3" right="0.3" top="0.4" bottom="0.4" header="0.2" footer="0.2"/>' +
      '<pageSetup paperSize="1" orientation="portrait" fitToWidth="0" fitToHeight="2"/>' +
      '<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Company</t></is></c></row>' +
      '</sheetData></worksheet>';
    const media = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02]);
    const input = await fixture([
      { name: '[Content_Types].xml', data: CONTENT_TYPES },
      { name: 'xl/workbook.xml', data: workbook },
      { name: 'xl/worksheets/sheet1.xml', data: worksheet },
      { name: 'xl/styles.xml', data: '<styleSheet/>' },
      { name: 'xl/media/image1.png', data: media },
    ]);
    const output = join(dirname(input), 'print.xlsx');

    await normaliseXlsxForPdf(input, output);
    const entries = await readZipEntries(output);

    expect(entries.get('xl/workbook.xml')?.toString('utf8')).not.toContain('Print_Titles');
    const normalisedWorksheet = entries.get('xl/worksheets/sheet1.xml')?.toString('utf8') ?? '';
    expect(normalisedWorksheet).toContain('<pageSetUpPr fitToPage="1"/>');
    expect(normalisedWorksheet).toContain(
      'paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"',
    );
    expect(normalisedWorksheet).toContain('<t>Company</t>');
    expect(entries.get('xl/styles.xml')?.toString('utf8')).toBe('<styleSheet/>');
    expect(entries.get('xl/media/image1.png')).toEqual(media);
    await expect(validateXlsxArchive(output)).resolves.toMatchObject({ entryCount: 5 });
  });

  it('inserts page setup in schema order when sheetPr and pageSetup are absent', async () => {
    const worksheet =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<dimension ref="A1:D20"/><sheetData/>' +
      '<drawing r:id="rId1" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/>' +
      '<tableParts count="1"><tablePart r:id="rId2"/></tableParts></worksheet>';
    const input = await fixture([
      { name: '[Content_Types].xml', data: CONTENT_TYPES },
      { name: 'xl/workbook.xml', data: WORKBOOK },
      { name: 'xl/worksheets/sheet1.xml', data: worksheet },
    ]);
    const output = join(dirname(input), 'print.xlsx');

    await normaliseXlsxForPdf(input, output);
    const xml =
      (await readZipEntries(output)).get('xl/worksheets/sheet1.xml')?.toString('utf8') ?? '';

    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>')).toBe(true);
    expect(xml.indexOf('<sheetPr>')).toBeLessThan(xml.indexOf('<dimension'));
    expect(xml.indexOf('<pageSetup')).toBeLessThan(xml.indexOf('<drawing'));
    expect(xml.indexOf('<pageSetup')).toBeLessThan(xml.indexOf('<tableParts'));
    expect(xml).toContain('<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>');
  });

  it('ignores nested extLst nodes when placing pageSetup in a WPS worksheet', async () => {
    const worksheet =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:G12"/>' +
      '<sheetData><row r="7"><c r="A7" t="inlineStr"><is><t>Product SKU</t></is></c></row></sheetData>' +
      '<autoFilter ref="A7:G7"><extLst/></autoFilter>' +
      '<mergeCells count="1"><mergeCell ref="A1:G1"/></mergeCells>' +
      '<pageMargins left="0.25" right="0.25" top="0.45" bottom="0.45" header="0.2" footer="0.2"/>' +
      '<headerFooter/><drawing r:id="rId1" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/>' +
      '</worksheet>';
    const input = await fixture([
      { name: '[Content_Types].xml', data: CONTENT_TYPES },
      { name: 'xl/workbook.xml', data: WORKBOOK },
      { name: 'xl/worksheets/sheet1.xml', data: worksheet },
    ]);
    const output = join(dirname(input), 'print.xlsx');

    await normaliseXlsxForPdf(input, output);
    const xml =
      (await readZipEntries(output)).get('xl/worksheets/sheet1.xml')?.toString('utf8') ?? '';

    const autoFilterEnd = xml.indexOf('</autoFilter>');
    const pageMargins = xml.indexOf('<pageMargins');
    const pageSetup = xml.indexOf('<pageSetup');
    expect(pageSetup).toBeGreaterThan(autoFilterEnd);
    expect(pageSetup).toBeGreaterThan(pageMargins);
    expect(pageSetup).toBeLessThan(xml.indexOf('<headerFooter'));
    expect(xml.slice(xml.indexOf('<autoFilter'), autoFilterEnd)).not.toContain('<pageSetup');
  });

  it('preserves tab and outline properties before pageSetUpPr', async () => {
    const worksheet =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<sheetPr><tabColor rgb="FFFF0000"/><outlinePr summaryBelow="1"/>' +
      '</sheetPr><dimension ref="A1:D20"/><sheetData/></worksheet>';
    const input = await fixture([
      { name: '[Content_Types].xml', data: CONTENT_TYPES },
      { name: 'xl/workbook.xml', data: WORKBOOK },
      { name: 'xl/worksheets/sheet1.xml', data: worksheet },
    ]);
    const output = join(dirname(input), 'print.xlsx');

    await normaliseXlsxForPdf(input, output);
    const xml =
      (await readZipEntries(output)).get('xl/worksheets/sheet1.xml')?.toString('utf8') ?? '';

    expect(xml.indexOf('<tabColor')).toBeLessThan(xml.indexOf('<outlinePr'));
    expect(xml.indexOf('<outlinePr')).toBeLessThan(xml.indexOf('<pageSetUpPr'));
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

async function readZipEntries(path: string): Promise<Map<string, Buffer>> {
  const archive = await fs.readFile(path);
  const eocd = findEocd(archive);
  const count = eocd.readUInt16LE(10);
  const centralSize = eocd.readUInt32LE(12);
  const centralOffset = eocd.readUInt32LE(16);
  const entries = new Map<string, Buffer>();
  let offset = centralOffset;
  for (let index = 0; index < count; index += 1) {
    if (archive.readUInt32LE(offset) !== 0x02014b50) throw new Error('invalid central directory');
    const method = archive.readUInt16LE(offset + 10);
    const compressedBytes = archive.readUInt32LE(offset + 20);
    const nameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const localOffset = archive.readUInt32LE(offset + 42);
    const name = archive.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    const localNameLength = archive.readUInt16LE(localOffset + 26);
    const localExtraLength = archive.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = archive.subarray(dataOffset, dataOffset + compressedBytes);
    entries.set(name, method === 8 ? inflateRawSync(compressed) : compressed);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  if (offset !== centralOffset + centralSize) throw new Error('invalid central directory size');
  return entries;
}

function findEocd(archive: Buffer): Buffer {
  for (let offset = archive.byteLength - 22; offset >= 0; offset -= 1) {
    if (archive.readUInt32LE(offset) === 0x06054b50) return archive.subarray(offset, offset + 22);
  }
  throw new Error('missing ZIP end record');
}
