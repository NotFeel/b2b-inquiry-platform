'use client';

import type { AdminUserSummary, AssignableRoleSummary } from '@b2b/contracts';
import { adminApi, type PaginatedResponse } from './admin-api';

// Thin, typed wrappers over the user/role endpoints so the page and the form
// share one contract (docs/17 §4.1). No role string parsing happens here.

export interface UserListParams {
  page?: number;
  pageSize?: number;
  q?: string;
  status?: 'active' | 'disabled' | '';
  roleId?: string;
}

export interface CreateUserPayload {
  username: string;
  displayName: string;
  roleIds: string[];
  password?: string;
}

export interface UpdateUserPayload {
  displayName?: string;
  roleIds?: string[];
  /** Optimistic concurrency guard; a mismatch is reported as USER_MODIFIED. */
  expectedUpdatedAt?: string;
}

export const usersApi = {
  list(params: UserListParams): Promise<PaginatedResponse<AdminUserSummary>> {
    return adminApi.list<AdminUserSummary>('/admin/users', {
      page: params.page ?? 1,
      pageSize: params.pageSize ?? 20,
      ...(params.q ? { q: params.q } : {}),
      ...(params.status ? { status: params.status } : {}),
      ...(params.roleId ? { roleId: params.roleId } : {}),
    });
  },

  create(payload: CreateUserPayload): Promise<{ data: AdminUserSummary; generatedPassword: string | null }> {
    return adminApi.post('/admin/users', payload);
  },

  update(id: string, payload: UpdateUserPayload): Promise<{ data: AdminUserSummary }> {
    return adminApi.patch(`/admin/users/${id}`, payload);
  },

  setStatus(
    id: string,
    status: 'active' | 'disabled',
    expectedUpdatedAt?: string,
  ): Promise<{ data: AdminUserSummary }> {
    return adminApi.patch(`/admin/users/${id}/status`, {
      status,
      ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}),
    });
  },

  resetPassword(id: string): Promise<{ generatedPassword: string | null }> {
    return adminApi.post(`/admin/users/${id}/reset-password`, { mustChangePassword: true });
  },

  /** Role options for the multi-select; `assignable` is a UI hint only. */
  async assignableRoles(): Promise<AssignableRoleSummary[]> {
    const response = await adminApi.get<{ data: AssignableRoleSummary[] }>('/admin/roles/assignable');
    return response.data;
  },
};
