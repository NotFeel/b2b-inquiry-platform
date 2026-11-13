'use client';

import type {
  HomepageCollectionDetail,
  HomepageCollectionProductSummary,
  HomepageCollectionSummary,
  HomepageDisplayConfigSummary,
  ProductAdminSummary,
  ProductLifecycleStatus,
  PublishStatus,
} from '@b2b/contracts';
import { adminApi, type PaginatedResponse } from './admin-api';

/**
 * The only product shape allowed to cross into Homepage UI state.
 *
 * `ProductAdminSummary` also contains the internal quotation price. It is
 * deliberately projected field by field here, immediately after the request,
 * so price data never reaches component state, props, toasts or rendering
 * (docs/45 stage E §7.2 and §10.3).
 */
export interface HomepageSafeProduct {
  id: string;
  sku: string;
  name: string;
  publishStatus: PublishStatus;
  lifecycleStatus: ProductLifecycleStatus;
  coverImageUrl: string | null;
  coverImageAlt: string | null;
}

export interface HomepageProductSearchResult {
  data: HomepageSafeProduct[];
  pagination: PaginatedResponse<HomepageSafeProduct>['pagination'];
}

export interface HomepageCollectionTranslationPayload {
  locale: string;
  title: string;
  subtitle: string | null;
}

export interface CreateHomepageCollectionPayload {
  categoryId: string;
  enabled: boolean;
  sortOrder?: number;
  productLimit: number;
  translations: HomepageCollectionTranslationPayload[];
}

export interface UpdateHomepageCollectionPayload {
  categoryId?: string;
  enabled?: boolean;
  sortOrder?: number;
  productLimit?: number;
  translations?: HomepageCollectionTranslationPayload[];
  expectedUpdatedAt?: string;
}

export interface UpdateHomepageCollectionProductsPayload {
  products: { productId: string; sortOrder?: number }[];
  expectedUpdatedAt?: string;
}

export function toHomepageSafeProduct(product: ProductAdminSummary): HomepageSafeProduct {
  return {
    id: product.id,
    sku: product.sku,
    name: product.name,
    publishStatus: product.publishStatus,
    lifecycleStatus: product.lifecycleStatus,
    coverImageUrl: product.coverImageUrl,
    coverImageAlt: product.coverImageAlt,
  };
}

export const homepageManagementApi = {
  async getConfig(): Promise<HomepageDisplayConfigSummary> {
    const response = await adminApi.get<{ data: HomepageDisplayConfigSummary }>(
      '/admin/homepage-management/config',
    );
    return response.data;
  },

  async updateConfig(payload: {
    newArrivalsLimit: number;
    enabled: boolean;
    expectedUpdatedAt?: string;
  }): Promise<HomepageDisplayConfigSummary> {
    const response = await adminApi.patch<{ data: HomepageDisplayConfigSummary }>(
      '/admin/homepage-management/config',
      payload,
    );
    return response.data;
  },

  async listCollections(locale: string): Promise<HomepageCollectionSummary[]> {
    const response = await adminApi.get<{ data: HomepageCollectionSummary[] }>(
      '/admin/homepage-management/collections',
      { locale },
    );
    return response.data;
  },

  async getCollection(id: string, locale: string): Promise<HomepageCollectionDetail> {
    const response = await adminApi.get<{ data: HomepageCollectionDetail }>(
      `/admin/homepage-management/collections/${id}`,
      { locale },
    );
    return response.data;
  },

  async createCollection(
    payload: CreateHomepageCollectionPayload,
  ): Promise<HomepageCollectionDetail> {
    const response = await adminApi.post<{ data: HomepageCollectionDetail }>(
      '/admin/homepage-management/collections',
      payload,
    );
    return response.data;
  },

  async updateCollection(
    id: string,
    payload: UpdateHomepageCollectionPayload,
  ): Promise<HomepageCollectionDetail> {
    const response = await adminApi.patch<{ data: HomepageCollectionDetail }>(
      `/admin/homepage-management/collections/${id}`,
      payload,
    );
    return response.data;
  },

  async removeCollection(id: string): Promise<{ deleted: true }> {
    const response = await adminApi.delete<{ data: { deleted: true } }>(
      `/admin/homepage-management/collections/${id}`,
    );
    return response.data;
  },

  async updateProducts(
    id: string,
    payload: UpdateHomepageCollectionProductsPayload,
  ): Promise<HomepageCollectionDetail> {
    const response = await adminApi.put<{ data: HomepageCollectionDetail }>(
      `/admin/homepage-management/collections/${id}/products`,
      payload,
    );
    return response.data;
  },

  async sortCollections(orderedIds: string[]): Promise<{ reordered: number }> {
    const response = await adminApi.put<{ data: { reordered: number } }>(
      '/admin/homepage-management/collections/sort',
      { orderedIds },
    );
    return response.data;
  },

  /**
   * Searches products through the existing Admin product API.
   *
   * `includeDescendants=false` is mandatory: a Homepage Collection contains
   * products whose category is exactly the selected Category. Stable SKU
   * ordering keeps page boundaries deterministic while the operator searches.
   */
  async searchProducts(params: {
    categoryId: string;
    q: string;
    page: number;
    pageSize: number;
  }): Promise<HomepageProductSearchResult> {
    const response = await adminApi.get<PaginatedResponse<ProductAdminSummary>>('/admin/products', {
      categoryId: params.categoryId,
      includeDescendants: 'false',
      ...(params.q.trim() ? { q: params.q.trim() } : {}),
      page: params.page,
      pageSize: params.pageSize,
      sortBy: 'sku',
      sortOrder: 'asc',
    });
    return {
      data: response.data.map(toHomepageSafeProduct),
      pagination: response.pagination,
    };
  },
};

/** Maps the selected-product DTO returned by Homepage detail to the UI shape. */
export function toSelectedHomepageProduct(
  product: HomepageCollectionProductSummary,
): HomepageSafeProduct {
  return {
    id: product.productId,
    sku: product.sku,
    name: product.name,
    publishStatus: product.publishStatus,
    lifecycleStatus: product.lifecycleStatus,
    coverImageUrl: product.coverImageUrl,
    coverImageAlt: product.coverImageAlt,
  };
}
