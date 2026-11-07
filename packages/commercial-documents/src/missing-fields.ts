import { COMMERCIAL_DOCUMENT_REQUIRED_FIELDS, COMMERCIAL_INVOICE_REQUIRED_FIELDS } from '@b2b/contracts';
import { documentFieldValueMap, type CommercialDocumentRenderData } from './render';
import { visibleSections, type DocumentTemplateConfig } from './template-config';

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

export interface MissingFieldReport {
  missing: string[];
  missingItemLines: { lineNo: number; fields: string[] }[];
}

export function findMissingDocumentFields(
  data: CommercialDocumentRenderData,
  config: DocumentTemplateConfig,
): MissingFieldReport {
  const values = documentFieldValueMap(data);
  const missing = new Set<string>();

  for (const field of BUSINESS_REQUIRED_FIELDS) {
    if (!values[field]?.trim()) missing.add(field);
  }
  if (data.documentType === 'CI') {
    for (const field of CI_REQUIRED_FIELDS) {
      if (!values[field]?.trim()) missing.add(field);
    }
  }
  if (data.items.length === 0) missing.add('items');
  if (!data.totals.totalAmount || Number(data.totals.totalAmount) <= 0) {
    missing.add('totals.grandTotal');
  }

  const missingItemLines: { lineNo: number; fields: string[] }[] = [];
  data.items.forEach((item) => {
    const fields: string[] = [];
    if (!item.description?.trim()) fields.push('items.description');
    if (item.quantity === undefined || Number(item.quantity) <= 0) fields.push('items.quantity');
    if (!item.unit?.trim()) fields.push('items.unit');
    if (data.documentType === 'CI') {
      if (!item.hsCode?.trim()) fields.push('items.hsCode');
      if (!item.originCountryCode?.trim()) fields.push('items.originCountryCode');
    }
    if (fields.length > 0) missingItemLines.push({ lineNo: item.lineNo, fields });
  });

  // A template may mark any visible field as required. That adds a document
  // level requirement but never weakens the business rules above.
  for (const section of visibleSections(config, data.locale)) {
    for (const field of section.fields) {
      if (field.required && !values[field.key]?.trim()) missing.add(field.key);
    }
  }

  return { missing: [...missing], missingItemLines };
}
