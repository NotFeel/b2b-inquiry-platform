'use server';

import { ApiRequestError, storefrontApi } from './api';
import type { HomepageSectionLoadResult, HomepageSectionRequest } from './homepage';
import { isStorefrontLocale } from './i18n';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_CURSOR_LENGTH = 4096;

function invalidRequest(): HomepageSectionLoadResult {
  return { ok: false, code: 'VALIDATION_FAILED' };
}

function validCursor(cursor: string): boolean {
  return cursor.length > 0 && cursor.length <= MAX_CURSOR_LENGTH;
}

/**
 * Load More runs as a Server Action so API_BASE_URL and the public API response
 * stay off the client. The fetched batches retain the three homepage cache tags.
 */
export async function loadMoreHomepageSection(
  request: HomepageSectionRequest,
): Promise<HomepageSectionLoadResult> {
  if (
    !request ||
    !isStorefrontLocale(request.locale) ||
    !validCursor(request.cursor) ||
    (request.kind !== 'new-arrivals' && request.kind !== 'collection') ||
    (request.kind === 'collection' && !UUID_PATTERN.test(request.id))
  ) {
    return invalidRequest();
  }

  try {
    const response =
      request.kind === 'new-arrivals'
        ? await storefrontApi.getHomepageNewArrivals(request.locale, request.cursor)
        : await storefrontApi.getHomepageCollectionProducts(
            request.id,
            request.locale,
            request.cursor,
          );
    return {
      ok: true,
      batch: {
        products: response.data.products,
        nextCursor: response.data.nextCursor,
        hasMore: response.data.hasMore,
      },
    };
  } catch (error) {
    const code =
      error instanceof ApiRequestError && /^[A-Z0-9_]+$/.test(error.code)
        ? error.code
        : 'INTERNAL_ERROR';
    return { ok: false, code };
  }
}
