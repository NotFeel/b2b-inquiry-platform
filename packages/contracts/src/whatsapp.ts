import { DEFAULT_WHATSAPP_SELECTION_LIMIT } from './constants';

export interface InquiryMessageItem {
  sku: string;
  name?: string | null;
  /** Target quantity, when the visitor supplied one. */
  quantity?: number | null;
  /** Canonical public product URL. Internal/admin URLs are rejected. */
  url?: string | null;
}

export interface InquiryMessageInput {
  items: InquiryMessageItem[];
  /** Public product page the visitor came from; never an internal URL. */
  sourceUrl?: string | null;
  limit?: number;
  /** Visitor-facing language for the prefilled message. */
  locale?: 'en-US' | 'zh-CN';
}

export interface InquiryMessageResult {
  message: string;
  skus: string[];
  truncated: boolean;
}

/** Normalise a WhatsApp number to the international digits-only form (docs/05 §6). */
export function normalizeWhatsAppNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[^\d]/g, '').replace(/^0+/, '');
  if (digits.length < 8 || digits.length > 15) return null;
  return digits;
}

/**
 * Builds the WhatsApp prefilled message (docs/16 §6.7).
 *
 * The text lists every selected SKU with its catalogue name so the sales team
 * can identify the items without a lookup, and it never contains internal
 * prices, notes or customer data. When the selection exceeds the configured
 * limit the caller must show an explicit error; `truncated` reports the
 * condition so no caller can silently drop SKUs.
 */
export function buildInquiryMessage(input: InquiryMessageInput): InquiryMessageResult {
  const limit = input.limit ?? DEFAULT_WHATSAPP_SELECTION_LIMIT;
  const copy =
    input.locale === 'zh-CN'
      ? {
          intro: '你好！我想咨询以下产品：',
          product: '产品',
          sku: 'SKU',
          quantity: '数量',
          link: '链接',
          outro: '请提供报价与 MOQ 信息。',
          source: '来源',
        }
      : {
          intro: 'Hello, I would like to inquire about the following products:',
          product: 'Product',
          sku: 'SKU',
          quantity: 'Quantity',
          link: 'Link',
          outro: 'Please share your quotation and MOQ details.',
          source: 'Source',
        };
  const seen = new Set<string>();
  const unique: InquiryMessageItem[] = [];
  for (const item of input.items) {
    const sku = item.sku?.trim();
    if (!sku || seen.has(sku)) continue;
    seen.add(sku);
    const quantity =
      typeof item.quantity === 'number' && Number.isFinite(item.quantity)
        ? Math.min(999_999, Math.max(1, Math.trunc(item.quantity)))
        : null;
    const url =
      item.url && /^https?:\/\//i.test(item.url) && !/[\r\n]/.test(item.url)
        ? item.url
        : null;
    unique.push({
      sku,
      name: item.name?.replace(/\s+/g, ' ').trim() || null,
      quantity,
      url,
    });
  }

  const accepted = unique.slice(0, limit);
  const truncated = unique.length > accepted.length;

  const lines = accepted.flatMap((item, index) => {
    const itemLines = [
      `${index + 1}. ${copy.product}: ${item.name ?? item.sku}`,
      `   ${copy.sku}: ${item.sku}`,
    ];
    if (item.quantity) itemLines.push(`   ${copy.quantity}: ${item.quantity}`);
    if (item.url) itemLines.push(`   ${copy.link}: ${item.url}`);
    return itemLines;
  });
  const parts = [copy.intro, ...lines, '', copy.outro];
  if (input.sourceUrl) {
    parts.push(`${copy.source}: ${input.sourceUrl}`);
  }

  return {
    message: parts.join('\n'),
    skus: accepted.map((item) => item.sku),
    truncated,
  };
}

export function buildWhatsAppUrl(number: string, message: string): string {
  const normalized = normalizeWhatsAppNumber(number);
  if (!normalized) {
    throw new Error('Invalid WhatsApp number: expected international digits only.');
  }
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
}
