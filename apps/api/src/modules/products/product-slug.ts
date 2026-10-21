import { randomInt } from 'node:crypto';
import {
  ERROR_CODES,
  PRODUCT_SLUG_RANDOM_SUFFIX_LENGTH,
  productSlugCandidate,
  type ProductSlugStrategy,
} from '@b2b/contracts';
import { Prisma } from '@b2b/database';
import { ApiError } from '../../common/errors/api-error';

/**
 * Cryptographically secure six-digit suffix.
 *
 * `randomInt` returns an integer in [min, max), so 100000–999999 is exactly six
 * digits and never includes the seven-digit upper bound.
 */
export function randomSlugSuffix(): string {
  return String(
    randomInt(
      10 ** (PRODUCT_SLUG_RANDOM_SUFFIX_LENGTH - 1),
      10 ** PRODUCT_SLUG_RANDOM_SUFFIX_LENGTH,
    ),
  );
}

export function buildProductSlugCandidate(
  name: string,
  strategy: ProductSlugStrategy,
  suffix?: string,
): string {
  return productSlugCandidate(
    name,
    strategy,
    strategy === 'name-random' ? (suffix ?? randomSlugSuffix()) : undefined,
  );
}

/**
 * Maps a database unique-constraint race to the same field-level conflict the
 * API returns after its pre-check. Keeping this pure makes the slug/SKU mapping
 * testable without relying on a timing-sensitive concurrent request.
 */
export function productUniqueConstraintError(error: unknown): ApiError | null {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return null;
  }
  const target = Array.isArray(error.meta?.target)
    ? error.meta.target.join(',')
    : String(error.meta?.target ?? '');
  if (target.includes('slug')) {
    return new ApiError(
      ERROR_CODES.productSlugConflict,
      'This product URL slug is already in use.',
      {
        details: { slug: 'products.validation.slugTaken' },
      },
    );
  }
  if (target.includes('sku')) {
    return new ApiError(ERROR_CODES.productSkuConflict, 'This SKU is already in use.', {
      details: { sku: 'products.validation.skuTaken' },
    });
  }
  return null;
}
