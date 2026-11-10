import { describe, expect, it } from 'vitest';
import {
  COMMERCIAL_DOCUMENT_STATUSES,
  isCommercialDocumentDownloadable,
} from './commercial-documents';

describe('isCommercialDocumentDownloadable', () => {
  it('allows only formal issued, superseded, or cancelled documents', () => {
    expect(
      COMMERCIAL_DOCUMENT_STATUSES.filter(isCommercialDocumentDownloadable),
    ).toEqual(['ISSUED', 'SUPERSEDED', 'CANCELLED']);
  });
});
