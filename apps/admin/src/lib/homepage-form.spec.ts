import { describe, expect, it } from 'vitest';
import type { HomepageCollectionDetail, HomepageCollectionSummary } from '@b2b/contracts';
import type { HomepageSafeProduct } from './homepage-management-api';
import {
  addHomepageProduct,
  emptyHomepageCollectionForm,
  fromHomepageCollectionDetail,
  isHomepageCategoryLocked,
  isHomepageCollectionFormDirty,
  moveHomepageProduct,
  nextHomepageCollectionSortOrder,
  parseHomepageDisplayTotal,
  removeHomepageProduct,
  selectedProductsFromDetail,
  shouldReloadHomepageDetailForLocaleChange,
  toCreateCollectionPayload,
  toHomepageProductsPayload,
  toUpdateCollectionPayload,
  validateHomepageCollectionForm,
} from './homepage-form';

function product(id: string): HomepageSafeProduct {
  return {
    id,
    sku: `SKU-${id}`,
    name: `Product ${id}`,
    publishStatus: 'published',
    lifecycleStatus: 'available',
    coverImageUrl: null,
    coverImageAlt: null,
  };
}

function detail(overrides: Partial<HomepageCollectionDetail> = {}): HomepageCollectionDetail {
  return {
    id: 'collection-1',
    categoryId: 'category-1',
    categoryCode: 'gates',
    categorySlug: 'gates',
    categoryName: 'Gates',
    categoryEnabled: true,
    categoryVisible: true,
    enabled: true,
    sortOrder: 10,
    productLimit: 24,
    title: 'Gates',
    subtitle: null,
    translations: [
      { locale: 'en-US', title: 'Gates', subtitle: null },
      { locale: 'zh-CN', title: '大门', subtitle: '室外大门' },
    ],
    selectedProductCount: 0,
    updatedAt: '2026-11-12T10:00:00.000Z',
    products: [],
    ...overrides,
  };
}

describe('parseHomepageDisplayTotal', () => {
  it.each(['6', '12', '18', '24', '36', '48', '120', '600'])(
    'accepts the legal total %s without a 36/120 business cap',
    (value) => {
      expect(parseHomepageDisplayTotal(value)).toEqual({ value: Number(value), error: null });
    },
  );

  it('accepts the PostgreSQL INTEGER maximum when it is a multiple of six', () => {
    expect(parseHomepageDisplayTotal('2147483646')).toEqual({
      value: 2_147_483_646,
      error: null,
    });
  });

  it.each([
    ['', 'validation.homepage.limit.required'],
    ['0', 'validation.homepage.limit.positive'],
    ['-6', 'validation.homepage.limit.positive'],
    ['6.5', 'validation.homepage.limit.integer'],
    ['18.1', 'validation.homepage.limit.integer'],
    ['7', 'validation.homepage.limit.multipleOfSix'],
    ['2147483648', 'validation.homepage.limit.databaseRange'],
  ])('rejects %s with %s', (value, error) => {
    expect(parseHomepageDisplayTotal(value)).toEqual({ value: null, error });
  });
});

describe('collection form', () => {
  it('maps both locales from the server detail', () => {
    expect(fromHomepageCollectionDetail(detail())).toMatchObject({
      categoryId: 'category-1',
      enabled: true,
      productLimit: '24',
      translations: {
        'en-US': { title: 'Gates', subtitle: '' },
        'zh-CN': { title: '大门', subtitle: '室外大门' },
      },
    });
  });

  it('requires English, validates lengths and blocks a limit below the selection', () => {
    const values = emptyHomepageCollectionForm();
    values.categoryId = 'category-1';
    values.productLimit = '6';
    values.translations['zh-CN'].subtitle = '只有副标题';
    const errors = validateHomepageCollectionForm(values, { selectedProductCount: 12 });
    expect(errors.translations?.['en-US']?.title).toBe(
      'validation.homepage.translation.englishRequired',
    );
    expect(errors.translations?.['zh-CN']?.title).toBe(
      'validation.homepage.translation.titleRequired',
    );
    expect(errors.productLimit).toBe('homepage.validation.productLimitBelowSelection');
  });

  it('builds a create payload with trimmed titles and null empty subtitles', () => {
    const values = emptyHomepageCollectionForm();
    values.categoryId = 'category-1';
    values.productLimit = '120';
    values.translations['en-US'] = { title: '  Gates  ', subtitle: '   ' };
    values.translations['zh-CN'] = { title: '大门', subtitle: '' };
    expect(toCreateCollectionPayload(values, 30)).toEqual({
      categoryId: 'category-1',
      enabled: true,
      sortOrder: 30,
      productLimit: 120,
      translations: [
        { locale: 'en-US', title: 'Gates', subtitle: null },
        { locale: 'zh-CN', title: '大门', subtitle: null },
      ],
    });
  });

  it('only sends categoryId when it changed and always sends the concurrency token', () => {
    const values = fromHomepageCollectionDetail(detail());
    values.enabled = false;
    expect(toUpdateCollectionPayload(values, '2026-11-12T11:00:00.000Z', 'category-1')).toEqual({
      enabled: false,
      productLimit: 24,
      translations: [
        { locale: 'en-US', title: 'Gates', subtitle: null },
        { locale: 'zh-CN', title: '大门', subtitle: '室外大门' },
      ],
      expectedUpdatedAt: '2026-11-12T11:00:00.000Z',
    });

    values.categoryId = 'category-2';
    expect(
      toUpdateCollectionPayload(values, '2026-11-12T11:00:00.000Z', 'category-1').categoryId,
    ).toBe('category-2');
  });

  it('detects dirty form values without locale dependency', () => {
    const values = fromHomepageCollectionDetail(detail());
    expect(isHomepageCollectionFormDirty(values, fromHomepageCollectionDetail(detail()))).toBe(
      false,
    );
    values.translations['en-US'].subtitle = 'Changed';
    expect(isHomepageCollectionFormDirty(values, fromHomepageCollectionDetail(detail()))).toBe(
      true,
    );
  });

  it('keeps the category locked until the complete product replacement is saved', () => {
    expect(isHomepageCategoryLocked(0, 0)).toBe(false);
    expect(isHomepageCategoryLocked(1, 0)).toBe(true);
    expect(isHomepageCategoryLocked(1, 1)).toBe(true);
    expect(isHomepageCategoryLocked(0, 1)).toBe(true);
  });

  it('reloads a clean detail for a new locale but preserves a dirty draft', () => {
    expect(
      shouldReloadHomepageDetailForLocaleChange({
        loadedLocale: 'en-US',
        nextLocale: 'zh-CN',
        draftDirty: false,
      }),
    ).toBe(true);
    expect(
      shouldReloadHomepageDetailForLocaleChange({
        loadedLocale: 'en-US',
        nextLocale: 'zh-CN',
        draftDirty: true,
      }),
    ).toBe(false);
    expect(
      shouldReloadHomepageDetailForLocaleChange({
        loadedLocale: null,
        nextLocale: 'zh-CN',
        draftDirty: true,
      }),
    ).toBe(true);
  });

  it('appends new collections using the service sort order convention', () => {
    const collections = [{ sortOrder: 10 }, { sortOrder: 30 }] as HomepageCollectionSummary[];
    expect(nextHomepageCollectionSortOrder(collections)).toBe(40);
    expect(nextHomepageCollectionSortOrder([])).toBe(10);
  });
});

