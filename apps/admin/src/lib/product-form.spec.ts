import { describe, expect, it } from 'vitest';
import type { ProductAdminDetail } from '@b2b/contracts';
import {
  emptyProductForm,
  formatBytes,
  fromProductDetail,
  mapServerFieldErrors,
  toCreatePayload,
  toWritePayload,
  validateProductForm,
} from './product-form';

function detail(overrides: Partial<ProductAdminDetail> = {}): ProductAdminDetail {
  return {
    id: 'p1',
    sku: 'GATE-001',
    slug: 'steel-gate-001',
    name: 'Steel gate',
    nameZh: '钢制大门',
    categoryId: 'c1',
    categoryName: 'Gates',
    categoryPath: 'Outdoor / Gates',
    publishStatus: 'draft',
    lifecycleStatus: 'available',
    isNew: true,
    isFeatured: false,
    isPreOrder: false,
    sortOrder: 3,
    imageCount: 2,
    hasCover: true,
    coverImageUrl: null,
    coverImageAlt: null,
    pendingImageDeletes: 0,
    tagCodes: ['featured'],
    tagIds: ['t1'],
    updatedAt: new Date('2026-10-01T00:00:00.000Z').toISOString(),
    priceCny: '125.50',
    priceVisible: true,
    lifecycleStatusItemId: null,
    publishStatusItemId: null,
    lengthMm: 1800,
    widthMm: 60,
    heightMm: 2000,
    weightGrams: 45000,
    packaging: 'Plywood crate',
    cartonLengthCm: 210,
    cartonWidthCm: 80,
    cartonHeightCm: 120,
    cartonWeightKg: '52.500',
    cartonQuantity: 4,
    translations: {
      'en-US': {
        name: 'Steel gate',
        description: 'Powder coated',
        seoTitle: 'Steel gate',
        seoDescription: 'Steel gate for projects',
      },
    },
    images: [],
    tags: [],
    coverImageId: null,
    createdAt: new Date('2026-09-01T00:00:00.000Z').toISOString(),
    ...overrides,
  };
}

describe('fromProductDetail', () => {
  it('fills both locales and presents product dimensions in centimetres', () => {
    const state = fromProductDetail(detail());
    expect(state.specs.lengthCm).toBe('180');
    expect(state.specs.widthCm).toBe('6');
    expect(state.specs.heightCm).toBe('200');
    expect(state.specs.cartonWeightKg).toBe('52.500');
    expect(state.translations['en-US']?.name).toBe('Steel gate');
    expect(state.translations['zh-CN']?.name).toBe('');
    expect(state.tagIds).toEqual(['t1']);
  });

  it('omits the internal price when the caller cannot read it', () => {
    const state = fromProductDetail(detail({ priceVisible: false, priceCny: null }));
    expect(state.priceCny).toBe('');
  });
});

describe('validateProductForm', () => {
  it('requires SKU, slug, category and the English name on create', () => {
    const errors = validateProductForm(emptyProductForm(), { mode: 'create' });
    expect(Object.keys(errors).sort()).toEqual(
      ['categoryId', 'sku', 'slug', 'translations.en-US.name'].sort(),
    );
  });

  it('does not require the SKU when editing (it is immutable)', () => {
    const errors = validateProductForm(emptyProductForm(), { mode: 'edit' });
    expect(errors.sku).toBeUndefined();
  });

  it('rejects a malformed slug', () => {
    const state = { ...emptyProductForm(), slug: 'Not A Slug', categoryId: 'c1' };
    expect(validateProductForm(state, { mode: 'edit' }).slug).toBe(
      'products.validation.slugFormat',
    );
  });

  it('rejects zero, negative and non-numeric dimensions per field', () => {
    const state = emptyProductForm();
    state.specs.lengthCm = '0';
    state.specs.widthCm = '-5';
    state.specs.heightCm = 'abc';
    state.specs.cartonQuantity = '2.5';
    const errors = validateProductForm(state, { mode: 'edit' });
    expect(errors['specs.lengthCm']).toBe('products.validation.length');
    expect(errors['specs.widthCm']).toBe('products.validation.width');
    expect(errors['specs.heightCm']).toBe('products.validation.height');
    expect(errors['specs.cartonQuantity']).toBe('products.validation.cartonQuantity');
  });

  it('accepts one decimal place for centimetre dimensions', () => {
    const state = emptyProductForm();
    state.specs.lengthCm = '10.5';
    state.specs.widthCm = '6.2';
    expect(validateProductForm(state, { mode: 'edit' })['specs.lengthCm']).toBeUndefined();
    expect(validateProductForm(state, { mode: 'edit' })['specs.widthCm']).toBeUndefined();
  });

  it('rejects centimetre dimensions with millimetre fractions', () => {
    const state = emptyProductForm();
    state.specs.lengthCm = '10.55';
    expect(validateProductForm(state, { mode: 'edit' })['specs.lengthCm']).toBe(
      'products.validation.length',
    );
  });

  it('allows an empty optional dimension', () => {
    const errors = validateProductForm(emptyProductForm(), { mode: 'edit' });
    expect(errors['specs.lengthCm']).toBeUndefined();
  });

  it('rejects a carton weight with more than three decimals', () => {
    const state = emptyProductForm();
    state.specs.cartonWeightKg = '12.3456';
    expect(validateProductForm(state, { mode: 'edit' })['specs.cartonWeightKg']).toBe(
      'products.validation.cartonWeight',
    );
  });
});

