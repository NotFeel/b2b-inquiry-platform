import ExcelJS from 'exceljs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  QuotationImageEmbedError,
  assertQuotationProductImageAnchors,
  embedQuotationProductImages,
} from './quotation-image-embedder';
import type { QuotationWorkbookProduct } from './quotation-workbook';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zt9sAAAAASUVORK5CYII=',
  'base64',
);
const PNG_WITH_MARKER = Buffer.concat([PNG, Buffer.from('row-specific-image')]);

function image(width = 1, height = 1, buffer = PNG): QuotationWorkbookProduct['image'] {
  return { buffer, width, height, extension: 'png' };
}

function product(productId: string, productImage = image()): QuotationWorkbookProduct {
  return {
    productId,
    sku: productId,
    englishName: productId,
    unitPrice: '10.00',
    cartonQuantity: 1,
    cartonDimensions: '1 × 1 × 1 cm',
    cartonGrossWeightKg: '1.000',
    image: productImage,
  };
}

function worksheetFixture(): ExcelJS.Worksheet {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Quotation');
  worksheet.getColumn(2).width = 20.5625;
  for (const row of [8, 9, 10]) worksheet.getRow(row).height = 84;
  worksheet.getCell('B8').value = 'placeholder';
  return worksheet;
}

describe('embedQuotationProductImages', () => {
  it('binds shuffled image input by productId to B8, B9 and B10', () => {
    const worksheet = worksheetFixture();
    const images = new Map([
      ['p3', image(4000, 3000, PNG_WITH_MARKER)],
      ['p1', image(3000, 4000)],
      ['p2', image(100, 100)],
    ]);
    const products = [
      product('p1', images.get('p1')),
      product('p2', images.get('p2')),
      product('p3', images.get('p3')),
    ];

    const anchors = embedQuotationProductImages({
      worksheet,
      products,
      images,
      itemStartRow: 8,
      imageColumn: 2,
    });

    expect(anchors.map((anchor) => [anchor.productId, anchor.rowNumber])).toEqual([
      ['p1', 8],
      ['p2', 9],
      ['p3', 10],
    ]);
    expect(anchors.map((anchor) => anchor.fit.scale)).toEqual([
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
    ]);
    const drawing = worksheet.getImages() as unknown as Array<{
      range: {
        tl: { nativeCol: number; nativeRow: number };
        ext: { width: number; height: number };
        editAs: string;
      };
    }>;
    expect(drawing.map((item) => item.range.tl.nativeRow)).toEqual([7, 8, 9]);
    const workbook = worksheet.workbook;
    const embeddedHashes = drawing.map((_, index) => {
      const imageId = worksheet.getImages()[index]?.imageId;
      const media = imageId === undefined ? undefined : workbook.getImage(Number(imageId));
      if (!media?.buffer) throw new Error('Embedded media missing');
      return createHash('sha256').update(Buffer.from(media.buffer)).digest('hex');
    });
    expect(embeddedHashes).toEqual([
      createHash('sha256').update(PNG).digest('hex'),
      createHash('sha256').update(PNG).digest('hex'),
      createHash('sha256').update(PNG_WITH_MARKER).digest('hex'),
    ]);
    for (const anchor of anchors) {
      expect(anchor.fit.width / anchor.fit.height).toBeCloseTo(
        anchor.productId === 'p1' ? 3000 / 4000 : anchor.productId === 'p3' ? 4000 / 3000 : 1,
        8,
      );
    }
    expect(drawing.every((item) => item.range.editAs === 'oneCell')).toBe(true);
    expect(() => assertQuotationProductImageAnchors(worksheet, anchors, 8)).not.toThrow();
  });

  it('rejects missing, extra, duplicate and invalid images before returning a partial mapping', () => {
    const worksheet = worksheetFixture();
    const products = [product('p1'), product('p2')];

    expect(() =>
      embedQuotationProductImages({
        worksheet,
        products,
        images: new Map([['p1', image()]]),
        itemStartRow: 8,
        imageColumn: 2,
      }),
    ).toThrowError(expect.objectContaining({ reason: 'IMAGE_MISSING' }));

    expect(() =>
      embedQuotationProductImages({
        worksheet,
        products,
        images: new Map([
          ['p1', image()],
          ['p2', image()],
          ['extra', image()],
        ]),
        itemStartRow: 8,
        imageColumn: 2,
      }),
    ).toThrowError(expect.objectContaining({ reason: 'IMAGE_EXTRA' }));

    expect(() =>
      embedQuotationProductImages({
        worksheet,
        products: [product('p1'), product('p1')],
        images: new Map([['p1', image()]]),
        itemStartRow: 8,
        imageColumn: 2,
      }),
    ).toThrowError(expect.objectContaining({ reason: 'IMAGE_PRODUCT_ID_DUPLICATE' }));

    expect(() =>
      embedQuotationProductImages({
        worksheet,
        products,
        images: new Map([
          ['p1', image()],
          ['p2', { ...image(), width: 0 }],
        ]),
        itemStartRow: 8,
        imageColumn: 2,
      }),
    ).toThrowError(expect.objectContaining({ reason: 'IMAGE_DIMENSIONS_MISSING' }));
  });

  it('rejects hidden and merged B cells for a product row', () => {
    const hidden = worksheetFixture();
    hidden.getRow(9).hidden = true;
    expect(() =>
      embedQuotationProductImages({
        worksheet: hidden,
        products: [product('p1'), product('p2')],
        images: new Map([
          ['p1', image()],
          ['p2', image()],
        ]),
        itemStartRow: 8,
        imageColumn: 2,
      }),
    ).toThrowError(expect.objectContaining({ reason: 'IMAGE_ROW_HIDDEN' }));

    const merged = worksheetFixture();
    merged.mergeCells('B9:C9');
    expect(() =>
      embedQuotationProductImages({
        worksheet: merged,
        products: [product('p1'), product('p2')],
        images: new Map([
          ['p1', image()],
          ['p2', image()],
        ]),
        itemStartRow: 8,
        imageColumn: 2,
      }),
    ).toThrowError(expect.objectContaining({ reason: 'IMAGE_CELL_MERGED' }));
  });

  it('detects a post-write anchor drift', () => {
    const worksheet = worksheetFixture();
    const anchors = embedQuotationProductImages({
      worksheet,
      products: [product('p1')],
      images: new Map([['p1', image()]]),
      itemStartRow: 8,
      imageColumn: 2,
    });
    const drawing = worksheet.getImages()[0] as unknown as {
      range: { tl: { nativeRow: number } };
    };
    if (drawing) drawing.range.tl.nativeRow = 8;

    expect(() => assertQuotationProductImageAnchors(worksheet, anchors, 8)).toThrowError(
      expect.objectContaining({ reason: 'IMAGE_ANCHOR_INVALID' }),
    );
    expect(QuotationImageEmbedError.prototype).toBeInstanceOf(Error);
  });
});
