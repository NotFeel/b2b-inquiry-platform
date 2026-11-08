import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@b2b/contracts';
import type { AuditService } from '../../common/services/audit.service';
import type { JsonLogger } from '../../common/logger.service';
import type { StorageService } from '../../common/services/storage.service';
import type { PrismaService } from '../../prisma/prisma.service';
import { ApiError } from '../../common/errors/api-error';
import { CompanyProfilesService } from './company-profiles.service';
import { CommercialDocumentsService } from './commercial-documents.service';
import { DocumentTemplatesService } from './document-templates.service';

const DOC_ID = 'ec6b6f8b-3f36-45ec-bc02-c11e3e5ef111';

function makeService(prisma: unknown, audit = { record: vi.fn() }) {
  return new CommercialDocumentsService(
    prisma as PrismaService,
    audit as unknown as AuditService,
    { get: vi.fn() } as unknown as StorageService,
    { warn: vi.fn(), error: vi.fn() } as unknown as JsonLogger,
    {} as DocumentTemplatesService,
    {} as CompanyProfilesService,
  );
}

function issuedDocument(overrides: Record<string, unknown> = {}) {
  return {
    id: DOC_ID,
    documentNo: 'CI-20261106-ABC123',
    revisionNo: 1,
    documentType: 'CI',
    status: 'ISSUED',
    pdfFileKey: 'private/commercial-documents/x.pdf',
    pdfSizeBytes: 1234n,
    pdfSha256: 'a'.repeat(64),
    ...overrides,
  };
}

describe('CommercialDocumentsService download authorization', () => {
  const findUnique = vi.fn();
  const audit = { record: vi.fn() };
  let service: CommercialDocumentsService;

  beforeEach(() => {
    vi.clearAllMocks();
    findUnique.mockResolvedValue(issuedDocument());
    service = makeService({ commercialDocument: { findUnique } }, audit);
  });

  it('returns a private file descriptor and records a download audit entry', async () => {
    const result = await service.download(DOC_ID, 'actor-1', 'request-1');
    expect(result).toMatchObject({
      storageKey: 'private/commercial-documents/x.pdf',
      sizeBytes: 1234,
      filename: 'CI-20261106-ABC123-R1.pdf',
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'commercial_document.downloaded',
        entityId: DOC_ID,
        metadata: expect.objectContaining({ documentNo: 'CI-20261106-ABC123' }),
      }),
    );
  });

  it('refuses drafts even if a draft PDF exists', async () => {
    findUnique.mockResolvedValue(issuedDocument({ status: 'DRAFT' }));
    await expect(service.download(DOC_ID, 'actor-1', 'request-1')).rejects.toMatchObject({
      code: ERROR_CODES.commercialDocumentPdfUnavailable,
    });
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('refuses an issued document whose PDF is still rendering', async () => {
    findUnique.mockResolvedValue(issuedDocument({ pdfFileKey: null, pdfSizeBytes: null }));
    await expect(service.download(DOC_ID, 'actor-1', 'request-1')).rejects.toMatchObject({
      code: ERROR_CODES.commercialDocumentPdfUnavailable,
    });
  });
});

describe('CommercialDocumentsService state guards', () => {
  const findUnique = vi.fn();
  let service: CommercialDocumentsService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = makeService({ commercialDocument: { findUnique } });
  });

  it('rejects editing an issued document', async () => {
    findUnique.mockResolvedValue({ ...issuedDocument(), items: [] });
    await expect(
      service.update(DOC_ID, { version: 1 }, 'actor-1', 'request-1'),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it('rejects a revision when the source is still a draft', async () => {
    findUnique.mockResolvedValue({ ...issuedDocument({ status: 'DRAFT' }), items: [] });
    await expect(service.createRevision(DOC_ID, 'actor-1', 'request-1')).rejects.toMatchObject({
      code: ERROR_CODES.commercialDocumentStateConflict,
    });
  });

  it('rejects cancelling a superseded revision', async () => {
    findUnique.mockResolvedValue(issuedDocument({ status: 'SUPERSEDED' }));
    await expect(service.cancel(DOC_ID, {}, 'actor-1', 'request-1')).rejects.toMatchObject({
      code: ERROR_CODES.commercialDocumentStateConflict,
    });
  });
});

describe('CommercialDocumentsService bank account currency matching', () => {
  const bankFindFirst = vi.fn();
  const bankFindUnique = vi.fn();
  const bankCount = vi.fn();
  let service: CommercialDocumentsService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = makeService({
      bankAccountProfile: {
        findFirst: bankFindFirst,
        findUnique: bankFindUnique,
        count: bankCount,
      },
    });
    resolve = (
      service as unknown as {
        resolveBankAccount: (
          companyProfileId: string | null,
          bankAccountId: string | null,
          currencyCode: string,
        ) => Promise<unknown>;
      }
    ).resolveBankAccount.bind(service);
  });

  let resolve: (
    companyProfileId: string | null,
    bankAccountId: string | null,
    currencyCode: string,
  ) => Promise<unknown>;

  it('auto-selects only an enabled default account in the document currency', async () => {
    bankFindFirst.mockResolvedValue({ id: 'bank-usd', currencyCode: 'USD' });
    const result = await resolve('company-1', null, 'USD');
    expect(result).toMatchObject({ id: 'bank-usd' });
    expect(bankFindFirst).toHaveBeenCalledWith({
      where: {
        companyProfileId: 'company-1',
        currencyCode: 'USD',
        enabled: true,
        isDefault: true,
      },
    });
  });

  it('rejects a manually selected account in another currency', async () => {
    bankFindUnique.mockResolvedValue({
      id: 'bank-eur',
      companyProfileId: 'company-1',
      enabled: true,
      currencyCode: 'EUR',
    });
    await expect(resolve('company-1', 'bank-eur', 'USD')).rejects.toMatchObject({
      code: ERROR_CODES.bankAccountCurrencyMismatch,
    });
  });

  it('rejects a disabled account even when the currency matches', async () => {
    bankFindUnique.mockResolvedValue({
      id: 'bank-usd',
      companyProfileId: 'company-1',
      enabled: false,
      currencyCode: 'USD',
    });
    await expect(resolve('company-1', 'bank-usd', 'USD')).rejects.toMatchObject({
      code: ERROR_CODES.bankAccountDisabled,
    });
  });

  it('returns null instead of substituting another currency when no default exists', async () => {
    bankFindFirst.mockResolvedValue(null);
    await expect(resolve('company-1', null, 'USD')).resolves.toBeNull();
    expect(bankFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ currencyCode: 'USD', isDefault: true }),
      }),
    );
  });
});
