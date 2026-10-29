import type { ErrorCode, ProductLifecycleStatus, PublishStatus } from './constants';

export const PRODUCT_IMPORT_TEMPLATE_VERSIONS = ['optimized-v1', 'wps-price-list-v1'] as const;
export type ProductImportTemplateVersion = (typeof PRODUCT_IMPORT_TEMPLATE_VERSIONS)[number];

export const PRODUCT_IMPORT_LIMITS = {
  /** Large workbooks are uploaded in chunks; this bounds one complete XLSX. */
  maxBytes: 300 * 1024 * 1024,
  /** Keep every proxy request below the Admin/Next 10MB body limit. */
  maxChunkBytes: 8 * 1024 * 1024,
  maxRows: 1_000,
  maxImagesPerProduct: 20,
  maxImageBytes: 10 * 1024 * 1024,
  maxTotalUncompressedBytes: 1024 * 1024 * 1024,
  uploadTtlSeconds: 60 * 60,
  validationTtlSeconds: 600,
} as const;

export const PRODUCT_IMPORT_UPLOAD_STATUSES = [
  'UPLOADING',
  'QUEUED',
  'VALIDATING',
  'VALIDATED',
  'INVALID',
  'FAILED',
  'EXPIRED',
  'CANCELLED',
] as const;
export type ProductImportUploadStatus = (typeof PRODUCT_IMPORT_UPLOAD_STATUSES)[number];

export interface ProductImportIssue {
  rowNumber: number | null;
  sku: string | null;
  field: string;
  code: ErrorCode | string;
  messageKey: string;
  severity: 'error' | 'warning';
}

export interface ProductImportSummary {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  warningCount: number;
  imageCount: number;
}

export interface ProductImportValidationResult {
  validationId: string | null;
  templateVersion: ProductImportTemplateVersion;
  summary: ProductImportSummary;
  errors: ProductImportIssue[];
  warnings: ProductImportIssue[];
  expiresAt: string | null;
}

export interface ProductImportUploadInitResult {
  uploadId: string;
  chunkSize: number;
  chunkCount: number;
  expiresAt: string;
}

export interface ProductImportUploadStatusResult {
  uploadId: string;
  status: ProductImportUploadStatus;
  originalName: string;
  sizeBytes: number;
  chunkCount: number;
  uploadedChunks: number;
  uploadedBytes: number;
  expiresAt: string;
  errorCode: string | null;
  validation: ProductImportValidationResult | null;
}

export interface ProductImportCommitResult {
  batchId: string;
  createdCount: number;
  completedAt: string;
}

export interface ProductImportSettings {
  categoryId: string;
  publishStatus: PublishStatus;
  lifecycleStatus: ProductLifecycleStatus;
  tagIds: string[];
  templateVersion: ProductImportTemplateVersion;
}
