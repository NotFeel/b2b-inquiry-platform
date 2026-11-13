import { ERROR_CODES, type ProductLifecycleStatus, type PublishStatus } from '@b2b/contracts';
import { ApiError } from '../../common/errors/api-error';

export const HOMEPAGE_DISPLAY_CONFIG_KEY = 'default';
export const HOMEPAGE_SORT_STEP = 10;

export interface HomepageTranslationRow {
  locale: string;
  title: string;
  subtitle: string | null;
}

export interface SelectedProductRow {
  id: string;
  categoryId: string | null;
  sku: string;
  publishStatus: PublishStatus;
  lifecycleStatus: ProductLifecycleStatus;
}

/** Optimistic concurrency for one singleton configuration row. */
export function assertHomepageConfigNotModified(
  current: Date,
  expectedUpdatedAt: string | undefined,
): void {
  if (!expectedUpdatedAt) return;
  if (new Date(expectedUpdatedAt).getTime() !== current.getTime()) {
    throw new ApiError(
      ERROR_CODES.homepageConfigConcurrentUpdate,
      'The homepage display setting changed. Reload and retry.',
    );
  }
}

/** Optimistic concurrency for one collection and its selected products. */
export function assertHomepageCollectionNotModified(
  current: Date,
  expectedUpdatedAt: string | undefined,
): void {
  if (!expectedUpdatedAt) return;
  if (new Date(expectedUpdatedAt).getTime() !== current.getTime()) {
    throw new ApiError(
      ERROR_CODES.homepageCollectionConcurrentUpdate,
      'The homepage collection changed. Reload and retry.',
    );
  }
}

/**
 * Full collection ordering is safer than partial sibling writes: it makes a
 * missing/unknown/duplicate id an explicit validation failure instead of a
 * silently incomplete layout.
 */
export function assertCompleteCollectionOrder(orderedIds: string[], currentIds: string[]): void {
  const requested = new Set(orderedIds);
  const current = new Set(currentIds);
  const missing = currentIds.filter((id) => !requested.has(id));
  const unknown = orderedIds.filter((id) => !current.has(id));
  if (missing.length > 0 || unknown.length > 0 || requested.size !== orderedIds.length) {
    throw ApiError.validation('The collection order must list every collection exactly once.', {
      missing: missing.join(','),
      unknown: unknown.join(','),
    });
  }
}

/** A configured collection can only contain products from its own Category. */
export function assertProductsBelongToCategory(
  products: Pick<SelectedProductRow, 'id' | 'categoryId'>[],
  categoryId: string,
): void {
  const invalid = products.filter((product) => product.categoryId !== categoryId);
  if (invalid.length > 0) {
    throw new ApiError(
      ERROR_CODES.homepageCollectionProductCategoryMismatch,
      'Every selected product must belong to the collection category.',
      { details: { productIds: invalid.map((product) => product.id) } },
    );
  }
}

export function assertSelectedProductCount(selectedCount: number, productLimit: number): void {
  if (selectedCount > productLimit) {
    throw new ApiError(
      ERROR_CODES.homepageCollectionProductLimitExceeded,
      'The number of selected products cannot exceed the configured display total.',
      { details: { selectedCount, productLimit } },
    );
  }
}

export function assertUniqueProductIds(productIds: string[]): void {
  if (new Set(productIds).size !== productIds.length) {
    throw new ApiError(
      ERROR_CODES.homepageCollectionProductDuplicate,
      'A product can only be selected once in a homepage collection.',
    );
  }
}

/** Requested locale → English → first stored translation. */
export function resolveHomepageTranslation(
  translations: HomepageTranslationRow[],
  locale: string,
): { title: string; subtitle: string | null } {
  const selected =
    translations.find((translation) => translation.locale === locale) ??
    translations.find((translation) => translation.locale === 'en-US') ??
    translations[0];
  return {
    title: selected?.title ?? '',
    subtitle: selected?.subtitle ?? null,
  };
}

/**
 * The array itself is the canonical product order. Normalising every write to
 * contiguous ten-point positions prevents duplicate or out-of-array sortOrder
 * values from silently changing what the administrator saved.
 */
export function productSortOrders(
  items: readonly { productId: string; sortOrder?: number }[],
): number[] {
  return items.map((_item, index) => (index + 1) * HOMEPAGE_SORT_STEP);
}
