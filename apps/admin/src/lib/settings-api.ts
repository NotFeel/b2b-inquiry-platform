'use client';

import type { GlobalSettingGroupSummary, GlobalSettingSummary } from '@b2b/contracts';
import { adminApi, type PaginatedResponse } from './admin-api';

// Typed wrappers over the settings endpoints (docs/21 §6.1). Secret values never
// travel through this client: the API only reports `configured`/`hasValue`.

export interface SettingListParams {
  locale?: string;
  page?: number;
  pageSize?: number;
  keyword?: string;
  groupCode?: string;
  valueType?: string;
  visibility?: string;
  source?: string;
}

export interface SettingWritePayload {
  value?: unknown;
  isPublic?: boolean;
  isSecret?: boolean;
  isRequired?: boolean;
  sortOrder?: number;
  groupCode?: string;
  valueType?: string;
  translations?: { locale: string; label: string; description?: string | null }[];
  expectedRevision?: number;
  clearSecret?: boolean;
  /** Locale the response should resolve custom labels in. */
  locale?: string;
}

export const SETTING_KEY_PATTERN = /^[a-z][a-zA-Z0-9_-]*(?:\.[a-z][a-zA-Z0-9_-]*)*$/;

export const settingsApi = {
  list(params: SettingListParams): Promise<PaginatedResponse<GlobalSettingSummary>> {
    return adminApi.list<GlobalSettingSummary>('/admin/settings', {
      ...(params.locale ? { locale: params.locale } : {}),
      page: params.page ?? 1,
      pageSize: params.pageSize ?? 20,
      ...(params.keyword ? { keyword: params.keyword } : {}),
      ...(params.groupCode && params.groupCode !== 'all' ? { groupCode: params.groupCode } : {}),
      ...(params.valueType && params.valueType !== 'all' ? { valueType: params.valueType } : {}),
      ...(params.visibility && params.visibility !== 'all' ? { visibility: params.visibility } : {}),
      ...(params.source && params.source !== 'all' ? { source: params.source } : {}),
    });
  },

  async groups(): Promise<{ data: GlobalSettingGroupSummary[] }> {
    return adminApi.get<{ data: GlobalSettingGroupSummary[] }>('/admin/settings/groups');
  },

  async detail(key: string, locale?: string): Promise<GlobalSettingSummary> {
    const response = await adminApi.get<{ data: GlobalSettingSummary }>(
      `/admin/settings/${encodeURIComponent(key)}`,
      locale ? { locale } : undefined,
    );
    return response.data;
  },

  async create(payload: SettingWritePayload & { key: string; translations: { locale: string; label: string }[] }) {
    const response = await adminApi.post<{ data: GlobalSettingSummary }>('/admin/settings', payload);
    return response.data;
  },

  async update(key: string, payload: SettingWritePayload): Promise<GlobalSettingSummary> {
    const response = await adminApi.patch<{ data: GlobalSettingSummary }>(
      `/admin/settings/${encodeURIComponent(key)}`,
      payload,
    );
    return response.data;
  },

  remove(key: string): Promise<{ deleted: true }> {
    return adminApi.delete<{ deleted: true }>(`/admin/settings/${encodeURIComponent(key)}`);
  },
};
