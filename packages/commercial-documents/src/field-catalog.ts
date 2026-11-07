// Stable field keys shared by the template editor, the API validator, the HTML
// renderer and the missing-field checklist (docs/41 §7.4-7.5).
//
// The template may hide, reorder or relabel these fields, but it can never
// introduce arbitrary expressions or data reads: a key outside this catalog is
// rejected server-side.

export const DOCUMENT_SECTION_KEYS = [
  'seller',
  'buyer',
  'consignee',
  'notifyParty',
  'invoice',
  'trade',
  'shipping',
  'payment',
  'totals',
  'declaration',
  'signature',
] as const;
export type DocumentSectionKey = (typeof DOCUMENT_SECTION_KEYS)[number];

export interface DocumentFieldDefinition {
  key: string;
  section: DocumentSectionKey;
  label: Record<'en-US' | 'zh-CN', string>;
}

export const DOCUMENT_FIELD_DEFINITIONS = [
  { key: 'seller.companyName', section: 'seller', label: { 'en-US': 'Seller / Exporter', 'zh-CN': '卖方 / 出口商' } },
  { key: 'seller.address', section: 'seller', label: { 'en-US': 'Seller address', 'zh-CN': '卖方地址' } },
  { key: 'seller.contact', section: 'seller', label: { 'en-US': 'Seller contact', 'zh-CN': '卖方联系人' } },
  { key: 'seller.phone', section: 'seller', label: { 'en-US': 'Seller phone', 'zh-CN': '卖方电话' } },
  { key: 'seller.email', section: 'seller', label: { 'en-US': 'Seller email', 'zh-CN': '卖方邮箱' } },
  { key: 'seller.taxId', section: 'seller', label: { 'en-US': 'Seller tax ID', 'zh-CN': '卖方税号' } },
  { key: 'buyer.companyName', section: 'buyer', label: { 'en-US': 'Sold To', 'zh-CN': '买方' } },
  { key: 'buyer.contact', section: 'buyer', label: { 'en-US': 'Buyer contact', 'zh-CN': '买方联系人' } },
  { key: 'buyer.phone', section: 'buyer', label: { 'en-US': 'Buyer phone', 'zh-CN': '买方电话' } },
  { key: 'buyer.email', section: 'buyer', label: { 'en-US': 'Buyer email', 'zh-CN': '买方邮箱' } },
  { key: 'buyer.taxId', section: 'buyer', label: { 'en-US': 'Buyer tax ID', 'zh-CN': '买方税号' } },
  { key: 'buyer.address', section: 'buyer', label: { 'en-US': 'Billing address', 'zh-CN': '账单地址' } },
  { key: 'consignee.name', section: 'consignee', label: { 'en-US': 'Consignee', 'zh-CN': '收货人' } },
  { key: 'consignee.companyName', section: 'consignee', label: { 'en-US': 'Consignee company', 'zh-CN': '收货公司' } },
  { key: 'consignee.phone', section: 'consignee', label: { 'en-US': 'Consignee phone', 'zh-CN': '收货电话' } },
  { key: 'consignee.address', section: 'consignee', label: { 'en-US': 'Ship To', 'zh-CN': '收货地址' } },
  { key: 'notifyParty.name', section: 'notifyParty', label: { 'en-US': 'Notify party', 'zh-CN': '通知方' } },
  { key: 'notifyParty.address', section: 'notifyParty', label: { 'en-US': 'Notify address', 'zh-CN': '通知方地址' } },
  { key: 'document.number', section: 'invoice', label: { 'en-US': 'Invoice No.', 'zh-CN': '发票编号' } },
  { key: 'document.issueDate', section: 'invoice', label: { 'en-US': 'Invoice Date', 'zh-CN': '发票日期' } },
  { key: 'document.revision', section: 'invoice', label: { 'en-US': 'Revision', 'zh-CN': '版本' } },
  { key: 'document.validUntil', section: 'invoice', label: { 'en-US': 'Valid until', 'zh-CN': '有效期至' } },
  { key: 'order.number', section: 'invoice', label: { 'en-US': 'Order No.', 'zh-CN': '订单编号' } },
  { key: 'order.date', section: 'invoice', label: { 'en-US': 'Order date', 'zh-CN': '订单日期' } },
  { key: 'order.contractNo', section: 'invoice', label: { 'en-US': 'Contract No.', 'zh-CN': '合同编号' } },
  { key: 'order.buyerReference', section: 'invoice', label: { 'en-US': 'Buyer reference', 'zh-CN': '买方参考号' } },
  { key: 'trade.incoterm', section: 'trade', label: { 'en-US': 'Trade term', 'zh-CN': '贸易术语' } },
  { key: 'trade.namedPlace', section: 'trade', label: { 'en-US': 'Named place', 'zh-CN': '指定地点' } },
  { key: 'trade.paymentTerms', section: 'trade', label: { 'en-US': 'Payment terms', 'zh-CN': '付款条件' } },
  { key: 'trade.currency', section: 'trade', label: { 'en-US': 'Currency', 'zh-CN': '币种' } },
  { key: 'trade.exchangeRate', section: 'trade', label: { 'en-US': 'Exchange rate', 'zh-CN': '汇率' } },
  { key: 'shipping.method', section: 'shipping', label: { 'en-US': 'Shipping method', 'zh-CN': '运输方式' } },
  { key: 'shipping.portOfLoading', section: 'shipping', label: { 'en-US': 'Port of loading', 'zh-CN': '起运港' } },
  { key: 'shipping.portOfDischarge', section: 'shipping', label: { 'en-US': 'Port of discharge', 'zh-CN': '目的港' } },
  { key: 'shipping.route', section: 'shipping', label: { 'en-US': 'Route / destination', 'zh-CN': '路线 / 目的地' } },
  { key: 'shipping.transitTime', section: 'shipping', label: { 'en-US': 'Estimated transit time', 'zh-CN': '预计运输时间' } },
  { key: 'shipping.cartonCount', section: 'shipping', label: { 'en-US': 'Packages / cartons', 'zh-CN': '包装件数 / 箱数' } },
  { key: 'shipping.netWeightKg', section: 'shipping', label: { 'en-US': 'Net weight (kg)', 'zh-CN': '净重（kg）' } },
  { key: 'shipping.grossWeightKg', section: 'shipping', label: { 'en-US': 'Gross weight (kg)', 'zh-CN': '毛重（kg）' } },
  { key: 'shipping.cbm', section: 'shipping', label: { 'en-US': 'Measurement (CBM)', 'zh-CN': '体积（CBM）' } },
  { key: 'shipping.marks', section: 'shipping', label: { 'en-US': 'Shipping marks', 'zh-CN': '唛头' } },
  { key: 'payment.accountHolder', section: 'payment', label: { 'en-US': 'Account holder', 'zh-CN': '账户名称' } },
  { key: 'payment.bankName', section: 'payment', label: { 'en-US': 'Bank name', 'zh-CN': '银行名称' } },
  { key: 'payment.bankAddress', section: 'payment', label: { 'en-US': 'Bank address', 'zh-CN': '银行地址' } },
  { key: 'payment.accountNumber', section: 'payment', label: { 'en-US': 'Account number', 'zh-CN': '账号' } },
  { key: 'payment.swift', section: 'payment', label: { 'en-US': 'SWIFT / BIC', 'zh-CN': 'SWIFT / BIC' } },
  { key: 'payment.wireRoutingNumber', section: 'payment', label: { 'en-US': 'Wire routing number', 'zh-CN': '电汇路由号' } },
  { key: 'payment.achRoutingNumber', section: 'payment', label: { 'en-US': 'ACH routing number', 'zh-CN': 'ACH 路由号' } },
  { key: 'totals.subtotal', section: 'totals', label: { 'en-US': 'Subtotal', 'zh-CN': '商品金额合计' } },
  { key: 'totals.discount', section: 'totals', label: { 'en-US': 'Discount', 'zh-CN': '折扣' } },
  { key: 'totals.freight', section: 'totals', label: { 'en-US': 'Freight', 'zh-CN': '运费' } },
  { key: 'totals.insurance', section: 'totals', label: { 'en-US': 'Insurance', 'zh-CN': '保险' } },
  { key: 'totals.otherCharges', section: 'totals', label: { 'en-US': 'Other charges', 'zh-CN': '其他费用' } },
  { key: 'totals.grandTotal', section: 'totals', label: { 'en-US': 'Grand total', 'zh-CN': '合计' } },
  { key: 'totals.amountInWords', section: 'totals', label: { 'en-US': 'Amount in words', 'zh-CN': '金额大写' } },
  { key: 'declaration.countryOfOrigin', section: 'declaration', label: { 'en-US': 'Country of origin', 'zh-CN': '原产国' } },
  { key: 'declaration.text', section: 'declaration', label: { 'en-US': 'Origin declaration', 'zh-CN': '原产地声明' } },
  { key: 'declaration.authenticity', section: 'declaration', label: { 'en-US': 'Authenticity statement', 'zh-CN': '真实性声明' } },
  { key: 'signature.seller', section: 'signature', label: { 'en-US': 'Seller signature / stamp', 'zh-CN': '卖方签字 / 盖章' } },
  { key: 'signature.buyer', section: 'signature', label: { 'en-US': 'Buyer signature', 'zh-CN': '买方签字' } },
] as const satisfies readonly DocumentFieldDefinition[];

