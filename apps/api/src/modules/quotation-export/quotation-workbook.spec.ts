import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import {
  buildQuotationWorkbook,
  quotationFilename,
  safeExcelText,
  type QuotationWorkbookProduct,
} from './quotation-workbook';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zt9sAAAAASUVORK5CYII=',
  'base64',
);

function product(overrides: Partial<QuotationWorkbookProduct> = {}): QuotationWorkbookProduct {
  return {
    productId: '11111111-1111-4111-8111-111111111111',
    sku: 'SKU-001',
    englishName: 'Steel gate',
    unitPrice: '15.93',
    cartonQuantity: 4,
    cartonDimensions: '40 × 30 × 30 cm',
    cartonGrossWeightKg: '12.500',
    image: { buffer: PNG, extension: 'png', width: 1, height: 1 },
    ...overrides,
  };
}

describe('safeExcelText', () => {
  it.each(['=SUM(A1:A2)', '+1+1', '-2+3', '@SUM(A1)', '\t=1', '\r=1', '\n=1', '   =1'])(
    'prefixes formula-like text %s with an apostrophe',
    (value) => {
      expect(safeExcelText(value)).toBe(`'${value}`);
    },
  );

  it('leaves ordinary customer text unchanged', () => {
    expect(safeExcelText('Example Ltd.')).toBe('Example Ltd.');
  });
});

describe('buildQuotationWorkbook', () => {
  it('builds a readable, styled Price List with one embedded image per product', async () => {
    const buffer = await buildQuotationWorkbook({
      header: {
        companyName: '=HYPERLINK("https://invalid")',
        contactPerson: 'Jerry',
        email: 'sales@example.com',
        phone: '+86 190 7428 9250',
        quotationTitle: '@malicious title',
      },
      currencyCode: 'USD',
      markupPercent: '15',
      exchangeRate: '0.1385',
      generatedAt: new Date('2026-10-30T10:30:00.000Z'),
      products: [
        product(),
        product({
          productId: '22222222-2222-4222-8222-222222222222',
          sku: '+SKU-002',
          englishName: '-Formula product',
          unitPrice: '115.00',
        }),
      ],
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    const sheet = workbook.getWorksheet('Price List');
    expect(sheet).toBeDefined();
    if (!sheet) throw new Error('Price List worksheet missing');

    expect(sheet.getCell('A1').value).toBe('\'=HYPERLINK("https://invalid")');
    expect(sheet.getCell('A5').value).toBe("'@malicious title");
    expect(sheet.getCell('A6').value).toContain('Currency: USD');
    expect(sheet.getCell('A6').value).toContain('1 CNY = 0.1385 USD');
    expect(sheet.getCell('C7').value).toBe('Product Name');
    expect(sheet.getCell('D7').value).toBe('Unit Price (USD)');
    expect(sheet.getCell('A8').value).toBe('SKU-001');
    expect(sheet.getCell('C8').value).toBe('Steel gate');
    expect(sheet.getCell('D8').value).toBe(15.93);
    expect(sheet.getCell('D8').numFmt).toBe('0.00');
    expect(sheet.getCell('A9').value).toBe("'+SKU-002");
    expect(sheet.getCell('C9').value).toBe("'-Formula product");
    expect(sheet.getCell('D9').value).toBe(115);
    expect(sheet.getCell('D9').numFmt).toBe('0.00');
    expect(sheet.getImages()).toHaveLength(2);
    expect(sheet.views[0]).toMatchObject({ state: 'frozen', ySplit: 7 });
    expect(sheet.autoFilter).toBe('A7:G7');
    expect(sheet.pageSetup.orientation).toBe('landscape');
    expect(sheet.pageSetup.fitToPage).toBe(true);
    expect(sheet.pageSetup.fitToWidth).toBe(1);
    expect(sheet.pageSetup.printTitlesRow).toBe('1:7');
    expect(sheet.pageSetup.printArea).toBe('A1:G9');

    const serialized = JSON.stringify(sheet.getSheetValues());
    expect(serialized).not.toContain('priceCny');
    expect(serialized).not.toContain('storageKey');
    expect(serialized).not.toContain('costCny');
  });
});

describe('quotationFilename', () => {
  it('uses the target currency and a stable UTC timestamp', () => {
    expect(quotationFilename('USD', new Date('2026-10-30T10:30:00.000Z'))).toBe(
      'Quotation_USD_20261030_103000.xlsx',
    );
  });
});
