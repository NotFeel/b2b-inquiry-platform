import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@b2b/contracts';
import { translateError } from './i18n';

describe('commercial document render errors', () => {
  it('explains how to diagnose an unavailable LibreOffice converter', () => {
    const message = translateError(
      'zh-CN',
      ERROR_CODES.commercialDocumentConverterUnavailable,
    );

    expect(message).toContain('LibreOffice');
    expect(message).toContain('Worker');
    expect(message).not.toBe(translateError('zh-CN', ERROR_CODES.internalError));
  });

  it('translates actionable PDF validation failures in both admin locales', () => {
    for (const code of [
      ERROR_CODES.commercialDocumentConversionFailed,
      ERROR_CODES.commercialDocumentConversionTimeout,
      ERROR_CODES.commercialDocumentPdfInfoUnavailable,
      ERROR_CODES.commercialDocumentOutputInvalid,
      ERROR_CODES.commercialDocumentOutputTooLarge,
      ERROR_CODES.commercialDocumentOutputTooManyPages,
    ]) {
      expect(translateError('zh-CN', code)).not.toBe(
        translateError('zh-CN', ERROR_CODES.internalError),
      );
      expect(translateError('en-US', code)).not.toBe(
        translateError('en-US', ERROR_CODES.internalError),
      );
    }
  });
});
