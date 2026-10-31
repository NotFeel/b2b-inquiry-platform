import ExcelJS from 'exceljs';
import type { QuotationExportCurrency, QuotationExportHeader } from '@b2b/contracts';
import {
  QUOTATION_TEMPLATE_PLACEHOLDERS,
  type QuoteTemplateFieldKey,
} from '../quote/quote-template-parser';
import {
  QuotationDrawingPreserveError,
  assertTemplateDrawingsPreserved,
  captureTemplateDrawings,
  removeTemplateProductImages,
} from './quotation-drawing-preserver';
import { QuotationImageEmbedError, embedQuotationProductImages } from './quotation-image-embedder';
import { QuotationOoxmlError, ensureQuotationOoxmlImages } from './quotation-ooxml-package';
import { safeExcelText, type QuotationWorkbookProduct } from './quotation-workbook';

export interface QuotationTemplateWorkbookInput {
  templateBuffer: Buffer;
  sheetName: string;
  headerRow: number;
  itemStartRow: number;
  fieldMapping: Record<string, QuoteTemplateFieldKey>;
  header: QuotationExportHeader;
  currencyCode: QuotationExportCurrency;
  markupPercent: string;
  exchangeRate: string;
  products: QuotationWorkbookProduct[];
  generatedAt: Date;
}

export class QuotationTemplateWorkbookError extends Error {
  constructor(
    message: string,
    readonly reason: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'QuotationTemplateWorkbookError';
  }
}

function asTemplateWorkbookError(error: unknown): QuotationTemplateWorkbookError {
  if (error instanceof QuotationTemplateWorkbookError) return error;
  if (
    error instanceof QuotationImageEmbedError ||
    error instanceof QuotationDrawingPreserveError ||
    error instanceof QuotationOoxmlError
  ) {
    const diagnosticCodes =
      error instanceof QuotationOoxmlError && error.errors.length > 0
        ? ` (${error.errors.map((item) => item.code).join(', ')})`
        : '';
    return new QuotationTemplateWorkbookError(
      `${error.message}${diagnosticCodes}`,
      error.reason,
      error,
    );
  }
  return new QuotationTemplateWorkbookError(
    'The quotation workbook could not be generated safely.',
    'WORKBOOK_GENERATION_FAILED',
  );
}

interface MergePattern {
  startColumn: number;
  endColumn: number;
}

interface DataRowPattern {
  height: number | undefined;
  hidden: boolean;
  cellStyles: Partial<ExcelJS.Style>[];
  merges: MergePattern[];
}

interface ShiftedMerge {
  startColumn: number;
  endColumn: number;
  startRow: number;
  endRow: number;
}

function cloneStyle(style: Partial<ExcelJS.Style>): Partial<ExcelJS.Style> {
  return JSON.parse(JSON.stringify(style)) as Partial<ExcelJS.Style>;
}

function cellText(value: ExcelJS.CellValue): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (!value || typeof value !== 'object') return '';
  if ('richText' in value && Array.isArray(value.richText)) {
    return value.richText.map((part) => part.text).join('');
  }
  if ('text' in value && typeof value.text === 'string') return value.text;
  return '';
}

function columnNumber(worksheet: ExcelJS.Worksheet, letter: string): number | null {
  const normalized = letter.trim().toUpperCase();
  if (!/^[A-Z]{1,3}$/.test(normalized)) return null;
  const column = worksheet.getColumn(normalized);
  return column.number > 0 ? column.number : null;
}

function rowHasValues(worksheet: ExcelJS.Worksheet, rowNumber: number): boolean {
  const row = worksheet.getRow(rowNumber);
  for (let index = 1; index <= worksheet.columnCount; index += 1) {
    if (cellText(row.getCell(index).value).trim().length > 0) return true;
  }
  return false;
}

function rowContains(worksheet: ExcelJS.Worksheet, rowNumber: number, needle: string): boolean {
  const row = worksheet.getRow(rowNumber);
  for (let index = 1; index <= worksheet.columnCount; index += 1) {
    if (cellText(row.getCell(index).value).toUpperCase().includes(needle)) return true;
  }
  return false;
}

