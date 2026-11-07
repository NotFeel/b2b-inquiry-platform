import { amountInWords as generateAmountInWords } from './amount-in-words';
import { documentCurrencyScale, formatDocumentAmount } from './totals';
import { DOCUMENT_ITEM_COLUMN_LABELS, defaultFieldLabel } from './field-catalog';
import { visibleSections, type DocumentTemplateConfig } from './template-config';

export interface DocumentAddressSnapshot {
  recipient?: string | null;
  companyName?: string | null;
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  countryCode?: string | null;
}

export interface DocumentPartySnapshot {
  companyName?: string | null;
  contactName?: string | null;
  phone?: string | null;
  email?: string | null;
  taxId?: string | null;
  countryCode?: string | null;
  address?: DocumentAddressSnapshot | null;
  billingAddress?: DocumentAddressSnapshot | null;
  shippingAddress?: DocumentAddressSnapshot | null;
}

export interface DocumentTradeSnapshot {
  incotermCode?: string | null;
  namedPlace?: string | null;
  paymentTerms?: string | null;
  contractNo?: string | null;
  buyerReference?: string | null;
  exchangeRateText?: string | null;
}

export interface DocumentShippingSnapshot {
  method?: string | null;
  portOfLoading?: string | null;
  portOfDischarge?: string | null;
  route?: string | null;
  transitTime?: string | null;
  cartonCount?: number | string | null;
  netWeightKg?: string | null;
  grossWeightKg?: string | null;
  cbm?: string | null;
  marks?: string | null;
}

export interface DocumentPaymentSnapshot {
  accountHolder?: string | null;
  bankName?: string | null;
  bankAddress?: string | null;
  accountNumber?: string | null;
  swiftCode?: string | null;
  wireRoutingNumber?: string | null;
  achRoutingNumber?: string | null;
}

export interface DocumentDeclarationSnapshot {
  countryOfOrigin?: string | null;
  text?: string | null;
  authenticityText?: string | null;
}

export interface DocumentSignatureSnapshot {
  sellerName?: string | null;
  sellerTitle?: string | null;
  stampAssetId?: string | null;
}

export interface DocumentRenderItem {
  lineNo: number;
  sku?: string | null;
  description?: string | null;
  hsCode?: string | null;
  originCountryCode?: string | null;
  quantity?: string | null;
  unit?: string | null;
  unitPrice?: string | null;
  cartons?: number | string | null;
  netWeightKg?: string | null;
  grossWeightKg?: string | null;
  cbm?: string | null;
  lineAmount?: string | null;
}

export interface DocumentRenderTotals {
  subtotal: string;
  discountAmount: string;
  freightAmount: string;
  insuranceAmount: string;
  otherCharges: string;
  totalAmount: string;
}

export interface CommercialDocumentRenderData {
  documentType: 'PI' | 'CI';
  documentNo: string;
  revisionNo: number;
  status: string;
  locale: 'en-US' | 'zh-CN';
  currency: string;
  issueDate?: string | null;
  validUntil?: string | null;
  orderNo?: string | null;
  orderDate?: string | null;
  contractNo?: string | null;
  buyerReference?: string | null;
  exchangeRateText?: string | null;
  seller: DocumentPartySnapshot;
  buyer: DocumentPartySnapshot;
  consignee?: DocumentPartySnapshot | null;
  notifyParty?: DocumentPartySnapshot | null;
  trade?: DocumentTradeSnapshot | null;
  shipping?: DocumentShippingSnapshot | null;
  payment?: DocumentPaymentSnapshot | null;
  declaration?: DocumentDeclarationSnapshot | null;
  signature?: DocumentSignatureSnapshot | null;
  notes?: string | null;
  items: DocumentRenderItem[];
  totals: DocumentRenderTotals;
}

