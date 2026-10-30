import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import {
  inspectQuoteTemplateWorkbook,
} from './quote-template-parser';

const REAL_TEMPLATE = readFileSync(
  resolve(process.cwd(), '../../assets/templates/B2B_Quotation_Template.xlsx'),
);

async function workbookBuffer(rows: string[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Quotation');
  for (const row of rows) worksheet.addRow(row);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function productQuoteRows(): string[][] {
  return [
    ['[COMPANY NAME]'],
    ['Contact person: [CONTACT PERSON]'],
    ['Email: [EMAIL]'],
    ['Phone: [PHONE]'],
    ['[QUOTATION TITLE]'],
    ['Currency: [CURRENCY]  Exchange rate: [RATE]  Markup: [MARKUP]'],
    [
      'Product SKU',
      'Product Image',
      'Product Name',
      'Unit Price (USD)',
      'Packing Quantity (PCS / carton)',
      'Case Dimensions (L × W × H cm)',
      'Gross Weight (KG)',
    ],
    ['SKU-1', '', 'Product', '1.00', '4', '40 × 30 × 30 cm', '12.5'],
  ];
}

describe('inspectQuoteTemplateWorkbook', () => {
  it('detects the real B2B quotation template layout and all seven columns', async () => {
    const inspection = await inspectQuoteTemplateWorkbook(REAL_TEMPLATE, {
      templateType: 'product_quote',
    });

    expect(inspection).toMatchObject({
      sheetName: 'Quotation',
      availableSheets: ['Quotation'],
      headerRow: 7,
      itemStartRow: 8,
      requiredFieldsPresent: true,
      missingRequiredFields: [],
      duplicateFields: [],
      missingPlaceholders: [],
      placeholderRowsMismatch: [],
      layoutValid: true,
    });
    expect(inspection.fieldMapping).toEqual({
      A: 'product.sku',
      B: 'product.image',
      C: 'product.name',
      D: 'product.price_cny',
      E: 'product.carton_qty',
      F: 'product.carton_size_cm',
      G: 'product.carton_weight_kg',
    });
    expect(inspection.detectedHeaders).toHaveLength(7);
  });

  it('rejects a requested worksheet that does not exist', async () => {
    await expect(
      inspectQuoteTemplateWorkbook(REAL_TEMPLATE, {
        templateType: 'product_quote',
        sheetName: 'Missing',
      }),
    ).rejects.toMatchObject({
      details: {
        reason: 'WORKSHEET_NOT_FOUND',
        availableSheets: ['Quotation'],
      },
    });
  });

  it('rejects a workbook without a recognizable quote header', async () => {
    const buffer = await workbookBuffer([
      ['Company name'],
      ['Contact person'],
      ['Email'],
    ]);

    await expect(
      inspectQuoteTemplateWorkbook(buffer, { templateType: 'product_quote' }),
    ).rejects.toMatchObject({
      details: { reason: 'HEADER_NOT_FOUND' },
    });
  });

  it('marks required fields missing instead of accepting a partial template', async () => {
    const buffer = await workbookBuffer([
      ['Product SKU', 'Product Image', 'Gross Weight (KG)'],
      ['SKU-1', 'image.png', '12'],
    ]);

    const inspection = await inspectQuoteTemplateWorkbook(buffer, {
      templateType: 'product_quote',
    });

    expect(inspection.requiredFieldsPresent).toBe(false);
    expect(inspection.missingRequiredFields).toEqual([
      'product.name',
      'product.price_cny',
      'product.carton_qty',
      'product.carton_size_cm',
    ]);
  });

  it('rejects duplicate critical columns', async () => {
    const buffer = await workbookBuffer([
      ['Product SKU', 'Product Name', 'Unit Price (USD)', 'Product SKU'],
      ['SKU-1', 'Product', '1.00', 'SKU-2'],
    ]);

    const inspection = await inspectQuoteTemplateWorkbook(buffer, {
      templateType: 'product_quote',
    });

    expect(inspection.duplicateFields).toEqual(['product.sku']);
    expect(inspection.requiredFieldsPresent).toBe(false);
  });

  it('rejects a product quote template when a fixed placeholder is missing', async () => {
    const rows = productQuoteRows();
    rows[2] = ['Contact details supplied by the sales team'];

    const inspection = await inspectQuoteTemplateWorkbook(await workbookBuffer(rows), {
      templateType: 'product_quote',
    });

    expect(inspection.missingPlaceholders).toEqual(['[EMAIL]']);
    expect(inspection.layoutValid).toBe(false);
    expect(inspection.requiredFieldsPresent).toBe(false);
  });

  it('rejects moved placeholders even when the text is still present', async () => {
    const rows = productQuoteRows();
    rows[2] = ['Phone: [PHONE]'];
    rows[3] = ['Email: [EMAIL]'];

    const inspection = await inspectQuoteTemplateWorkbook(await workbookBuffer(rows), {
      templateType: 'product_quote',
    });

    expect(inspection.placeholderRowsMismatch).toEqual(['[EMAIL]', '[PHONE]']);
    expect(inspection.layoutValid).toBe(false);
    expect(inspection.requiredFieldsPresent).toBe(false);
  });

  it('rejects a moved header or first product row', async () => {
    const movedHeader = [[''], ...productQuoteRows()];
    const headerInspection = await inspectQuoteTemplateWorkbook(
      await workbookBuffer(movedHeader),
      { templateType: 'product_quote' },
    );
    expect(headerInspection).toMatchObject({
      headerRow: 8,
      itemStartRow: 9,
      layoutValid: false,
      requiredFieldsPresent: false,
    });

    const itemInspection = await inspectQuoteTemplateWorkbook(
      await workbookBuffer(productQuoteRows()),
      { templateType: 'product_quote', itemStartRow: 9 },
    );
    expect(itemInspection).toMatchObject({
      headerRow: 7,
      itemStartRow: 9,
      layoutValid: false,
      requiredFieldsPresent: false,
    });
  });
});
