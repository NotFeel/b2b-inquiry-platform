import ExcelJS from 'exceljs';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildQuotationWorkbookFromTemplate,
  type QuotationTemplateWorkbookInput,
} from './quotation-template-workbook';
import type { QuotationWorkbookProduct } from './quotation-workbook';

const TEMPLATE = readFileSync(
  resolve(process.cwd(), '../../assets/templates/B2B_Quotation_Template.xlsx'),
);
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zt9sAAAAASUVORK5CYII=',
  'base64',
);

const FIELD_MAPPING = {
  A: 'product.sku',
  B: 'product.image',
  C: 'product.name',
  D: 'product.price_cny',
  E: 'product.carton_qty',
  F: 'product.carton_size_cm',
  G: 'product.carton_weight_kg',
} as const;

function product(
  index = 1,
  overrides: Partial<QuotationWorkbookProduct> = {},
): QuotationWorkbookProduct {
  return {
    productId: `product-${index}`,
    sku: `SKU-${String(index).padStart(3, '0')}`,
    englishName: `Product ${index}`,
    unitPrice: index === 1 ? '15.93' : '115.00',
    cartonQuantity: index + 3,
    cartonDimensions: `${40 + index} × 30 × 30 cm`,
    cartonGrossWeightKg: index === 1 ? '12.500' : '13.750',
    image: { buffer: PNG, extension: 'png', width: 1, height: 1 },
    ...overrides,
  };
}

function input(
  products: QuotationWorkbookProduct[],
  overrides: Partial<QuotationTemplateWorkbookInput> = {},
): QuotationTemplateWorkbookInput {
  return {
    templateBuffer: TEMPLATE,
    sheetName: 'Quotation',
    headerRow: 7,
    itemStartRow: 8,
    fieldMapping: FIELD_MAPPING,
    header: {
      companyName: 'Example Ltd.',
      contactPerson: 'Jerry',
      email: 'sales@example.com',
      phone: '+86 190 7428 9250',
      quotationTitle: 'October Price List',
    },
    currencyCode: 'USD',
    markupPercent: '15',
    exchangeRate: '0.1385',
    products,
    generatedAt: new Date('2026-10-30T10:30:00.000Z'),
    ...overrides,
  };
}

async function readWorkbook(buffer: Buffer): Promise<ExcelJS.Worksheet> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  const worksheet = workbook.getWorksheet('Quotation');
  if (!worksheet) throw new Error('Quotation worksheet missing');
  return worksheet;
}

