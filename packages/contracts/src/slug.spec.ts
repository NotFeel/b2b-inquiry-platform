import { describe, expect, it } from 'vitest';
import { PRODUCT_SLUG_MAX_LENGTH, productSlugCandidate, slugifyProductName } from './slug';

describe('slugifyProductName', () => {
  it('normalizes accents, punctuation, casing and repeated separators', () => {
    expect(slugifyProductName('  Ménage à trois  ')).toBe('menage-a-trois');
    expect(slugifyProductName('Steel Gate 1800 × 2000')).toBe('steel-gate-1800-2000');
    expect(slugifyProductName('A---B___C')).toBe('a-b-c');
  });

  it('falls back to product when no latin characters survive', () => {
    expect(slugifyProductName('中文名称')).toBe('product');
    expect(slugifyProductName('   ')).toBe('product');
  });

  it('honours the maximum length', () => {
    const value = slugifyProductName('a'.repeat(300));
    expect(value).toHaveLength(PRODUCT_SLUG_MAX_LENGTH);
  });
});

describe('productSlugCandidate', () => {
  it('keeps the pure name when no random strategy is selected', () => {
    expect(productSlugCandidate('Nylon lock nut M12', 'name')).toBe('nylon-lock-nut-m12');
  });

  it('appends exactly six digits for the random strategy', () => {
    const value = productSlugCandidate('Nylon lock nut M12', 'name-random', '483271');
    expect(value).toBe('nylon-lock-nut-m12-483271');
    expect(value.match(/-(\d{6})$/)?.[1]).toHaveLength(6);
  });

  it('keeps the suffix intact when the base is long', () => {
    const value = productSlugCandidate('x'.repeat(300), 'name-random', '123456');
    expect(value).toHaveLength(PRODUCT_SLUG_MAX_LENGTH);
    expect(value.endsWith('-123456')).toBe(true);
  });

  it('refuses to silently generate a suffix-less random candidate', () => {
    expect(() => productSlugCandidate('Toys', 'name-random')).toThrow(/six-digit/);
  });
});
