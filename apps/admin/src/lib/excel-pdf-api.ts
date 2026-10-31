'use client';

import {
  EXCEL_PDF_LIMITS,
  type ExcelPdfBusinessType,
  type ExcelPdfConfig,
  type ExcelPdfJobListResult,
  type ExcelPdfJobStatus,
  type ExcelPdfJobSummary,
  type ExcelPdfUploadInitResult,
  type ExcelPdfUploadStatus,
} from '@b2b/contracts';
import {
  AdminApiError,
  buildApiUrl,
  downloadAdminFileGet,
  type AdminFileDownload,
} from './admin-api';

const TERMINAL_JOB_STATUSES = new Set<ExcelPdfJobStatus>([
  'succeeded',
  'failed',
  'cancelled',
  'expired',
]);

export interface ExcelPdfUploadProgress {
  phase: 'uploading' | 'converting';
  uploadId: string;
  uploadedChunks: number;
  chunkCount: number;
  uploadedBytes: number;
  totalBytes: number;
  retryingChunkIndex: number | null;
  jobId: string | null;
  jobStatus: ExcelPdfJobStatus | null;
}

export interface ExcelPdfUploadOptions {
  signal?: AbortSignal;
  onProgress?: (progress: ExcelPdfUploadProgress) => void;
  maxChunkRetries?: number;
  pollIntervalMs?: number;
  idempotencyKey?: string;
}

export interface ExcelPdfJobFilters {
  page: number;
  pageSize: number;
  status: 'all' | ExcelPdfJobStatus;
  businessType: 'all' | ExcelPdfBusinessType;
}

interface ErrorEnvelope {
  error?: {
    code?: string;
    message?: string;
    requestId?: string;
    details?: Record<string, unknown>;
  };
}

async function requestJson<T>(path: string, init: RequestInit, unwrapData: boolean): Promise<T> {
  const response = await fetch(buildApiUrl(path), {
    credentials: 'include',
    cache: 'no-store',
    ...init,
  });
  const payload = (await response.json().catch(() => ({}))) as T | { data?: T } | ErrorEnvelope;
  if (!response.ok) {
    const error = (payload as ErrorEnvelope).error;
    throw new AdminApiError(
      response.status,
      error?.code ?? 'INTERNAL_ERROR',
      error?.message ?? 'The request failed.',
      error?.requestId ?? response.headers.get('x-request-id') ?? undefined,
      error?.details,
    );
  }
  if (unwrapData && typeof payload === 'object' && payload !== null && 'data' in payload) {
    return (payload as { data: T }).data;
  }
  return payload as T;
}

