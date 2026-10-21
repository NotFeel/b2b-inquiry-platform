'use client';

import type { MenuNode, PermissionSummary } from '@b2b/contracts';
import { adminApi } from './admin-api';

// Typed wrappers over the menu endpoints (docs/19 §6). Menu `code`, route and
// permission code are machine values; no display text crosses this boundary.

export type MenuTypeFilter = 'all' | 'group' | 'page' | 'external';
export type MenuStatusFilter = 'all' | 'enabled' | 'disabled';
export type MenuVisibilityFilter = 'all' | 'visible' | 'hidden';

export interface MenuListParams {
  locale: string;
  q?: string;
  type?: MenuTypeFilter;
  status?: MenuStatusFilter;
  visibility?: MenuVisibilityFilter;
  rootOnly?: boolean;
}

export interface MenuWritePayload {
  parentId: string | null;
  route: string | null;
  icon: string | null;
  permissionCode: string | null;
  sortOrder: number;
  visible: boolean;
  enabled: boolean;
  external: boolean;
  labels: Record<string, string>;
}

export interface CreateMenuPayload extends MenuWritePayload {
  code: string;
}

export interface UpdateMenuPayload extends Partial<MenuWritePayload> {
  /** Optimistic concurrency guard; a mismatch is reported as MENU_MODIFIED. */
  expectedUpdatedAt?: string;
}

export const menusApi = {
  async tree(params: MenuListParams): Promise<MenuNode[]> {
    const response = await adminApi.get<{ data: MenuNode[] }>('/admin/menus', {
      locale: params.locale,
      ...(params.q ? { q: params.q } : {}),
      ...(params.type && params.type !== 'all' ? { type: params.type } : {}),
      ...(params.status && params.status !== 'all' ? { status: params.status } : {}),
      ...(params.visibility && params.visibility !== 'all' ? { visibility: params.visibility } : {}),
      ...(params.rootOnly ? { rootOnly: true } : {}),
    });
    return response.data;
  },

  async detail(id: string): Promise<MenuNode> {
    const response = await adminApi.get<{ data: MenuNode }>(`/admin/menus/${id}`);
    return response.data;
  },

  async permissionOptions(): Promise<PermissionSummary[]> {
    const response = await adminApi.get<{ data: PermissionSummary[] }>('/admin/menus/permission-options');
    return response.data;
  },

  async create(payload: CreateMenuPayload): Promise<MenuNode> {
    const response = await adminApi.post<{ data: MenuNode }>('/admin/menus', payload);
    return response.data;
  },

  async update(id: string, payload: UpdateMenuPayload): Promise<MenuNode> {
    const response = await adminApi.patch<{ data: MenuNode }>(`/admin/menus/${id}`, payload);
    return response.data;
  },

  reorder(payload: { parentId: string | null; orderedIds: string[] }): Promise<{ reordered: number }> {
    return adminApi.patch<{ reordered: number }>('/admin/menus/reorder', payload);
  },

  remove(id: string): Promise<{ deleted: true }> {
    return adminApi.delete<{ deleted: true }>(`/admin/menus/${id}`);
  },
};
