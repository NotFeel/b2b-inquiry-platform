import ExcelJS from 'exceljs';

const DEFAULT_MAX_DIGIT_WIDTH_PX = 7;
const DEFAULT_COLUMN_WIDTH = 9;
const DEFAULT_ROW_HEIGHT_POINTS = 15;
const PIXELS_PER_POINT_AT_96_DPI = 96 / 72;

export const QUOTATION_IMAGE_PADDING_PX = 4;
export const MIN_QUOTATION_IMAGE_DIMENSION_PX = 16;
export const EMU_PER_PIXEL_AT_96_DPI = 9_525;

export interface ImageFitInput {
  sourceWidth: number;
  sourceHeight: number;
  cellWidthPx: number;
  cellHeightPx: number;
  paddingPx: number;
}

export interface ImageFitResult {
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  scale: number;
}

export interface ImageCellDimensions {
  widthPx: number;
  heightPx: number;
}

export class QuotationImageFitError extends Error {
  constructor(
    message: string,
    readonly reason: string,
  ) {
    super(message);
    this.name = 'QuotationImageFitError';
  }
}

function isFinitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

/** Converts an ExcelJS character width to the 96-DPI calibration used by Excel. */
export function excelColumnWidthToPixels(width: number): number {
  if (!isFinitePositive(width)) {
    throw new QuotationImageFitError(
      'The image column width is invalid.',
      'IMAGE_COLUMN_WIDTH_INVALID',
    );
  }
  const characterPixels =
    ((256 * width + Math.trunc(128 / DEFAULT_MAX_DIGIT_WIDTH_PX)) / 256) *
    DEFAULT_MAX_DIGIT_WIDTH_PX;
  return Math.floor(characterPixels);
}

export function pointsToPixels(points: number): number {
  if (!isFinitePositive(points)) {
    throw new QuotationImageFitError(
      'The product row height is invalid.',
      'IMAGE_ROW_HEIGHT_INVALID',
    );
  }
  return points * PIXELS_PER_POINT_AT_96_DPI;
}

export function pixelsToEmu(pixels: number): number {
  if (!Number.isFinite(pixels) || pixels < 0) {
    throw new QuotationImageFitError('The image offset is invalid.', 'IMAGE_OFFSET_INVALID');
  }
  return Math.round(pixels * EMU_PER_PIXEL_AT_96_DPI);
}

/**
 * Measures the exact drawing canvas for one product row. The template remains
 * authoritative: hidden or merged image cells are rejected instead of guessed.
 */
export function measureQuotationImageCell(
  worksheet: ExcelJS.Worksheet,
  rowNumber: number,
  columnNumber: number,
): ImageCellDimensions {
  const column = worksheet.getColumn(columnNumber);
  if (column.hidden) {
    throw new QuotationImageFitError('The product image column is hidden.', 'IMAGE_COLUMN_HIDDEN');
  }

  const row = worksheet.getRow(rowNumber);
  if (row.hidden) {
    throw new QuotationImageFitError('The product image row is hidden.', 'IMAGE_ROW_HIDDEN');
  }
  if (row.getCell(columnNumber).isMerged) {
    throw new QuotationImageFitError(
      'The product image cell cannot be merged.',
      'IMAGE_CELL_MERGED',
    );
  }

  const width = column.width ?? DEFAULT_COLUMN_WIDTH;
  const defaultHeight = worksheet.properties.defaultRowHeight;
  const height =
    row.height ??
    (typeof defaultHeight === 'number' && defaultHeight > 0
      ? defaultHeight
      : DEFAULT_ROW_HEIGHT_POINTS);

  return {
    widthPx: excelColumnWidthToPixels(width),
    heightPx: pointsToPixels(height),
  };
}

/** Aspect-ratio-preserving fit with explicit centering and no artificial scale cap. */
export function fitImageIntoCell(input: ImageFitInput): ImageFitResult {
  if (!isFinitePositive(input.sourceWidth) || !isFinitePositive(input.sourceHeight)) {
    throw new QuotationImageFitError(
      'The source image dimensions must be finite positive numbers.',
      'IMAGE_SOURCE_DIMENSIONS_INVALID',
    );
  }
  if (!isFinitePositive(input.cellWidthPx) || !isFinitePositive(input.cellHeightPx)) {
    throw new QuotationImageFitError(
      'The image cell dimensions must be finite positive numbers.',
      'IMAGE_CELL_DIMENSIONS_INVALID',
    );
  }
  if (!Number.isFinite(input.paddingPx) || input.paddingPx < 0) {
    throw new QuotationImageFitError(
      'The image padding must be a finite non-negative number.',
      'IMAGE_PADDING_INVALID',
    );
  }

  const availableWidth = input.cellWidthPx - input.paddingPx * 2;
  const availableHeight = input.cellHeightPx - input.paddingPx * 2;
  if (availableWidth <= 0 || availableHeight <= 0) {
    throw new QuotationImageFitError(
      'The image padding exceeds the available cell area.',
      'IMAGE_PADDING_EXCEEDS_CELL',
    );
  }
  if (
    availableWidth < MIN_QUOTATION_IMAGE_DIMENSION_PX ||
    availableHeight < MIN_QUOTATION_IMAGE_DIMENSION_PX
  ) {
    throw new QuotationImageFitError(
      'The product image cell is too small for a usable image.',
      'IMAGE_CELL_TOO_SMALL',
    );
  }

  const scale = Math.min(availableWidth / input.sourceWidth, availableHeight / input.sourceHeight);
  const width = input.sourceWidth * scale;
  const height = input.sourceHeight * scale;
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width < MIN_QUOTATION_IMAGE_DIMENSION_PX ||
    height < MIN_QUOTATION_IMAGE_DIMENSION_PX
  ) {
    throw new QuotationImageFitError(
      'The scaled product image would be too small to display.',
      'IMAGE_RENDER_TOO_SMALL',
    );
  }

  return {
    width,
    height,
    offsetX: (input.cellWidthPx - width) / 2,
    offsetY: (input.cellHeightPx - height) / 2,
    scale,
  };
}
