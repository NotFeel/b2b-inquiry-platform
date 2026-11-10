import {
  COMMERCIAL_DOCUMENT_REQUIRED_FIELDS,
  COMMERCIAL_INVOICE_REQUIRED_FIELDS,
} from '@b2b/contracts';
import {
  defaultFieldLabel,
  documentFieldDefinition,
  type DocumentSectionKey,
} from './field-catalog';
import { documentFieldValueMap, type CommercialDocumentRenderData } from './render';
import {
  isItemColumnRequired,
  visibleSections,
  type DocumentTemplateConfig,
} from './template-config';

// This checklist is the single source of truth used by:
//   - the prefill endpoint (before a draft exists),
//   - the draft editor (warning banner),
//   - the issue endpoint (hard gate).
// It never trusts a browser-submitted "complete" flag.

const BUSINESS_REQUIRED_FIELDS = [
  COMMERCIAL_DOCUMENT_REQUIRED_FIELDS.sellerCompanyName,
  COMMERCIAL_DOCUMENT_REQUIRED_FIELDS.sellerAddress,
  COMMERCIAL_DOCUMENT_REQUIRED_FIELDS.buyerCompanyName,
  COMMERCIAL_DOCUMENT_REQUIRED_FIELDS.buyerAddress,
  COMMERCIAL_DOCUMENT_REQUIRED_FIELDS.incoterm,
  COMMERCIAL_DOCUMENT_REQUIRED_FIELDS.namedPlace,
  COMMERCIAL_DOCUMENT_REQUIRED_FIELDS.paymentTerms,
  COMMERCIAL_DOCUMENT_REQUIRED_FIELDS.issueDate,
  COMMERCIAL_DOCUMENT_REQUIRED_FIELDS.bankAccountHolder,
  COMMERCIAL_DOCUMENT_REQUIRED_FIELDS.bankName,
  COMMERCIAL_DOCUMENT_REQUIRED_FIELDS.bankAccountNumber,
];

const CI_REQUIRED_FIELDS = [
  COMMERCIAL_INVOICE_REQUIRED_FIELDS.shippingMethod,
  COMMERCIAL_INVOICE_REQUIRED_FIELDS.cartons,
];

export type MissingFieldSource = 'BUSINESS_RULE' | 'TEMPLATE_REQUIRED' | 'CI_ITEM_RULE';

export interface MissingFieldEntry {
  key: string;
  label: string;
  source: MissingFieldSource;
  sectionKey?: DocumentSectionKey;
  lineNo?: number;
}

export interface MissingFieldConflict {
  key: string;
  label: string;
  reason: 'REQUIRED_BUT_HIDDEN';
}

export interface MissingFieldReport {
  businessRequired: MissingFieldEntry[];
  templateRequired: MissingFieldEntry[];
  itemLineMissing: Array<{
    lineNo: number;
    fields: MissingFieldEntry[];
  }>;
  templateVisibilityConflicts: MissingFieldConflict[];
  /** Compatibility fields retained for issue gates and older clients. */
  missing: string[];
  missingItemLines: { lineNo: number; fields: string[] }[];
}

function missingEntry(
  key: string,
  source: MissingFieldSource,
  locale: string,
  lineNo?: number,
): MissingFieldEntry {
  return {
    key,
    label:
      key === 'items'
        ? locale === 'zh-CN'
          ? '商品明细'
          : 'Item lines'
        : defaultFieldLabel(key, locale),
    source,
    ...(documentFieldDefinition(key)?.section
      ? { sectionKey: documentFieldDefinition(key)!.section }
      : {}),
    ...(lineNo ? { lineNo } : {}),
  };
}

function itemColumnValue(item: CommercialDocumentRenderData['items'][number], key: string): string {
  const values: Record<string, unknown> = {
    'items.lineNo': item.lineNo,
    'items.sku': item.sku,
    'items.description': item.description,
    'items.hsCode': item.hsCode,
    'items.originCountryCode': item.originCountryCode,
    'items.quantity': item.quantity,
    'items.unit': item.unit,
    'items.unitPrice': item.unitPrice,
    'items.cartons': item.cartons,
    'items.netWeightKg': item.netWeightKg,
    'items.grossWeightKg': item.grossWeightKg,
    'items.cbm': item.cbm,
    'items.amount': item.lineAmount,
  };
  return values[key] === null || values[key] === undefined ? '' : String(values[key]).trim();
}

export function findMissingDocumentFields(
  data: CommercialDocumentRenderData,
  config: DocumentTemplateConfig,
): MissingFieldReport {
  const values = documentFieldValueMap(data);
  const missing = new Set<string>();
  const businessRequired: MissingFieldEntry[] = [];

  const addMissingField = (key: string, absent: boolean, source: MissingFieldSource) => {
    if (!absent) return;
    missing.add(key);
    const entry = missingEntry(key, source, data.locale);
    if (source === 'BUSINESS_RULE') businessRequired.push(entry);
  };

  const templateRequired: MissingFieldEntry[] = [];
  const templateRequiredKeys = new Set<string>();
  for (const section of visibleSections(config, data.locale)) {
    for (const field of section.fields) {
      if (!field.required) continue;
      templateRequiredKeys.add(field.key);
      if (!values[field.key]?.trim()) {
        missing.add(field.key);
        templateRequired.push({
          ...missingEntry(field.key, 'TEMPLATE_REQUIRED', data.locale),
          label: field.label,
        });
      }
    }
  }

  for (const field of BUSINESS_REQUIRED_FIELDS) {
    if (templateRequiredKeys.has(field)) {
      addMissingField(field, !values[field]?.trim(), 'BUSINESS_RULE');
    }
  }
  if (data.documentType === 'CI') {
    for (const field of CI_REQUIRED_FIELDS) {
      if (templateRequiredKeys.has(field)) {
        addMissingField(field, !values[field]?.trim(), 'BUSINESS_RULE');
      }
    }
  }
  addMissingField(
    COMMERCIAL_DOCUMENT_REQUIRED_FIELDS.items,
    data.items.length === 0,
    'BUSINESS_RULE',
  );
  addMissingField(
    'totals.grandTotal',
    !data.totals.totalAmount || Number(data.totals.totalAmount) <= 0,
    'BUSINESS_RULE',
  );

  const missingItemLines: { lineNo: number; fields: string[] }[] = [];
  const itemLineMissing: MissingFieldReport['itemLineMissing'] = [];
  data.items.forEach((item) => {
    const fields: string[] = [];
    for (const column of config.itemColumns) {
      if (!isItemColumnRequired(config, column.key)) continue;
      const value = itemColumnValue(item, column.key);
      if (!value || (column.key === 'items.quantity' && Number(value) <= 0)) {
        fields.push(column.key);
      }
    }
    if (fields.length > 0) {
      missingItemLines.push({ lineNo: item.lineNo, fields });
      itemLineMissing.push({
        lineNo: item.lineNo,
        fields: fields.map((key) =>
          missingEntry(key, 'TEMPLATE_REQUIRED', data.locale, item.lineNo),
        ),
      });
    }
  });

  return {
    businessRequired,
    templateRequired,
    itemLineMissing,
    templateVisibilityConflicts: [],
    missing: [...missing],
    missingItemLines,
  };
}