function abortError(): DOMException {
  return new DOMException('The Excel-to-PDF operation was cancelled.', 'AbortError');
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

function isRetryable(error: unknown): boolean {
  if (error instanceof AdminApiError) return error.status >= 500 || error.status === 429;
  return error instanceof TypeError;
}

function createIdempotencyKey(): string {
  if (typeof crypto.randomUUID === 'function') {
    return `excel-pdf-${crypto.randomUUID()}`;
  }
  return `excel-pdf-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function validateExcelPdfFile(
  file: File,
  maxBytes: number,
): 'extension' | 'empty' | 'tooLarge' | null {
  if (!file.name.toLowerCase().endsWith('.xlsx')) return 'extension';
  if (file.size <= 0) return 'empty';
  if (file.size > maxBytes) return 'tooLarge';
  return null;
}

export const excelPdfApi = {
  async config(signal?: AbortSignal): Promise<ExcelPdfConfig> {
    return requestJson<ExcelPdfConfig>('/admin/excel-pdf/config', { method: 'GET', signal }, true);
  },

  async initializeUpload(
    file: File,
    businessType: ExcelPdfBusinessType,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<ExcelPdfUploadInitResult> {
    if (file.size > EXCEL_PDF_LIMITS.maxUploadBytes) {
      throw new AdminApiError(413, 'UPLOAD_TOO_LARGE', 'The workbook exceeds the upload limit.');
    }
    return requestJson<ExcelPdfUploadInitResult>(
      '/admin/excel-pdf/uploads',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({
          originalName: file.name,
          sizeBytes: file.size,
          businessType,
          options: { layout: 'workbook' },
        }),
        signal,
      },
      true,
    );
  },

  async uploadChunk(
    uploadId: string,
    index: number,
    chunk: Blob,
    signal?: AbortSignal,
  ): Promise<{ uploadId: string; index: number; uploadedBytes: number }> {
    const form = new FormData();
    form.append('file', chunk, `${String(index).padStart(6, '0')}.part`);
    return requestJson<{ uploadId: string; index: number; uploadedBytes: number }>(
      `/admin/excel-pdf/uploads/${encodeURIComponent(uploadId)}/chunks/${index}`,
      { method: 'PUT', body: form, signal },
      true,
    );
  },

  async completeUpload(uploadId: string, signal?: AbortSignal): Promise<ExcelPdfUploadStatus> {
    return requestJson<ExcelPdfUploadStatus>(
      `/admin/excel-pdf/uploads/${encodeURIComponent(uploadId)}/complete`,
      { method: 'POST', signal },
      true,
    );
  },

  async uploadStatus(uploadId: string, signal?: AbortSignal): Promise<ExcelPdfUploadStatus> {
    return requestJson<ExcelPdfUploadStatus>(
      `/admin/excel-pdf/uploads/${encodeURIComponent(uploadId)}`,
      { method: 'GET', signal },
      true,
    );
  },

  async cancelUpload(uploadId: string, signal?: AbortSignal): Promise<ExcelPdfUploadStatus> {
    return requestJson<ExcelPdfUploadStatus>(
      `/admin/excel-pdf/uploads/${encodeURIComponent(uploadId)}/cancel`,
      { method: 'POST', signal },
      true,
    );
  },

  async getJob(jobId: string, signal?: AbortSignal): Promise<ExcelPdfJobSummary> {
    return requestJson<ExcelPdfJobSummary>(
      `/admin/excel-pdf/jobs/${encodeURIComponent(jobId)}`,
      { method: 'GET', signal },
      true,
    );
  },

  async waitForJob(
    jobId: string,
    options: {
      signal?: AbortSignal;
      initialIntervalMs?: number;
      onStatus?: (job: ExcelPdfJobSummary) => void;
    } = {},
  ): Promise<ExcelPdfJobSummary> {
    let interval = Math.max(500, options.initialIntervalMs ?? 1_500);
    for (;;) {
      throwIfAborted(options.signal);
      const job = await this.getJob(jobId, options.signal);
      options.onStatus?.(job);
      if (TERMINAL_JOB_STATUSES.has(job.status)) return job;
      await wait(interval, options.signal);
      interval = Math.min(10_000, Math.round(interval * 1.5));
    }
  },

  async uploadAndConvert(
    file: File,
    businessType: ExcelPdfBusinessType,
    options: ExcelPdfUploadOptions = {},
  ): Promise<ExcelPdfJobSummary> {
    throwIfAborted(options.signal);
    const idempotencyKey = options.idempotencyKey ?? createIdempotencyKey();
    const maxRetries = Math.max(0, options.maxChunkRetries ?? 2);

    let init: ExcelPdfUploadInitResult | null = null;
    for (let attempt = 0; ; attempt += 1) {
      try {
        init = await this.initializeUpload(file, businessType, idempotencyKey, options.signal);
        break;
      } catch (error) {
        if (options.signal?.aborted) throw abortError();
        if (attempt >= maxRetries || !isRetryable(error)) throw error;
        await wait(Math.min(500 * 2 ** attempt, 3_000), options.signal);
      }
    }

    let uploadedChunks = 0;
    let uploadedBytes = 0;
    const report = (
      phase: 'uploading' | 'converting',
      retryingChunkIndex: number | null,
      jobId: string | null = null,
      jobStatus: ExcelPdfJobStatus | null = null,
    ) => {
      options.onProgress?.({
        phase,
        uploadId: init!.uploadId,
        uploadedChunks,
        chunkCount: init!.chunkCount,
        uploadedBytes,
        totalBytes: file.size,
        retryingChunkIndex,
        jobId,
        jobStatus,
      });
    };
    report('uploading', null);

    for (let index = 0; index < init.chunkCount; index += 1) {
      throwIfAborted(options.signal);
      const start = index * init.chunkSize;
      const chunk = file.slice(start, Math.min(file.size, start + init.chunkSize));
      for (let attempt = 0; ; attempt += 1) {
        try {
          await this.uploadChunk(init.uploadId, index, chunk, options.signal);
          break;
        } catch (error) {
          if (options.signal?.aborted) throw abortError();
          if (attempt >= maxRetries || !isRetryable(error)) throw error;
          report('uploading', index);
          await wait(Math.min(500 * 2 ** attempt, 4_000), options.signal);
        }
      }
      uploadedChunks += 1;
      uploadedBytes += chunk.size;
      report('uploading', null);
    }

    const uploadStatus = await this.completeUpload(init.uploadId, options.signal);
    if (!uploadStatus.jobId) {
      throw new AdminApiError(
        502,
        uploadStatus.errorCode ?? 'EXCEL_PDF_UPLOAD_STATE_INVALID',
        'The upload completed without creating a conversion job.',
      );
    }
    report('converting', null, uploadStatus.jobId, 'queued');
    const job = await this.waitForJob(uploadStatus.jobId, {
      signal: options.signal,
      initialIntervalMs: options.pollIntervalMs,
      onStatus: (current) => report('converting', null, current.id, current.status),
    });
    report('converting', null, job.id, job.status);
    return job;
  },

  async listJobs(
    filters: ExcelPdfJobFilters,
    signal?: AbortSignal,
  ): Promise<ExcelPdfJobListResult> {
    const query = new URLSearchParams({
      page: String(filters.page),
      pageSize: String(filters.pageSize),
      status: filters.status,
      businessType: filters.businessType,
    });
    return requestJson<ExcelPdfJobListResult>(
      `/admin/excel-pdf/jobs?${query.toString()}`,
      { method: 'GET', signal },
      false,
    );
  },

  async retry(jobId: string): Promise<ExcelPdfJobSummary> {
    return requestJson<ExcelPdfJobSummary>(
      `/admin/excel-pdf/jobs/${encodeURIComponent(jobId)}/retry`,
      { method: 'POST' },
      true,
    );
  },

  async delete(jobId: string): Promise<{ id: string; status: 'deletion_pending' | 'deleted' }> {
    return requestJson<{ id: string; status: 'deletion_pending' | 'deleted' }>(
      `/admin/excel-pdf/jobs/${encodeURIComponent(jobId)}`,
      { method: 'DELETE' },
      true,
    );
  },

  download(jobId: string, fallbackFilename: string): Promise<AdminFileDownload> {
    return downloadAdminFileGet(
      `/admin/excel-pdf/jobs/${encodeURIComponent(jobId)}/download`,
      fallbackFilename,
    );
  },

  previewUrl(jobId: string): string {
    return buildApiUrl(`/admin/excel-pdf/jobs/${encodeURIComponent(jobId)}/preview`);
  },
};
