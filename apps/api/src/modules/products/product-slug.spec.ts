import { describe, expect, it } from 'vitest';
import { PRODUCT_SLUG_MAX_LENGTH } from '@b2b/contracts';
import { Prisma } from '@b2b/database';
import {
  buildProductSlugCandidate,
  productUniqueConstraintError,
  randomSlugSuffix,
} from './product-slug';

describe('randomSlugSuffix', () => {
  it('always produces six digits', () => {
    for (let index = 0; index < 50; index += 1) {
      expect(randomSlugSuffix()).toMatch(/^\d{6}$/);
    }
  });
});

describe('buildProductSlugCandidate', () => {
  it('uses the requested strategy', () => {
    expect(buildProductSlugCandidate('Nylon lock nut M12', 'name')).toBe('nylon-lock-nut-m12');
    expect(buildProductSlugCandidate('Nylon lock nut M12', 'name-random', '483271')).toBe(
      'nylon-lock-nut-m12-483271',
    );
  });

  it('never exceeds the database column length', () => {
    const value = buildProductSlugCandidate('x'.repeat(400), 'name-random', '999999');
    expect(value.length).toBeLessThanOrEqual(PRODUCT_SLUG_MAX_LENGTH);
    expect(value.endsWith('-999999')).toBe(true);
  });
});

describe('productUniqueConstraintError', () => {
  const unique = (target: string | string[]) =>
    new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: '6.19.3',
      meta: { target },
    });

  it('maps slug and SKU unique races to field-level conflicts', () => {
    expect(productUniqueConstraintError(unique(['slug']))?.code).toBe('PRODUCT_SLUG_CONFLICT');
    expect(productUniqueConstraintError(unique('products_slug_key'))?.code).toBe(
      'PRODUCT_SLUG_CONFLICT',
    );
    expect(productUniqueConstraintError(unique(['sku']))?.code).toBe('PRODUCT_SKU_CONFLICT');
  });

  it('leaves unrelated errors untouched', () => {
    expect(productUniqueConstraintError(new Error('boom'))).toBeNull();
    expect(
      productUniqueConstraintError(
        new Prisma.PrismaClientKnownRequestError('Serialization failure', {
          code: 'P2034',
          clientVersion: '6.19.3',
        }),
      ),
    ).toBeNull();
  });
});
