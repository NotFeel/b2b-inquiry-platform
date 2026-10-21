import { describe, expect, it } from 'vitest';
import { buildInquiryMessage, buildWhatsAppUrl, normalizeWhatsAppNumber } from './whatsapp';

describe('whatsapp helpers', () => {
  it('normalises an international number to digits only', () => {
    expect(normalizeWhatsAppNumber('+86 138-0000-0000')).toBe('8613800000000');
    // Too short to be an international number.
    expect(normalizeWhatsAppNumber('+1')).toBeNull();
  });

  it('numbers every selected SKU and includes its name', () => {
    const result = buildInquiryMessage({
      items: [
        { sku: 'DEMO-1001', name: 'Hex bolt M12', quantity: 100 },
        { sku: 'DEMO-1002', name: 'Flat washer M12' },
      ],
    });
    expect(result.message).toContain('1. Product: Hex bolt M12\n   SKU: DEMO-1001\n   Quantity: 100');
    expect(result.message).toContain('2. Product: Flat washer M12\n   SKU: DEMO-1002');
    expect(result.message).toContain('Please share your quotation and MOQ details.');
    expect(result.truncated).toBe(false);
  });

  it('de-duplicates SKUs and tolerates a missing name', () => {
    const result = buildInquiryMessage({
      items: [{ sku: 'SKU-1' }, { sku: 'SKU-1', name: 'Duplicate' }, { sku: 'SKU-2', name: null }],
    });
    expect(result.skus).toEqual(['SKU-1', 'SKU-2']);
    expect(result.message).toContain('1. Product: SKU-1\n   SKU: SKU-1\n');
  });

  it('includes a public product link but rejects non-http URLs', () => {
    const result = buildInquiryMessage({
      items: [
        {
          sku: 'SKU-1',
          name: 'Public product',
          url: 'https://shop.example.com/en-US/products/public-product',
        },
        { sku: 'SKU-2', name: 'Unsafe', url: 'javascript:alert(1)' },
      ],
    });
    expect(result.message).toContain(
      '   Link: https://shop.example.com/en-US/products/public-product',
    );
    expect(result.message).not.toContain('javascript:');
  });

  it('reports truncation instead of silently dropping SKUs', () => {
    const items = Array.from({ length: 25 }, (_, index) => ({ sku: `SKU-${index}` }));
    const result = buildInquiryMessage({ items, limit: 20 });
    expect(result.skus).toHaveLength(20);
    expect(result.truncated).toBe(true);
  });

  it('never includes price information in the prefilled text', () => {
    const result = buildInquiryMessage({
      items: [{ sku: 'DEMO-1001', name: 'Hex bolt M12' }],
      sourceUrl: 'https://example.com/en-US/products/demo-hex-bolt-m12',
    });
    expect(result.message).not.toMatch(/price|amount|usd|cny|\$/i);
    expect(result.message).toContain('Source: https://example.com');
  });

  it('url-encodes the message', () => {
    const url = buildWhatsAppUrl('8613800000000', "Hello, I'm interested: SKU-001");
    expect(url.startsWith('https://wa.me/8613800000000?text=')).toBe(true);
    expect(url).toContain('%20');
  });

  it('localises the prefilled message for Chinese visitors', () => {
    const result = buildInquiryMessage({
      locale: 'zh-CN',
      items: [{ sku: 'SKU-1', name: '样品', quantity: 12 }],
    });
    expect(result.message).toContain('你好！我想咨询以下产品：');
    expect(result.message).toContain('   数量: 12');
    expect(result.message).toContain('请提供报价与 MOQ 信息。');
  });
});
