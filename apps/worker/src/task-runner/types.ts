import type {
  AnalyticsRollupJobPayload,
  ExcelPdfCleanupJobPayload,
  ExcelPdfConvertJobPayload,
  FileDeleteJobPayload,
  ImageDerivativeJobPayload,
  ProductImportCleanupJobPayload,
  ProductImportValidateJobPayload,
  QuoteExportJobPayload,
} from '@b2b/contracts';

export type ClaimedTask =
  | {
      source: 'file_delete';
      id: string;
      attempts: number;
      payload: FileDeleteJobPayload;
    }
  | {
      source: 'quote_export';
      id: string;
      attempts: number;
      payload: QuoteExportJobPayload;
    }
  | {
      source: 'outbox';
      id: string;
      attempts: number;
      eventType: 'image-derivatives';
      payload: ImageDerivativeJobPayload;
    }
  | {
      source: 'outbox';
      id: string;
      attempts: number;
      eventType: 'product-import-validate';
      payload: ProductImportValidateJobPayload;
    }
  | {
      source: 'outbox';
      id: string;
      attempts: number;
      eventType: 'product-import-cleanup';
      payload: ProductImportCleanupJobPayload;
    }
  | {
      source: 'outbox';
      id: string;
      attempts: number;
      eventType: 'analytics-rollup';
      payload: AnalyticsRollupJobPayload;
    }
  | {
      source: 'outbox';
      id: string;
      attempts: number;
      eventType: 'excel-pdf-convert';
      payload: ExcelPdfConvertJobPayload;
    }
  | {
      source: 'outbox';
      id: string;
      attempts: number;
      eventType: 'excel-pdf-cleanup';
      payload: ExcelPdfCleanupJobPayload;
    };

export interface TaskRunnerOptions {
  workerId: string;
  maxAttempts: number;
  leaseSeconds: number;
  pollIntervalMs: number;
  retryBaseDelayMs: number;
  /** When false, conversion events remain queued until the feature is re-enabled. */
  excelPdfEnabled?: boolean;
}