function findFooterStartRow(worksheet: ExcelJS.Worksheet, itemStartRow: number): number {
  for (let rowNumber = itemStartRow; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    if (rowContains(worksheet, rowNumber, QUOTATION_TEMPLATE_PLACEHOLDERS.currency)) {
      return rowNumber;
    }
  }

  // Older templates may omit the currency placeholder in their footer. Only
  // accept explicit footer language; otherwise keep the template unchanged and
  // let the normal row validation decide whether the structure is safe.
  const footerMarkers = ['PRICES ARE QUOTED', 'CONTACT US', 'FURTHER DETAILS'];
  for (let rowNumber = itemStartRow; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    if (footerMarkers.some((marker) => rowContains(worksheet, rowNumber, marker))) {
      return rowNumber;
    }
  }
  return worksheet.rowCount + 1;
}

function rowHasTemplateContent(worksheet: ExcelJS.Worksheet, rowNumber: number): boolean {
  if (rowHasValues(worksheet, rowNumber)) return true;
  const row = worksheet.getRow(rowNumber);
  if (row.height !== undefined) return true;
  for (let column = 1; column <= worksheet.columnCount; column += 1) {
    const cell = row.getCell(column);
    if (cell.border || cell.fill || cell.font || cell.numFmt || cell.alignment || cell.protection) {
      return true;
    }
  }
  return false;
}

/** Finds the contiguous product sample block immediately above the footer. */
function findSampleDataRows(
  worksheet: ExcelJS.Worksheet,
  itemStartRow: number,
  footerStartRow: number,
): number[] {
  const rows: number[] = [];
  for (let rowNumber = itemStartRow; rowNumber < footerStartRow; rowNumber += 1) {
    if (!rowHasTemplateContent(worksheet, rowNumber)) break;
    rows.push(rowNumber);
  }
  return rows;
}

function mergeCellsFromRange(worksheet: ExcelJS.Worksheet, range: string): ShiftedMerge | null {
  const [startCell, endCell] = range.split(':');
  if (!startCell || !endCell) return null;
  const start = worksheet.getCell(startCell);
  const end = worksheet.getCell(endCell);
  return {
    startColumn: start.fullAddress.col,
    endColumn: end.fullAddress.col,
    startRow: start.fullAddress.row,
    endRow: end.fullAddress.row,
  };
}

function rangeFor(merge: ShiftedMerge): string {
  const start = `${columnLetter(merge.startColumn)}${merge.startRow}`;
  const end = `${columnLetter(merge.endColumn)}${merge.endRow}`;
  return `${start}:${end}`;
}

