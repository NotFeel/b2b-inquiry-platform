import ExcelJS from 'exceljs';
import type { QuoteTemplateType } from '@b2b/contracts';

export const QUOTE_TEMPLATE_FIELD_KEYS = [
  'product.sku',
  'product.image',
  'product.name',
  'product.size',
  'product.weight_g',
  'product.packaging',
  'product.carton_size_cm',
  'product.carton_weight_kg',
  'product.carton_qty',
  'product.category',
  'product.lifecycle_status',
  'product.price_cny',
] as const;

export type QuoteTemplateFieldKey = (typeof QUOTE_TEMPLATE_FIELD_KEYS)[number];

interface HeaderDefinition {
  field: QuoteTemplateFieldKey;
  aliases: readonly string[];
  prefixAliases?: readonly string[];
}

const HEADER_DEFINITIONS: readonly HeaderDefinition[] = [
  { field: 'product.sku', aliases: ['product sku', 'sku', 'item sku'] },
  { field: 'product.image', aliases: ['product image', 'image', 'photo'] },
  {
    field: 'product.name',
    aliases: ['product name', 'product name english', 'english name', 'name'],
  },
  { field: 'product.size', aliases: ['product size', 'size', 'size mm', 'dimensions'] },
  { field: 'product.weight_g', aliases: ['product weight g', 'weight g', 'unit weight'] },
  { field: 'product.packaging', aliases: ['packaging', 'package', 'packing method'] },
  {
    field: 'product.carton_size_cm',
    aliases: [
      'case dimensions',
      'case dimensions l x w x h cm',
      'carton dimensions',
      'carton size',
    ],
    prefixAliases: ['case dimensions', 'carton size'],
  },
  {
    field: 'product.carton_weight_kg',
    aliases: ['gross weight kg', 'carton gross weight kg', 'carton weight kg'],
    prefixAliases: ['gross weight', 'carton weight'],
  },
  {
    field: 'product.carton_qty',
    aliases: [
      'packing quantity',
      'packing quantity pcs carton',
      'carton qty',
      'quantity per carton',
    ],
    prefixAliases: ['packing quantity', 'carton qty', 'quantity per carton'],
  },
  { field: 'product.category', aliases: ['category', 'product category'] },
  {
    field: 'product.lifecycle_status',
    aliases: ['lifecycle', 'lifecycle status', 'product lifecycle'],
  },
  {
    field: 'product.price_cny',
    aliases: ['unit price', 'price per unit', 'price', 'unit price cny'],
    prefixAliases: ['unit price', 'price per unit'],
  },
] as const;

const REQUIRED_FIELDS_BY_TYPE: Record<QuoteTemplateType, readonly QuoteTemplateFieldKey[]> = {
  product_quote: [
    'product.sku',
    'product.image',
    'product.name',
    'product.price_cny',
    'product.carton_qty',
    'product.carton_size_cm',
    'product.carton_weight_kg',
  ],
  pi: ['product.sku', 'product.name', 'product.price_cny'],
};

/** Stable text anchors used by the server-side workbook filler. */
export const QUOTATION_TEMPLATE_PLACEHOLDERS = {
  companyName: '[COMPANY NAME]',
  contactPerson: '[CONTACT PERSON]',
  email: '[EMAIL]',
  phone: '[PHONE]',
  quotationTitle: '[QUOTATION TITLE]',
  currency: '[CURRENCY]',
  exchangeRate: '[RATE]',
  markup: '[MARKUP]',
} as const;

const PRODUCT_QUOTE_REQUIRED_PLACEHOLDERS = [
  'companyName',
  'contactPerson',
  'email',
  'phone',
  'quotationTitle',
  'currency',
] as const satisfies readonly (keyof typeof QUOTATION_TEMPLATE_PLACEHOLDERS)[];

const PRODUCT_QUOTE_FIXED_PLACEHOLDER_ROWS: Readonly<
  Partial<Record<keyof typeof QUOTATION_TEMPLATE_PLACEHOLDERS, number>>
> = {
  companyName: 1,
  contactPerson: 2,
  email: 3,
  phone: 4,
  quotationTitle: 5,
};

