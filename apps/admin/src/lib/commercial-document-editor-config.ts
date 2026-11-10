import {
  isFieldVisible,
  isItemColumnVisible,
  isSectionVisible,
  type DocumentItemColumnKey,
  type DocumentSectionKey,
} from '@b2b/commercial-documents/visibility';
import type { DocumentTemplateConfig } from './commercial-documents-api';

export type PartyEditorField =
  'companyName' | 'contactName' | 'phone' | 'email' | 'taxId' | 'address';

export type ShippingEditorField =
  | 'method'
  | 'portOfLoading'
  | 'portOfDischarge'
  | 'route'
  | 'transitTime'
  | 'cartonCount'
  | 'netWeightKg'
  | 'grossWeightKg'
  | 'cbm'
  | 'marks';

export type TotalsEditorField =
  'discountAmount' | 'freightAmount' | 'insuranceAmount' | 'otherCharges';

const PARTY_FIELD_KEYS: Record<DocumentSectionKey, Partial<Record<PartyEditorField, string>>> = {
  seller: {
    companyName: 'seller.companyName',
    contactName: 'seller.contact',
    phone: 'seller.phone',
    email: 'seller.email',
    taxId: 'seller.taxId',
    address: 'seller.address',
  },
  buyer: {
    companyName: 'buyer.companyName',
    contactName: 'buyer.contact',
    phone: 'buyer.phone',
    email: 'buyer.email',
    taxId: 'buyer.taxId',
    address: 'buyer.address',
  },
  consignee: {
    companyName: 'consignee.companyName',
    contactName: 'consignee.name',
    phone: 'consignee.phone',
    address: 'consignee.address',
  },
  notifyParty: {
    contactName: 'notifyParty.name',
    address: 'notifyParty.address',
  },
  invoice: {},
  trade: {},
  shipping: {},
  payment: {},
  totals: {},
  declaration: {},
  signature: {},
};

export const SHIPPING_FIELD_KEYS: Record<ShippingEditorField, string> = {
  method: 'shipping.method',
  portOfLoading: 'shipping.portOfLoading',
  portOfDischarge: 'shipping.portOfDischarge',
  route: 'shipping.route',
  transitTime: 'shipping.transitTime',
  cartonCount: 'shipping.cartonCount',
  netWeightKg: 'shipping.netWeightKg',
  grossWeightKg: 'shipping.grossWeightKg',
  cbm: 'shipping.cbm',
  marks: 'shipping.marks',
};

export const TOTALS_FIELD_KEYS: Record<TotalsEditorField, string> = {
  discountAmount: 'totals.discount',
  freightAmount: 'totals.freight',
  insuranceAmount: 'totals.insurance',
  otherCharges: 'totals.otherCharges',
};

export const ITEM_EDITOR_COLUMN_KEYS = [
  'items.lineNo',
  'items.sku',
  'items.description',
  'items.hsCode',
  'items.originCountryCode',
  'items.quantity',
  'items.unit',
  'items.unitPrice',
  'items.cartons',
  'items.netWeightKg',
  'items.grossWeightKg',
  'items.cbm',
  'items.amount',
] as const satisfies readonly DocumentItemColumnKey[];

export function isTemplateSectionVisible(
  config: DocumentTemplateConfig,
  section: DocumentSectionKey,
): boolean {
  return isSectionVisible(config, section);
}

export function isTemplateFieldVisible(
  config: DocumentTemplateConfig,
  section: DocumentSectionKey,
  field: string,
): boolean {
  return isFieldVisible(config, section, field);
}

export function visiblePartyFields(
  config: DocumentTemplateConfig,
  section: 'seller' | 'buyer' | 'consignee' | 'notifyParty',
): Set<PartyEditorField> {
  const keys = PARTY_FIELD_KEYS[section] ?? {};
  return new Set(
    (Object.entries(keys) as Array<[PartyEditorField, string]>)
      .filter(([, key]) => isFieldVisible(config, section, key))
      .map(([field]) => field),
  );
}

export function visibleShippingFields(config: DocumentTemplateConfig): Set<ShippingEditorField> {
  return new Set(
    (Object.entries(SHIPPING_FIELD_KEYS) as Array<[ShippingEditorField, string]>)
      .filter(([, key]) => isFieldVisible(config, 'shipping', key))
      .map(([field]) => field),
  );
}

export function visibleTotalsFields(config: DocumentTemplateConfig): Set<TotalsEditorField> {
  return new Set(
    (Object.entries(TOTALS_FIELD_KEYS) as Array<[TotalsEditorField, string]>)
      .filter(([, key]) => isFieldVisible(config, 'totals', key))
      .map(([field]) => field),
  );
}

export function visibleItemEditorColumns(config: DocumentTemplateConfig): DocumentItemColumnKey[] {
  return config.itemColumns
    .map((column) => column.key)
    .filter((key): key is DocumentItemColumnKey =>
      ITEM_EDITOR_COLUMN_KEYS.includes(key as DocumentItemColumnKey),
    )
    .filter((key) => isItemColumnVisible(config, key));
}

export function visibleNotes(config: DocumentTemplateConfig): boolean {
  return config.notes.visible;
}
