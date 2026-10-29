import type {
  Paginated,
  PublicAd,
  PublicCategoryTreeNode,
  PublicContentPage,
  PublicContentPageRef,
  PublicFactoryContent,
  PublicFaqItem,
  PublicHomeSection,
  PublicInquiryIntentResult,
  PublicProductCard,
  PublicProductDetail,
  PublicQualityContent,
  PublicSiteConfig,
  PublicTagFilter,
} from '@b2b/contracts';

// Server-side API access.
//
// The storefront never talks to the database and never receives internal price
// fields: every response here is a public DTO projection (docs/02 §2).
const API_BASE_URL =
  process.env.API_BASE_URL ??
  (process.env.NODE_ENV === 'production'
    ? 'https://api.wuxuanglobal.com'
    : 'http://localhost:3002');
/** Browser endpoint stays same-origin; the Next server proxies it to the API. */
export const INQUIRY_INTENT_ENDPOINT = '/api/v1/public/inquiry-intents';

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId?: string,
  ) {
    super(message);
  }
}

interface FetchOptions {
  revalidate?: number;
  tags?: string[];
  query?: Record<string, string | number | boolean | undefined>;
}

async function apiGet<T>(path: string, options: FetchOptions = {}): Promise<T> {
  const url = new URL(`/api/v1${path}`, API_BASE_URL);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value === undefined || value === '') continue;
    url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, {
    headers: { accept: 'application/json' },
    next: {
      revalidate: options.revalidate ?? 60,
      ...(options.tags ? { tags: options.tags } : {}),
    },
  });
  if (!response.ok) {
    let code = 'INTERNAL_ERROR';
    let message = `Request failed with status ${response.status}`;
    let requestId: string | undefined;
    try {
      const body = (await response.json()) as {
        error?: { code?: string; message?: string; requestId?: string };
      };
      code = body.error?.code ?? code;
      message = body.error?.message ?? message;
      requestId = body.error?.requestId;
    } catch {
      // Non-JSON error bodies are reported with the HTTP status only.
    }
    throw new ApiRequestError(response.status, code, message, requestId);
  }
  return (await response.json()) as T;
}

export interface ProductListParams {
  locale: string;
  page?: number;
  pageSize?: number;
  q?: string;
  category?: string;
  includeDescendants?: boolean;
  featured?: boolean;
  isNew?: boolean;
  /** Home-page pre-order rail, driven by the `preorder` tag plus lifecycle. */
  isPreOrder?: boolean;
  lifecycle?: string;
  tag?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export const storefrontApi = {
  getSiteConfig(): Promise<{ data: PublicSiteConfig }> {
    return apiGet('/public/site-config', { revalidate: 120, tags: ['site-config'] });
  },
  getCategoryTree(locale: string): Promise<{ data: PublicCategoryTreeNode[] }> {
    return apiGet('/public/categories', {
      query: { locale },
      revalidate: 120,
      tags: ['categories'],
    });
  },
  getTags(locale: string): Promise<{ data: PublicTagFilter[] }> {
    return apiGet('/public/tags', {
      query: { locale },
      revalidate: 120,
      tags: ['products', 'tags'],
    });
  },
  getProducts(params: ProductListParams): Promise<Paginated<PublicProductCard>> {
    return apiGet('/public/products', {
      query: {
        locale: params.locale,
        page: params.page ?? 1,
        pageSize: params.pageSize ?? 12,
        q: params.q,
        category: params.category,
        includeDescendants: params.includeDescendants,
        featured: params.featured,
        isNew: params.isNew,
        isPreOrder: params.isPreOrder,
        lifecycle: params.lifecycle,
        tag: params.tag,
        sortBy: params.sortBy,
        sortOrder: params.sortOrder,
      },
      revalidate: 60,
      tags: ['products'],
    });
  },
  getProduct(slug: string, locale: string): Promise<{ data: PublicProductDetail }> {
    return apiGet(`/public/products/${encodeURIComponent(slug)}`, {
      query: { locale },
      revalidate: 60,
      tags: ['products', `product:${slug}`],
    });
  },
  getAds(placement: string, locale: string): Promise<{ data: PublicAd[] }> {
    return apiGet('/public/ads', { query: { placement, locale }, revalidate: 60, tags: ['ads'] });
  },
  getContentPage(slug: string, locale: string): Promise<{ data: PublicContentPage }> {
    return apiGet(`/public/content/pages/${encodeURIComponent(slug)}`, {
      query: { locale },
      revalidate: 300,
      tags: ['content', 'content-pages', `page:${slug}`],
    });
  },
  getContentPages(): Promise<{ data: PublicContentPageRef[] }> {
    return apiGet('/public/content/pages', {
      revalidate: 300,
      tags: ['content', 'content-pages'],
    });
  },
  getFactoryContent(locale: string): Promise<{ data: PublicFactoryContent }> {
    return apiGet('/public/content/factory', {
      query: { locale },
      revalidate: 300,
      tags: ['content', 'content:factory'],
    });
  },
  getQualityContent(locale: string): Promise<{ data: PublicQualityContent }> {
    return apiGet('/public/content/quality', {
      query: { locale },
      revalidate: 300,
      tags: ['content', 'content:quality'],
    });
  },
  getHomeSections(locale: string): Promise<{ data: PublicHomeSection[] }> {
    return apiGet('/public/content/home-sections', {
      query: { locale },
      revalidate: 300,
      tags: ['content', 'content:home-sections'],
    });
  },
  getFaq(locale: string): Promise<{ data: PublicFaqItem[] }> {
    return apiGet('/public/content/faq', { query: { locale }, revalidate: 300, tags: ['faq'] });
  },
};

/** Client-side call used when the visitor starts a WhatsApp inquiry. */
export async function createInquiryIntent(
  items: { sku: string; quantity: number }[],
  sessionId: string,
  sourcePath: string,
  locale: string,
  sourceUrl?: string,
): Promise<PublicInquiryIntentResult> {
  const skus = items.map((item) => item.sku);
  const quantities = Object.fromEntries(
    items.map((item) => [item.sku, Math.max(1, Math.trunc(item.quantity || 1))]),
  );
  const response = await fetch(INQUIRY_INTENT_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-session-id': sessionId },
    body: JSON.stringify({
      skus,
      quantities,
      sourcePath,
      locale,
      ...(sourceUrl ? { sourceUrl } : {}),
    }),
  });
  const body = (await response.json()) as
    PublicInquiryIntentResult | { error?: { code?: string; message?: string; requestId?: string } };
  if (!response.ok) {
    const error = (body as { error?: { code?: string; message?: string; requestId?: string } })
      .error;
    throw new ApiRequestError(
      response.status,
      error?.code ?? 'INTERNAL_ERROR',
      error?.message ?? 'The inquiry could not be prepared.',
      error?.requestId,
    );
  }
  return body as PublicInquiryIntentResult;
}

/** Anonymous analytics beacon; failures are intentionally swallowed. */
export async function sendAnalyticsEvent(payload: {
  eventName: string;
  path?: string;
  sessionId: string;
  context?: Record<string, unknown>;
}): Promise<void> {
  try {
    await fetch('/api/v1/public/analytics/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    });
  } catch {
    // Telemetry must never break the storefront.
  }
}