export interface QuoteTemplateInspection {
  sheetName: string;
  availableSheets: string[];
  headerRow: number;
  itemStartRow: number;
  fieldMapping: Record<string, QuoteTemplateFieldKey>;
  detectedHeaders: { column: string; header: string; field: QuoteTemplateFieldKey }[];
  requiredFields: QuoteTemplateFieldKey[];
  missingRequiredFields: QuoteTemplateFieldKey[];
  duplicateFields: QuoteTemplateFieldKey[];
  missingPlaceholders: string[];
  placeholderRowsMismatch: string[];
  layoutValid: boolean;
  requiredFieldsPresent: boolean;
}

export class QuoteTemplateParseError extends Error {
  constructor(
    message: string,
    readonly details: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'QuoteTemplateParseError';
  }
}

export interface QuoteTemplateParseOptions {
  templateType: QuoteTemplateType;
  sheetName?: string | null;
  headerRow?: number;
  itemStartRow?: number;
}

function normalizeHeader(value: string): string {
  return value
    .replace(/\u00a0/g, ' ')
    .replace(/\[[^\]]+\]/g, ' ')
    .replace(/[()]/g, ' ')
    .replace(/[×]/g, 'x')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function cellText(value: ExcelJS.CellValue): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (!value || typeof value !== 'object') return '';
  if ('richText' in value && Array.isArray(value.richText)) {
    return value.richText
      .map((part) => part.text)
      .join('')
      .trim();
  }
  if ('text' in value && typeof value.text === 'string') return value.text.trim();
  return '';
}

function matchField(header: string): QuoteTemplateFieldKey | null {
  const normalized = normalizeHeader(header);
  if (!normalized) return null;
  for (const definition of HEADER_DEFINITIONS) {
    if (definition.aliases.includes(normalized)) return definition.field;
    if (definition.prefixAliases?.some((alias) => normalized.startsWith(alias))) {
      return definition.field;
    }
  }
  return null;
}

function inspectRow(
  worksheet: ExcelJS.Worksheet,
  rowNumber: number,
): {
  fieldMapping: Record<string, QuoteTemplateFieldKey>;
  detectedHeaders: QuoteTemplateInspection['detectedHeaders'];
} {
  const row = worksheet.getRow(rowNumber);
  const fieldMapping: Record<string, QuoteTemplateFieldKey> = {};
  const detectedHeaders: QuoteTemplateInspection['detectedHeaders'] = [];
  for (let columnNumber = 1; columnNumber <= worksheet.columnCount; columnNumber += 1) {
    const cell = row.getCell(columnNumber);
    const header = cellText(cell.value).replace(/\s+/g, ' ');
    const field = matchField(header);
    if (!field) continue;
    const column = worksheet.getColumn(columnNumber).letter;
    fieldMapping[column] = field;
    detectedHeaders.push({ column, header, field });
  }
  return { fieldMapping, detectedHeaders };
}

function detectHeaderRow(
  worksheet: ExcelJS.Worksheet,
  templateType: QuoteTemplateType,
): number | null {
  const lastRow = Math.min(Math.max(worksheet.rowCount, 1), 200);
  let best: { rowNumber: number; score: number } | null = null;
  for (let rowNumber = 1; rowNumber <= lastRow; rowNumber += 1) {
    const inspected = inspectRow(worksheet, rowNumber);
    const fields = new Set(Object.values(inspected.fieldMapping));
    const hasAnchor =
      fields.has('product.sku') || (templateType !== 'product_quote' && fields.has('product.name'));
    const score = fields.size;
    if (hasAnchor && score >= 2 && (!best || score > best.score)) {
      best = { rowNumber, score };
    }
  }
  return best?.rowNumber ?? null;
}