export type DocumentFieldKey = (typeof DOCUMENT_FIELD_DEFINITIONS)[number]['key'];
export const DOCUMENT_FIELD_KEYS = DOCUMENT_FIELD_DEFINITIONS.map(
  (definition) => definition.key,
) as unknown as readonly [DocumentFieldKey, ...DocumentFieldKey[]];

const FIELD_BY_KEY = new Map<string, DocumentFieldDefinition>(
  DOCUMENT_FIELD_DEFINITIONS.map((definition) => [definition.key, definition]),
);

export function documentFieldDefinition(key: string): DocumentFieldDefinition | undefined {
  return FIELD_BY_KEY.get(key);
}

export function defaultFieldLabel(key: string, locale: string): string {
  const definition = FIELD_BY_KEY.get(key);
  if (definition) return locale === 'zh-CN' ? definition.label['zh-CN'] : definition.label['en-US'];
  // Item keys are validated against DOCUMENT_ITEM_COLUMN_KEYS at runtime.
  const item = DOCUMENT_ITEM_COLUMN_LABELS[key as DocumentItemColumnKey];
  if (item) return locale === 'zh-CN' ? item['zh-CN'] : item['en-US'];
  return key;
}

export const DOCUMENT_ITEM_COLUMN_KEYS = [
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
] as const;
export type DocumentItemColumnKey = (typeof DOCUMENT_ITEM_COLUMN_KEYS)[number];

