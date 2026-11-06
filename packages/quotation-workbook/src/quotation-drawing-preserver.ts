import ExcelJS from 'exceljs';
import { createHash } from 'node:crypto';

interface DrawingPosition {
  nativeCol: number;
  nativeRow: number;
  nativeColOff: number;
  nativeRowOff: number;
}

interface DrawingRange {
  tl: DrawingPosition;
  br?: DrawingPosition;
  ext?: { width: number; height: number };
  editAs?: string;
}

interface DrawingImage {
  type: 'image';
  imageId: string;
  range: DrawingRange;
}

interface WorksheetMediaInternal {
  _media?: DrawingImage[];
}

export interface TemplateDrawingImageSnapshot {
  imageId: number;
  mediaSha256: string;
  range: DrawingRange;
}

export interface TemplateDrawingSnapshot {
  fixedImages: TemplateDrawingImageSnapshot[];
  productImageIds: number[];
}

export interface CaptureTemplateDrawingsOptions {
  workbook: ExcelJS.Workbook;
  worksheet: ExcelJS.Worksheet;
  headerRow: number;
  itemStartRow: number;
  footerStartRow: number;
  imageColumn: number;
}

export class QuotationDrawingPreserveError extends Error {
  constructor(
    message: string,
    readonly reason: string,
  ) {
    super(message);
    this.name = 'QuotationDrawingPreserveError';
  }
}

function imageBytes(workbook: ExcelJS.Workbook, imageId: number): Uint8Array {
  const image = workbook.getImage(imageId) as (ExcelJS.Image & { base64?: string }) | undefined;
  if (image?.buffer) return image.buffer as unknown as Uint8Array;
  if (image?.base64) return Buffer.from(image.base64, 'base64');
  throw new QuotationDrawingPreserveError(
    'A template drawing media file could not be read.',
    'TEMPLATE_MEDIA_UNREADABLE',
  );
}

function hash(buffer: Uint8Array): string {
  return createHash('sha256').update(buffer).digest('hex');
}

function cloneRange(range: DrawingRange): DrawingRange {
  return {
    tl: { ...range.tl },
    ...(range.br ? { br: { ...range.br } } : {}),
    ...(range.ext ? { ext: { ...range.ext } } : {}),
    ...(range.editAs ? { editAs: range.editAs } : {}),
  };
}

function classifyImage(
  image: DrawingImage,
  options: CaptureTemplateDrawingsOptions,
): 'fixed' | 'product' {
  const productStart0 = options.itemStartRow - 1;
  const productEnd0 = options.footerStartRow - 2;
  const imageColumn0 = options.imageColumn - 1;
  const tl = image.range.tl;
  const br = image.range.br;

  if (tl.nativeRow < productStart0 && br && br.nativeRow >= productStart0) {
    throw new QuotationDrawingPreserveError(
      'A template image crosses into the product data area.',
      'TEMPLATE_IMAGE_ANCHOR_AMBIGUOUS',
    );
  }

  if (tl.nativeCol === imageColumn0 && tl.nativeRow === options.headerRow - 1) {
    throw new QuotationDrawingPreserveError(
      'An image anchored on the header row needs manual template confirmation.',
      'TEMPLATE_IMAGE_ANCHOR_AMBIGUOUS',
    );
  }

  if (tl.nativeRow < productStart0 || tl.nativeRow > productEnd0) return 'fixed';
  if (tl.nativeCol !== imageColumn0) return 'fixed';

  if (br) {
    const rowDelta = br.nativeRow - tl.nativeRow;
    const columnDelta = br.nativeCol - tl.nativeCol;
    // ExcelJS represents a one-cell range such as B8:B8 with the bottom-right
    // marker at the next cell boundary (C9). Accept only that single-cell
    // boundary form; anything larger can span rows or columns and is unsafe.
    const endsAtSingleCellBoundary =
      rowDelta >= 0 && rowDelta <= 1 && columnDelta >= 0 && columnDelta <= 1;
    if (!endsAtSingleCellBoundary) {
      throw new QuotationDrawingPreserveError(
        'A product-area image spans multiple cells or product rows.',
        'TEMPLATE_IMAGE_ANCHOR_AMBIGUOUS',
      );
    }
  }

  return 'product';
}

