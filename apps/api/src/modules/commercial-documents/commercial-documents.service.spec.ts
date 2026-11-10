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

function makeService(
  prisma: unknown,
  audit = { record: vi.fn() },
  templates = {} as DocumentTemplatesService,
) {
  return new CommercialDocumentsService(
    prisma as PrismaService,
    audit as unknown as AuditService,
    { get: vi.fn() } as unknown as StorageService,
    { warn: vi.fn(), error: vi.fn() } as unknown as JsonLogger,
    templates,
    {} as CompanyProfilesService,
  );
}

describe('CommercialDocumentsService template prefill resolution', () => {
  const resolved = {
    template: {
      id: 'template-ci',
      documentType: 'CI',
      locale: 'en-US',
      status: 'ACTIVE',
    },
    version: {
      id: 'version-ci-1',
      version: 1,
      status: 'PUBLISHED',
      checksum: 'a'.repeat(64),
    },
    config: {
      schemaVersion: 1,
    },
  };
  let resolveVersion: ReturnType<typeof vi.fn>;
  let ensureDefaultVersion: ReturnType<typeof vi.fn>;
  let service: CommercialDocumentsService;

  beforeEach(() => {
    vi.clearAllMocks();
    resolveVersion = vi.fn(async () => resolved);
    ensureDefaultVersion = vi.fn(async () => resolved);
    service = makeService({}, undefined, {
      resolveVersion,
      ensureDefaultVersion,
    } as unknown as DocumentTemplatesService);
  });

  const resolveForOrder = (locale: string, templateVersionId: string | null) =>
    (
      service as unknown as {
        resolveTemplateForOrder: (
          order: unknown,
          documentType: 'PI' | 'CI',
          locale: string,
          templateVersionId: string | null,
          actorId: string,
        ) => Promise<unknown>;
      }
    ).resolveTemplateForOrder({}, 'CI', locale, templateVersionId, 'actor-1');

  it('uses the requested published version when template and locale match', async () => {
    await expect(resolveForOrder('en-US', 'version-ci-1')).resolves.toBe(resolved);
    expect(resolveVersion).toHaveBeenCalledWith('version-ci-1', 'CI');
    expect(ensureDefaultVersion).not.toHaveBeenCalled();
  });

  it('rejects a template version whose language differs from the document', async () => {
    await expect(resolveForOrder('zh-CN', 'version-ci-1')).rejects.toMatchObject({
      code: ERROR_CODES.documentTemplateLocaleMismatch,
    });
  });

  it('rejects a version belonging to an inactive template', async () => {
    resolveVersion.mockResolvedValue({
      ...resolved,
      template: { ...resolved.template, status: 'DISABLED' },
    });
    await expect(resolveForOrder('en-US', 'version-ci-1')).rejects.toMatchObject({
      code: ERROR_CODES.documentTemplateNotActive,
    });
  });

  it('keeps the default-template fallback when no version is supplied', async () => {
    await expect(resolveForOrder('zh-CN', null)).resolves.toBe(resolved);
    expect(ensureDefaultVersion).toHaveBeenCalledWith('CI', 'zh-CN', 'actor-1', undefined);
    expect(resolveVersion).not.toHaveBeenCalled();
  });
});

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

  it('rejects switching to a template version in another language', async () => {
    findUnique.mockResolvedValue({
      ...issuedDocument({ status: 'DRAFT' }),
      version: 1,
      items: [],
      locale: 'en-US',
      templateId: 'template-ci',
      templateVersionId: 'version-ci-1',
      templateVersionNo: 1,
      template: {
        id: 'template-ci',
        locale: 'en-US',
        status: 'ACTIVE',
      },
      templateVersion: {
        id: 'version-ci-1',
        version: 1,
        status: 'PUBLISHED',
      },
    });
    const localizedService = makeService({ commercialDocument: { findUnique } }, undefined, {
      resolveVersion: vi.fn(async () => ({
        template: {
          id: 'template-ci',
          documentType: 'CI',
          locale: 'zh-CN',
          status: 'ACTIVE',
        },
        version: { id: 'version-ci-2', version: 2, status: 'PUBLISHED' },
        config: {},
      })),
    } as unknown as DocumentTemplatesService);

    await expect(
      localizedService.update(
        DOC_ID,
        {
          version: 1,
          locale: 'en-US',
          templateVersionId: 'version-ci-2',
        },
        'actor-1',
        'request-1',
      ),
    ).rejects.toMatchObject({
      code: ERROR_CODES.documentTemplateLocaleMismatch,
    });
  });
});

