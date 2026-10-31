import ExcelJS from 'exceljs';
import { createHash } from 'node:crypto';
import type { QuotationWorkbookProduct } from './quotation-workbook';
import {
  QUOTATION_IMAGE_PADDING_PX,
  QuotationImageFitError,
  fitImageIntoCell,
  measureQuotationImageCell,
  pixelsToEmu,
  type ImageFitResult,
} from './quotation-image-fitter';

type ProductImage = QuotationWorkbookProduct['image'];

export interface QuotationImageEmbedOptions {
  worksheet: ExcelJS.Worksheet;
  products: QuotationWorkbookProduct[];
  images: ReadonlyMap<string, ProductImage>;
  itemStartRow: number;
  imageColumn: number;
  paddingPx?: number;
}

export interface QuotationProductImageAnchor {
  productId: string;
  rowNumber: number;
  columnNumber: number;
  nativeCol: number;
  nativeRow: number;
  nativeColOff: number;
  nativeRowOff: number;
  widthPx: number;
  heightPx: number;
  fit: ImageFitResult;
  mediaSha256: string;
}

export class QuotationImageEmbedError extends Error {
  constructor(
    message: string,
    readonly reason: string,
  ) {
    super(message);
    this.name = 'QuotationImageEmbedError';
  }
}

function sourceDimensions(image: ProductImage): { width: number; height: number } {
  if (
    image.width === null ||
    image.height === null ||
    !Number.isFinite(image.width) ||
    !Number.isFinite(image.height) ||
    image.width <= 0 ||
    image.height <= 0
  ) {
    throw new QuotationImageEmbedError(
      'A product image has no usable dimensions.',
      'IMAGE_DIMENSIONS_MISSING',
    );
  }
  return { width: image.width, height: image.height };
}

