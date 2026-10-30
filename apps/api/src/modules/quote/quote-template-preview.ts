import ExcelJS from 'exceljs';
import type {
  QuoteTemplatePreview,
  QuoteTemplatePreviewCell,
  QuoteTemplatePreviewCellStyle,
  QuoteTemplatePreviewImage,
} from '@b2b/contracts';
import { QuoteTemplateParseError } from './quote-template-parser';

const MAX_PREVIEW_ROWS = 200;
const MAX_PREVIEW_COLUMNS = 40;
const MAX_PREVIEW_MERGES = 200;
const MAX_PREVIEW_CELL_TEXT = 2_000;
const MAX_PREVIEW_IMAGES = 6;
const MAX_PREVIEW_IMAGE_BYTES = 1_000_000;
const MAX_PREVIEW_IMAGE_TOTAL_BYTES = 3_000_000;

interface PreviewTemplateSource {
  id: string;
  name: string;
  version: number;
  sheetName: string | null;
}

interface WorkbookMedia {
  buffer?: Buffer;
  extension?: string;
}

const EMPTY_STYLE: QuoteTemplatePreviewCellStyle = {
  bold: false,
  italic: false,
  fontSize: null,
  fontColor: null,
  fillColor: null,
  horizontal: null,
  vertical: null,
  wrapText: false,
  border: false,
};

/** Builds a deliberately bounded, read-only preview from a private XLSX. */
export async function buildQuoteTemplatePreview(
  buffer: Buffer,
  source: PreviewTemplateSource,
): Promise<QuoteTemplatePreview> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  } catch {
    throw new QuoteTemplateParseError('The workbook could not be parsed.', {
      reason: 'WORKBOOK_UNREADABLE',
    });
  }

  const worksheet = source.sheetName
    ? workbook.getWorksheet(source.sheetName)
    : workbook.worksheets[0];
  if (!worksheet) {
    throw new QuoteTemplateParseError('The selected worksheet does not exist.', {
      reason: 'WORKSHEET_NOT_FOUND',
      availableSheets: workbook.worksheets.map((sheet) => sheet.name),
    });
  }

  const sourceRowCount = Math.max(0, worksheet.rowCount);
  const sourceColumnCount = Math.max(0, worksheet.columnCount);
  const rowCount = Math.min(sourceRowCount, MAX_PREVIEW_ROWS);
  const columnCount = Math.min(sourceColumnCount, MAX_PREVIEW_COLUMNS);
  const truncated = sourceRowCount > rowCount || sourceColumnCount > columnCount;
  const rows = Array.from({ length: rowCount }, (_unused, rowOffset) => {
    const rowNumber = rowOffset + 1;
    const row = worksheet.getRow(rowNumber);
    return {
      index: rowNumber,
      height: normalizedDimension(row.height, 20),
      hidden: row.hidden === true,
      cells: Array.from({ length: columnCount }, (_cellUnused, columnOffset) => {
        const columnNumber = columnOffset + 1;
        return previewCell(row.getCell(columnNumber), rowNumber, columnNumber);
      }),
    };
  });

  const columns = Array.from({ length: columnCount }, (_unused, columnOffset) => {
    const columnNumber = columnOffset + 1;
    const column = worksheet.getColumn(columnNumber);
    return {
      index: columnNumber,
      letter: columnLetter(columnNumber),
      width: normalizedDimension(column.width, 12),
      hidden: column.hidden === true,
    };
  });

  return {
    templateId: source.id,
    name: source.name,
    version: source.version,
    sheetName: worksheet.name,
    rowCount,
    columnCount,
    truncated,
    merges: (worksheet.model.merges ?? [])
      .filter((merge): merge is string => typeof merge === 'string')
      .slice(0, MAX_PREVIEW_MERGES),
    columns,
    rows,
    images: previewImages(workbook, worksheet),
  };
}

function previewCell(cell: ExcelJS.Cell, row: number, column: number): QuoteTemplatePreviewCell {
  return {
    address: cell.address,
    row,
    column,
    ...cellContent(cell.value),
    style: previewStyle(cell),
  };
}

function cellContent(value: ExcelJS.CellValue): {
  value: string;
  kind: QuoteTemplatePreviewCell['kind'];
} {
  if (value === null || value === undefined || value === '') {
    return { value: '', kind: 'empty' };
  }
  if (typeof value === 'string') return { value: safeCellText(value), kind: 'text' };
  if (typeof value === 'number') return { value: String(value), kind: 'number' };
  if (typeof value === 'boolean') return { value: value ? 'TRUE' : 'FALSE', kind: 'boolean' };
  if (value instanceof Date) {
    return { value: value.toISOString().slice(0, 10), kind: 'date' };
  }
  if (isFormulaValue(value)) {
    return { value: safeCellText(`=${value.formula}`), kind: 'formula' };
  }
  if (isRichTextValue(value)) {
    return {
      value: safeCellText(value.richText.map((part) => part.text).join('')),
      kind: 'text',
    };
  }
  if (isHyperlinkValue(value)) {
    return { value: safeCellText(value.text), kind: 'text' };
  }
  if (isErrorValue(value)) {
    return { value: safeCellText(value.error), kind: 'text' };
  }
  return { value: '', kind: 'empty' };
}

