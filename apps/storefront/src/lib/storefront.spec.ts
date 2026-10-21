import { describe, expect, it } from 'vitest';
import { htmlToPlainText } from './content';
import { getTranslator, localeHref, productCountLabel } from './i18n';
import { normalizeQuantity } from './inquiry';
import { isPlaceholderSiteValue } from './site-config';

describe('storefront helpers', () => {
  it('uses the Chinese dictionary instead of silently falling back to English', () => {
    const zh = getTranslator('zh-CN');
    expect(zh.t('site.nav.home')).toBe('首页');
    expect(zh.t('inquiry.empty')).toBe('询价清单为空。');
    expect(zh.t('product.select')).toBe('加入询价');
  });

  it('builds locale-prefixed links without doubling the slash', () => {
    expect(localeHref('en-US', '/products')).toBe('/en-US/products');
    expect(localeHref('zh-CN', '/')).toBe('/zh-CN');
  });

  it('hides obvious seed contact values', () => {
    expect(isPlaceholderSiteValue('sales@example.com')).toBe(true);
    expect(isPlaceholderSiteValue('Add your company address in Settings')).toBe(true);
    expect(isPlaceholderSiteValue('8613800000000')).toBe(true);
    expect(isPlaceholderSiteValue('sales@real-factory.com')).toBe(false);
  });

  it('normalises inquiry quantities to a positive integer within range', () => {
    expect(normalizeQuantity(0)).toBe(1);
    expect(normalizeQuantity(2.9)).toBe(2);
    expect(normalizeQuantity(Number.NaN)).toBe(1);
    expect(normalizeQuantity(2_000_000)).toBe(999_999);
  });

  it('uses the singular English product count', () => {
    const en = getTranslator('en-US');
    expect(productCountLabel(en.t, 1)).toBe('1 product');
    expect(productCountLabel(en.t, 4)).toBe('4 products');
    expect(productCountLabel(en.t, 1, 'catalog.categoryItemsOne', 'catalog.categoryItems')).toBe(
      '1 product',
    );
  });

  it('turns administrator HTML into a bounded plain-text summary', () => {
    expect(
      htmlToPlainText(
        '<h2>Factory</h2><p>Real production &amp; packaging support.</p><script>bad()</script>',
        120,
      ),
    ).toBe('Factory Real production & packaging support.');
    expect(htmlToPlainText('   ', 120)).toBeNull();
  });
});
