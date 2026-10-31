import type { ErrorCode } from '@b2b/contracts';

export class ExcelPdfProcessingError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'ExcelPdfProcessingError';
  }
}