describe('toWritePayload', () => {
  it('sends the structured tag ids and the required category', () => {
    const state = emptyProductForm();
    state.slug = 'steel-gate';
    state.categoryId = 'c1';
    state.tagIds = ['t1', 't2'];
    state.translations['en-US']!.name = 'Steel gate';
    const payload = toWritePayload(state, { canEditCost: false });
    expect(payload.tagIds).toEqual(['t1', 't2']);
    expect(payload.categoryId).toBe('c1');
    expect(payload.translations).toHaveLength(1);
    expect(payload.priceCny).toBeUndefined();
  });

  it('keeps a locale only when it carries content', () => {
    const state = emptyProductForm();
    state.translations['en-US']!.name = 'Steel gate';
    state.translations['zh-CN']!.name = '钢制大门';
    state.translations['zh-CN']!.description = '粉末喷涂';
    const payload = toWritePayload(state, { canEditCost: false });
    expect(payload.translations.map((entry) => entry.locale)).toEqual(['en-US', 'zh-CN']);
  });

  it('turns empty optional inputs into null instead of zero', () => {
    const state = emptyProductForm();
    state.translations['en-US']!.name = 'Steel gate';
    const payload = toWritePayload(state, { canEditCost: false });
    expect(payload.lengthMm).toBeNull();
    expect(payload.packaging).toBeNull();
    expect(payload.cartonWeightKg).toBeNull();
    expect(payload.sortOrder).toBe(0);
  });

  it('converts centimetre input to the canonical millimetre payload', () => {
    const state = emptyProductForm();
    state.translations['en-US']!.name = 'Steel gate';
    state.specs.lengthCm = '10.5';
    state.specs.widthCm = '6';
    state.specs.heightCm = '0.1';
    const payload = toWritePayload(state, { canEditCost: false });
    expect(payload.lengthMm).toBe(105);
    expect(payload.widthMm).toBe(60);
    expect(payload.heightMm).toBe(1);
  });

  it('includes the internal price only for an authorised actor', () => {
    const state = emptyProductForm();
    state.priceCny = '99.99';
    expect(toWritePayload(state, { canEditCost: true }).priceCny).toBe('99.99');
    expect(toWritePayload(state, { canEditCost: false }).priceCny).toBeUndefined();
  });

  it('trims the SKU on create', () => {
    const state = emptyProductForm();
    state.sku = '  GATE-001 ';
    expect(toCreatePayload(state, { canEditCost: false }).sku).toBe('GATE-001');
  });
});

describe('mapServerFieldErrors', () => {
  it('maps dotted server paths onto the form key space', () => {
    const mapped = mapServerFieldErrors({
      lengthMm: 'products.validation.length',
      'translations.en-US': 'product.translation.englishRequired',
      tagIds: 'tagIds',
    });
    expect(mapped.errors['specs.lengthCm']).toBe('products.validation.length');
    expect(mapped.errors['translations.en-US']).toBe('product.translation.englishRequired');
    // An unmapped key stays a form-level message instead of being dropped.
    expect(mapped.formLevel).toEqual(['tagIds']);
  });
});

describe('formatBytes', () => {
  it('renders a human readable size', () => {
    expect(formatBytes(null)).toBe('—');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.00 MB');
  });
});
