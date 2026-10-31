import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import {
  MIN_QUOTATION_IMAGE_DIMENSION_PX,
  QuotationImageFitError,
  excelColumnWidthToPixels,
  fitImageIntoCell,
  measureQuotationImageCell,
  pixelsToEmu,
  pointsToPixels,
} from './quotation-image-fitter';

function expectInsideCell(
  fit: ReturnType<typeof fitImageIntoCell>,
  width: number,
  height: number,
): void {
  expect(fit.offsetX).toBeGreaterThanOrEqual(0);
  expect(fit.offsetY).toBeGreaterThanOrEqual(0);
  expect(fit.offsetX + fit.width).toBeLessThanOrEqual(width + 0.5);
  expect(fit.offsetY + fit.height).toBeLessThanOrEqual(height + 0.5);
}

describe('fitImageIntoCell', () => {
  it.each([
    ['square', 100, 100],
    ['landscape', 4000, 3000],
    ['portrait', 3000, 4000],
  ])('fits and centers a %s source image without distortion', (_label, width, height) => {
    const fit = fitImageIntoCell({
      sourceWidth: width,
      sourceHeight: height,
      cellWidthPx: 144,
      cellHeightPx: 112,
      paddingPx: 4,
    });

    expect(fit.width / fit.height).toBeCloseTo(width / height, 8);
    expectInsideCell(fit, 144, 112);
    expect(fit.width === 136 || fit.height === 104).toBe(true);
  });

  it('upscales a small image instead of capping scale at one', () => {
    const fit = fitImageIntoCell({
      sourceWidth: 1,
      sourceHeight: 1,
      cellWidthPx: 144,
      cellHeightPx: 112,
      paddingPx: 4,
    });

    expect(fit.scale).toBeGreaterThan(1);
    expect(fit.width).toBe(104);
    expect(fit.height).toBe(104);
    expect(fit.offsetX).toBe(20);
    expect(fit.offsetY).toBe(4);
  });

  it.each([40, 84, 120])('uses the actual %ipt row height', (rowHeightPoints) => {
    const cellHeightPx = pointsToPixels(rowHeightPoints);
    const fit = fitImageIntoCell({
      sourceWidth: 100,
      sourceHeight: 100,
      cellWidthPx: 144,
      cellHeightPx,
      paddingPx: 4,
    });

    expect(fit.height).toBeCloseTo(Math.min(136, cellHeightPx - 8), 8);
    expectInsideCell(fit, 144, cellHeightPx);
  });

  it.each([
    [0, 100, 100, 100, 4, 'IMAGE_SOURCE_DIMENSIONS_INVALID'],
    [-1, 100, 100, 100, 4, 'IMAGE_SOURCE_DIMENSIONS_INVALID'],
    [Number.NaN, 100, 100, 100, 4, 'IMAGE_SOURCE_DIMENSIONS_INVALID'],
    [100, Number.POSITIVE_INFINITY, 100, 100, 4, 'IMAGE_SOURCE_DIMENSIONS_INVALID'],
    [100, 100, 0, 100, 4, 'IMAGE_CELL_DIMENSIONS_INVALID'],
    [100, 100, 100, -1, 4, 'IMAGE_CELL_DIMENSIONS_INVALID'],
    [100, 100, 100, 100, -1, 'IMAGE_PADDING_INVALID'],
    [100, 100, 100, 100, Number.NaN, 'IMAGE_PADDING_INVALID'],
    [100, 100, 20, 20, 10, 'IMAGE_PADDING_EXCEEDS_CELL'],
  ])(
    'rejects invalid dimensions and padding',
    (sourceW, sourceH, cellW, cellH, padding, reason) => {
      expect(() =>
        fitImageIntoCell({
          sourceWidth: sourceW,
          sourceHeight: sourceH,
          cellWidthPx: cellW,
          cellHeightPx: cellH,
          paddingPx: padding,
        }),
      ).toThrowError(expect.objectContaining({ reason }));
    },
  );

  it('rejects structurally unusable cells and extreme aspect ratios', () => {
    expect(() =>
      fitImageIntoCell({
        sourceWidth: 100,
        sourceHeight: 100,
        cellWidthPx: MIN_QUOTATION_IMAGE_DIMENSION_PX,
        cellHeightPx: 100,
        paddingPx: 4,
      }),
    ).toThrowError(expect.objectContaining({ reason: 'IMAGE_CELL_TOO_SMALL' }));

    expect(() =>
      fitImageIntoCell({
        sourceWidth: 4_000,
        sourceHeight: 10,
        cellWidthPx: 144,
        cellHeightPx: 112,
        paddingPx: 4,
      }),
    ).toThrowError(expect.objectContaining({ reason: 'IMAGE_RENDER_TOO_SMALL' }));
  });
});

describe('quotation image dimensions', () => {
  it('converts Excel column width and row points consistently', () => {
    expect(excelColumnWidthToPixels(20.5625)).toBe(144);
    expect(pointsToPixels(84)).toBe(112);
    expect(pixelsToEmu(12.5)).toBe(119_063);
  });

  it('rejects hidden rows, hidden columns, merged cells and invalid row heights', () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Quotation');
    worksheet.getColumn(2).width = 20.5625;
    worksheet.getRow(8).height = 84;

    expect(measureQuotationImageCell(worksheet, 8, 2)).toEqual({
      widthPx: 144,
      heightPx: 112,
    });

    worksheet.getColumn(2).hidden = true;
    expect(() => measureQuotationImageCell(worksheet, 8, 2)).toThrowError(
      expect.objectContaining({ reason: 'IMAGE_COLUMN_HIDDEN' }),
    );
    worksheet.getColumn(2).hidden = false;

    worksheet.getRow(8).hidden = true;
    expect(() => measureQuotationImageCell(worksheet, 8, 2)).toThrowError(
      expect.objectContaining({ reason: 'IMAGE_ROW_HIDDEN' }),
    );
    worksheet.getRow(8).hidden = false;

    worksheet.mergeCells('B8:C8');
    expect(() => measureQuotationImageCell(worksheet, 8, 2)).toThrowError(
      expect.objectContaining({ reason: 'IMAGE_CELL_MERGED' }),
    );

    worksheet.unMergeCells('B8:C8');
    worksheet.getRow(8).height = 0;
    expect(() => measureQuotationImageCell(worksheet, 8, 2)).toThrow();
    expect(QuotationImageFitError.prototype).toBeInstanceOf(Error);
  });
});