function columnLetter(columnNumberValue: number): string {
  let value = columnNumberValue;
  let result = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function captureRowPatterns(
  worksheet: ExcelJS.Worksheet,
  sampleRowNumbers: readonly number[],
  dataMerges: ShiftedMerge[],
): DataRowPattern[] {
  const patterns: DataRowPattern[] = [];
  for (const rowNumber of sampleRowNumbers) {
    const row = worksheet.getRow(rowNumber);
    const cellStyles: Partial<ExcelJS.Style>[] = [];
    for (let column = 1; column <= worksheet.columnCount; column += 1) {
      cellStyles.push(cloneStyle(row.getCell(column).style));
    }
    patterns.push({
      height: row.height,
      hidden: row.hidden,
      cellStyles,
      merges: dataMerges
        .filter((merge) => merge.startRow === rowNumber && merge.endRow === rowNumber)
        .map((merge) => ({ startColumn: merge.startColumn, endColumn: merge.endColumn })),
    });
  }
  return patterns;
}

function defaultDataRowPattern(worksheet: ExcelJS.Worksheet, headerRow: number): DataRowPattern {
  const header = worksheet.getRow(headerRow);
  const cellStyles: Partial<ExcelJS.Style>[] = [];
  for (let column = 1; column <= worksheet.columnCount; column += 1) {
    const headerStyle = cloneStyle(header.getCell(column).style);
    cellStyles.push({
      border: headerStyle.border,
      alignment: {
        horizontal: column === 3 ? 'left' : 'center',
        vertical: 'middle',
        wrapText: true,
      },
      font: {
        name: headerStyle.font?.name ?? 'Arial',
        size: 10,
        color: { argb: 'FF1F2937' },
      },
    });
  }
  return {
    height: 84,
    hidden: false,
    cellStyles,
    merges: [],
  };
}

function replaceTextTokens(
  value: ExcelJS.CellValue,
  replacements: Readonly<Record<string, string>>,
): ExcelJS.CellValue {
  const replacement = (text: string): string =>
    Object.entries(replacements).reduce(
      (current, [token, next]) => current.split(token).join(next),
      text,
    );

  if (typeof value === 'string') {
    const next = replacement(value);
    return next === value ? value : safeExcelText(next);
  }
  if (!value || typeof value !== 'object' || !('richText' in value)) return value;

  const nextParts = value.richText.map((part) => ({
    ...part,
    text: replacement(part.text),
  }));
  if (nextParts.every((part, index) => part.text === value.richText[index]?.text)) return value;
  const combined = nextParts.map((part) => part.text).join('');
  if (/^\s*[=+\-@]/.test(combined)) {
    const first = nextParts.find((part) => part.text.length > 0);
    if (first) first.text = `'${first.text}`;
  }
  return { ...value, richText: nextParts };
}

function applyRowPattern(
  worksheet: ExcelJS.Worksheet,
  rowNumber: number,
  pattern: DataRowPattern,
): void {
  const row = worksheet.getRow(rowNumber);
  if (pattern.height !== undefined) row.height = pattern.height;
  row.hidden = pattern.hidden;
  for (let column = 1; column <= worksheet.columnCount; column += 1) {
    row.getCell(column).style = cloneStyle(pattern.cellStyles[column - 1] ?? {});
  }
}

function writeProductField(
  cell: ExcelJS.Cell,
  field: QuoteTemplateFieldKey,
  product: QuotationWorkbookProduct,
  unitPrice: string,
): void {
  switch (field) {
    case 'product.sku':
      cell.value = safeExcelText(product.sku);
      break;
    case 'product.image':
      cell.value = null;
      break;
    case 'product.name':
      cell.value = safeExcelText(product.englishName);
      break;
    case 'product.price_cny':
      cell.value = Number(unitPrice);
      cell.numFmt = '0.00';
      break;
    case 'product.carton_qty':
      cell.value = product.cartonQuantity;
      break;
    case 'product.carton_size_cm':
      cell.value = safeExcelText(product.cartonDimensions);
      break;
    case 'product.carton_weight_kg': {
      const weight = Number(product.cartonGrossWeightKg);
      cell.value = Number.isFinite(weight) ? weight : null;
      cell.numFmt = '0.000';
      break;
    }
    case 'product.size':
      cell.value = product.size ? safeExcelText(product.size) : null;
      break;
    case 'product.weight_g':
      cell.value = product.weightGrams ?? null;
      break;
    case 'product.packaging':
      cell.value = product.packaging ? safeExcelText(product.packaging) : null;
      break;
    case 'product.category':
      cell.value = product.category ? safeExcelText(product.category) : null;
      break;
    case 'product.lifecycle_status':
      cell.value = product.lifecycleStatus ? safeExcelText(product.lifecycleStatus) : null;
      break;
  }
}

/**
 * Opens a private, pre-validated workbook and fills the fixed quotation layout.
 * Product data, pricing and image bytes all come from server-owned services.
 */
export async function buildQuotationWorkbookFromTemplate(
  input: QuotationTemplateWorkbookInput,
): Promise<Buffer> {
  if (input.products.length === 0) {
    throw new QuotationTemplateWorkbookError('No products were supplied.', 'NO_PRODUCTS');
  }
  if (input.headerRow < 1 || input.itemStartRow <= input.headerRow) {
    throw new QuotationTemplateWorkbookError('The template rows are invalid.', 'ROWS_INVALID');
  }

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(
      input.templateBuffer as unknown as Parameters<typeof workbook.xlsx.load>[0],
    );
  } catch {
    throw new QuotationTemplateWorkbookError(
      'The selected template workbook cannot be read.',
      'WORKBOOK_UNREADABLE',
    );
  }

  const worksheet = workbook.getWorksheet(input.sheetName);
  if (!worksheet) {
    throw new QuotationTemplateWorkbookError(
      'The selected template worksheet does not exist.',
      'WORKSHEET_NOT_FOUND',
    );
  }

  try {
    const mappedColumns = Object.entries(input.fieldMapping)
      .map(([letter, field]) => ({ field, column: columnNumber(worksheet, letter) }))
      .filter((entry): entry is { field: QuoteTemplateFieldKey; column: number } =>
        Boolean(entry.column),
      );
    const imageColumn = mappedColumns.find((entry) => entry.field === 'product.image')?.column;
    if (!imageColumn) {
      throw new QuotationTemplateWorkbookError(
        'The template does not map a product image column.',
        'IMAGE_COLUMN_MISSING',
      );
    }

    const footerStartRow = findFooterStartRow(worksheet, input.itemStartRow);
    if (footerStartRow <= input.itemStartRow) {
      throw new QuotationTemplateWorkbookError(
        'The template footer could not be identified below the product data.',
        'FOOTER_NOT_FOUND',
      );
    }
    const sampleRowNumbers = findSampleDataRows(worksheet, input.itemStartRow, footerStartRow);
    const sampleDataRows = sampleRowNumbers.length;

    const mergeRanges = [...(worksheet.model.merges ?? [])]
      .map((range) => mergeCellsFromRange(worksheet, range))
      .filter((merge): merge is ShiftedMerge => merge !== null);
    const dataMerges = mergeRanges.filter(
      (merge) => merge.startRow >= input.itemStartRow && merge.endRow < footerStartRow,
    );
    if (dataMerges.some((merge) => merge.startRow !== merge.endRow)) {
      throw new QuotationTemplateWorkbookError(
        'Product data rows cannot contain multi-row merged cells.',
        'DATA_ROW_MERGE_INVALID',
      );
    }
    const footerMerges = mergeRanges.filter((merge) => merge.startRow >= footerStartRow);
    const drawingSnapshot = captureTemplateDrawings({
      workbook,
      worksheet,
      headerRow: input.headerRow,
      itemStartRow: input.itemStartRow,
      footerStartRow,
      imageColumn,
    });
    removeTemplateProductImages(worksheet, drawingSnapshot);
    const rowPatterns = captureRowPatterns(worksheet, sampleRowNumbers, dataMerges);
    const dataRowPatterns =
      rowPatterns.length > 0 ? rowPatterns : [defaultDataRowPattern(worksheet, input.headerRow)];

    // ExcelJS preserves merges below inserted rows, but does not shift them when
    // rows are removed. Temporarily unmerge footer/data ranges and recreate them
    // at their final positions after the data area has been resized.
    for (const merge of [...dataMerges, ...footerMerges]) {
      worksheet.unMergeCells(rangeFor(merge));
    }

    const rowDelta = input.products.length - sampleDataRows;
    if (rowDelta > 0) {
      worksheet.spliceRows(
        footerStartRow,
        0,
        ...Array.from({ length: rowDelta }, () => [] as ExcelJS.CellValue[]),
      );
    } else if (rowDelta < 0) {
      worksheet.spliceRows(input.itemStartRow + input.products.length, Math.abs(rowDelta));
    }
    const replacements = {
      [QUOTATION_TEMPLATE_PLACEHOLDERS.companyName]: input.header.companyName,
      [QUOTATION_TEMPLATE_PLACEHOLDERS.contactPerson]: input.header.contactPerson,
      [QUOTATION_TEMPLATE_PLACEHOLDERS.email]: input.header.email,
      [QUOTATION_TEMPLATE_PLACEHOLDERS.phone]: input.header.phone,
      [QUOTATION_TEMPLATE_PLACEHOLDERS.quotationTitle]: input.header.quotationTitle,
      [QUOTATION_TEMPLATE_PLACEHOLDERS.currency]: input.currencyCode,
      [QUOTATION_TEMPLATE_PLACEHOLDERS.exchangeRate]: `${input.exchangeRate} ${input.currencyCode}`,
      [QUOTATION_TEMPLATE_PLACEHOLDERS.markup]: `${input.markupPercent}%`,
    } as const;
    for (let rowNumber = 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
      const row = worksheet.getRow(rowNumber);
      for (let column = 1; column <= worksheet.columnCount; column += 1) {
        const cell = row.getCell(column);
        cell.value = replaceTextTokens(cell.value, replacements);
      }
    }

    const productImages = new Map(
      input.products.map((product) => [product.productId, product.image] as const),
    );
    input.products.forEach((product, index) => {
      const rowNumber = input.itemStartRow + index;
      const patternIndex = Math.min(index, dataRowPatterns.length - 1);
      const pattern = dataRowPatterns[patternIndex];
      if (!pattern) {
        throw new QuotationTemplateWorkbookError(
          'The template data-row style could not be read.',
          'DATA_ROW_STYLE_MISSING',
        );
      }
      applyRowPattern(worksheet, rowNumber, pattern);
      const row = worksheet.getRow(rowNumber);
      for (let column = 1; column <= worksheet.columnCount; column += 1) {
        row.getCell(column).value = null;
      }
      for (const mapped of mappedColumns) {
        writeProductField(row.getCell(mapped.column), mapped.field, product, product.unitPrice);
      }
    });

    input.products.forEach((_, index) => {
      const rowNumber = input.itemStartRow + index;
      const patternIndex = Math.min(index, dataRowPatterns.length - 1);
      const pattern = dataRowPatterns[patternIndex];
      for (const merge of pattern?.merges ?? []) {
        worksheet.mergeCells(rowNumber, merge.startColumn, rowNumber, merge.endColumn);
      }
    });
    for (const merge of footerMerges) {
      const shifted = {
        ...merge,
        startRow: merge.startRow + rowDelta,
        endRow: merge.endRow + rowDelta,
      };
      worksheet.mergeCells(rangeFor(shifted));
    }

    const productImageAnchors = embedQuotationProductImages({
      worksheet,
      products: input.products,
      images: productImages,
      itemStartRow: input.itemStartRow,
      imageColumn,
    });

    const firstColumn = 1;
    const lastColumn = Math.max(1, worksheet.columnCount);
    const lastDataRow = input.itemStartRow + input.products.length - 1;
    const lastSheetRow = Math.max(lastDataRow, worksheet.rowCount);
    worksheet.autoFilter = `${columnLetter(firstColumn)}${input.headerRow}:${columnLetter(lastColumn)}${lastDataRow}`;
    worksheet.pageSetup.printArea = `${columnLetter(firstColumn)}1:${columnLetter(lastColumn)}${lastSheetRow}`;
    worksheet.pageSetup.printTitlesRow = `1:${input.headerRow}`;
    const existingView = worksheet.views[0];
    worksheet.views = [
      {
        state: 'frozen' as const,
        ySplit: input.headerRow,
        topLeftCell: `${columnLetter(firstColumn)}${input.itemStartRow}`,
        ...(existingView?.showGridLines === undefined
          ? {}
          : { showGridLines: existingView.showGridLines }),
        ...(existingView?.showRowColHeaders === undefined
          ? {}
          : { showRowColHeaders: existingView.showRowColHeaders }),
        ...(existingView?.zoomScale === undefined ? {} : { zoomScale: existingView.zoomScale }),
        ...(existingView?.zoomScaleNormal === undefined
          ? {}
          : { zoomScaleNormal: existingView.zoomScaleNormal }),
      },
    ];
    workbook.modified = input.generatedAt;

    const output = Buffer.from(await workbook.xlsx.writeBuffer());
    await assertTemplateDrawingsPreserved(output, input.sheetName, drawingSnapshot);
    const validated = await ensureQuotationOoxmlImages(output, {
      sheetName: input.sheetName,
      fixedImages: drawingSnapshot.fixedImages,
      productImages: productImageAnchors.map((anchor) => ({ anchor, fit: anchor.fit })),
    });
    return validated.buffer;
  } catch (error) {
    throw asTemplateWorkbookError(error);
  }
}
