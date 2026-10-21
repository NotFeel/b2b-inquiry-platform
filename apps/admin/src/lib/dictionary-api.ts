'use client';

import type {
  DictionaryItemSummary,
  DictionaryOptionSet,
  DictionaryTypeSummary,
} from '@b2b/contracts';
import { adminApi, type PaginatedResponse } from './admin-api';

// Typed wrappers over the two-level dictionary endpoints (docs/20 §6).
// `typeCode` / item `code` are machine keys; labels are display-only.

export type EnabledFilter = 'all' | 'true' | 'false';

export interface TypeListParams {
  page?: number;
  pageSize?: number;
  keyword?: string;
  enabled?: EnabledFilter;
  includeItems?: boolean;
}

export interface ItemListParams {
  locale: string;
  enabled?: EnabledFilter;
  keyword?: string;
  includeUsageCount?: boolean;
}

export interface ItemWritePayload {
  value?: string | null;
  sortOrder?: number;
  enabled?: boolean;
  labels?: { 'zh-CN'?: string; 'en-US'?: string };
  expectedUpdatedAt?: string;
}

export const dictionaryApi = {
  listTypes(params: TypeListParams = {}): Promise<PaginatedResponse<DictionaryTypeSummary>> {
    return adminApi.list<DictionaryTypeSummary>('/admin/dictionary/types', {
      page: params.page ?? 1,
      pageSize: params.pageSize ?? 100,
      ...(params.keyword ? { keyword: params.keyword } : {}),
      ...(params.enabled && params.enabled !== 'all' ? { enabled: params.enabled } : {}),
      ...(params.includeItems ? { includeItems: true } : {}),
    });
  },

  async getType(id: string): Promise<DictionaryTypeSummary> {
    const response = await adminApi.get<{ data: DictionaryTypeSummary }>(`/admin/dictionary/types/${id}`);
    return response.data;
  },

  async createType(payload: {
    code: string;
    nameKey: string;
    description?: string | null;
    enabled?: boolean;
  }): Promise<DictionaryTypeSummary> {
    const response = await adminApi.post<{ data: DictionaryTypeSummary }>(
      '/admin/dictionary/types',
      payload,
    );
    return response.data;
  },

  async updateType(
    id: string,
    payload: { nameKey?: string; description?: string | null; enabled?: boolean },
  ): Promise<DictionaryTypeSummary> {
    const response = await adminApi.patch<{ data: DictionaryTypeSummary }>(
      `/admin/dictionary/types/${id}`,
      payload,
    );
    return response.data;
  },

  removeType(id: string): Promise<{ deleted: true }> {
    return adminApi.delete<{ deleted: true }>(`/admin/dictionary/types/${id}`);
  },

  async listItems(
    typeCode: string,
    params: ItemListParams,
  ): Promise<{ data: DictionaryItemSummary[]; type: { id: string; code: string; nameKey: string; systemLocked: boolean } }> {
    return adminApi.get<{
      data: DictionaryItemSummary[];
      type: { id: string; code: string; nameKey: string; systemLocked: boolean };
    }>(`/admin/dictionary/types/${typeCode}/items`, {
      locale: params.locale,
      ...(params.enabled && params.enabled !== 'all' ? { enabled: params.enabled } : {}),
      ...(params.keyword ? { keyword: params.keyword } : {}),
      ...(params.includeUsageCount === false ? { includeUsageCount: false } : {}),
    });
  },

  async createItem(
    typeCode: string,
    payload: {
      code: string;
      value?: string | null;
      sortOrder?: number;
      enabled?: boolean;
      labels?: { 'zh-CN'?: string; 'en-US'?: string };
    },
  ): Promise<DictionaryItemSummary> {
    const response = await adminApi.post<{ data: DictionaryItemSummary }>(
      `/admin/dictionary/types/${typeCode}/items`,
      { ...payload, typeCode },
    );
    return response.data;
  },

  async updateItem(id: string, payload: ItemWritePayload): Promise<DictionaryItemSummary> {
    const response = await adminApi.patch<{ data: DictionaryItemSummary }>(
      `/admin/dictionary/items/${id}`,
      payload,
    );
    return response.data;
  },

  removeItem(id: string): Promise<{ deleted: true }> {
    return adminApi.delete<{ deleted: true }>(`/admin/dictionary/items/${id}`);
  },

  reorderItems(typeCode: string, orderedIds: string[]): Promise<{ reordered: number }> {
    return adminApi.post<{ reordered: number }>(`/admin/dictionary/types/${typeCode}/reorder`, {
      orderedIds,
    });
  },

  /** Business option set; the shared hook wraps this with caching and states. */
  async options(
    typeCode: string,
    params: { locale: string; includeDisabled?: boolean },
  ): Promise<DictionaryOptionSet> {
    const response = await adminApi.get<{ data: DictionaryOptionSet }>(
      `/admin/dictionary/options/${typeCode}`,
      {
        locale: params.locale,
        ...(params.includeDisabled ? { includeDisabled: true } : {}),
      },
    );
    return response.data;
  },
};
