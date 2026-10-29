import type { ErrorCode, ProductLifecycleStatus, PublishStatus } from './constants';

export const PRODUCT_IMPORT_TEMPLATE_VERSIONS = ['optimized-v1', 'wps-price-list-v1'] as const;
export type ProductImportTemplateVersion = (typeof PRODUCT_IMPORT_TEMPLATE_VERSIONS)[number];

export const PRODUCT_IMPORT_LIMITS = {
  maxBytes: 10 * 1024 * 1024,
  maxRows: 1_000,
  maxImagesPerProduct: 20,
  maxImageBytes: 10 * 1024 * 1024,
  maxTotalUncompressedBytes: 100 * 1024 * 1024,
  validationTtlSeconds: 600,
} as const;

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
