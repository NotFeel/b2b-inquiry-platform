'use client';

import type { CategoryDetail, CategoryListItem, CategoryNode, Paginated } from '@b2b/contracts';
import { adminApi } from './admin-api';

// Typed wrappers over the category endpoints (docs/22 §5).
//
// Only machine values cross this boundary: `code`, `slug`, ids and raw booleans.
// Display names travel as a `locale -> name` map and are resolved by the caller,
// so switching the admin language never needs a second request.

export type CategoryStatusFilter = 'all' | 'enabled' | 'disabled';
export type CategoryVisibilityFilter = 'all' | 'visible' | 'hidden';
export type CategoryProductFilter = 'all' | 'with' | 'without';

export interface CategoryTreeParams {
  locale: string;
  q?: string;
  status?: CategoryStatusFilter;
  visibility?: CategoryVisibilityFilter;
  hasProducts?: CategoryProductFilter;
  rootOnly?: boolean;
}

export interface CategoryListParams extends CategoryTreeParams {
  page?: number;
  pageSize?: number;
  parentId?: string;
  rootId?: string;
  sortBy?: 'path' | 'updatedAt' | 'sortOrder';
  sortDir?: 'asc' | 'desc';
}

export interface CategoryTranslationPayload {
  locale: string;
  name: string;
  description: string | null;
}

export interface CategoryWritePayload {
  slug: string;
  parentId: string | null;
  sortOrder: number;
  enabled: boolean;
  visible: boolean;
  translations: CategoryTranslationPayload[];
  /** Optimistic concurrency guard; a mismatch is reported as CATEGORY_CONCURRENT_UPDATE. */
  expectedUpdatedAt?: string;
}

export interface CreateCategoryPayload extends CategoryWritePayload {
  code: string;
}

export interface CategoryDeleteImpact {
  childCount: number;
  productCount: number;
  blockedBy: 'children' | 'products' | null;
}

export const categoriesApi = {
  async tree(params: CategoryTreeParams): Promise<CategoryNode[]> {
    const response = await adminApi.get<{ data: CategoryNode[] }>('/admin/categories/tree', {
      locale: params.locale,
      ...(params.q ? { q: params.q } : {}),
      ...(params.status && params.status !== 'all' ? { status: params.status } : {}),
      ...(params.visibility && params.visibility !== 'all'
        ? { visibility: params.visibility }
        : {}),
      ...(params.hasProducts && params.hasProducts !== 'all'
        ? { hasProducts: params.hasProducts }
        : {}),
      ...(params.rootOnly ? { rootOnly: true } : {}),
    });
    return response.data;
  },

  list(params: CategoryListParams): Promise<Paginated<CategoryListItem>> {
    return adminApi.get<Paginated<CategoryListItem>>('/admin/categories', {
      locale: params.locale,
      ...(params.q ? { q: params.q } : {}),
      ...(params.status && params.status !== 'all' ? { status: params.status } : {}),
      ...(params.visibility && params.visibility !== 'all'
        ? { visibility: params.visibility }
        : {}),
      ...(params.hasProducts && params.hasProducts !== 'all'
        ? { hasProducts: params.hasProducts }
        : {}),
      ...(params.parentId ? { parentId: params.parentId } : {}),
      ...(params.rootId ? { rootId: params.rootId } : {}),
      ...(params.sortBy ? { sortBy: params.sortBy } : {}),
      ...(params.sortDir ? { sortDir: params.sortDir } : {}),
      ...(params.page ? { page: params.page } : {}),
      ...(params.pageSize ? { pageSize: params.pageSize } : {}),
    });
  },

  async detail(id: string, locale: string): Promise<CategoryDetail> {
    const response = await adminApi.get<{ data: CategoryDetail }>(`/admin/categories/${id}`, {
      locale,
    });
    return response.data;
  },

  async deleteImpact(id: string): Promise<CategoryDeleteImpact> {
    const response = await adminApi.get<{ data: CategoryDeleteImpact }>(
      `/admin/categories/${id}/delete-impact`,
    );
    return response.data;
  },

  async create(payload: CreateCategoryPayload): Promise<{ id: string }> {
    const response = await adminApi.post<{ data: { id: string } }>('/admin/categories', payload);
    return response.data;
  },

  async update(id: string, payload: CategoryWritePayload): Promise<{ id: string }> {
    const response = await adminApi.patch<{ data: { id: string } }>(
      `/admin/categories/${id}`,
      payload,
    );
    return response.data;
  },

  async move(
    id: string,
    payload: { parentId: string | null; sortOrder?: number },
  ): Promise<{ id: string }> {
    const response = await adminApi.post<{ data: { id: string } }>(
      `/admin/categories/${id}/move`,
      payload,
    );
    return response.data;
  },

  reorder(payload: {
    parentId: string | null;
    orderedIds: string[];
  }): Promise<{ reordered: number }> {
    return adminApi
      .post<{ data: { reordered: number } }>('/admin/categories/reorder', payload)
      .then((response) => response.data);
  },

  async remove(id: string): Promise<{ deleted: true }> {
    const response = await adminApi.delete<{ data: { deleted: true } }>(`/admin/categories/${id}`);
    return response.data;
  },
};
