export const PRODUCT_SLUG_MAX_LENGTH = 180;
export const PRODUCT_SLUG_RANDOM_SUFFIX_LENGTH = 6;
export const PRODUCT_SLUG_STRATEGIES = ['name', 'name-random'] as const;
export type ProductSlugStrategy = (typeof PRODUCT_SLUG_STRATEGIES)[number];

/**
 * Product slug base derived from the English name.
 *
 * This is deliberately shared by the browser preview/tests and the API so both
 * sides agree on normalization. The API remains authoritative for uniqueness
 * and for the random suffix.
 */
export function slugifyProductName(name: string, maxLength = PRODUCT_SLUG_MAX_LENGTH): string {
  const normalized = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized.slice(0, Math.max(1, maxLength)) || 'product';
}

/**
 * Builds the final candidate, keeping the suffix intact when the base is long.
 * `suffix` is passed in by the server after generating cryptographically secure
 * digits; keeping this pure makes length and strategy deterministic in tests.
 */
export function productSlugCandidate(
  name: string,
  strategy: ProductSlugStrategy,
  suffix?: string,
): string {
  if (strategy === 'name-random' && !/^\d{6}$/.test(suffix ?? '')) {
    throw new Error('A six-digit suffix is required for the name-random strategy.');
  }
  const randomSuffix =
    strategy === 'name-random' && suffix
      ? `-${suffix.replace(/^0+/, '').padStart(PRODUCT_SLUG_RANDOM_SUFFIX_LENGTH, '0')}`
      : '';
  const base = slugifyProductName(name, PRODUCT_SLUG_MAX_LENGTH - randomSuffix.length);
  return `${base.slice(0, PRODUCT_SLUG_MAX_LENGTH - randomSuffix.length)}${randomSuffix}`;
}