/** Captures every template-owned drawing before any row/style mutation. */
export function captureTemplateDrawings(
  options: CaptureTemplateDrawingsOptions,
): TemplateDrawingSnapshot {
  const fixedImages: TemplateDrawingImageSnapshot[] = [];
  const productImageIds: number[] = [];
  const images = options.worksheet.getImages() as unknown as DrawingImage[];

  for (const image of images) {
    const imageId = Number(image.imageId);
    if (!Number.isInteger(imageId) || imageId < 0) {
      throw new QuotationDrawingPreserveError(
        'A template image has an invalid media identifier.',
        'TEMPLATE_IMAGE_ID_INVALID',
      );
    }
    if (classifyImage(image, options) === 'product') {
      productImageIds.push(imageId);
      continue;
    }
    fixedImages.push({
      imageId,
      mediaSha256: hash(imageBytes(options.workbook, imageId)),
      range: cloneRange(image.range),
    });
  }

  return { fixedImages, productImageIds };
}

/** Removes only product-area images classified from the pre-mutation snapshot. */
export function removeTemplateProductImages(
  worksheet: ExcelJS.Worksheet,
  snapshot: TemplateDrawingSnapshot,
): void {
  if (snapshot.productImageIds.length === 0) return;
  const ids = new Set(snapshot.productImageIds.map(String));
  const internal = worksheet as unknown as WorksheetMediaInternal;
  if (!Array.isArray(internal._media)) {
    throw new QuotationDrawingPreserveError(
      'The worksheet drawing collection is unavailable.',
      'TEMPLATE_DRAWINGS_UNAVAILABLE',
    );
  }
  internal._media = internal._media.filter((image) => !ids.has(String(image.imageId)));
}

function sameRange(left: DrawingRange, right: DrawingRange): boolean {
  return (
    left.tl.nativeCol === right.tl.nativeCol &&
    left.tl.nativeRow === right.tl.nativeRow &&
    left.tl.nativeColOff === right.tl.nativeColOff &&
    left.tl.nativeRowOff === right.tl.nativeRowOff &&
    Boolean(left.br) === Boolean(right.br) &&
    (!left.br ||
      !right.br ||
      (left.br.nativeCol === right.br.nativeCol &&
        left.br.nativeRow === right.br.nativeRow &&
        left.br.nativeColOff === right.br.nativeColOff &&
        left.br.nativeRowOff === right.br.nativeRowOff)) &&
    Boolean(left.ext) === Boolean(right.ext) &&
    (!left.ext ||
      !right.ext ||
      (left.ext.width === right.ext.width && left.ext.height === right.ext.height)) &&
    (left.editAs ?? 'oneCell') === (right.editAs ?? 'oneCell')
  );
}

/** Reopens the final XLSX and verifies fixed template media and anchors are unchanged. */
export async function assertTemplateDrawingsPreserved(
  output: Buffer,
  sheetName: string,
  snapshot: TemplateDrawingSnapshot,
): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(output as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  } catch {
    throw new QuotationDrawingPreserveError(
      'The generated workbook could not be reopened for drawing verification.',
      'OUTPUT_WORKBOOK_UNREADABLE',
    );
  }
  const worksheet = workbook.getWorksheet(sheetName);
  if (!worksheet) {
    throw new QuotationDrawingPreserveError(
      'The generated workbook lost its quotation worksheet.',
      'OUTPUT_WORKSHEET_MISSING',
    );
  }
  const images = worksheet.getImages() as unknown as DrawingImage[];
  if (images.length < snapshot.fixedImages.length) {
    throw new QuotationDrawingPreserveError(
      'A template-owned image disappeared during export.',
      'TEMPLATE_IMAGE_MISSING',
    );
  }

  snapshot.fixedImages.forEach((expected, index) => {
    const actual = images[index];
    if (!actual) {
      throw new QuotationDrawingPreserveError(
        'A template-owned image disappeared during export.',
        'TEMPLATE_IMAGE_MISSING',
      );
    }
    const actualHash = hash(imageBytes(workbook, Number(actual.imageId)));
    if (actualHash !== expected.mediaSha256) {
      throw new QuotationDrawingPreserveError(
        'A template-owned image media file changed during export.',
        'TEMPLATE_IMAGE_MEDIA_CHANGED',
      );
    }
    if (!sameRange(actual.range, expected.range)) {
      throw new QuotationDrawingPreserveError(
        'A template-owned image anchor changed during export.',
        'TEMPLATE_IMAGE_ANCHOR_CHANGED',
      );
    }
  });
}
