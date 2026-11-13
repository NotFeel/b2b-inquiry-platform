import {
  DATABASE_INTEGER_MAX,
  type HomepageCollectionDetail,
  type HomepageCollectionSummary,
} from '@b2b/contracts';
import {
  type CreateHomepageCollectionPayload,
  type UpdateHomepageCollectionPayload,
  type UpdateHomepageCollectionProductsPayload,
  type HomepageSafeProduct,
  toSelectedHomepageProduct,
} from './homepage-management-api';

export const HOMEPAGE_TITLE_MAX = 240;
export const HOMEPAGE_SUBTITLE_MAX = 500;
export const HOMEPAGE_LOCALES = ['en-US', 'zh-CN'] as const;
export type HomepageLocale = (typeof HOMEPAGE_LOCALES)[number];

export interface HomepageConfigFormValues {
  newArrivalsLimit: string;
  enabled: boolean;
}

export interface HomepageTranslationFormValue {
  title: string;
  subtitle: string;
}

export interface HomepageCollectionFormValues {
  categoryId: string;
  enabled: boolean;
  productLimit: string;
  translations: Record<HomepageLocale, HomepageTranslationFormValue>;
}

export interface HomepageCollectionFormErrors {
  categoryId?: string;
  productLimit?: string;
  translations?: Partial<Record<HomepageLocale, { title?: string; subtitle?: string }>>;
}

export interface DisplayTotalParseResult {
  value: number | null;
  error: string | null;
}

/**
 * Parses one configured display total.
 *
 * The only upper bound is PostgreSQL INTEGER. A value of 48, 120 or 600 is as
 * valid as 6; 24 is the Storefront batch size and is intentionally absent here.
 * Empty, decimal, zero, negative and non-multiple-of-six values are rejected
 * instead of being silently coerced (docs/45 stage E §5.1, §14.1).
 */
export function parseHomepageDisplayTotal(raw: string): DisplayTotalParseResult {
  const value = raw.trim();
  if (value.length === 0) {
    return { value: null, error: 'validation.homepage.limit.required' };
  }
  if (!/^-?\d+$/.test(value)) {
    return { value: null, error: 'validation.homepage.limit.integer' };
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    return { value: null, error: 'validation.homepage.limit.integer' };
  }
  if (parsed <= 0) {
    return { value: null, error: 'validation.homepage.limit.positive' };
  }
  if (parsed > DATABASE_INTEGER_MAX) {
    return { value: null, error: 'validation.homepage.limit.databaseRange' };
  }
  if (parsed % 6 !== 0) {
    return { value: null, error: 'validation.homepage.limit.multipleOfSix' };
  }
  return { value: parsed, error: null };
}

export function emptyHomepageConfigForm(): HomepageConfigFormValues {
  return { newArrivalsLimit: '12', enabled: true };
}

export function emptyHomepageCollectionForm(): HomepageCollectionFormValues {
  return {
    categoryId: '',
    enabled: true,
    productLimit: '6',
    translations: {
      'en-US': { title: '', subtitle: '' },
      'zh-CN': { title: '', subtitle: '' },
    },
  };
}

export function fromHomepageCollectionDetail(
  detail: HomepageCollectionDetail,
): HomepageCollectionFormValues {
  const translation = (locale: HomepageLocale) => {
    const row = detail.translations.find((item) => item.locale === locale);
    return { title: row?.title ?? '', subtitle: row?.subtitle ?? '' };
  };
  return {
    categoryId: detail.categoryId,
    enabled: detail.enabled,
    productLimit: String(detail.productLimit),
    translations: {
      'en-US': translation('en-US'),
      'zh-CN': translation('zh-CN'),
    },
  };
}

export function validateHomepageCollectionForm(
  values: HomepageCollectionFormValues,
  options: { selectedProductCount: number },
): HomepageCollectionFormErrors {
  const errors: HomepageCollectionFormErrors = {};
  if (!values.categoryId) errors.categoryId = 'homepage.validation.categoryRequired';

  const limit = parseHomepageDisplayTotal(values.productLimit);
  if (limit.error) {
    errors.productLimit = limit.error;
  } else if (limit.value !== null && options.selectedProductCount > limit.value) {
    errors.productLimit = 'homepage.validation.productLimitBelowSelection';
  }

  const english = values.translations['en-US'];
  if (!english.title.trim()) {
    errors.translations = {
      ...errors.translations,
      'en-US': { title: 'validation.homepage.translation.englishRequired' },
    };
  } else if (english.title.trim().length > HOMEPAGE_TITLE_MAX) {
    errors.translations = {
      ...errors.translations,
      'en-US': { title: 'validation.homepage.translation.titleTooLong' },
    };
  }
  if (english.subtitle.trim().length > HOMEPAGE_SUBTITLE_MAX) {
    errors.translations = {
      ...errors.translations,
      'en-US': {
        ...errors.translations?.['en-US'],
        subtitle: 'validation.homepage.translation.subtitleTooLong',
      },
    };
  }

  const chinese = values.translations['zh-CN'];
  if (chinese.title.trim().length > HOMEPAGE_TITLE_MAX) {
    errors.translations = {
      ...errors.translations,
      'zh-CN': {
        ...errors.translations?.['zh-CN'],
        title: 'validation.homepage.translation.titleTooLong',
      },
    };
  } else if (!chinese.title.trim() && chinese.subtitle.trim()) {
    errors.translations = {
      ...errors.translations,
      'zh-CN': {
        ...errors.translations?.['zh-CN'],
        title: 'validation.homepage.translation.titleRequired',
      },
    };
  }
  if (chinese.subtitle.trim().length > HOMEPAGE_SUBTITLE_MAX) {
    errors.translations = {
      ...errors.translations,
      'zh-CN': {
        ...errors.translations?.['zh-CN'],
        subtitle: 'validation.homepage.translation.subtitleTooLong',
      },
    };
  }

  return errors;
}

