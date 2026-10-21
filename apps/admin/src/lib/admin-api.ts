'use client';

import type { AuthenticatedAdminUser, MenuNode } from '@b2b/contracts';

// Requests default to the admin origin and are forwarded by the Next proxy.
// This keeps the HttpOnly session cookie first-party and avoids browser CORS.
// An explicit public URL remains available for non-standard deployments.
export const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL ?? '').replace(/\/+$/, '');

type QueryValue = string | number | boolean | undefined;

/** Builds either a same-origin API path or an explicitly configured API URL. */
export function buildApiUrl(
  path: string,
  query?: Record<string, QueryValue>,
  baseUrl = API_BASE_URL,
): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const url = new URL(`/api/v1${normalizedPath}`, baseUrl || 'http://admin.invalid');
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === '') continue;
    url.searchParams.set(key, String(value));
  }
  return baseUrl ? url.toString() : `${url.pathname}${url.search}`;
}

export class AdminApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId?: string,
    /** Field-level validation details keyed by input name, when provided. */
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

async function request<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
  query?: Record<string, QueryValue>,
): Promise<T> {
  const response = await fetch(buildApiUrl(path, query), {
    method,
    credentials: 'include',
    // Admin data is per-session and includes locale/authorization-filtered
    // navigation; browser caches must never reuse it across users or locales.
    cache: 'no-store',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (response.status === 204) return undefined as T;
  const payload = (await response.json().catch(() => ({}))) as
    T | { error?: { code?: string; message?: string; requestId?: string } };

  if (!response.ok) {
    const error = (
      payload as {
        error?: {
          code?: string;
          message?: string;
          requestId?: string;
          details?: Record<string, unknown>;
        };
      }
    ).error;
    throw new AdminApiError(
      response.status,
      error?.code ?? 'INTERNAL_ERROR',
      error?.message ?? 'The request failed.',
      error?.requestId,
      error?.details,
    );
  }
  return payload as T;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

export const adminApi = {
  login: (username: string, password: string) =>
    request<{ user: AuthenticatedAdminUser; expiresAt: string }>('POST', '/admin/auth/login', {
      username,
      password,
    }),
  logout: () => request<{ revoked: true }>('POST', '/admin/auth/logout'),
  me: (locale?: string) =>
    request<{ user: AuthenticatedAdminUser; menus: MenuNode[] }>(
      'GET',
      '/admin/auth/me',
      undefined,
      locale ? { locale } : undefined,
    ),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ changed: true }>('POST', '/admin/auth/change-password', {
      currentPassword,
      newPassword,
    }),

  list: <T>(path: string, query?: Record<string, QueryValue>) =>
    request<PaginatedResponse<T>>('GET', path, undefined, query),
  get: <T>(path: string, query?: Record<string, QueryValue>) =>
    request<T>('GET', path, undefined, query),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
};

/** Uploads a file with the session cookie attached (multipart/form-data). */
export async function uploadFile(
  file: File,
  purpose: string,
): Promise<{
  id: string;
  url: string | null;
  originalName: string;
  storageKey: string;
}> {
  const form = new FormData();
  form.append('file', file);
  const response = await fetch(buildApiUrl('/admin/files/upload', { purpose }), {
    method: 'POST',
    credentials: 'include',
    body: form,
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown> & {
    error?: { code?: string; message?: string; requestId?: string };
  };
  if (!response.ok) {
    throw new AdminApiError(
      response.status,
      payload.error?.code ?? 'INTERNAL_ERROR',
      payload.error?.message ?? 'The upload failed.',
      payload.error?.requestId,
    );
  }
  return payload as { id: string; url: string | null; originalName: string; storageKey: string };
}
