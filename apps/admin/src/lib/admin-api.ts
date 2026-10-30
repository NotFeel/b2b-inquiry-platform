'use client';

import type {
  AuthenticatedAdminUser,
  FileAssetProcessingStatus,
  FileAssetStatusResult,
  MenuNode,
  PresignedUploadResult,
} from '@b2b/contracts';

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

/** Parses RFC 5987 `filename*` first, then a quoted ASCII filename fallback. */
export function parseContentDispositionFilename(
  disposition: string | null,
  fallback = 'download.bin',
): string {
  if (!disposition) return fallback;
  const encoded = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(disposition)?.[1];
  const quoted = /filename\s*=\s*"([^"]+)"/i.exec(disposition)?.[1];
  const bare = /filename\s*=\s*([^;]+)/i.exec(disposition)?.[1]?.trim();
  let candidate = encoded ?? quoted ?? bare ?? fallback;
  if (encoded) {
    try {
      candidate = decodeURIComponent(encoded);
    } catch {
      candidate = quoted ?? bare ?? fallback;
    }
  }
  const safe = candidate
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/]/g, '_')
    .trim()
    .slice(0, 180);
  return safe.length > 0 ? safe : fallback;
}

export interface AdminFileDownload {
  blob: Blob;
  filename: string;
  requestId: string | null;
}

/** Downloads a generated file without treating its binary response as JSON. */
export async function downloadAdminFilePost(
  path: string,
  body: unknown,
): Promise<AdminFileDownload> {
  const response = await fetch(buildApiUrl(path), {
    method: 'POST',
    credentials: 'include',
    cache: 'no-store',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return readAdminFileResponse(response, 'Quotation.xlsx');
}

/** Downloads an existing private file through an authenticated GET endpoint. */
export async function downloadAdminFileGet(
  path: string,
  fallbackFilename = 'download.bin',
): Promise<AdminFileDownload> {
  const response = await fetch(buildApiUrl(path), {
    method: 'GET',
    credentials: 'include',
    cache: 'no-store',
  });
  return readAdminFileResponse(response, fallbackFilename);
}

async function readAdminFileResponse(
  response: Response,
  fallbackFilename: string,
): Promise<AdminFileDownload> {
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as {
      error?: {
        code?: string;
        message?: string;
        requestId?: string;
        details?: Record<string, unknown>;
      };
    };
    const error = payload.error;
    throw new AdminApiError(
      response.status,
      error?.code ?? 'INTERNAL_ERROR',
      error?.message ?? 'The request failed.',
      error?.requestId ?? response.headers.get('x-request-id') ?? undefined,
      error?.details,
    );
  }
  const blob = await response.blob();
  return {
    blob,
    filename: parseContentDispositionFilename(
      response.headers.get('content-disposition'),
      fallbackFilename,
    ),
    requestId: response.headers.get('x-request-id'),
  };
}

/** Uploads a file with the session cookie attached (multipart/form-data). */
export async function uploadFile(
  file: File,
  purpose: string,
): Promise<{
  id: string;
  url: string | null;
  originalName: string;
  storageKey: string;
  status: FileAssetProcessingStatus;
}> {
  if (file.type.startsWith('image/')) {
    try {
      return await uploadFileDirect(file, purpose);
    } catch (error) {
      if (!(error instanceof AdminApiError) || error.code !== 'UPLOAD_DIRECT_UNAVAILABLE') {
        throw error;
      }
    }
  }
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
  let uploaded = payload as {
    id: string;
    url: string | null;
    originalName: string;
    storageKey: string;
    status: FileAssetProcessingStatus;
  };
  if (uploaded.status === 'processing') {
    const processed = await waitForFileAsset(uploaded.id);
    uploaded = {
      ...uploaded,
      status: processed.status,
      url: processed.url ?? uploaded.url,
    };
  }
  if (uploaded.status !== 'ready') {
    throw new AdminApiError(
      422,
      'UPLOAD_PROCESSING_FAILED',
      'The image could not be safely decoded or optimized.',
    );
  }
  return uploaded;
}

export async function uploadFileDirect(
  file: File,
  purpose: string,
  paths: {
    initiate?: string;
    confirm?: (id: string) => string;
    status?: (id: string) => string;
  } = {},
): Promise<{
  id: string;
  url: string | null;
  originalName: string;
  storageKey: string;
  status: FileAssetProcessingStatus;
}> {
  const initiated = await adminApi.post<{ data: PresignedUploadResult }>(
    paths.initiate ?? '/admin/files/presign-upload',
    {
      purpose,
      originalName: file.name,
      declaredMime: file.type || imageMimeFromName(file.name),
      sizeBytes: file.size,
    },
  );
  const upload = initiated.data;
  const put = await fetch(upload.uploadUrl, {
    method: upload.method,
    headers: upload.headers,
    body: file,
  });
  if (!put.ok) {
    throw new AdminApiError(
      put.status,
      'STORAGE_ERROR',
      `Object storage rejected the upload (${put.status}).`,
    );
  }

  const confirmed = await adminApi.post<{ data: FileAssetStatusResult }>(
    paths.confirm?.(upload.fileAssetId) ?? `/admin/files/${upload.fileAssetId}/confirm-upload`,
  );
  let status = confirmed.data;
  if (status.status === 'processing') {
    status = await waitForFileAsset(upload.fileAssetId, 60_000, paths.status?.(upload.fileAssetId));
  }
  if (status.status !== 'ready') {
    throw new AdminApiError(
      422,
      'UPLOAD_PROCESSING_FAILED',
      'The image could not be safely decoded or optimized.',
    );
  }
  return {
    id: upload.fileAssetId,
    url: status.url,
    originalName: file.name,
    storageKey: upload.storageKey,
    status: 'ready',
  };
}

function imageMimeFromName(name: string): string {
  const extension = name.toLowerCase().split('.').pop();
  if (extension === 'png') return 'image/png';
  if (extension === 'webp') return 'image/webp';
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  return 'application/octet-stream';
}

async function waitForFileAsset(
  id: string,
  timeoutMs = 60_000,
  statusPath = `/admin/files/${id}/status`,
): Promise<FileAssetStatusResult> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await adminApi.get<{ data: FileAssetStatusResult }>(statusPath);
    if (response.data.status !== 'processing') {
      return response.data;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
  }
  throw new AdminApiError(504, 'UPLOAD_PROCESSING_FAILED', 'The image processing timed out.');
}
