import ExcelJS from 'exceljs';
import type { QuoteTemplateFieldKey } from './quote-template-parser';
import { QuoteTemplateParseError, type QuoteTemplateInspection } from './quote-template-parser';

const TEMPLATE_SHEET = 'Quotation';
const HEADER_ROW = 6;
const ITEM_START_ROW = 7;
const REQUIRED_HEADERS: readonly {
  column: number;
  field: QuoteTemplateFieldKey;
  pattern: RegExp;
}[] = [
  { column: 1, field: 'product.sku', pattern: /^product\s*sku$/i },
  { column: 2, field: 'product.image', pattern: /^product\s*image$/i },
  { column: 3, field: 'product.name', pattern: /^product\s*name$/i },
  { column: 4, field: 'product.category', pattern: /^material$/i },
  { column: 5, field: 'quotation.quantity', pattern: /^quantity\s*pcs$/i },
  { column: 6, field: 'quotation.unit_price', pattern: /^unit\s*price(?:\s*[a-z]{3})?$/i },
  { column: 7, field: 'quotation.total_price', pattern: /^total\s*price(?:\s*[a-z]{3})?$/i },
];

function textValue(value: ExcelJS.CellValue): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value && typeof value === 'object' && 'richText' in value && Array.isArray(value.richText)) {
    return value.richText
      .map((part) => part.text)
      .join('')
      .trim();
  }
  if (value && typeof value === 'object' && 'text' in value && typeof value.text === 'string') {
    return value.text.trim();
  }
  return '';
}

function normalized(value: string): string {
  return value
    .replace(/[()（）]/g, ' ')
    .replace(/[_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function findSummaryRows(worksheet: ExcelJS.Worksheet): {
  subtotalRow: number | null;
  shippingRow: number | null;
  totalRow: number | null;
  duplicates: string[];
} {
  const found = new Map<string, number[]>();
  for (const key of ['product subtotal', 'shipping cost', 'total cost']) found.set(key, []);
  for (let rowNumber = ITEM_START_ROW; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const label = textValue(worksheet.getCell(rowNumber, 1).value).toLowerCase();
    for (const key of found.keys()) {
      if (label.includes(key)) found.get(key)?.push(rowNumber);
    }
  }
  const duplicates = [...found.entries()].filter(([, rows]) => rows.length > 1).map(([key]) => key);
  return {
    subtotalRow: found.get('product subtotal')?.[0] ?? null,
    shippingRow: found.get('shipping cost')?.[0] ?? null,
    totalRow: found.get('total cost')?.[0] ?? null,
    duplicates,
  };
}

/** Inspects the fixed DOC-40 worksheet contract without reusing DOC-36 field detection. */
export async function inspectCalculatorQuoteTemplateWorkbook(
  buffer: Buffer,
): Promise<QuoteTemplateInspection> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  } catch {
    throw new QuoteTemplateParseError('The workbook could not be parsed.', {
      reason: 'WORKBOOK_UNREADABLE',
    });
  }

  const availableSheets = workbook.worksheets.map((worksheet) => worksheet.name);
  const worksheet = workbook.getWorksheet(TEMPLATE_SHEET);
  if (!worksheet) {
    throw new QuoteTemplateParseError('The Quotation worksheet is required.', {
      reason: 'WORKSHEET_NOT_FOUND',
      sheetName: TEMPLATE_SHEET,
      availableSheets,
    });
  }

  const detectedHeaders: QuoteTemplateInspection['detectedHeaders'] = [];
  const missingRequiredFields: QuoteTemplateFieldKey[] = [];
  const fieldMapping: Record<string, QuoteTemplateFieldKey> = {};
  for (const required of REQUIRED_HEADERS) {
    const header = textValue(worksheet.getCell(HEADER_ROW, required.column).value).replace(
      /\s+/g,
      ' ',
    );
    if (!required.pattern.test(normalized(header))) {
      missingRequiredFields.push(required.field);
      continue;
    }
    const column = worksheet.getColumn(required.column).letter;
    fieldMapping[column] = required.field;
    detectedHeaders.push({ column, header, field: required.field });
  }

  const summaries = findSummaryRows(worksheet);
  const summaryRowsValid =
    summaries.subtotalRow !== null &&
    summaries.shippingRow === summaries.subtotalRow + 1 &&
    summaries.totalRow === summaries.subtotalRow + 2 &&
    summaries.subtotalRow >= ITEM_START_ROW + 1 &&
    summaries.duplicates.length === 0;
  const fieldValues = Object.values(fieldMapping);
  const duplicateFields = fieldValues.filter(
    (field, index) => fieldValues.indexOf(field) !== index,
  );
  const layoutValid = worksheet.rowCount >= ITEM_START_ROW && summaryRowsValid;
  const requiredFields = REQUIRED_HEADERS.map((header) => header.field);

  return {
    sheetName: worksheet.name,
    availableSheets,
    headerRow: HEADER_ROW,
    itemStartRow: ITEM_START_ROW,
    fieldMapping,
    detectedHeaders,
    requiredFields,
    missingRequiredFields,
    duplicateFields,
    missingPlaceholders: [],
    placeholderRowsMismatch: [],
    layoutValid,
    requiredFieldsPresent:
      missingRequiredFields.length === 0 && duplicateFields.length === 0 && layoutValid,
  };
}
