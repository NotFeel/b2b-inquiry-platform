// Queue names and payload contracts shared by the API (producer) and the worker
// (consumer). Keeping them in one place stops the two apps drifting apart.

import type { ExcelPdfCleanupJobPayload, ExcelPdfConvertJobPayload } from './excel-pdf';

export interface ImageDerivativeJobPayload {
  fileAssetId: string;
  storageKey: string;
  widths: number[];
}

export interface QuoteExportJobPayload {
  jobId: string;
  templateId: string;
  templateVersion: number;
  locale: string;
  filter: {
    categoryId?: string | null;
    includeDescendants?: boolean;
    categoryIds?: string[];
    publishStatus?: string;
    lifecycleStatus?: string;
    tag?: string;
    search?: string;
    piDocumentId?: string;
  };
}

export interface FileDeleteJobPayload {
  jobId?: string;
  /** Absent for aggregate tasks that only finalise database state. */
  storageKey?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  productId?: string | null;
}

export interface AnalyticsRollupJobPayload {
  retentionDays: number;
  targetDate?: string;
}

export interface ProductImportValidateJobPayload {
  uploadId: string;
}

export interface ProductImportCleanupJobPayload {
  scheduledAt: string;
}

export type JobPayload =
  | ImageDerivativeJobPayload
  | QuoteExportJobPayload
  | FileDeleteJobPayload
  | AnalyticsRollupJobPayload
  | ProductImportValidateJobPayload
  | ProductImportCleanupJobPayload
  | ExcelPdfConvertJobPayload
  | ExcelPdfCleanupJobPayload;