function findPlaceholderRows(worksheet: ExcelJS.Worksheet): Map<string, number[]> {
  const found = new Map<string, number[]>();
  for (const placeholder of Object.values(QUOTATION_TEMPLATE_PLACEHOLDERS)) {
    found.set(placeholder, []);
  }
  const lastRow = Math.max(worksheet.rowCount, 1);
  for (let rowNumber = 1; rowNumber <= lastRow; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    for (let columnNumber = 1; columnNumber <= worksheet.columnCount; columnNumber += 1) {
      const value = cellText(row.getCell(columnNumber).value).toUpperCase();
      for (const placeholder of Object.values(QUOTATION_TEMPLATE_PLACEHOLDERS)) {
        if (value.includes(placeholder)) {
          found.get(placeholder)?.push(rowNumber);
        }
      }
    }
  }
  return found;
}

/**
 * Reads only structural metadata from an already signature-validated XLSX.
 * The uploaded template remains unchanged in private storage.
 */
export async function inspectQuoteTemplateWorkbook(
  buffer: Buffer,
  options: QuoteTemplateParseOptions,
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
  const worksheet = options.sheetName
    ? workbook.getWorksheet(options.sheetName)
    : workbook.worksheets[0];
  if (!worksheet) {
    throw new QuoteTemplateParseError('The selected worksheet does not exist.', {
      reason: 'WORKSHEET_NOT_FOUND',
      sheetName: options.sheetName ?? null,
      availableSheets,
    });
  }

  const headerRow = options.headerRow ?? detectHeaderRow(worksheet, options.templateType);
  if (!headerRow) {
    throw new QuoteTemplateParseError('No recognizable quote table header was found.', {
      reason: 'HEADER_NOT_FOUND',
      sheetName: worksheet.name,
      availableSheets,
    });
  }

  const inspected = inspectRow(worksheet, headerRow);
  if (inspected.detectedHeaders.length < 2) {
    throw new QuoteTemplateParseError('The template header does not match a quote layout.', {
      reason: 'HEADER_INVALID',
      sheetName: worksheet.name,
      headerRow,
      availableSheets,
    });
  }

  const itemStartRow = options.itemStartRow ?? headerRow + 1;
  if (itemStartRow <= headerRow) {
    throw new QuoteTemplateParseError('The item start row must be below the header row.', {
      reason: 'ITEM_START_ROW_INVALID',
      headerRow,
      itemStartRow,
    });
  }

  const fields = Object.values(inspected.fieldMapping);
  const duplicateFields = fields.filter((field, index) => fields.indexOf(field) !== index);
  const requiredFields = [...REQUIRED_FIELDS_BY_TYPE[options.templateType]];
  const missingRequiredFields = requiredFields.filter((field) => !fields.includes(field));

  const missingPlaceholders: string[] = [];
  const placeholderRowsMismatch: string[] = [];
  let layoutValid = true;
  if (options.templateType === 'product_quote') {
    const placeholderRows = findPlaceholderRows(worksheet);
    for (const field of PRODUCT_QUOTE_REQUIRED_PLACEHOLDERS) {
      const placeholder = QUOTATION_TEMPLATE_PLACEHOLDERS[field];
      const expectedRow = PRODUCT_QUOTE_FIXED_PLACEHOLDER_ROWS[field];
      const rows = placeholderRows.get(placeholder) ?? [];
      if (rows.length === 0) {
        missingPlaceholders.push(placeholder);
      } else if (expectedRow !== undefined && !rows.includes(expectedRow)) {
        placeholderRowsMismatch.push(placeholder);
      }
    }
    // Product rows always start immediately below the detected Product SKU row.
    // Customer placeholders remain fixed so the header remains safely fillable.
    layoutValid =
      itemStartRow === headerRow + 1 &&
      missingPlaceholders.length === 0 &&
      placeholderRowsMismatch.length === 0;
  }

  return {
    sheetName: worksheet.name,
    availableSheets,
    headerRow,
    itemStartRow,
    fieldMapping: inspected.fieldMapping,
    detectedHeaders: inspected.detectedHeaders,
    requiredFields,
    missingRequiredFields,
    duplicateFields,
    missingPlaceholders,
    placeholderRowsMismatch,
    layoutValid,
    requiredFieldsPresent:
      missingRequiredFields.length === 0 &&
      duplicateFields.length === 0 &&
      (options.templateType !== 'product_quote' || layoutValid),
  };
}
