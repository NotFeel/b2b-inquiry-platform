// Queue names and payload contracts shared by the API (producer) and the worker
// (consumer). Keeping them in one place stops the two apps drifting apart.

export const QUEUE_NAMES = {
  imageDerivatives: 'image-derivatives',
  quoteExport: 'quote-export',
  pdfConvert: 'pdf-convert',
  fileDelete: 'file-delete',
  analyticsRollup: 'analytics-rollup',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

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
  };
}

export interface PdfConvertJobPayload {
  jobId: string;
  sourceStorageKey: string;
  sheetName?: string | null;
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

export type JobPayload =
  | ImageDerivativeJobPayload
  | QuoteExportJobPayload
  | PdfConvertJobPayload
  | FileDeleteJobPayload
  | AnalyticsRollupJobPayload;
