import { describe, expect, it } from 'vitest';
import type { CategoryDetail, CategoryNode } from '@b2b/contracts';
import {
  CATEGORY_CODE_MAX,
  emptyCategoryForm,
  hasCategoryFormErrors,
  isCategoryFormDirty,
  mapCategoryFieldErrors,
  parentLabel,
  seedFromParent,
  toCategoryFormValues,
  toCategoryPayload,
  validateCategoryForm,
  type CategoryFormValues,
} from './category-form';

const LOCALES = ['zh-CN', 'en-US'] as const;

const detail: CategoryDetail = {
  id: 'toys',
  code: 'toys',
  slug: 'toys',
  parentId: 'catalog',
  parentName: '商品目录',
  sortOrder: 20,
  enabled: false,
  visible: false,
  coverImageId: null,
  names: { 'zh-CN': '玩具', 'en-US': 'Toys' },
  descriptions: { 'zh-CN': '玩具描述', 'en-US': null },
  productCount: 4,
  totalProductCount: 31,
  updatedAt: '2026-10-16T10:00:00.000Z',
  createdAt: '2026-10-15T10:00:00.000Z',
  path: [
    { id: 'catalog', slug: 'catalog', name: '商品目录' },
    { id: 'toys', slug: 'toys', name: '玩具' },
  ],
  children: [],
};

const values = (overrides: Partial<CategoryFormValues> = {}): CategoryFormValues => ({
  ...emptyCategoryForm(10),
  code: 'model-toys',
  slug: 'model-toys',
  names: { 'zh-CN': '模型玩具', 'en-US': 'Model Toys' },
  descriptions: { 'zh-CN': '', 'en-US': '' },
  ...overrides,
});

describe('seeding', () => {
  it('echoes every stored value, including disabled and hidden state', () => {
    const seeded = toCategoryFormValues(detail, LOCALES);
    expect(seeded).toMatchObject({
      code: 'toys',
      slug: 'toys',
      parentId: 'catalog',
      sortOrder: '20',
      enabled: false,
      visible: false,
    });
    expect(seeded.names['zh-CN']).toBe('玩具');
    expect(seeded.descriptions['en-US']).toBe('');
  });

  it('seeds an empty translation slot for each locale', () => {
    const seeded = toCategoryFormValues({ ...detail, names: {} }, LOCALES);
    expect(seeded.names).toEqual({ 'zh-CN': '', 'en-US': '' });
  });

  it('preselects the clicked parent without inventing a code or slug', () => {
    const parent = { id: 'toys' } as CategoryNode;
    const seeded = seedFromParent(parent, { locales: LOCALES, sortOrder: 30 });
    expect(seeded.parentId).toBe('toys');
    expect(seeded.code).toBe('');
    expect(seeded.slug).toBe('');
    expect(seeded.sortOrder).toBe('30');
  });
});

describe('validation', () => {
  it('accepts a complete new category', () => {
    expect(hasCategoryFormErrors(validateCategoryForm(values(), 'createRoot', LOCALES))).toBe(false);
  });

  it('requires a machine-valid code on create and ignores it on edit', () => {
    const bad = values({ code: 'Model Toys' });
    expect(validateCategoryForm(bad, 'createRoot', LOCALES).code).toBe('categories.errors.codeInvalid');
    expect(validateCategoryForm(bad, 'edit', LOCALES).code).toBeUndefined();
  });

  it('rejects an over-long code', () => {
    const long = values({ code: 'a'.repeat(CATEGORY_CODE_MAX + 1) });
    expect(validateCategoryForm(long, 'createRoot', LOCALES).code).toBe('categories.errors.codeInvalid');
  });

  it('requires a url-safe slug', () => {
    expect(validateCategoryForm(values({ slug: '' }), 'createRoot', LOCALES).slug).toBe(
      'categories.errors.slugRequired',
    );
    expect(validateCategoryForm(values({ slug: 'Model_Toys' }), 'createRoot', LOCALES).slug).toBe(
      'categories.errors.slugInvalid',
    );
  });

  it('requires the name in every admin locale', () => {
    const errors = validateCategoryForm(values({ names: { 'zh-CN': '模型玩具', 'en-US': '' } }), 'createRoot', LOCALES);
    expect(errors.names).toEqual({ 'en-US': 'categories.errors.nameRequired' });
  });

  it('rejects a non-numeric or negative sort order', () => {
    expect(validateCategoryForm(values({ sortOrder: 'x' }), 'createRoot', LOCALES).sortOrder).toBe(
      'categories.errors.sortOrder',
    );
    expect(validateCategoryForm(values({ sortOrder: '-1' }), 'createRoot', LOCALES).sortOrder).toBe(
      'categories.errors.sortOrder',
    );
  });
});

