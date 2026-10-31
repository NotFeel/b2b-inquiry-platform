import type { ErrorCode } from './constants';

const MIB = 1024 * 1024;

/**
 * Upload and conversion limits shared by Admin, API and Worker (docs/38).
 * Large workbooks are uploaded as small independent chunks so no request
 * reaches the 10 MiB Next.js proxy limit.
 */
export const EXCEL_PDF_LIMITS = {
  maxUploadBytes: 200 * MIB,
  chunkBytes: 8 * MIB,
  uploadTtlSeconds: 60 * 60,
  maxZipEntries: 4_000,
  maxZipEntryBytes: 256 * MIB,
  maxZipUncompressedBytes: 1024 * MIB,
  maxCompressionRatio: 250,
  maxOutputBytes: 50 * MIB,
  maxPages: 200,
  defaultTimeoutMs: 300_000,
  defaultRetentionDays: 7,
  maxPageSize: 50,
} as const;

export const EXCEL_PDF_BUSINESS_TYPES = ['quotation', 'pi', 'other'] as const;
export type ExcelPdfBusinessType = (typeof EXCEL_PDF_BUSINESS_TYPES)[number];

/** UI-facing status adds `expired`, derived from retention without an enum migration. */
export const EXCEL_PDF_JOB_STATUSES = [
  'queued',
  'processing',
  'succeeded',
  'failed',
  'cancelled',
  'expired',
] as const;
export type ExcelPdfJobStatus = (typeof EXCEL_PDF_JOB_STATUSES)[number];

export const EXCEL_PDF_UPLOAD_STATUSES = [
  'UPLOADING',
  'QUEUED',
  'CONVERTING',
  'SUCCEEDED',
  'FAILED',
  'EXPIRED',
  'CANCELLED',
] as const;
export type ExcelPdfUploadState = (typeof EXCEL_PDF_UPLOAD_STATUSES)[number];

export interface ExcelPdfConversionOptions {
  /** Workbook page setup and print areas are authoritative. */
  layout: 'workbook';
}

export const DEFAULT_EXCEL_PDF_OPTIONS: ExcelPdfConversionOptions = {
  layout: 'workbook',
};

export interface ExcelPdfUploadInitInput {
  originalName: string;
  sizeBytes: number;
  businessType: ExcelPdfBusinessType;
  options: ExcelPdfConversionOptions;
}

export interface ExcelPdfUploadInitResult {
  uploadId: string;
  chunkSize: number;
  chunkCount: number;
  expiresAt: string;
}

export interface ExcelPdfUploadStatus {
  uploadId: string;
  status: ExcelPdfUploadState;
  originalName: string;
  sizeBytes: number;
  chunkCount: number;
  uploadedChunks: number;
  uploadedBytes: number;
  expiresAt: string;
  errorCode: ErrorCode | string | null;
  jobId: string | null;
}

export interface ExcelPdfConfig {
  enabled: boolean;
  maxUploadBytes: number;
  chunkBytes: number;
  maxOutputBytes: number;
  maxPages: number;
  retentionDays: number;
  businessTypes: readonly ExcelPdfBusinessType[];
}

export interface ExcelPdfJobSummary {
  id: string;
  fileName: string;
  businessType: ExcelPdfBusinessType;
  fileSize: number;
  status: ExcelPdfJobStatus;
  pageCount: number | null;
  outputSize: number | null;
  errorCode: ErrorCode | string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  expiresAt: string | null;
  createdBy: string | null;
  canDownload: boolean;
}

export interface ExcelPdfJobListResult {
  data: ExcelPdfJobSummary[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

export interface ExcelPdfConvertJobPayload {
  jobId: string;
  attemptId: string;
}

export interface ExcelPdfCleanupJobPayload {
  scheduledAt: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertUuid(value: string): string {
  if (!UUID_PATTERN.test(value)) throw new Error('excel_pdf.invalid_uuid');
  return value.toLowerCase();
}

export function excelPdfChunkKey(uploadId: string, index: number): string {
  if (!Number.isInteger(index) || index < 0 || index > 100_000) {
    throw new Error('excel_pdf.invalid_chunk_index');
  }
  return `private/excel-pdf/uploads/${assertUuid(uploadId)}/${index}.part`;
}

export function excelPdfInputKey(assetId: string): string {
  return `private/excel-pdf/inputs/${assertUuid(assetId)}.xlsx`;
}

export function excelPdfOutputKey(assetId: string): string {
  return `private/excel-pdf/outputs/${assertUuid(assetId)}.pdf`;
}

export function effectiveExcelPdfJobStatus(input: {
  status:
    | 'QUEUED'
    | 'PROCESSING'
    | 'SUCCEEDED'
    | 'FAILED'
    | 'CANCEL_REQUESTED'
    | 'CANCELLED'
    | 'queued'
    | 'processing'
    | 'succeeded'
    | 'failed'
    | 'cancel_requested'
    | 'cancelled';
  expiresAt: Date | string | null;
  now?: Date;
}): ExcelPdfJobStatus {
  const expiresAt = input.expiresAt
    ? input.expiresAt instanceof Date
      ? input.expiresAt
      : new Date(input.expiresAt)
    : null;
  if (
    expiresAt &&
    expiresAt.getTime() <= (input.now ?? new Date()).getTime() &&
    input.status !== 'CANCELLED' &&
    input.status !== 'cancelled'
  ) {
    return 'expired';
  }
  if (input.status === 'CANCEL_REQUESTED' || input.status === 'cancel_requested') {
    return 'cancelled';
  }
  return input.status.toLowerCase() as ExcelPdfJobStatus;
}