describe('selected product helpers', () => {
  it('deduplicates products and enforces productLimit without dropping existing rows', () => {
    const first = addHomepageProduct([], product('1'), 2);
    expect(first.products.map((item) => item.id)).toEqual(['1']);
    const duplicate = addHomepageProduct(first.products, product('1'), 2);
    expect(duplicate.error).toBe('homepage.validation.productDuplicate');
    const second = addHomepageProduct(first.products, product('2'), 2);
    const limited = addHomepageProduct(second.products, product('3'), 2);
    expect(limited.error).toBe('homepage.validation.productLimitExceeded');
    expect(limited.products).toEqual(second.products);
  });

  it('blocks a lowered productLimit without deleting the current selection', () => {
    const values = emptyHomepageCollectionForm();
    values.categoryId = 'category-1';
    values.productLimit = '6';
    values.translations['en-US'].title = 'Gates';
    const selected = Array.from({ length: 7 }, (_, index) => product(String(index + 1)));

    const errors = validateHomepageCollectionForm(values, {
      selectedProductCount: selected.length,
    });

    expect(errors.productLimit).toBe('homepage.validation.productLimitBelowSelection');
    expect(selected.map((item) => item.id)).toEqual(['1', '2', '3', '4', '5', '6', '7']);
  });

  it('moves products only within valid boundaries', () => {
    const products = [product('1'), product('2'), product('3')];
    expect(moveHomepageProduct(products, '1', 'up')).toBeNull();
    expect(moveHomepageProduct(products, '3', 'down')).toBeNull();
    expect(moveHomepageProduct(products, '2', 'up')?.map((item) => item.id)).toEqual([
      '2',
      '1',
      '3',
    ]);
    expect(moveHomepageProduct(products, '2', 'down')?.map((item) => item.id)).toEqual([
      '1',
      '3',
      '2',
    ]);
  });

  it('removes only the requested product', () => {
    expect(removeHomepageProduct([product('1'), product('2')], '1').map((item) => item.id)).toEqual(
      ['2'],
    );
  });

  it('maps detail products in server order and sends a complete replacement', () => {
    const selected = selectedProductsFromDetail(
      detail({
        products: [
          {
            productId: '2',
            sku: 'SKU-2',
            name: 'Product 2',
            categoryId: 'category-1',
            publishStatus: 'published',
            lifecycleStatus: 'available',
            sortOrder: 10,
            coverImageUrl: null,
            coverImageAlt: null,
          },
          {
            productId: '1',
            sku: 'SKU-1',
            name: 'Product 1',
            categoryId: 'category-1',
            publishStatus: 'draft',
            lifecycleStatus: 'discontinued',
            sortOrder: 20,
            coverImageUrl: null,
            coverImageAlt: null,
          },
        ],
      }),
    );
    expect(selected.map((item) => item.id)).toEqual(['2', '1']);
    expect(toHomepageProductsPayload(selected, '2026-11-12T12:00:00.000Z')).toEqual({
      products: [
        { productId: '2', sortOrder: 10 },
        { productId: '1', sortOrder: 20 },
      ],
      expectedUpdatedAt: '2026-11-12T12:00:00.000Z',
    });
  });
});