describe('dirty tracking', () => {
  it('ignores whitespace-only differences and detects real edits', () => {
    const initial = values();
    expect(isCategoryFormDirty(initial, initial)).toBe(false);
    expect(isCategoryFormDirty(values({ names: { 'zh-CN': ' 模型玩具 ', 'en-US': 'Model Toys' } }), initial)).toBe(
      false,
    );
    expect(isCategoryFormDirty(values({ names: { 'zh-CN': '模型玩具', 'en-US': 'Model Toys!' } }), initial)).toBe(
      true,
    );
    expect(isCategoryFormDirty(values({ visible: false }), initial)).toBe(true);
    expect(isCategoryFormDirty(values({ parentId: 'toys' }), initial)).toBe(true);
  });
});

describe('payload', () => {
  it('sends code only on create and drops empty translations', () => {
    const created = toCategoryPayload(values(), 'createRoot');
    expect(created.code).toBe('model-toys');
    expect(created.parentId).toBeNull();
    expect(created.translations).toEqual([
      { locale: 'zh-CN', name: '模型玩具', description: null },
      { locale: 'en-US', name: 'Model Toys', description: null },
    ]);

    const edited = toCategoryPayload(values({ names: { 'en-US': 'Model Toys' } }), 'edit');
    expect(edited.code).toBeUndefined();
    expect(edited.translations).toEqual([{ locale: 'en-US', name: 'Model Toys', description: null }]);
  });

  it('trims text and keeps status flags explicit', () => {
    const payload = toCategoryPayload(
      values({
        slug: ' model-toys ',
        parentId: 'toys',
        sortOrder: '20',
        enabled: false,
        visible: false,
        descriptions: { 'en-US': '  A description  ' },
      }),
      'createChild',
    );
    expect(payload.slug).toBe('model-toys');
    expect(payload.parentId).toBe('toys');
    expect(payload.sortOrder).toBe(20);
    expect(payload.enabled).toBe(false);
    expect(payload.visible).toBe(false);
    expect(payload.translations).toContainEqual({
      locale: 'en-US',
      name: 'Model Toys',
      description: 'A description',
    });
  });
});

describe('field error mapping', () => {
  it('routes server details onto the matching input', () => {
    expect(
      mapCategoryFieldErrors({ code: 'category.code.taken', slug: 'category.slug.taken', parentId: 'x' }),
    ).toEqual({
      code: 'categories.errors.codeTaken',
      slug: 'categories.errors.slugTaken',
      parentId: 'categories.errors.parentInvalid',
    });
    expect(mapCategoryFieldErrors(undefined)).toEqual({});
  });
});

describe('parent label', () => {
  it('resolves a nested parent name instead of a raw id', () => {
    const tree: CategoryNode[] = [
      {
        ...(values() as unknown as CategoryNode),
        id: 'catalog',
        names: { 'zh-CN': '商品目录' },
        children: [
          {
            id: 'toys',
            code: 'toys',
            slug: 'toys',
            name: 'toys',
            parentId: 'catalog',
            sortOrder: 10,
            enabled: true,
            visible: true,
            coverImageId: null,
            names: { 'zh-CN': '玩具' },
            descriptions: {},
            productCount: 0,
            totalProductCount: 0,
            updatedAt: '2026-10-16T10:00:00.000Z',
            children: [],
          },
        ],
      } as CategoryNode,
    ];
    expect(parentLabel(tree, 'toys', 'zh-CN')).toBe('玩具');
    expect(parentLabel(tree, 'missing', 'zh-CN')).toBeNull();
    expect(parentLabel(tree, null, 'zh-CN')).toBeNull();
  });
});
