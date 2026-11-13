import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProductAdminSummary } from '@b2b/contracts';
import {
  homepageManagementApi,
  toHomepageSafeProduct,
  toSelectedHomepageProduct,
} from './homepage-management-api';

function adminProduct(overrides: Partial<ProductAdminSummary> = {}): ProductAdminSummary {
  return {
    id: 'product-1',
    sku: 'GATE-001',
    slug: 'gate-001',
    name: 'Steel gate',
    nameZh: '钢制大门',
    categoryId: 'category-1',
    categoryName: 'Gates',
    categoryPath: 'Outdoor / Gates',
    publishStatus: 'published',
    lifecycleStatus: 'available',
    isNew: false,
    isFeatured: false,
    isPreOrder: false,
    sortOrder: 10,
    imageCount: 1,
    hasCover: true,
    coverImageUrl: 'https://cdn.example.com/gate.webp',
    coverImageAlt: 'Steel gate',
    pendingImageDeletes: 0,
    tagCodes: [],
    tagIds: [],
    priceCny: '123.45',
    priceVisible: true,
    updatedAt: '2026-11-12T10:00:00.000Z',
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('homepageManagementApi', () => {
  it('PATCHes the singleton config with the optimistic token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        data: {
          newArrivalsLimit: 120,
          enabled: false,
          updatedAt: '2026-11-12T11:00:00.000Z',
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await homepageManagementApi.updateConfig({
      newArrivalsLimit: 120,
      enabled: false,
      expectedUpdatedAt: '2026-11-12T10:00:00.000Z',
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/admin/homepage-management/config', {
      method: 'PATCH',
      credentials: 'include',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        newArrivalsLimit: 120,
        enabled: false,
        expectedUpdatedAt: '2026-11-12T10:00:00.000Z',
      }),
    });
  });

  it('carries the admin locale on collection list and detail reads', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: [] }))
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            id: 'collection-1',
            categoryId: 'category-1',
            categoryCode: 'gates',
            categorySlug: 'gates',
            categoryName: 'Gates',
            categoryEnabled: true,
            categoryVisible: true,
            enabled: true,
            sortOrder: 10,
            productLimit: 24,
            title: 'Gates',
            subtitle: null,
            translations: [],
            selectedProductCount: 0,
            updatedAt: '2026-11-12T10:00:00.000Z',
            products: [],
          },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    await homepageManagementApi.listCollections('zh-CN');
    await homepageManagementApi.getCollection('collection-1', 'en-US');

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      '/api/v1/admin/homepage-management/collections?locale=zh-CN',
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      '/api/v1/admin/homepage-management/collections/collection-1?locale=en-US',
    );
  });

  it('searches only the exact collection category and returns a price-free projection', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        data: [adminProduct(), adminProduct({ id: 'product-2', sku: 'GATE-002' })],
        pagination: { page: 2, pageSize: 20, total: 42, totalPages: 3 },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await homepageManagementApi.searchProducts({
      categoryId: 'category-1',
      q: '  gate  ',
      page: 2,
      pageSize: 20,
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      '/api/v1/admin/products?categoryId=category-1&includeDescendants=false&q=gate&page=2&pageSize=20&sortBy=sku&sortOrder=asc',
    );
    expect(result.pagination.total).toBe(42);
    expect(result.data[0]).toEqual({
      id: 'product-1',
      sku: 'GATE-001',
      name: 'Steel gate',
      publishStatus: 'published',
      lifecycleStatus: 'available',
      coverImageUrl: 'https://cdn.example.com/gate.webp',
      coverImageAlt: 'Steel gate',
    });
    expect(JSON.stringify(result)).not.toContain('priceCny');
    expect(JSON.stringify(result)).not.toContain('123.45');
  });

  it('omits a blank q and still fixes the category and descendants flag', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        data: [],
        pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await homepageManagementApi.searchProducts({
      categoryId: 'category-1',
      q: '   ',
      page: 1,
      pageSize: 20,
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      '/api/v1/admin/products?categoryId=category-1&includeDescendants=false&page=1&pageSize=20&sortBy=sku&sortOrder=asc',
    );
  });

  it('replaces the complete product list and sends every displayed sort order', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: { id: 'collection-1' } }));
    vi.stubGlobal('fetch', fetchMock);

    await homepageManagementApi.updateProducts('collection-1', {
      products: [
        { productId: 'product-2', sortOrder: 10 },
        { productId: 'product-1', sortOrder: 20 },
      ],
      expectedUpdatedAt: '2026-11-12T10:00:00.000Z',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/admin/homepage-management/collections/collection-1/products',
      {
        method: 'PUT',
        credentials: 'include',
        cache: 'no-store',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          products: [
            { productId: 'product-2', sortOrder: 10 },
            { productId: 'product-1', sortOrder: 20 },
          ],
          expectedUpdatedAt: '2026-11-12T10:00:00.000Z',
        }),
      },
    );
  });

  it('sends the complete collection order as orderedIds', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: { reordered: 3 } }));
    vi.stubGlobal('fetch', fetchMock);

    await homepageManagementApi.sortCollections(['c2', 'c1', 'c3']);

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/admin/homepage-management/collections/sort', {
      method: 'PUT',
      credentials: 'include',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orderedIds: ['c2', 'c1', 'c3'] }),
    });
  });

  it('maps the selected-product detail cover image for the collection editor', () => {
    const withCover = toSelectedHomepageProduct({
      productId: 'product-1',
      sku: 'GATE-001',
      name: 'Steel gate',
      categoryId: 'category-1',
      publishStatus: 'published',
      lifecycleStatus: 'available',
      sortOrder: 10,
      coverImageUrl: '/api/v1/admin/media/assets/asset-1/preview',
      coverImageAlt: 'Steel gate',
    });
    expect(withCover).toEqual({
      id: 'product-1',
      sku: 'GATE-001',
      name: 'Steel gate',
      publishStatus: 'published',
      lifecycleStatus: 'available',
      coverImageUrl: '/api/v1/admin/media/assets/asset-1/preview',
      coverImageAlt: 'Steel gate',
    });

    const withoutCover = toSelectedHomepageProduct({
      productId: 'product-2',
      sku: 'GATE-002',
      name: 'Steel gate 2',
      categoryId: 'category-1',
      publishStatus: 'draft',
      lifecycleStatus: 'available',
      sortOrder: 20,
      coverImageUrl: null,
      coverImageAlt: null,
    });
    expect(withoutCover.coverImageUrl).toBeNull();
    expect(withoutCover.coverImageAlt).toBeNull();
    expect(withoutCover).not.toHaveProperty('priceCny');
    expect(withoutCover).not.toHaveProperty('sortOrder');
  });

  it('projects a product without copying prohibited administrative fields', () => {
    const projected = toHomepageSafeProduct(adminProduct());
    expect(projected).not.toHaveProperty('priceCny');
    expect(projected).not.toHaveProperty('priceVisible');
    expect(projected).not.toHaveProperty('tagIds');
  });
});
