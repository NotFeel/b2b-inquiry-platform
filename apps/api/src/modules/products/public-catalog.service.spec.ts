import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PUBLIC_PRODUCT_SELECT } from './public-catalog.service';

// Price isolation is a release blocker, so it is asserted twice: structurally on
// the projection (below) and textually against the public code paths (docs/13 §2).

const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..');

function collectKeys(value: unknown, path = ''): string[] {
  if (typeof value !== 'object' || value === null) return [path];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => {
    const next = path ? `${path}.${key}` : key;
    return child !== null && typeof child === 'object' ? collectKeys(child, next) : [next];
  });
}

describe('public product projection', () => {
  it('never selects an internal price field', () => {
    const keys = collectKeys(PUBLIC_PRODUCT_SELECT);
    const forbidden = keys.filter((key) => /price|amount|cost|margin/i.test(key));
    expect(forbidden).toEqual([]);
  });

  it('exposes only whitelisted catalogue fields', () => {
    const keys = collectKeys(PUBLIC_PRODUCT_SELECT);
    expect(keys).toContain('sku');
    expect(keys).toContain('translations.select.name');
    expect(keys).toContain('images.select.asset.select.derivatives');
    expect(keys).not.toContain('createdById');
    expect(keys).not.toContain('publishStatus');
  });
});

describe('storefront source', () => {
  it('contains no reference to internal price fields', () => {
    const files = [
      'apps/storefront/src/lib/api.ts',
      'apps/storefront/src/components/product-card.tsx',
      'apps/storefront/src/app/[locale]/products/[slug]/page.tsx',
      'apps/storefront/src/components/site-shell.tsx',
    ];
    for (const file of files) {
      const content = readFileSync(join(REPO_ROOT, file), 'utf8');
      expect(content, `${file} must not mention priceCny/unitPrice`).not.toMatch(
        /priceCny|unitPrice|price_cny/,
      );
    }
  });
});
