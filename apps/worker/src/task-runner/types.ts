import type {
  AnalyticsRollupJobPayload,
  FileDeleteJobPayload,
  ImageDerivativeJobPayload,
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
      eventType: 'analytics-rollup';
      payload: AnalyticsRollupJobPayload;
    };

export interface TaskRunnerOptions {
  workerId: string;
  maxAttempts: number;
  leaseSeconds: number;
  pollIntervalMs: number;
  retryBaseDelayMs: number;
}
