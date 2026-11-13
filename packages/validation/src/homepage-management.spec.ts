import { describe, expect, it } from 'vitest';
import {
  DATABASE_INTEGER_MAX,
  createHomepageCollectionSchema,
  homepageCollectionIdSchema,
  updateHomepageCollectionProductsSchema,
  updateHomepageDisplayConfigSchema,
} from './homepage-management';

describe('homepage display totals', () => {
  it.each([6, 12, 24, 36, 48, 120, 600])('accepts configured total %s', (value) => {
    const result = updateHomepageDisplayConfigSchema.safeParse({ newArrivalsLimit: value });
    expect(result.success).toBe(true);
  });

  it.each([0, -6, 7, 7.5])(
    'rejects non-positive, fractional and non-multiple input %s',
    (value) => {
      const result = updateHomepageDisplayConfigSchema.safeParse({ newArrivalsLimit: value });
      expect(result.success).toBe(false);
    },
  );

  it('accepts the largest multiple of six in PostgreSQL INTEGER', () => {
    expect(
      updateHomepageDisplayConfigSchema.safeParse({
        newArrivalsLimit: DATABASE_INTEGER_MAX - 1,
      }).success,
    ).toBe(true);
  });

  it('rejects values beyond PostgreSQL INTEGER instead of introducing a 36/120 cap', () => {
    expect(
      updateHomepageDisplayConfigSchema.safeParse({
        newArrivalsLimit: DATABASE_INTEGER_MAX + 1,
      }).success,
    ).toBe(false);
    expect(
      updateHomepageDisplayConfigSchema.safeParse({ newArrivalsLimit: 10_000_000_000 }).success,
    ).toBe(false);
  });

  it.each([0, -6, 7, 7.5, DATABASE_INTEGER_MAX + 1])(
    'applies the same total rules to collection productLimit %s',
    (productLimit) => {
      const result = createHomepageCollectionSchema.safeParse({
        categoryId: '06a7b9cb-6ffd-4c55-a3ef-bdc64df33566',
        productLimit,
        translations: [{ locale: 'en-US', title: 'New arrivals' }],
      });
      expect(result.success).toBe(false);
    },
  );

  it.each([48, 120, 600])('accepts collection productLimit %s', (productLimit) => {
    const result = createHomepageCollectionSchema.safeParse({
      categoryId: '06a7b9cb-6ffd-4c55-a3ef-bdc64df33566',
      productLimit,
      translations: [{ locale: 'en-US', title: 'New arrivals' }],
    });
    expect(result.success).toBe(true);
  });
});

describe('homepage collection inputs', () => {
  const categoryId = '06a7b9cb-6ffd-4c55-a3ef-bdc64df33566';

  it('requires an English title and unique locales', () => {
    const englishRequired = createHomepageCollectionSchema.safeParse({
      categoryId,
      translations: [{ locale: 'zh-CN', title: '新品' }],
    });
    expect(englishRequired.success).toBe(false);

    const duplicateLocale = createHomepageCollectionSchema.safeParse({
      categoryId,
      translations: [
        { locale: 'en-US', title: 'First' },
        { locale: 'en-US', title: 'Second' },
      ],
    });
    expect(duplicateLocale.success).toBe(false);
  });

  it('defaults productLimit to six without imposing a display-total ceiling', () => {
    const parsed = createHomepageCollectionSchema.parse({
      categoryId,
      translations: [{ locale: 'en-US', title: 'Industrial fasteners' }],
    });
    expect(parsed.productLimit).toBe(6);
  });

  it('rejects a duplicate product id in one collection', () => {
    const productId = '47b34109-4b5b-4428-8989-ac08f9ec1fd5';
    expect(
      updateHomepageCollectionProductsSchema.safeParse({
        products: [{ productId }, { productId, sortOrder: 20 }],
      }).success,
    ).toBe(false);
  });

  it('rejects a malformed collection id before it reaches Prisma', () => {
    expect(homepageCollectionIdSchema.safeParse(categoryId).success).toBe(true);
    expect(homepageCollectionIdSchema.safeParse('not-a-uuid').success).toBe(false);
  });
});