async function workbookBuffer(rows: string[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Quotation');
  for (const row of rows) worksheet.addRow(row);
  worksheet.getColumn(2).width = 13;
  worksheet.getRow(7).height = 84;
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describe('buildQuotationWorkbookFromTemplate', () => {
  it('fills the real B2B template, keeps its spacer/footer and embeds both product images', async () => {
    const source = await readWorkbook(TEMPLATE);
    const buffer = await buildQuotationWorkbookFromTemplate(
      input([
        product(1, {
          sku: '+SKU-001',
          englishName: '=HYPERLINK("https://invalid")',
        }),
        product(2),
      ]),
    );
    const worksheet = await readWorkbook(buffer);

    expect(worksheet.getCell('A1').value).toBe('Example Ltd.');
    expect(worksheet.getCell('A2').value).toBe('Contact person: Jerry');
    expect(worksheet.getCell('A3').value).toBe('Email: sales@example.com');
    expect(worksheet.getCell('A4').value).toBe('Phone/WhatsApp/WeChat: +86 190 7428 9250');
    expect(worksheet.getCell('A5').value).toBe('October Price List');
    expect(String(worksheet.getCell('A6').value)).toContain('Currency: USD');
    expect(String(worksheet.getCell('A6').value)).toContain('Exchange rate: 0.1385 USD');
    expect(String(worksheet.getCell('A6').value)).toContain('Markup: 15%');
    expect(worksheet.getCell('D7').value).toBe('Unit Price (USD)');

    expect(worksheet.getCell('A8').value).toBe("'+SKU-001");
    expect(worksheet.getCell('B8').value).toBeNull();
    expect(worksheet.getCell('C8').value).toBe('\'=HYPERLINK("https://invalid")');
    expect(worksheet.getCell('D8').value).toBe(15.93);
    expect(worksheet.getCell('D8').numFmt).toBe('0.00');
    expect(worksheet.getCell('E8').value).toBe(4);
    expect(worksheet.getCell('F8').value).toBe('41 × 30 × 30 cm');
    expect(worksheet.getCell('G8').value).toBe(12.5);
    expect(worksheet.getCell('G8').numFmt).toBe('0.000');

    expect(worksheet.getCell('A9').value).toBe('SKU-002');
    expect(worksheet.getCell('C9').value).toBe('Product 2');
    expect(worksheet.getCell('D9').value).toBe(115);
    expect(worksheet.getCell('E9').value).toBe(5);
    expect(worksheet.getCell('G9').value).toBe(13.75);
    const productImageRows = worksheet
      .getImages()
      .map((image) => image.range.tl.nativeRow + 1)
      .filter((row) => row >= 8);
    expect(productImageRows).toEqual([8, 9]);

    expect(source.rowCount).toBe(12);
    expect(worksheet.getRow(8).height).toBe(84);
    expect(worksheet.getCell('A8').border).toEqual(source.getCell('A8').border);
    expect(worksheet.getCell('A8').alignment).toMatchObject({
      horizontal: 'center',
      vertical: 'middle',
    });
    expect(worksheet.model.merges).toEqual(
      expect.arrayContaining(['A1:G1', 'A2:G2', 'A3:G3', 'A4:G4', 'A5:G5', 'A6:G6']),
    );
    expect(worksheet.autoFilter).toBe('A7:G9');
    expect(worksheet.pageSetup.printArea).toBe('A1:G11');
    expect(worksheet.pageSetup.printTitlesRow).toBe('1:7');
    expect(worksheet.getCell('A10').value).toBeNull();
    expect(String(worksheet.getCell('A11').value)).toContain('Prices are quoted in USD.');
    expect(worksheet.model.merges).toContain('A11:G11');
    expect(worksheet.views[0]).toMatchObject({
      state: 'frozen',
      ySplit: 7,
      topLeftCell: 'A8',
    });
  });

  it.each([1, 200])('resizes the data area safely for %i products', async (count) => {
    const products = Array.from({ length: count }, (_, index) => product(index + 1));
    const worksheet = await readWorkbook(await buildQuotationWorkbookFromTemplate(input(products)));
    const lastProductRow = 7 + count;
    const templateImageCount = (await readWorkbook(TEMPLATE)).getImages().length;

    expect(worksheet.getCell(`A${lastProductRow}`).value).toBe(
      `SKU-${String(count).padStart(3, '0')}`,
    );
    expect(worksheet.getCell(`D${lastProductRow}`).value).toBe(count === 1 ? 15.93 : 115);
    expect(worksheet.getImages()).toHaveLength(templateImageCount + count);
    expect(worksheet.autoFilter).toBe(`A7:G${lastProductRow}`);
    expect(worksheet.pageSetup.printArea).toBe(`A1:G${lastProductRow + 2}`);
    expect(worksheet.getCell(`A${lastProductRow + 1}`).value).toBeNull();
    expect(String(worksheet.getCell(`A${lastProductRow + 2}`).value)).toContain(
      'Prices are quoted in USD.',
    );
  });

  it('fills products below a dynamically detected Product SKU header without RATE or MARKUP', async () => {
    const templateBuffer = await workbookBuffer([
      ['[COMPANY NAME]'],
      ['Contact person: [CONTACT PERSON]'],
      ['Email: [EMAIL]'],
      ['Phone: [PHONE]'],
      ['[QUOTATION TITLE]'],
      [
        'Product SKU',
        'Product Image',
        'Product Name',
        'Unit Price ([CURRENCY])',
        'Packing Quantity (PCS / carton)',
        'Case Dimensions (L × W × H cm)',
        'Gross Weight (KG)',
      ],
      ['SAMPLE', '[Original product image]', 'Sample', '0.00', '1', 'L × W × H', '0'],
      ['Prices are quoted in [CURRENCY]. Please contact us for further details.'],
    ]);

    const worksheet = await readWorkbook(
      await buildQuotationWorkbookFromTemplate(
        input([product(1), product(2)], {
          templateBuffer,
          headerRow: 6,
          itemStartRow: 7,
        }),
      ),
    );

    expect(worksheet.getCell('A1').value).toBe('Example Ltd.');
    expect(worksheet.getCell('D6').value).toBe('Unit Price (USD)');
    expect(worksheet.getCell('A7').value).toBe('SKU-001');
    expect(worksheet.getCell('A8').value).toBe('SKU-002');
    expect(worksheet.getCell('A9').value).toContain('Prices are quoted in USD.');
    expect(worksheet.getImages().map((image) => image.range.tl.nativeRow + 1)).toEqual([7, 8]);
    expect(worksheet.autoFilter).toBe('A6:G8');
    expect(worksheet.pageSetup.printTitlesRow).toBe('1:6');
    expect(worksheet.views[0]).toMatchObject({
      state: 'frozen',
      ySplit: 6,
      topLeftCell: 'A7',
    });
  });

  it('fails instead of returning a partial workbook when the template cannot be read', async () => {
    await expect(
      buildQuotationWorkbookFromTemplate(
        input([product()], { templateBuffer: Buffer.from('not an xlsx') }),
      ),
    ).rejects.toMatchObject({ reason: 'WORKBOOK_UNREADABLE' });
  });

  it('fails when the configured worksheet or image column is missing', async () => {
    await expect(
      buildQuotationWorkbookFromTemplate(input([product()], { sheetName: 'Missing' })),
    ).rejects.toMatchObject({ reason: 'WORKSHEET_NOT_FOUND' });

    await expect(
      buildQuotationWorkbookFromTemplate(
        input([product()], {
          fieldMapping: {
            A: 'product.sku',
            C: 'product.name',
            D: 'product.price_cny',
            E: 'product.carton_qty',
            F: 'product.carton_size_cm',
            G: 'product.carton_weight_kg',
          },
        }),
      ),
    ).rejects.toMatchObject({ reason: 'IMAGE_COLUMN_MISSING' });
  });
});