export function hasHomepageCollectionFormErrors(errors: HomepageCollectionFormErrors): boolean {
  return Boolean(
    errors.categoryId ||
    errors.productLimit ||
    HOMEPAGE_LOCALES.some((locale) => {
      const translation = errors.translations?.[locale];
      return Boolean(translation?.title || translation?.subtitle);
    }),
  );
}

export function toCollectionTranslations(
  values: HomepageCollectionFormValues,
): CreateHomepageCollectionPayload['translations'] {
  const translations: CreateHomepageCollectionPayload['translations'] = [];
  for (const locale of HOMEPAGE_LOCALES) {
    const title = values.translations[locale].title.trim();
    if (!title) continue;
    const subtitle = values.translations[locale].subtitle.trim();
    translations.push({ locale, title, subtitle: subtitle || null });
  }
  return translations;
}

export function toCreateCollectionPayload(
  values: HomepageCollectionFormValues,
  sortOrder: number,
): CreateHomepageCollectionPayload {
  const limit = parseHomepageDisplayTotal(values.productLimit);
  if (limit.value === null) throw new Error(limit.error ?? 'Invalid product limit.');
  return {
    categoryId: values.categoryId,
    enabled: values.enabled,
    sortOrder,
    productLimit: limit.value,
    translations: toCollectionTranslations(values),
  };
}

export function toUpdateCollectionPayload(
  values: HomepageCollectionFormValues,
  expectedUpdatedAt: string,
  originalCategoryId: string,
): UpdateHomepageCollectionPayload {
  const limit = parseHomepageDisplayTotal(values.productLimit);
  if (limit.value === null) throw new Error(limit.error ?? 'Invalid product limit.');
  return {
    ...(values.categoryId !== originalCategoryId ? { categoryId: values.categoryId } : {}),
    enabled: values.enabled,
    productLimit: limit.value,
    translations: toCollectionTranslations(values),
    expectedUpdatedAt,
  };
}

export function nextHomepageCollectionSortOrder(
  collections: Pick<HomepageCollectionSummary, 'sortOrder'>[],
): number {
  if (collections.length === 0) return 10;
  return Math.max(...collections.map((item) => item.sortOrder)) + 10;
}

export function isHomepageCollectionFormDirty(
  values: HomepageCollectionFormValues,
  initial: HomepageCollectionFormValues,
): boolean {
  return JSON.stringify(values) !== JSON.stringify(initial);
}

/**
 * A collection category cannot change while products are still attached.
 *
 * The persisted count is authoritative until the complete product list is
 * saved. Removing rows locally therefore must not unlock the category picker
 * prematurely (docs/45 stage E §9.3).
 */
export function isHomepageCategoryLocked(
  persistedProductCount: number,
  localProductCount: number,
): boolean {
  return persistedProductCount > 0 || localProductCount > 0;
}

export interface HomepageDetailLocaleReloadInput {
  loadedLocale: string | null;
  nextLocale: string;
  draftDirty: boolean;
}

/**
 * Locale changes may refresh a clean collection detail, but must never replace
 * an unsaved metadata/product draft. This helper is intentionally independent
 * from React so the safety rule is covered by a unit test.
 */
export function shouldReloadHomepageDetailForLocaleChange({
  loadedLocale,
  nextLocale,
  draftDirty,
}: HomepageDetailLocaleReloadInput): boolean {
  if (loadedLocale === null || loadedLocale === nextLocale) return true;
  return !draftDirty;
}

/** Moves one safe product within the complete local selection order. */
export function moveHomepageProduct(
  products: HomepageSafeProduct[],
  productId: string,
  direction: 'up' | 'down',
): HomepageSafeProduct[] | null {
  const index = products.findIndex((product) => product.id === productId);
  if (index < 0) return null;
  const target = direction === 'up' ? index - 1 : index + 1;
  if (target < 0 || target >= products.length) return null;
  const next = [...products];
  const [moved] = next.splice(index, 1);
  if (!moved) return null;
  next.splice(target, 0, moved);
  return next;
}

export function addHomepageProduct(
  products: HomepageSafeProduct[],
  product: HomepageSafeProduct,
  productLimit: number,
): { products: HomepageSafeProduct[]; error: string | null } {
  if (products.some((item) => item.id === product.id)) {
    return { products, error: 'homepage.validation.productDuplicate' };
  }
  if (products.length >= productLimit) {
    return { products, error: 'homepage.validation.productLimitExceeded' };
  }
  return { products: [...products, product], error: null };
}

export function removeHomepageProduct(
  products: HomepageSafeProduct[],
  productId: string,
): HomepageSafeProduct[] {
  return products.filter((product) => product.id !== productId);
}

export function selectedProductsFromDetail(
  detail: HomepageCollectionDetail,
): HomepageSafeProduct[] {
  return detail.products.map(toSelectedHomepageProduct);
}

export function toHomepageProductsPayload(
  products: HomepageSafeProduct[],
  expectedUpdatedAt: string,
): UpdateHomepageCollectionProductsPayload {
  return {
    products: products.map((product, index) => ({
      productId: product.id,
      sortOrder: (index + 1) * 10,
    })),
    expectedUpdatedAt,
  };
}