describe('CommercialDocumentsService draft deletion', () => {
  const audit = { record: vi.fn() };
  const documentFindUnique = vi.fn();
  const renderCount = vi.fn();
  const renderFindMany = vi.fn();
  const fileUpsert = vi.fn();
  const documentDelete = vi.fn();
  let service: CommercialDocumentsService;

  beforeEach(() => {
    vi.clearAllMocks();
    documentFindUnique.mockResolvedValue({
      id: DOC_ID,
      documentType: 'CI',
      documentNo: 'CI-20261110-ABC123',
      revisionNo: 1,
      status: 'DRAFT',
      pdfFileKey: 'commercial-documents/draft.pdf',
      templateId: 'template-ci',
      templateVersionNo: 2,
      _count: { revisions: 0 },
    });
    renderCount.mockResolvedValue(0);
    renderFindMany.mockResolvedValue([
      { fileKey: 'commercial-documents/draft.pdf' },
      { fileKey: 'commercial-documents/render-1.pdf' },
    ]);
    fileUpsert
      .mockResolvedValueOnce({ id: 'deletion-job-1' })
      .mockResolvedValueOnce({ id: 'deletion-job-2' });
    documentDelete.mockResolvedValue({ id: DOC_ID });
    const transaction = vi.fn(async (callback: (tx: unknown) => unknown) =>
      callback({
        commercialDocument: { findUnique: documentFindUnique, delete: documentDelete },
        documentRenderJob: { count: renderCount, findMany: renderFindMany },
        fileDeletionJob: { upsert: fileUpsert },
      }),
    );
    service = makeService({ $transaction: transaction }, audit);
  });

  it('deletes only an unreferenced draft and queues each generated file exactly once', async () => {
    await expect(service.remove(DOC_ID, 'actor-1', 'request-1')).resolves.toEqual({
      deleted: true,
      deletionJobIds: ['deletion-job-1', 'deletion-job-2'],
    });

    expect(fileUpsert).toHaveBeenCalledTimes(2);
    expect(fileUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          entityType: 'commercial_document',
          entityId: DOC_ID,
          status: 'QUEUED',
        }),
      }),
    );
    expect(documentDelete).toHaveBeenCalledWith({ where: { id: DOC_ID } });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'commercial_document.deleted',
        metadata: {
          documentNo: 'CI-20261110-ABC123',
          documentType: 'CI',
          revisionNo: 1,
          templateId: 'template-ci',
          templateVersionNo: 2,
          deletedFileCount: 2,
        },
      }),
    );
  });

  it.each(['REVIEW', 'ISSUED', 'SUPERSEDED', 'CANCELLED'])(
    'refuses to delete a %s document',
    async (status) => {
      documentFindUnique.mockResolvedValue({
        id: DOC_ID,
        documentType: 'CI',
        documentNo: 'CI-20261110-ABC123',
        revisionNo: 1,
        status,
        pdfFileKey: null,
        templateId: null,
        templateVersionNo: null,
        _count: { revisions: 0 },
      });
      await expect(service.remove(DOC_ID, 'actor-1', 'request-1')).rejects.toMatchObject({
        code: ERROR_CODES.commercialDocumentStateConflict,
      });
      expect(documentDelete).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    },
  );

  it('refuses to delete a document with revisions', async () => {
    documentFindUnique.mockResolvedValue({
      id: DOC_ID,
      documentType: 'CI',
      documentNo: 'CI-20261110-ABC123',
      revisionNo: 1,
      status: 'DRAFT',
      pdfFileKey: null,
      templateId: 'template-ci',
      templateVersionNo: 1,
      _count: { revisions: 1 },
    });
    await expect(service.remove(DOC_ID, 'actor-1', 'request-1')).rejects.toMatchObject({
      code: ERROR_CODES.commercialDocumentStateConflict,
    });
    expect(renderCount).not.toHaveBeenCalled();
    expect(documentDelete).not.toHaveBeenCalled();
  });

  it('refuses deletion while a PDF render is queued or processing', async () => {
    renderCount.mockResolvedValue(1);
    await expect(service.remove(DOC_ID, 'actor-1', 'request-1')).rejects.toMatchObject({
      code: ERROR_CODES.commercialDocumentStateConflict,
    });
    expect(fileUpsert).not.toHaveBeenCalled();
    expect(documentDelete).not.toHaveBeenCalled();
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
