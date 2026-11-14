import type { PublicHomepage, PublicHomepageProductBatch, PublicProductCard } from '@b2b/contracts';
export { HOMEPAGE_CACHE_TAGS } from './homepage-cache';
import { localeHref } from './i18n';

export type HomepageSectionRequest =
  | { kind: 'new-arrivals'; locale: string; cursor: string }
  | { kind: 'collection'; id: string; locale: string; cursor: string };

export type HomepageSectionLoadResult =
  { ok: true; batch: PublicHomepageProductBatch } | { ok: false; code: string };

/** Maintains server order while preventing duplicate cards after Load More. */
export function mergeHomepageProducts(
  current: readonly PublicProductCard[],
  incoming: readonly PublicProductCard[],
  limit = Number.POSITIVE_INFINITY,
): PublicProductCard[] {
  const merged = current.slice(0, limit);
  const seen = new Set(merged.map((product) => product.sku));
  for (const product of incoming) {
    if (seen.has(product.sku) || merged.length >= limit) continue;
    seen.add(product.sku);
    merged.push(product);
  }
  return merged;
}

/** Hero imagery is borrowed from real homepage products, never copied data. */
export function homepageHeroProducts(
  homepage: PublicHomepage | null,
  count = 4,
): PublicProductCard[] {
  if (!homepage || count <= 0) return [];

  const candidates = mergeHomepageProducts(
    homepage.newArrivals.products,
    homepage.collections.flatMap((collection) => collection.products),
  );
  const selected: PublicProductCard[] = [];
  const selectedSkus = new Set<string>();
  const selectedCategories = new Set<string>();

  // Lead with one product per public category so the first screen represents
  // the breadth of the catalogue instead of repeating the newest category.
  for (const product of candidates) {
    const categoryKey = product.category?.slug ?? product.category?.id ?? null;
    if (!categoryKey || selectedCategories.has(categoryKey)) continue;
    selected.push(product);
    selectedSkus.add(product.sku);
    selectedCategories.add(categoryKey);
    if (selected.length >= count) return selected;
  }

  for (const product of candidates) {
    if (selectedSkus.has(product.sku)) continue;
    selected.push(product);
    if (selected.length >= count) break;
  }

  return selected;
}

/** The existing Products category filter is the public collection destination. */
export function collectionProductsHref(locale: string, categorySlug: string): string {
  const query = new URLSearchParams({ category: categorySlug });
  return localeHref(locale, `/products?${query.toString()}`);
}
