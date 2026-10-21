'use client';

import type { Paginated, TagOption, TagSummary } from '@b2b/contracts';
import { adminApi } from './admin-api';

// Typed wrappers over the tag endpoints (docs/23 §6).
//
// Only machine values cross this boundary: `code`, `colorToken`, plain booleans
// and a `locale -> label` map. No display text is parsed here.

export type TagStatusFilter = 'all' | 'enabled' | 'disabled';
export type TagUsageFilter = 'all' | 'used' | 'unused';

export interface TagListParams {
  locale: string;
  q?: string;
  status?: TagStatusFilter;
  usage?: TagUsageFilter;
  page?: number;
  pageSize?: number;
}

export interface TagTranslationPayload {
  locale: string;
  label: string;
}

export interface CreateTagPayload {
  code: string;
  /** Whitelisted style token (docs/23 §3.1) or null for the neutral badge. */
  colorToken: string | null;
  enabled: boolean;
  translations: TagTranslationPayload[];
}

export interface UpdateTagPayload {
  colorToken?: string | null;
  enabled?: boolean;
  translations?: TagTranslationPayload[];
  /** Optimistic concurrency guard; a mismatch is TAG_CONCURRENT_UPDATE. */
  expectedUpdatedAt?: string;
}

export const tagsApi = {
  list(params: TagListParams): Promise<Paginated<TagSummary>> {
    return adminApi.get<Paginated<TagSummary>>('/admin/tags', {
      locale: params.locale,
      ...(params.q ? { q: params.q } : {}),
      ...(params.status && params.status !== 'all' ? { status: params.status } : {}),
      ...(params.usage && params.usage !== 'all' ? { usage: params.usage } : {}),
      ...(params.page ? { page: params.page } : {}),
      ...(params.pageSize ? { pageSize: params.pageSize } : {}),
    });
  },

  async detail(id: string, locale: string): Promise<TagSummary> {
    const response = await adminApi.get<{ data: TagSummary }>(`/admin/tags/${id}`, { locale });
    return response.data;
  },

  /** Enabled tags only, for the product editor (docs/23 §8.1). */
  async options(locale: string): Promise<TagOption[]> {
    const response = await adminApi.get<{ data: TagOption[] }>('/admin/tags/options', { locale });
    return response.data;
  },

  async create(payload: CreateTagPayload): Promise<TagSummary> {
    const response = await adminApi.post<{ data: TagSummary }>('/admin/tags', payload);
    return response.data;
  },

  async update(id: string, payload: UpdateTagPayload): Promise<TagSummary> {
    const response = await adminApi.patch<{ data: TagSummary }>(`/admin/tags/${id}`, payload);
    return response.data;
  },

  async setStatus(id: string, enabled: boolean): Promise<TagSummary> {
    const response = await adminApi.patch<{ data: TagSummary }>(`/admin/tags/${id}/status`, {
      enabled,
    });
    return response.data;
  },

  async remove(id: string): Promise<{ deleted: true }> {
    const response = await adminApi.delete<{ data: { deleted: true } }>(`/admin/tags/${id}`);
    return response.data;
  },
};