function previewStyle(cell: ExcelJS.Cell): QuoteTemplatePreviewCellStyle {
  const horizontal = cell.alignment?.horizontal;
  const vertical = cell.alignment?.vertical;
  return {
    ...EMPTY_STYLE,
    bold: cell.font?.bold === true,
    italic: cell.font?.italic === true,
    fontSize: typeof cell.font?.size === 'number' ? cell.font.size : null,
    fontColor: colorToHex(cell.font?.color),
    fillColor: fillToHex(cell.fill),
    horizontal:
      horizontal === 'left' ||
      horizontal === 'center' ||
      horizontal === 'right' ||
      horizontal === 'justify'
        ? horizontal
        : null,
    vertical:
      vertical === 'top' || vertical === 'middle' || vertical === 'bottom' ? vertical : null,
    wrapText: cell.alignment?.wrapText === true,
    border: Boolean(
      cell.border?.top || cell.border?.right || cell.border?.bottom || cell.border?.left,
    ),
  };
}

function previewImages(
  workbook: ExcelJS.Workbook,
  worksheet: ExcelJS.Worksheet,
): QuoteTemplatePreviewImage[] {
  const media = (workbook.model.media ?? []) as ExcelJS.Media[];
  const images: QuoteTemplatePreviewImage[] = [];
  let totalBytes = 0;

  for (const image of worksheet.getImages()) {
    if (images.length >= MAX_PREVIEW_IMAGES || totalBytes >= MAX_PREVIEW_IMAGE_TOTAL_BYTES) break;
    const mediaIndex = Number(image.imageId);
    if (!Number.isInteger(mediaIndex) || mediaIndex < 0) continue;
    const item = media[mediaIndex] as WorkbookMedia | undefined;
    if (!item?.buffer || item.buffer.length > MAX_PREVIEW_IMAGE_BYTES) continue;
    if (totalBytes + item.buffer.length > MAX_PREVIEW_IMAGE_TOTAL_BYTES) continue;
    const mimeType = imageMimeType(item.extension);
    if (!mimeType) continue;

    totalBytes += item.buffer.length;
    const rowSpan = Math.max(1, image.range.br.nativeRow - image.range.tl.nativeRow);
    const columnSpan = Math.max(1, image.range.br.nativeCol - image.range.tl.nativeCol);
    images.push({
      row: nativeCoordinate(image.range.tl.nativeRow, image.range.tl.row) + 1,
      column: nativeCoordinate(image.range.tl.nativeCol, image.range.tl.col) + 1,
      width: Math.max(
        16,
        Array.from({ length: columnSpan }, (_entry, offset) =>
          normalizedDimension(worksheet.getColumn(image.range.tl.nativeCol + offset + 1).width, 12),
        ).reduce((total, width) => total + Math.round(width * 7), 0),
      ),
      height: Math.max(
        16,
        Array.from({ length: rowSpan }, (_entry, offset) =>
          normalizedDimension(worksheet.getRow(image.range.tl.nativeRow + offset + 1).height, 20),
        ).reduce((total, height) => total + Math.round(height * 1.333), 0),
      ),
      mimeType,
      dataUrl: `data:${mimeType};base64,${item.buffer.toString('base64')}`,
    });
  }
  return images;
}

function safeCellText(value: string): string {
  const withoutControls = value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .trim();
  return withoutControls.slice(0, MAX_PREVIEW_CELL_TEXT);
}

function normalizedDimension(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(500, Math.max(1, value));
}

function nativeCoordinate(native: number | undefined, fractional: number | undefined): number {
  if (typeof native === 'number' && Number.isFinite(native)) return Math.max(0, native);
  if (typeof fractional === 'number' && Number.isFinite(fractional)) {
    return Math.max(0, Math.floor(fractional));
  }
  return 0;
}

function colorToHex(color: Partial<ExcelJS.Color> | undefined): string | null {
  if (!color || typeof color.argb !== 'string') return null;
  const normalized = color.argb.toUpperCase();
  if (/^[0-9A-F]{8}$/.test(normalized)) return `#${normalized.slice(2)}`;
  if (/^[0-9A-F]{6}$/.test(normalized)) return `#${normalized}`;
  return null;
}

function fillToHex(fill: ExcelJS.Fill | undefined): string | null {
  if (!fill || fill.type !== 'pattern') return null;
  return colorToHex(fill.fgColor);
}

function imageMimeType(extension: string | undefined): string | null {
  switch (extension?.toLowerCase()) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    default:
      return null;
  }
}

function columnLetter(column: number): string {
  let value = column;
  let result = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function isFormulaValue(
  value: ExcelJS.CellValue,
): value is ExcelJS.CellFormulaValue & { formula: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'formula' in value &&
    typeof value.formula === 'string'
  );
}

function isRichTextValue(value: ExcelJS.CellValue): value is ExcelJS.CellRichTextValue {
  return (
    typeof value === 'object' &&
    value !== null &&
    'richText' in value &&
    Array.isArray(value.richText)
  );
}

function isHyperlinkValue(value: ExcelJS.CellValue): value is ExcelJS.CellHyperlinkValue {
  return (
    typeof value === 'object' && value !== null && 'text' in value && typeof value.text === 'string'
  );
}

function isErrorValue(value: ExcelJS.CellValue): value is ExcelJS.CellErrorValue {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    typeof value.error === 'string'
  );
}