export interface DocumentRenderAssets {
  logoDataUri?: string | null;
  stampDataUri?: string | null;
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  CNY: '¥',
  JPY: '¥',
  KRW: '₩',
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function text(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

export function formatDocumentAddress(
  address: DocumentAddressSnapshot | null | undefined,
): string {
  if (!address) return '';
  const lines = [
    text(address.companyName),
    text(address.recipient),
    text(address.line1),
    text(address.line2),
    [text(address.city), text(address.state), text(address.postalCode)].filter(Boolean).join(', '),
    text(address.countryCode),
  ].filter((line) => line.length > 0);
  return lines.join('\n');
}

export function documentFieldValueMap(
  data: CommercialDocumentRenderData,
): Record<string, string> {
  const buyerAddress = formatDocumentAddress(data.buyer.billingAddress ?? data.buyer.address);
  const consigneeAddress = formatDocumentAddress(
    data.consignee?.shippingAddress ?? data.consignee?.address,
  );
  const notifyAddress = formatDocumentAddress(data.notifyParty?.address);
  const uniqueOrigins = Array.from(
    new Set(data.items.map((item) => text(item.originCountryCode)).filter(Boolean)),
  );
  return {
    'seller.companyName': text(data.seller.companyName),
    'seller.address': formatDocumentAddress(data.seller.address),
    'seller.contact': text(data.seller.contactName),
    'seller.phone': text(data.seller.phone),
    'seller.email': text(data.seller.email),
    'seller.taxId': text(data.seller.taxId),
    'buyer.companyName': text(data.buyer.companyName),
    'buyer.contact': text(data.buyer.contactName),
    'buyer.phone': text(data.buyer.phone),
    'buyer.email': text(data.buyer.email),
    'buyer.taxId': text(data.buyer.taxId),
    'buyer.address': buyerAddress,
    'consignee.name': text(data.consignee?.contactName ?? data.consignee?.companyName),
    'consignee.companyName': text(data.consignee?.companyName),
    'consignee.phone': text(data.consignee?.phone),
    'consignee.address': consigneeAddress,
    'notifyParty.name': text(data.notifyParty?.companyName ?? data.notifyParty?.contactName),
    'notifyParty.address': notifyAddress,
    'document.number': data.documentNo,
    'document.issueDate': text(data.issueDate),
    'document.revision': `R${data.revisionNo}`,
    'document.validUntil': text(data.validUntil),
    'order.number': text(data.orderNo),
    'order.date': text(data.orderDate),
    'order.contractNo': text(data.contractNo ?? data.trade?.contractNo),
    'order.buyerReference': text(data.buyerReference ?? data.trade?.buyerReference),
    'trade.incoterm': text(data.trade?.incotermCode),
    'trade.namedPlace': text(data.trade?.namedPlace),
    'trade.paymentTerms': text(data.trade?.paymentTerms),
    'trade.currency': data.currency,
    'trade.exchangeRate': text(data.exchangeRateText ?? data.trade?.exchangeRateText),
    'shipping.method': text(data.shipping?.method),
    'shipping.portOfLoading': text(data.shipping?.portOfLoading),
    'shipping.portOfDischarge': text(data.shipping?.portOfDischarge),
    'shipping.route': text(data.shipping?.route),
    'shipping.transitTime': text(data.shipping?.transitTime),
    'shipping.cartonCount': text(data.shipping?.cartonCount),
    'shipping.netWeightKg': text(data.shipping?.netWeightKg),
    'shipping.grossWeightKg': text(data.shipping?.grossWeightKg),
    'shipping.cbm': text(data.shipping?.cbm),
    'shipping.marks': text(data.shipping?.marks),
    'payment.accountHolder': text(data.payment?.accountHolder),
    'payment.bankName': text(data.payment?.bankName),
    'payment.bankAddress': text(data.payment?.bankAddress),
    'payment.accountNumber': text(data.payment?.accountNumber),
    'payment.swift': text(data.payment?.swiftCode),
    'payment.wireRoutingNumber': text(data.payment?.wireRoutingNumber),
    'payment.achRoutingNumber': text(data.payment?.achRoutingNumber),
    'totals.subtotal': data.totals.subtotal,
    'totals.discount': data.totals.discountAmount,
    'totals.freight': data.totals.freightAmount,
    'totals.insurance': data.totals.insuranceAmount,
    'totals.otherCharges': data.totals.otherCharges,
    'totals.grandTotal': data.totals.totalAmount,
    'totals.amountInWords': generateAmountInWords(
      data.totals.totalAmount,
      data.currency,
      data.locale,
    ),
    'declaration.countryOfOrigin':
      text(data.declaration?.countryOfOrigin) || uniqueOrigins.join(', '),
    'declaration.text': text(data.declaration?.text),
    'declaration.authenticity': text(data.declaration?.authenticityText),
    'signature.seller': [text(data.signature?.sellerName), text(data.signature?.sellerTitle)]
      .filter(Boolean)
      .join(', '),
    'signature.buyer': '',
  };
}

function itemCellValue(item: DocumentRenderItem, key: string): string {
  switch (key) {
    case 'items.lineNo':
      return String(item.lineNo);
    case 'items.sku':
      return text(item.sku);
    case 'items.description':
      return text(item.description);
    case 'items.hsCode':
      return text(item.hsCode);
    case 'items.originCountryCode':
      return text(item.originCountryCode);
    case 'items.quantity':
      return text(item.quantity);
    case 'items.unit':
      return text(item.unit);
    case 'items.unitPrice':
      return formatDocumentAmount(item.unitPrice ?? '', 2);
    case 'items.cartons':
      return text(item.cartons);
    case 'items.netWeightKg':
      return text(item.netWeightKg);
    case 'items.grossWeightKg':
      return text(item.grossWeightKg);
    case 'items.cbm':
      return text(item.cbm);
    case 'items.amount':
      return formatDocumentAmount(item.lineAmount ?? '', 2);
    default:
      return '';
  }
}

function amountCell(value: string, currency: string): string {
  const formatted = formatDocumentAmount(value, documentCurrencyScale(currency));
  return `<span class="amount">${escapeHtml(formatted)}</span>`;
}

/**
 * Renders the complete standalone HTML used for preview and PDF conversion.
 *
 * All business values are escaped. No external resource, script, iframe or
 * file URL is ever emitted; logo and stamp are only embedded as pre-fetched
 * data URIs by the trusted worker (docs/41 §7.6).
 */
export function renderCommercialDocumentHtml(
  config: DocumentTemplateConfig,
  data: CommercialDocumentRenderData,
  assets: DocumentRenderAssets = {},
): string {
  const locale = data.locale;
  const zh = locale === 'zh-CN';
  const values = documentFieldValueMap(data);
  const sections = visibleSections(config, locale);
  const page = config.page;
  const pageSize = `${page.size} ${page.orientation}`;
  const margins = `${page.marginMm.top}mm ${page.marginMm.right}mm ${page.marginMm.bottom}mm ${page.marginMm.left}mm`;
  const currencySymbol = CURRENCY_SYMBOLS[data.currency] ?? '';
  const documentTitle =
    config.header.title ||
    (data.documentType === 'CI' ? 'COMMERCIAL INVOICE' : 'PROFORMA INVOICE');

  const partySections = new Set(['buyer', 'consignee', 'notifyParty']);
  const detailSections = new Set(['invoice', 'trade', 'shipping', 'payment']);

  const sellerSection = sections.find((section) => section.key === 'seller');
  const sellerFields = sellerSection
    ? sellerSection.fields
        .map((field) => {
          const value = values[field.key];
          if (!value) return '';
          return `<div class="seller-line"><span class="label">${escapeHtml(field.label)}:</span> <span class="pre">${escapeHtml(value)}</span></div>`;
        })
        .join('')
    : '';

  const partyBlocks = sections
    .filter((section) => partySections.has(section.key))
    .map((section) => {
      const fields = section.fields
        .map((field) => {
          const value = values[field.key];
          if (!value) return '';
          return `<div class="party-field"><div class="label">${escapeHtml(field.label)}</div><div class="pre">${escapeHtml(value)}</div></div>`;
        })
        .join('');
      if (!fields) return '';
      return `<div class="party-block"><h3>${escapeHtml(section.title)}</h3>${fields}</div>`;
    })
    .join('');

  const detailBlocks = sections
    .filter((section) => detailSections.has(section.key))
    .map((section) => {
      const fields = section.fields
        .map((field) => {
          const value = values[field.key];
          if (!value) return '';
          return `<div class="detail-row"><div class="label">${escapeHtml(field.label)}</div><div class="pre">${escapeHtml(value)}</div></div>`;
        })
        .join('');
      if (!fields) return '';
      return `<div class="detail-block"><h3>${escapeHtml(section.title)}</h3>${fields}</div>`;
    })
    .join('');

  const columns = config.itemColumns.filter((column) => column.visible);
  const headerCells = columns
    .map((column) => {
      const width = column.width ? ` style="width:${column.width}%"` : '';
      const label =
        column.label ||
        DOCUMENT_ITEM_COLUMN_LABELS[column.key][locale] ||
        defaultFieldLabel(column.key, locale);
      return `<th${width}>${escapeHtml(label)}</th>`;
    })
    .join('');
  const itemRows = data.items
    .map((item) => {
      const cells = columns
        .map((column) => {
          const value = itemCellValue(item, column.key);
          const numeric = column.key === 'items.amount' || column.key === 'items.unitPrice';
          return `<td class="${numeric ? 'numeric' : ''}">${escapeHtml(value)}</td>`;
        })
        .join('');
      return `<tr>${cells}</tr>`;
    })
    .join('');

  const totalsSectionConfig = config.sections.find((section) => section.key === 'totals');
  const totalsVisible = totalsSectionConfig ? totalsSectionConfig.visible : true;
  const totalsFieldVisible = (key: string): boolean => {
    if (!totalsSectionConfig) return true;
    const field = totalsSectionConfig.fields.find((candidate) => candidate.key === key);
    return field ? field.visible : true;
  };
  const totalsLabel = (key: string, fallback: string): string => {
    const field = totalsSectionConfig?.fields.find((candidate) => candidate.key === key);
    return field?.label || fallback;
  };
  const words = generateAmountInWords(data.totals.totalAmount, data.currency, locale);
  const totalsRows: string[] = [];
  if (totalsVisible) {
    if (totalsFieldVisible('totals.subtotal')) {
      totalsRows.push(
        `<tr><td>${escapeHtml(totalsLabel('totals.subtotal', zh ? '商品金额合计' : 'Subtotal'))}</td><td class="numeric">${amountCell(data.totals.subtotal, data.currency)}</td></tr>`,
      );
    }
    if (totalsFieldVisible('totals.discount') && Number(data.totals.discountAmount) > 0) {
      totalsRows.push(
        `<tr><td>${escapeHtml(totalsLabel('totals.discount', zh ? '折扣' : 'Discount'))}</td><td class="numeric">- ${amountCell(data.totals.discountAmount, data.currency)}</td></tr>`,
      );
    }
    if (totalsFieldVisible('totals.freight') && Number(data.totals.freightAmount) > 0) {
      totalsRows.push(
        `<tr><td>${escapeHtml(totalsLabel('totals.freight', zh ? '运费' : 'Freight'))}</td><td class="numeric">${amountCell(data.totals.freightAmount, data.currency)}</td></tr>`,
      );
    }
    if (totalsFieldVisible('totals.insurance') && Number(data.totals.insuranceAmount) > 0) {
      totalsRows.push(
        `<tr><td>${escapeHtml(totalsLabel('totals.insurance', zh ? '保险' : 'Insurance'))}</td><td class="numeric">${amountCell(data.totals.insuranceAmount, data.currency)}</td></tr>`,
      );
    }
    if (totalsFieldVisible('totals.otherCharges') && Number(data.totals.otherCharges) > 0) {
      totalsRows.push(
        `<tr><td>${escapeHtml(totalsLabel('totals.otherCharges', zh ? '其他费用' : 'Other charges'))}</td><td class="numeric">${amountCell(data.totals.otherCharges, data.currency)}</td></tr>`,
      );
    }
    if (totalsFieldVisible('totals.grandTotal')) {
      totalsRows.push(
        `<tr class="grand-total"><td>${escapeHtml(totalsLabel('totals.grandTotal', zh ? '合计' : 'Grand Total'))} ${escapeHtml(currencySymbol)} ${escapeHtml(data.currency)}</td><td class="numeric">${amountCell(data.totals.totalAmount, data.currency)}</td></tr>`,
      );
    }
    if (totalsFieldVisible('totals.amountInWords')) {
      totalsRows.push(
        `<tr><td colspan="2" class="amount-words"><span class="label">${escapeHtml(totalsLabel('totals.amountInWords', zh ? '金额大写' : 'Amount in words'))}:</span> ${escapeHtml(words)}</td></tr>`,
      );
    }
  }

  const notesSection = data.notes
    ? `<section class="block notes"><h3>${zh ? '备注' : 'Notes'}</h3><div class="pre">${escapeHtml(data.notes)}</div></section>`
    : '';
  const paymentNotice = config.terms.paymentNotice
    ? `<div class="notice"><strong>${zh ? '付款说明' : 'Payment notice'}:</strong> ${escapeHtml(config.terms.paymentNotice)}</div>`
    : '';
  const shipmentNotice = config.terms.shipmentNotice
    ? `<div class="notice"><strong>${zh ? '运输说明' : 'Shipment notice'}:</strong> ${escapeHtml(config.terms.shipmentNotice)}</div>`
    : '';
  const declarationSection = sections.find((section) => section.key === 'declaration');
  const declarationFields =
    declarationSection?.fields
      .map((field) => {
        const value = values[field.key];
        if (!value) return '';
        return `<div class="notice"><strong>${escapeHtml(field.label)}:</strong> <span class="pre">${escapeHtml(value)}</span></div>`;
      })
      .join('') ?? '';
  const authenticity = config.terms.authenticityDeclaration
    ? `<div class="notice">${escapeHtml(config.terms.authenticityDeclaration)}</div>`
    : '';
  const signatureSection = sections.find((section) => section.key === 'signature');
  const stamp =
    signatureSection && config.header.showLogo && assets.stampDataUri
      ? `<img class="stamp" src="${escapeHtml(assets.stampDataUri)}" alt="" />`
      : '';
  const logo =
    config.header.showLogo && assets.logoDataUri
      ? `<img class="logo" src="${escapeHtml(assets.logoDataUri)}" alt="" />`
      : '';
  const signatureBlock = signatureSection
    ? `<section class="signature">
        <div class="signature-cell">
          <div class="signature-line">${escapeHtml(
            signatureSection.fields.find((field) => field.key === 'signature.seller')?.label ??
              (zh ? '卖方签字 / 盖章' : 'Seller signature / stamp'),
          )}</div>
          ${stamp}
          <div class="signature-name">${escapeHtml(values['signature.seller'] ?? '')}</div>
        </div>
        <div class="signature-cell">
          <div class="signature-line">${escapeHtml(
            signatureSection.fields.find((field) => field.key === 'signature.buyer')?.label ??
              (zh ? '买方签字' : 'Buyer signature'),
          )}</div>
          <div class="signature-name">${escapeHtml(values['buyer.companyName'] ?? '')}</div>
        </div>
      </section>`
    : '';

  const footerText = config.footer.text
    ? `<div class="footer-text">${escapeHtml(config.footer.text)}</div>`
    : '';

  return `<!doctype html>
<html lang="${escapeHtml(locale)}">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(documentTitle)} ${escapeHtml(data.documentNo)}</title>
<style>
  @page { size: ${pageSize}; margin: ${margins}; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: "${config.theme.fontFamily.replace(/"/g, '')}", "DejaVu Sans", sans-serif;
    font-size: ${config.theme.fontSizePt}pt;
    color: #111827;
    padding: ${margins};
    line-height: 1.35;
  }
  h1 { font-size: 18pt; margin: 0 0 2mm; color: ${config.theme.primaryColor}; letter-spacing: 0.5pt; }
  h2 { font-size: 12pt; margin: 0 0 1mm; color: ${config.theme.primaryColor}; }
  h3 { font-size: 9.5pt; margin: 0 0 1.5mm; text-transform: uppercase; color: ${config.theme.primaryColor}; border-bottom: 0.4pt solid #d1d5db; padding-bottom: 0.8mm; }
  .label { color: #6b7280; font-size: 8.5pt; }
  .pre { white-space: pre-line; }
  .doc-header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 1.5pt solid ${config.theme.accentColor}; padding-bottom: 3mm; margin-bottom: 3mm; }
  .doc-header .logo { max-height: 18mm; max-width: 45mm; }
  .doc-header .seller { max-width: 96mm; }
  .doc-header .seller-line { margin: 0.4mm 0; }
  .doc-meta { text-align: right; }
  .doc-meta .doctype { font-size: 8pt; letter-spacing: 1pt; color: #6b7280; }
  .parties { display: flex; gap: 4mm; margin-bottom: 3mm; }
  .party-block { flex: 1; border: 0.4pt solid #d1d5db; border-radius: 1.5mm; padding: 2.5mm; min-width: 0; }
  .party-field { margin-bottom: 1.2mm; }
  .details { display: flex; flex-wrap: wrap; gap: 3mm; margin-bottom: 3mm; }
  .detail-block { flex: 1 1 48%; border: 0.4pt solid #e5e7eb; border-radius: 1.5mm; padding: 2mm 2.5mm; min-width: 0; }
  .detail-row { display: flex; justify-content: space-between; gap: 3mm; border-bottom: 0.3pt dotted #e5e7eb; padding: 0.6mm 0; }
  .detail-row .label { flex: 0 0 38%; }
  .detail-row .pre { flex: 1; text-align: right; word-break: break-word; }
  table.items { width: 100%; border-collapse: collapse; margin: 2mm 0 3mm; table-layout: fixed; }
  table.items thead { display: table-header-group; }
  table.items tr { page-break-inside: avoid; }
  table.items th { background: ${config.theme.primaryColor}; color: #ffffff; font-size: 8pt; padding: 1.6mm 1.2mm; text-align: left; word-break: break-word; }
  table.items td { border-bottom: 0.4pt solid #e5e7eb; padding: 1.4mm 1.2mm; font-size: 8.5pt; vertical-align: top; word-break: break-word; }
  td.numeric, th.numeric { text-align: right; }
  table.totals { width: 78mm; margin-left: auto; border-collapse: collapse; }
  table.totals td { padding: 1.2mm 1.5mm; border-bottom: 0.4pt solid #e5e7eb; font-size: 9pt; }
  table.totals tr.grand-total td { background: #f3f4f6; font-weight: bold; border-top: 1pt solid ${config.theme.primaryColor}; }
  table.totals td.amount-words { font-size: 8.5pt; color: #374151; border-bottom: none; }
  .notes, .declaration, .block { margin-top: 3mm; }
  .notice { margin: 1mm 0; font-size: 8.5pt; }
  .signature { display: flex; gap: 12mm; margin-top: 10mm; page-break-inside: avoid; }
  .signature-cell { flex: 1; min-height: 24mm; }
  .signature-line { border-top: 0.5pt solid #111827; padding-top: 1.5mm; font-size: 8.5pt; color: #374151; }
  .signature-name { margin-top: 1mm; font-size: 9pt; }
  .stamp { display: block; max-height: 22mm; max-width: 40mm; margin-top: 1mm; }
  .footer-text { margin-top: 6mm; padding-top: 2mm; border-top: 0.4pt solid #d1d5db; font-size: 7.5pt; color: #6b7280; }
  .confidential { font-size: 7.5pt; color: #9ca3af; }
</style>
</head>
<body>
  <header class="doc-header">
    <div class="seller">
      ${logo}
      ${sellerFields}
    </div>
    <div class="doc-meta">
      ${config.header.showDocumentType ? `<div class="doctype">${escapeHtml(data.documentType)}</div>` : ''}
      <h1>${escapeHtml(documentTitle)}</h1>
      ${config.header.subtitle ? `<div class="pre">${escapeHtml(config.header.subtitle)}</div>` : ''}
      <div><span class="label">${zh ? '单据编号' : 'Document No.'}:</span> ${escapeHtml(data.documentNo)}</div>
      <div><span class="label">${zh ? '版本' : 'Revision'}:</span> R${data.revisionNo}</div>
      <div><span class="label">${zh ? '币种' : 'Currency'}:</span> ${escapeHtml(data.currency)}</div>
    </div>
  </header>

  ${partyBlocks ? `<section class="parties">${partyBlocks}</section>` : ''}
  ${detailBlocks ? `<section class="details">${detailBlocks}</section>` : ''}

  <table class="items">
    <thead><tr>${headerCells}</tr></thead>
    <tbody>${itemRows}</tbody>
  </table>

  ${totalsRows.length > 0 ? `<table class="totals">${totalsRows.join('')}</table>` : ''}

  ${notesSection}
  ${paymentNotice || shipmentNotice ? `<section class="block">${paymentNotice}${shipmentNotice}</section>` : ''}
  ${(declarationFields || authenticity || config.terms.authenticityDeclaration) ? `<section class="block declaration">${declarationFields}${authenticity}</section>` : ''}
  ${signatureBlock}
  ${footerText}
  <div class="confidential">${zh ? '商业单据 — 未经授权不得传播。' : 'Commercial document — confidential.'}</div>
</body>
</html>`;
}

export function renderMissingFieldLabels(
  missing: string[],
  locale: string,
): Array<{ key: string; label: string }> {
  return missing.map((key) => ({
    key,
    label: defaultFieldLabel(key, locale),
  }));
}
