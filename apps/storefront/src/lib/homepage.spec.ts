import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PublicHomepage, PublicProductCard } from '@b2b/contracts';
import { storefrontApi } from './api';
import {
  HOMEPAGE_CACHE_TAGS,
  collectionProductsHref,
  homepageHeroProducts,
  mergeHomepageProducts,
} from './homepage';

function product(sku: string): PublicProductCard {
  return {
    sku,
    slug: sku.toLowerCase(),
    name: `Product ${sku}`,
    summary: null,
    lifecycleStatus: 'available',
    isNew: false,
    isFeatured: false,
    isPreOrder: false,
    category: null,
    coverImage: null,
    tags: [],
  };
}

function homepageFixture(): PublicHomepage {
  return {
    enabled: true,
    newArrivals: {
      limit: 24,
      products: [product('A'), product('B')],
      nextCursor: 'new-cursor',
      hasMore: true,
    },
    collections: [
      {
        id: '00000000-0000-4000-8000-000000000001',
        categoryId: '00000000-0000-4000-8000-000000000002',
        categorySlug: 'squishy-toys',
        title: 'Squishy Toys',
        subtitle: null,
        productLimit: 48,
        products: [product('B'), product('C')],
        nextCursor: 'collection-cursor',
        hasMore: true,
      },
    ],
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('homepage helpers', () => {
  it('merges cursor batches by SKU without duplicates or reordering', () => {
    const merged = mergeHomepageProducts(
      [product('A'), product('B')],
      [product('B'), product('C'), product('A'), product('D')],
      4,
    );
    expect(merged.map((item) => item.sku)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('truncates existing products to the configured limit', () => {
    const current = Array.from({ length: 10 }, (_, index) => product(`P${index + 1}`));

    const merged = mergeHomepageProducts(
      current,
      [product('P4'), product('P11'), product('P12')],
      3,
    );

    expect(merged.map((item) => item.sku)).toEqual(['P1', 'P2', 'P3']);
  });

  it('does not append when existing products already reached the limit', () => {
    const merged = mergeHomepageProducts(
      [product('A'), product('B'), product('C')],
      [product('D'), product('E')],
      3,
    );

    expect(merged.map((item) => item.sku)).toEqual(['A', 'B', 'C']);
  });

  it('stops after filling the limit from a short current list', () => {
    const merged = mergeHomepageProducts(
      [product('A'), product('B')],
      [product('C'), product('D'), product('E'), product('F'), product('G')],
      3,
    );

    expect(merged.map((item) => item.sku)).toEqual(['A', 'B', 'C']);
  });

  it('fills remaining slots from new products after truncating existing products', () => {
    const merged = mergeHomepageProducts(
      [product('A'), product('B'), product('C'), product('D'), product('E')],
      [product('A'), product('F'), product('G'), product('H')],
      3,
    );

    expect(merged.map((item) => item.sku)).toEqual(['A', 'B', 'C']);
  });

  it('uses SKUs in the truncated current products when merging new products', () => {
    const merged = mergeHomepageProducts(
      [product('A'), product('B'), product('C'), product('D')],
      [product('B'), product('E'), product('F')],
      3,
    );

    expect(merged.map((item) => item.sku)).toEqual(['A', 'B', 'C']);
  });

  it('does not append SKUs already present when current products contain duplicates', () => {
    const merged = mergeHomepageProducts(
      [product('A'), product('A')],
      [product('A'), product('B'), product('C')],
      3,
    );

    expect(merged.map((item) => item.sku)).toEqual(['A', 'A', 'B']);
  });

  it('builds hero imagery and collection links from public DTO data', () => {
    expect(homepageHeroProducts(homepageFixture()).map((item) => item.sku)).toEqual([
      'A',
      'B',
      'C',
    ]);
    expect(collectionProductsHref('zh-CN', 'squishy toys')).toBe(
      '/zh-CN/products?category=squishy+toys',
    );
  });

  it('never renders more hero products than the configured count', () => {
    const homepage = homepageFixture();
    homepage.newArrivals.products = Array.from({ length: 10 }, (_, index) =>
      product(`H${index + 1}`),
    );

    expect(homepageHeroProducts(homepage, 3).map((item) => item.sku)).toEqual(['H1', 'H2', 'H3']);
  });

  it('uses the three required cache tags', () => {
    expect(HOMEPAGE_CACHE_TAGS).toEqual(['homepage', 'products', 'categories']);
  });
});

describe('homepage API cache contract', () => {
  it('tags the aggregate and both cursor endpoints consistently', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Promise.resolve(
        new Response(JSON.stringify({ data: {} }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await storefrontApi.getHomepage('en-US');
    await storefrontApi.getHomepageNewArrivals('en-US', 'next/new arrivals');
    await storefrontApi.getHomepageCollectionProducts(
      '00000000-0000-4000-8000-000000000001',
      'zh-CN',
      'collection-cursor',
    );

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const requestedUrls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(requestedUrls[0]).toContain('/api/v1/public/homepage?locale=en-US');
    expect(requestedUrls[1]).toContain('/api/v1/public/homepage/new-arrivals?');
    expect(requestedUrls[1]).toContain('cursor=next%2Fnew+arrivals');
    expect(requestedUrls[2]).toContain(
      '/api/v1/public/homepage/collections/00000000-0000-4000-8000-000000000001/products?',
    );
    expect(requestedUrls[2]).toContain('locale=zh-CN');

    for (const [, options] of fetchMock.mock.calls) {
      const next = (options as unknown as { next?: { tags?: string[] } } | undefined)?.next;
      expect(next?.tags).toEqual(['homepage', 'products', 'categories']);
    }
  });

  it('keeps Load More server-only and registers the shared helper and action contract', () => {
    const action = readFileSync(
      fileURLToPath(new URL('./homepage-actions.ts', import.meta.url)),
      'utf8',
    );
    const section = readFileSync(
      fileURLToPath(new URL('../components/homepage-product-section.tsx', import.meta.url)),
      'utf8',
    );
    expect(action).toContain("'use server'");
    expect(action).toContain('getHomepageNewArrivals');
    expect(action).toContain('getHomepageCollectionProducts');
    expect(action).toContain('isStorefrontLocale');
    expect(section).not.toContain('API_BASE_URL');
    expect(section).not.toContain('fetch(');
    expect(section).toContain('initialBatch.nextCursor');
  });
});
