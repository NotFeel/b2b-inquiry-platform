import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ERROR_CODES } from '@b2b/contracts';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { ProductBulkImportParser, parseSafePriceFormula } from './product-bulk-import-parser';

const fixturePath = resolve(process.cwd(), '../../docs/凡士林.xlsx');

async function firstTwoProductRows(source: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(source);
  const sheet = zip.file('xl/worksheets/sheet1.xml');
  if (!sheet) throw new Error('fixture worksheet missing');
  const xml = (await sheet.async('string'))
    .replace(/<dimension ref="A1:S1001"\/>/, '<dimension ref="A1:S3"/>')
    .replace(/<autoFilter ref="A1:S4"/, '<autoFilter ref="A1:S3"')
    .replace(/<drawing r:id="rId2"\/>/, '')
    .replace(/<row r="(?:[4-9]|\d{2,})"[\s\S]*?<\/row>/g, '');
  const rels = zip.file('xl/worksheets/_rels/sheet1.xml.rels');
  if (rels) {
    zip.file(
      'xl/worksheets/_rels/sheet1.xml.rels',
      (await rels.async('string')).replace(/<Relationship Id="rId2"[^>]*\/>/, ''),
    );
  }
  zip.file('xl/worksheets/sheet1.xml', xml);
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }));
}

describe('parseSafePriceFormula', () => {
  it('evaluates the confirmed CNY expressions with Decimal arithmetic', () => {
    expect(parseSafePriceFormula('=4.7*1.15')).toBe('5.4050');
    expect(parseSafePriceFormula('=3.8*1.15')).toBe('4.3700');
    expect(parseSafePriceFormula('(2.5 + 1.5) / 2')).toBe('2.0000');
  });

  it('rejects functions, references, names and division by zero', () => {
    expect(() => parseSafePriceFormula('=SUM(1,2)')).toThrow(ERROR_CODES.importFormulaNotAllowed);
    expect(() => parseSafePriceFormula('=A1*2')).toThrow(ERROR_CODES.importFormulaNotAllowed);
    expect(() => parseSafePriceFormula('=1/0')).toThrow(ERROR_CODES.importFormulaNotAllowed);
    expect(() => parseSafePriceFormula('=1e3')).toThrow(ERROR_CODES.importFormulaNotAllowed);
  });
});

describe('ProductBulkImportParser', () => {
  it('maps the legacy Price List columns without executing arbitrary formulas', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Price List');
    sheet.addRow([
      'Product Code',
      'Product Image',
      'Product Name',
      'Price per Unit (CNY)',
      'Price per Unit (CNY)',
      'Packing Quantity (PCS)',
      'Case Dimensions (L×W×H cm)',
      'Gross Weight (KG)',
    ]);
    sheet.addRow([
      'LEGACY-1',
      '',
      'Legacy rose',
      null,
      { formula: '4.7*1.15', result: 5.405 },
      168,
      '42*28*51',
      20,
    ]);
    const parsed = await new ProductBulkImportParser().parse(
      Buffer.from(await workbook.xlsx.writeBuffer()),
    );

    expect(parsed.templateVersion).toBe('wps-price-list-v1');
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows[0]).toMatchObject({
      sku: 'LEGACY-1',
      nameEn: 'Legacy rose',
      priceCny: '5.4050',
      cartonQuantity: 168,
      cartonLengthCm: 42,
      cartonWidthCm: 28,
      cartonHeightCm: 51,
      cartonWeightKg: '20.000',
    });
  });

  it('extracts the WPS DISPIMG images and maps them to the matching product rows', async () => {
    const workbook = await firstTwoProductRows(await readFile(fixturePath));
    const parsed = await new ProductBulkImportParser().parse(workbook);

    expect(parsed.templateVersion).toBe('optimized-v1');
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows.map((row) => row.sku)).toEqual(['WX-FSL-2610001', 'WX-FSL-2610002']);
    expect(parsed.imageCount).toBe(2);
    expect(parsed.rows[0]?.images).toHaveLength(1);
    expect(parsed.rows[1]?.images).toHaveLength(1);
    expect(parsed.rows[0]?.images[0]).toMatchObject({
      source: 'wps-cellimage',
      rowNumber: 2,
      columnNumber: 18,
      mimeType: 'image/jpeg',
    });
    expect(parsed.rows[1]?.images[0]).toMatchObject({
      source: 'wps-cellimage',
      rowNumber: 3,
      columnNumber: 18,
      mimeType: 'image/jpeg',
    });
    expect(parsed.rows[0]?.images[0]?.sha256).not.toBe(parsed.rows[1]?.images[0]?.sha256);
  });

  it('keeps zero values distinct from blanks and converts product cm to integer mm', async () => {
    const workbook = await firstTwoProductRows(await readFile(fixturePath));
    const parsed = await new ProductBulkImportParser().parse(workbook);
    const first = parsed.rows[0]!;

    expect(first.lengthMm).toBe(70);
    expect(first.widthMm).toBe(60);
    expect(first.heightMm).toBe(60);
    expect(first.cartonQuantity).toBe(192);
    expect(first.priceCny).toBe('4.7000');
    expect(first.sortOrder).toBe(10);
  });

  it('rejects a real external WPS relationship instead of treating it as a placeholder', async () => {
    const source = await firstTwoProductRows(await readFile(fixturePath));
    const zip = await JSZip.loadAsync(source);
    const relsPath = 'xl/_rels/cellimages.xml.rels';
    const rels = zip.file(relsPath);
    if (!rels) throw new Error('fixture cell image relationships missing');
    zip.file(
      relsPath,
      (await rels.async('string')).replace(
        'Target="NULL" TargetMode="External"',
        'Target="https://example.com/product.png" TargetMode="External"',
      ),
    );

    await expect(
      new ProductBulkImportParser().parse(
        Buffer.from(await zip.generateAsync({ type: 'nodebuffer' })),
      ),
    ).rejects.toThrow('products.import.errors.externalContent');
  });

  it('fails image mapping when a DISPIMG formula references the WPS NULL placeholder', async () => {
    const source = await firstTwoProductRows(await readFile(fixturePath));
    const zip = await JSZip.loadAsync(source);
    const cellImagesPath = 'xl/cellimages.xml';
    const cellImages = zip.file(cellImagesPath);
    if (!cellImages) throw new Error('fixture cell images missing');
    zip.file(
      cellImagesPath,
      (await cellImages.async('string')).replace('r:embed="rId1"', 'r:embed="rId10"'),
    );

    const parsed = await new ProductBulkImportParser().parse(
      Buffer.from(await zip.generateAsync({ type: 'nodebuffer' })),
    );

    expect(parsed.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: ERROR_CODES.importImageMappingInvalid }),
      ]),
    );
  });
});