function imageHash(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

function exactImageBuffer(buffer: Buffer): ExcelJS.Buffer {
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ExcelJS.Buffer;
}

/**
 * Embeds exactly one original image into B for each product row. The product ID
 * is the only binding key; image order and file names are never used as facts.
 */
export function embedQuotationProductImages(
  options: QuotationImageEmbedOptions,
): QuotationProductImageAnchor[] {
  const { worksheet, products, images, itemStartRow, imageColumn } = options;
  const paddingPx = options.paddingPx ?? QUOTATION_IMAGE_PADDING_PX;
  const productIds = new Set<string>();
  const rowNumbers = new Set<number>();
  const anchors: QuotationProductImageAnchor[] = [];

  for (const product of products) {
    if (!product.productId || productIds.has(product.productId)) {
      throw new QuotationImageEmbedError(
        'Product IDs must be non-empty and unique before embedding images.',
        'IMAGE_PRODUCT_ID_DUPLICATE',
      );
    }
    productIds.add(product.productId);
  }
  for (const productId of images.keys()) {
    if (!productIds.has(productId)) {
      throw new QuotationImageEmbedError(
        'An image has no matching selected product.',
        'IMAGE_EXTRA',
      );
    }
  }

  products.forEach((product, index) => {
    const rowNumber = itemStartRow + index;
    if (rowNumbers.has(rowNumber)) {
      throw new QuotationImageEmbedError(
        'Two products were mapped to the same image row.',
        'IMAGE_ROW_DUPLICATE',
      );
    }
    rowNumbers.add(rowNumber);

    const image = images.get(product.productId);
    if (!image) {
      throw new QuotationImageEmbedError(
        'A selected product has no original image.',
        'IMAGE_MISSING',
      );
    }

    const dimensions = sourceDimensions(image);
    let cell: { widthPx: number; heightPx: number };
    let fit: ImageFitResult;
    try {
      cell = measureQuotationImageCell(worksheet, rowNumber, imageColumn);
      fit = fitImageIntoCell({
        sourceWidth: dimensions.width,
        sourceHeight: dimensions.height,
        cellWidthPx: cell.widthPx,
        cellHeightPx: cell.heightPx,
        paddingPx,
      });
    } catch (error) {
      if (!(error instanceof QuotationImageFitError)) throw error;
      throw new QuotationImageEmbedError(error.message, error.reason);
    }

    const imageId = options.worksheet.workbook.addImage({
      buffer: exactImageBuffer(image.buffer),
      extension: image.extension,
    });
    const nativePosition = {
      tl: {
        // ExcelJS accepts native marker coordinates at runtime. They avoid the
        // lossy character-width conversion in its fractional { col, row } API.
        nativeCol: imageColumn - 1,
        nativeRow: rowNumber - 1,
        nativeColOff: pixelsToEmu(fit.offsetX),
        nativeRowOff: pixelsToEmu(fit.offsetY),
      },
      ext: { width: fit.width, height: fit.height },
      editAs: 'oneCell' as const,
    };
    worksheet.addImage(
      imageId,
      nativePosition as unknown as Parameters<ExcelJS.Worksheet['addImage']>[1],
    );

    anchors.push({
      productId: product.productId,
      rowNumber,
      columnNumber: imageColumn,
      nativeCol: imageColumn - 1,
      nativeRow: rowNumber - 1,
      nativeColOff: pixelsToEmu(fit.offsetX),
      nativeRowOff: pixelsToEmu(fit.offsetY),
      widthPx: cell.widthPx,
      heightPx: cell.heightPx,
      fit,
      mediaSha256: imageHash(image.buffer),
    });
  });

  assertQuotationProductImageAnchors(worksheet, anchors, itemStartRow);
  return anchors;
}

interface DrawingPositionModel {
  nativeCol: number;
  nativeRow: number;
  nativeColOff: number;
  nativeRowOff: number;
}

interface DrawingRangeModel {
  tl: DrawingPositionModel;
  ext?: { width: number; height: number };
  editAs?: string;
}

interface DrawingImageModel {
  imageId: string;
  range: DrawingRangeModel;
}

function drawingImages(worksheet: ExcelJS.Worksheet): DrawingImageModel[] {
  return worksheet.getImages() as unknown as DrawingImageModel[];
}

/** Re-opens the in-memory drawing model and proves each image stayed in its own B row. */
export function assertQuotationProductImageAnchors(
  worksheet: ExcelJS.Worksheet,
  expected: readonly QuotationProductImageAnchor[],
  itemStartRow: number,
): void {
  const imageColumn = expected[0]?.columnNumber;
  if (imageColumn === undefined) {
    throw new QuotationImageEmbedError(
      'No product image anchors were expected.',
      'IMAGE_ANCHORS_MISSING',
    );
  }

  const actual = drawingImages(worksheet).filter(
    (image) =>
      image.range.tl.nativeRow >= itemStartRow - 1 && image.range.tl.nativeCol === imageColumn - 1,
  );
  if (actual.length !== expected.length) {
    throw new QuotationImageEmbedError(
      'The workbook contains an unexpected number of product images.',
      'IMAGE_ANCHOR_COUNT_MISMATCH',
    );
  }

  expected.forEach((anchor, index) => {
    const image = actual[index];
    if (
      !image ||
      image.range.tl.nativeCol !== anchor.nativeCol ||
      image.range.tl.nativeRow !== anchor.nativeRow ||
      image.range.tl.nativeColOff !== anchor.nativeColOff ||
      image.range.tl.nativeRowOff !== anchor.nativeRowOff ||
      image.range.ext?.width !== anchor.fit.width ||
      image.range.ext?.height !== anchor.fit.height ||
      image.range.editAs !== 'oneCell'
    ) {
      throw new QuotationImageEmbedError(
        `The product image for row ${anchor.rowNumber} has an invalid anchor.`,
        'IMAGE_ANCHOR_INVALID',
      );
    }
    if (anchor.fit.width + anchor.fit.offsetX > anchor.widthPx + 0.5) {
      throw new QuotationImageEmbedError(
        `The product image for row ${anchor.rowNumber} overflows its cell.`,
        'IMAGE_ANCHOR_OVERFLOW',
      );
    }
    if (anchor.fit.height + anchor.fit.offsetY > anchor.heightPx + 0.5) {
      throw new QuotationImageEmbedError(
        `The product image for row ${anchor.rowNumber} overflows its cell.`,
        'IMAGE_ANCHOR_OVERFLOW',
      );
    }
  });
}
