/**
 * Pure helpers for the order customer-correction form (docs/43 §11.4 / R2-3).
 *
 * The form edits only an order snapshot. These helpers build a human-readable,
 * masked change summary and are deliberately independent of React so the
 * sensitive-field masking can be unit tested.
 */

export interface EditableParty {
  companyName: string;
  contactName: string;
  phone: string;
  email: string;
  taxId: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  postalCode: string;
  countryCode: string;
  addressCountryCode: string;
}

export interface EditableCustomerSnapshot {
  buyer: EditableParty;
  consignee: EditableParty;
  buyerReference: string;
  incotermCode: string;
  namedPlace: string;
  paymentTerms: string;
}

export type CustomerChangeField =
  | `buyer.${keyof EditableParty}`
  | `consignee.${keyof EditableParty}`
  | 'buyerReference'
  | 'incotermCode'
  | 'namedPlace'
  | 'paymentTerms';

export interface CustomerChange {
  field: CustomerChangeField;
  labelKey: string;
  before: string;
  after: string;
}

const PARTY_FIELDS: { field: keyof EditableParty; labelKey: string; sensitive?: boolean }[] = [
  { field: 'companyName', labelKey: 'commercialDocuments.editor.fields.companyName' },
  { field: 'contactName', labelKey: 'commercialDocuments.editor.fields.contactName' },
  { field: 'phone', labelKey: 'commercialDocuments.editor.fields.phone', sensitive: true },
  { field: 'email', labelKey: 'commercialDocuments.editor.fields.email', sensitive: true },
  { field: 'taxId', labelKey: 'commercialDocuments.editor.fields.taxId', sensitive: true },
  { field: 'line1', labelKey: 'commercialDocuments.editor.fields.addressLine1', sensitive: true },
  { field: 'line2', labelKey: 'commercialDocuments.editor.fields.addressLine2', sensitive: true },
  { field: 'city', labelKey: 'commercialDocuments.editor.fields.city' },
  { field: 'state', labelKey: 'commercialDocuments.editor.fields.state' },
  { field: 'postalCode', labelKey: 'commercialDocuments.editor.fields.postalCode' },
  { field: 'countryCode', labelKey: 'commercialDocuments.editor.fields.countryCode' },
  {
    field: 'addressCountryCode',
    labelKey: 'commercialDocuments.editor.fields.addressCountryCode',
  },
];

const REFERENCE_FIELDS: {
  field: 'buyerReference' | 'incotermCode' | 'namedPlace' | 'paymentTerms';
  labelKey: string;
}[] = [
  { field: 'buyerReference', labelKey: 'quotationCenter.buyerReference' },
  { field: 'incotermCode', labelKey: 'quotationCenter.incoterm' },
  { field: 'namedPlace', labelKey: 'quotationCenter.namedPlace' },
  { field: 'paymentTerms', labelKey: 'quotationCenter.paymentTerms' },
];

/** Masks values that must never be shown in full or written to audit metadata. */
export function maskCustomerValue(field: CustomerChangeField, value: string): string {
  const normalized = value.trim();
  if (!normalized) return '';
  const key = field.split('.').at(-1) ?? field;
  if (key === 'phone' || key === 'taxId') {
    return normalized.length <= 4 ? '••••' : `••••${normalized.slice(-4)}`;
  }
  if (key === 'email') {
    const [local = '', domain = ''] = normalized.split('@');
    return domain ? `${local.slice(0, 1)}•••@${domain}` : '••••';
  }
  if (key === 'line1' || key === 'line2') {
    return normalized.length <= 4 ? '••••' : `••••${normalized.slice(-4)}`;
  }
  return normalized;
}

/** Returns only changed fields, with values masked for display. */
export function buildCustomerChanges(
  before: EditableCustomerSnapshot,
  after: EditableCustomerSnapshot,
): CustomerChange[] {
  const changes: CustomerChange[] = [];
  for (const partyKey of ['buyer', 'consignee'] as const) {
    for (const definition of PARTY_FIELDS) {
      const beforeValue = before[partyKey][definition.field].trim();
      const afterValue = after[partyKey][definition.field].trim();
      if (beforeValue === afterValue) continue;
      const field = `${partyKey}.${definition.field}` as CustomerChangeField;
      changes.push({
        field,
        labelKey: definition.labelKey,
        before: maskCustomerValue(field, beforeValue),
        after: maskCustomerValue(field, afterValue),
      });
    }
  }
  for (const definition of REFERENCE_FIELDS) {
    const beforeValue = before[definition.field].trim();
    const afterValue = after[definition.field].trim();
    if (beforeValue === afterValue) continue;
    changes.push({
      field: definition.field,
      labelKey: definition.labelKey,
      before: beforeValue,
      after: afterValue,
    });
  }
  return changes;
}
