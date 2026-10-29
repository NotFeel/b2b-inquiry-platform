'use client';

import {
  ERROR_CODES,
  PRODUCT_IMPORT_LIMITS,
  type ProductImportCommitResult,
  type ProductImportSettings,
  type ProductImportUploadInitResult,
  type ProductImportUploadStatusResult,
  type ProductImportValidationResult,
} from '@b2b/contracts';
import { AdminApiError, buildApiUrl } from './admin-api';

const TERMINAL_STATUSES = new Set(['VALIDATED', 'INVALID', 'FAILED', 'EXPIRED', 'CANCELLED']);

export interface ProductImportUploadProgress {
  phase: 'uploading' | 'validating';
  uploadId: string;
  uploadedChunks: number;
  chunkCount: number;
  uploadedBytes: number;
  totalBytes: number;
  retryingChunkIndex: number | null;
}

export interface ProductImportUploadOptions {
  onProgress?: (progress: ProductImportUploadProgress) => void;
  signal?: AbortSignal;
  maxChunkRetries?: number;
  pollIntervalMs?: number;
}

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as {
    data?: T;
    error?: {
      code?: string;
      message?: string;
      requestId?: string;
      details?: Record<string, unknown>;
    };
  };
  if (!response.ok) {
    throw new AdminApiError(
      response.status,
      payload.error?.code ?? 'INTERNAL_ERROR',
      payload.error?.message ?? 'The request failed.',
      payload.error?.requestId,
      payload.error?.details,
    );
  }
  return payload.data as T;
}

function abortError(): DOMException {
  return new DOMException('The product import was cancelled.', 'AbortError');
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError();
}

function wait(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const timer = globalThis.setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        globalThis.clearTimeout(timer);
        reject(abortError());
      },
      { once: true },
    );
  });
}

function isRetryableChunkError(error: unknown): boolean {
  if (error instanceof AdminApiError) return error.status >= 500 || error.status === 429;
  return error instanceof TypeError;
}

export const productBulkImportApi = {
  templateUrl(): string {
    return buildApiUrl('/admin/products/bulk-import/template');
  },

  async initializeUpload(
    file: File,
    settings: ProductImportSettings,
    signal?: AbortSignal,
  ): Promise<ProductImportUploadInitResult> {
    if (file.size > PRODUCT_IMPORT_LIMITS.maxBytes) {
      throw new AdminApiError(
        413,
        ERROR_CODES.importFileTooLarge,
        'The workbook exceeds the 300MB import limit.',
      );
    }
    const response = await fetch(buildApiUrl('/admin/products/bulk-import/uploads'), {
      method: 'POST',
      credentials: 'include',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...settings,
        originalName: file.name,
        sizeBytes: file.size,
      }),
      signal,
    });
    return parseResponse<ProductImportUploadInitResult>(response);
  },

  async uploadChunk(
    uploadId: string,
    index: number,
    chunk: Blob,
    signal?: AbortSignal,
  ): Promise<{ uploadId: string; index: number; uploadedBytes: number }> {
    const form = new FormData();
    form.append('file', chunk, `${uploadId}-${String(index).padStart(6, '0')}.part`);
    const response = await fetch(
      buildApiUrl(
        `/admin/products/bulk-import/uploads/${encodeURIComponent(uploadId)}/chunks/${index}`,
      ),
      {
        method: 'PUT',
        credentials: 'include',
        cache: 'no-store',
        body: form,
        signal,
      },
    );
    return parseResponse<{ uploadId: string; index: number; uploadedBytes: number }>(response);
  },

  async completeUpload(
    uploadId: string,
    signal?: AbortSignal,
  ): Promise<ProductImportUploadStatusResult> {
    const response = await fetch(
      buildApiUrl(`/admin/products/bulk-import/uploads/${encodeURIComponent(uploadId)}/complete`),
      {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        signal,
      },
    );
    return parseResponse<ProductImportUploadStatusResult>(response);
  },

  async uploadStatus(
    uploadId: string,
    signal?: AbortSignal,
  ): Promise<ProductImportUploadStatusResult> {
    const response = await fetch(
      buildApiUrl(`/admin/products/bulk-import/uploads/${encodeURIComponent(uploadId)}`),
      { method: 'GET', credentials: 'include', cache: 'no-store', signal },
    );
    return parseResponse<ProductImportUploadStatusResult>(response);
  },

  async cancelUpload(
    uploadId: string,
    signal?: AbortSignal,
  ): Promise<ProductImportUploadStatusResult> {
    const response = await fetch(
      buildApiUrl(`/admin/products/bulk-import/uploads/${encodeURIComponent(uploadId)}/cancel`),
      {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        signal,
      },
    );
    return parseResponse<ProductImportUploadStatusResult>(response);
  },

  async uploadAndValidate(
    file: File,
    settings: ProductImportSettings,
    options: ProductImportUploadOptions = {},
  ): Promise<ProductImportUploadStatusResult> {
    throwIfAborted(options.signal);
    const init = await this.initializeUpload(file, settings, options.signal);
    const maxRetries = Math.max(0, options.maxChunkRetries ?? 2);
    let uploadedChunks = 0;
    let uploadedBytes = 0;
    options.onProgress?.({
      phase: 'uploading',
      uploadId: init.uploadId,
      uploadedChunks,
      chunkCount: init.chunkCount,
      uploadedBytes,
      totalBytes: file.size,
      retryingChunkIndex: null,
    });

    for (let index = 0; index < init.chunkCount; index += 1) {
      throwIfAborted(options.signal);
      const start = index * init.chunkSize;
      const end = Math.min(file.size, start + init.chunkSize);
      const chunk = file.slice(start, end);
      for (let attempt = 0; ; attempt += 1) {
        try {
          await this.uploadChunk(init.uploadId, index, chunk, options.signal);
          break;
        } catch (error) {
          if (options.signal?.aborted) throw abortError();
          if (attempt >= maxRetries || !isRetryableChunkError(error)) throw error;
          options.onProgress?.({
            phase: 'uploading',
            uploadId: init.uploadId,
            uploadedChunks,
            chunkCount: init.chunkCount,
            uploadedBytes,
            totalBytes: file.size,
            retryingChunkIndex: index,
          });
          await wait(Math.min(400 * 2 ** attempt, 4_000), options.signal);
        }
      }
      uploadedChunks += 1;
      uploadedBytes += chunk.size;
      options.onProgress?.({
        phase: 'uploading',
        uploadId: init.uploadId,
        uploadedChunks,
        chunkCount: init.chunkCount,
        uploadedBytes,
        totalBytes: file.size,
        retryingChunkIndex: null,
      });
    }

    let status = await this.completeUpload(init.uploadId, options.signal);
    options.onProgress?.({
      phase: 'validating',
      uploadId: init.uploadId,
      uploadedChunks,
      chunkCount: init.chunkCount,
      uploadedBytes,
      totalBytes: file.size,
      retryingChunkIndex: null,
    });
    while (!TERMINAL_STATUSES.has(status.status)) {
      await wait(options.pollIntervalMs ?? 1_500, options.signal);
      status = await this.uploadStatus(init.uploadId, options.signal);
    }
    return status;
  },

  async commit(validationId: string): Promise<ProductImportCommitResult> {
    const response = await fetch(buildApiUrl('/admin/products/bulk-import/commit'), {
      method: 'POST',
      credentials: 'include',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ validationId }),
    });
    return parseResponse<ProductImportCommitResult>(response);
  },
};

export function productImportValidationFromStatus(
  status: ProductImportUploadStatusResult,
): ProductImportValidationResult | null {
  return status.validation;
}