export const DOCUMENT_ITEM_COLUMN_LABELS: Record<
  DocumentItemColumnKey,
  Record<'en-US' | 'zh-CN', string>
> = {
  'items.lineNo': { 'en-US': '#', 'zh-CN': '序号' },
  'items.sku': { 'en-US': 'SKU', 'zh-CN': 'SKU' },
  'items.description': { 'en-US': 'Description', 'zh-CN': '品名' },
  'items.hsCode': { 'en-US': 'HS Code', 'zh-CN': 'HS 编码' },
  'items.originCountryCode': { 'en-US': 'Origin', 'zh-CN': '原产国' },
  'items.quantity': { 'en-US': 'Qty', 'zh-CN': '数量' },
  'items.unit': { 'en-US': 'Unit', 'zh-CN': '单位' },
  'items.unitPrice': { 'en-US': 'Unit price', 'zh-CN': '单价' },
  'items.cartons': { 'en-US': 'Cartons', 'zh-CN': '箱数' },
  'items.netWeightKg': { 'en-US': 'Net weight (kg)', 'zh-CN': '净重（kg）' },
  'items.grossWeightKg': { 'en-US': 'Gross weight (kg)', 'zh-CN': '毛重（kg）' },
  'items.cbm': { 'en-US': 'CBM', 'zh-CN': '体积（CBM）' },
  'items.amount': { 'en-US': 'Amount', 'zh-CN': '金额' },
};

export const DOCUMENT_SECTION_LABELS: Record<
  DocumentSectionKey,
  Record<'en-US' | 'zh-CN', string>
> = {
  seller: { 'en-US': 'Seller', 'zh-CN': '卖方' },
  buyer: { 'en-US': 'Buyer', 'zh-CN': '买方' },
  consignee: { 'en-US': 'Consignee', 'zh-CN': '收货人' },
  notifyParty: { 'en-US': 'Notify party', 'zh-CN': '通知方' },
  invoice: { 'en-US': 'Invoice details', 'zh-CN': '发票信息' },
  trade: { 'en-US': 'Trade terms', 'zh-CN': '贸易条款' },
  shipping: { 'en-US': 'Shipping & delivery', 'zh-CN': '运输与交付' },
  payment: { 'en-US': 'Payment information', 'zh-CN': '付款信息' },
  totals: { 'en-US': 'Totals', 'zh-CN': '金额汇总' },
  declaration: { 'en-US': 'Declaration', 'zh-CN': '声明' },
  signature: { 'en-US': 'Signature', 'zh-CN': '签章' },
};
