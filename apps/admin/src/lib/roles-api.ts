'use client';

import type {
  PermissionTree,
  RoleNames,
  RolePermissionGrant,
  RoleSummary,
  RoleUserSummary,
} from '@b2b/contracts';
import { adminApi, type PaginatedResponse } from './admin-api';

// Thin typed wrappers over the role/permission endpoints so the list page, the
// role form and the permission drawer share one contract (docs/18 §4). Role and
// permission codes travel as machine identifiers; no display text is parsed.

export type RoleTypeFilter = 'all' | 'system' | 'custom';

export interface RoleListParams {
  page?: number;
  pageSize?: number;
  keyword?: string;
  type?: RoleTypeFilter;
}

export interface CreateRolePayload {
  code: string;
  names: RoleNames;
  description?: string | null;
}

export interface UpdateRolePayload {
  names?: RoleNames;
  description?: string | null;
  /** Optimistic concurrency guard; a mismatch is CONCURRENT_ROLE_UPDATE. */
  expectedUpdatedAt?: string;
}

export interface SaveRolePermissionsPayload {
  permissionCodes: string[];
  expectedUpdatedAt?: string;
}

export const rolesApi = {
  list(params: RoleListParams): Promise<PaginatedResponse<RoleSummary>> {
    return adminApi.list<RoleSummary>('/admin/roles', {
      page: params.page ?? 1,
      pageSize: params.pageSize ?? 20,
      ...(params.keyword ? { keyword: params.keyword } : {}),
      ...(params.type && params.type !== 'all' ? { type: params.type } : {}),
    });
  },

  detail(id: string): Promise<RoleSummary> {
    return adminApi.get<{ data: RoleSummary }>(`/admin/roles/${id}`).then((response) => response.data);
  },

  create(payload: CreateRolePayload): Promise<RoleSummary> {
    return adminApi.post<{ data: RoleSummary }>('/admin/roles', payload).then((response) => response.data);
  },

  update(id: string, payload: UpdateRolePayload): Promise<RoleSummary> {
    return adminApi
      .patch<{ data: RoleSummary }>(`/admin/roles/${id}`, payload)
      .then((response) => response.data);
  },

  remove(id: string): Promise<{ deleted: true }> {
    return adminApi.delete<{ deleted: true }>(`/admin/roles/${id}`);
  },

  /** Menu/module tree for the permission editor; never hardcoded client-side. */
  permissionTree(): Promise<PermissionTree> {
    return adminApi
      .get<{ data: PermissionTree }>('/admin/permissions/tree')
      .then((response) => response.data);
  },

  permissions(id: string): Promise<RolePermissionGrant> {
    return adminApi
      .get<{ data: RolePermissionGrant }>(`/admin/roles/${id}/permissions`)
      .then((response) => response.data);
  },

  savePermissions(id: string, payload: SaveRolePermissionsPayload): Promise<RolePermissionGrant> {
    return adminApi
      .put<{ data: RolePermissionGrant }>(`/admin/roles/${id}/permissions`, payload)
      .then((response) => response.data);
  },

  users(id: string): Promise<RoleUserSummary[]> {
    return adminApi
      .get<{ data: RoleUserSummary[] }>(`/admin/roles/${id}/users`)
      .then((response) => response.data);
  },
};
