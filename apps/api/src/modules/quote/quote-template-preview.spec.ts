import ExcelJS from 'exceljs';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildQuoteTemplatePreview } from './quote-template-preview';

const TEMPLATE_ID = '11111111-1111-4111-8111-111111111111';
const TEMPLATE_KEY = 'quote-template/2026/10/private.xlsx';
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zt9sAAAAASUVORK5CYII=',
  'base64',
);
const REAL_TEMPLATE = readFileSync(
  resolve(process.cwd(), '../../assets/templates/B2B_Quotation_Template.xlsx'),
);

async function previewWorkbook(
  configure: (workbook: ExcelJS.Workbook, sheet: ExcelJS.Worksheet) => void,
) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Quotation');
  configure(workbook, sheet);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

const source = {
  id: TEMPLATE_ID,
  name: 'Private quotation template',
  version: 4,
  sheetName: 'Quotation',
};

describe('buildQuoteTemplatePreview', () => {
  it('loads the real configured B2B quotation workbook', async () => {
    const preview = await buildQuoteTemplatePreview(REAL_TEMPLATE, {
      id: TEMPLATE_ID,
      name: 'B2B Quotation Template',
      version: 1,
      sheetName: 'Quotation',
    });

    expect(preview.sheetName).toBe('Quotation');
    expect(preview.rowCount).toBeGreaterThanOrEqual(7);
    expect(preview.columnCount).toBeGreaterThanOrEqual(7);
    expect(preview.truncated).toBe(false);
    expect(preview.rows[6]?.cells.slice(0, 7).map((cell) => cell.value)).toEqual([
      'Product SKU',
      'Product Image',
      'Product Name',
      'Unit Price ([CURRENCY])',
      'Packing Quantity (PCS / carton)',
      'Case Dimensions (L × W × H cm)',
      'Gross Weight (KG)',
    ]);
    expect(JSON.stringify(preview)).not.toContain('storageKey');
  });

  it('renders safe content, styles, merges and embedded images without exposing the storage key', async () => {
    const buffer = await previewWorkbook((workbook, sheet) => {
      sheet.getCell('A1').value = 'B2B Quotation Template';
      sheet.getCell('A1').font = { bold: true, size: 18, color: { argb: 'FFFFFFFF' } };
      sheet.getCell('A1').fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF0F766E' },
      };
      sheet.getCell('A1').alignment = { horizontal: 'center', wrapText: true };
      sheet.mergeCells('A1:C1');
      sheet.getCell('B2').value = { formula: '1+1', result: 2 };
      sheet.getColumn(1).width = 24;
      sheet.getRow(1).height = 30;
      const imageId = workbook.addImage({ buffer: PNG as never, extension: 'png' });
      sheet.addImage(imageId, 'A3:B4');
    });

    const preview = await buildQuoteTemplatePreview(buffer, source);

    expect(preview).toMatchObject({
      templateId: TEMPLATE_ID,
      name: source.name,
      version: 4,
      sheetName: 'Quotation',
      truncated: false,
      merges: ['A1:C1'],
    });
    expect(preview.rows[0]?.cells[0]).toMatchObject({
      address: 'A1',
      value: 'B2B Quotation Template',
      kind: 'text',
      style: {
        bold: true,
        fontSize: 18,
        fontColor: '#FFFFFF',
        fillColor: '#0F766E',
        horizontal: 'center',
        wrapText: true,
      },
    });
    expect(preview.rows[1]?.cells[1]).toMatchObject({ value: '=1+1', kind: 'formula' });
    expect(preview.columns[0]).toMatchObject({ letter: 'A', width: 24 });
    expect(preview.images).toHaveLength(1);
    expect(preview.images[0]).toMatchObject({ row: 3, column: 1, mimeType: 'image/png' });
    expect(preview.images[0]?.dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(JSON.stringify(preview)).not.toContain(TEMPLATE_KEY);
    expect(JSON.stringify(preview)).not.toContain('storageKey');
  });

  it('bounds large sheets to 200 rows and 40 columns', async () => {
    const buffer = await previewWorkbook((_workbook, sheet) => {
      sheet.getCell(205, 43).value = 'last';
    });

    const preview = await buildQuoteTemplatePreview(buffer, source);

    expect(preview.rowCount).toBe(200);
    expect(preview.columnCount).toBe(40);
    expect(preview.truncated).toBe(true);
    expect(preview.rows).toHaveLength(200);
    expect(preview.columns).toHaveLength(40);
  });

  it('rejects a workbook whose requested worksheet no longer exists', async () => {
    const buffer = await previewWorkbook((_workbook, sheet) => {
      sheet.getCell('A1').value = 'Preview';
    });

    await expect(
      buildQuoteTemplatePreview(buffer, { ...source, sheetName: 'Missing' }),
    ).rejects.toMatchObject({
      details: { reason: 'WORKSHEET_NOT_FOUND', availableSheets: ['Quotation'] },
    });
  });
});
