import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { looksLikeXlsx } from './file-validation';

async function workbookBuffer(
  options: {
    fillerBeforeContentTypes?: boolean;
    includeWorkbook?: boolean;
    includeMacro?: boolean;
  } = {},
): Promise<Buffer> {
  const zip = new JSZip();
  if (options.fillerBeforeContentTypes) {
    zip.file('xl/media/filler.bin', Buffer.alloc(8192, 0x41));
  }
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
  );
  if (options.includeWorkbook !== false) {
    zip.file('xl/workbook.xml', '<?xml version="1.0"?><workbook/>');
  }
  if (options.includeMacro) zip.file('xl/vbaProject.bin', Buffer.from([1, 2, 3]));
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' }));
}

describe('looksLikeXlsx', () => {
  it('accepts the current image-heavy WPS fixture', async () => {
    const fixture = await readFile(resolve(process.cwd(), '../../docs/凡士林.xlsx'));
    expect(looksLikeXlsx(fixture)).toBe(true);
  });

  it('finds OOXML entries in the ZIP central directory for large image-heavy workbooks', async () => {
    expect(looksLikeXlsx(await workbookBuffer({ fillerBeforeContentTypes: true }))).toBe(true);
  });

  it('rejects macro-enabled workbooks', async () => {
    expect(looksLikeXlsx(await workbookBuffer({ includeMacro: true }))).toBe(false);
  });

  it('rejects ZIP files that are not Excel workbooks', async () => {
    expect(looksLikeXlsx(await workbookBuffer({ includeWorkbook: false }))).toBe(false);
    expect(looksLikeXlsx(Buffer.from('PK\\x03\\x04not-a-zip'))).toBe(false);
  });

  it('rejects truncated workbooks whose central directory is incomplete', async () => {
    const valid = await workbookBuffer();
    expect(looksLikeXlsx(valid.subarray(0, valid.byteLength - 8))).toBe(false);
  });
});
