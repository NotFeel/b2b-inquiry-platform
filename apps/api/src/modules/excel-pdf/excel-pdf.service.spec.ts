import { ERROR_CODES, EXCEL_PDF_LIMITS, excelPdfChunkKey } from '@b2b/contracts';
import { Prisma } from '@b2b/database';
import { describe, expect, it, vi } from 'vitest';
import type { AppEnv } from '../../config/config.module';
import type { AuthenticatedActor } from '../../common/request-context';
import type { AuditService } from '../../common/services/audit.service';
import type { StorageService } from '../../common/services/storage.service';
import type { PrismaService } from '../../prisma/prisma.service';
import { ExcelPdfService } from './excel-pdf.service';

const actor: AuthenticatedActor = {
  id: '11111111-1111-4111-8111-111111111111',
  username: 'excel-user',
  displayName: 'Excel User',
  roles: ['super_admin'],
  permissions: new Set(),
  sessionId: 'session-id',
  mustChangePassword: false,
};

const uploadId = '22222222-2222-4222-8222-222222222222';
const jobId = '33333333-3333-4333-8333-333333333333';
const assetId = '44444444-4444-4444-8444-444444444444';
const future = new Date(Date.now() + 60 * 60 * 1000);

const env = {
  EXCEL_PDF_ENABLED: true,
  EXCEL_PDF_MAX_UPLOAD_BYTES: EXCEL_PDF_LIMITS.maxUploadBytes,
  EXCEL_PDF_CHUNK_BYTES: EXCEL_PDF_LIMITS.chunkBytes,
  EXCEL_PDF_MAX_OUTPUT_BYTES: EXCEL_PDF_LIMITS.maxOutputBytes,
  EXCEL_PDF_MAX_PAGES: EXCEL_PDF_LIMITS.maxPages,
  EXCEL_PDF_RETENTION_DAYS: EXCEL_PDF_LIMITS.defaultRetentionDays,
} as AppEnv;

function uploadFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: uploadId,
    actorId: actor.id,
    idempotencyKey: 'upload-key-0001',
    status: 'UPLOADING',
    originalName: 'quotation.xlsx',
    declaredSize: 4n,
    chunkSize: 4,
    chunkCount: 1,
    businessType: 'quotation',
    options: { layout: 'workbook' },
    jobId: null,
    errorCode: null,
    expiresAt: future,
    createdAt: new Date(),
    updatedAt: new Date(),
    chunks: [{ index: 0, sizeBytes: 4n, sha256: 'a'.repeat(64) }],
    ...overrides,
  };
}

function setup() {
  const transaction = {
    excelPdfUpload: { updateMany: vi.fn(async () => ({ count: 1 })) },
    fileAsset: {
      create: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    pdfConversionJob: {
      create: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    outboxEvent: { create: vi.fn(async () => ({})) },
    fileDeletionJob: { upsert: vi.fn(async () => ({})) },
    auditLog: { create: vi.fn(async () => ({})) },
  };
  const prisma = {
    excelPdfUpload: {
      findUnique: vi.fn(async () => null as ReturnType<typeof uploadFixture> | null),
      create: vi.fn(async (_args?: unknown) => ({
        id: uploadId,
        chunkSize: EXCEL_PDF_LIMITS.chunkBytes,
        chunkCount: 25,
        expiresAt: future,
      })),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    excelPdfUploadChunk: {
      findUnique: vi.fn(async (..._args: unknown[]): Promise<unknown> => null),
      upsert: vi.fn(async () => ({})),
      findMany: vi.fn(async (..._args: unknown[]): Promise<unknown> => []),
    },
    pdfConversionJob: {
      findFirst: vi.fn(async (..._args: unknown[]): Promise<unknown> => null),
      findMany: vi.fn(async (..._args: unknown[]): Promise<unknown> => []),
      count: vi.fn(async () => 0),
    },
    fileDeletionJob: { upsert: vi.fn(async () => ({})) },
    $transaction: vi.fn(async (callback: (tx: typeof transaction) => unknown) =>
      callback(transaction),
    ),
  };
  const storage = {
    put: vi.fn(async () => ({ key: 'unused', sizeBytes: 0 })),
    get: vi.fn(async () => Buffer.from([0x50, 0x4b, 0x03, 0x04])),
    delete: vi.fn(async () => undefined),
    stat: vi.fn(async () => ({ sizeBytes: 4 })),
  };
  const audit = { record: vi.fn(async () => undefined) };
  const service = new ExcelPdfService(
    prisma as unknown as PrismaService,
    storage as unknown as StorageService,
    audit as unknown as AuditService,
    env,
  );
  return { service, prisma, transaction, storage, audit };
}

describe('ExcelPdfService uploads', () => {
  it('accepts exactly 200 MiB and splits it into 8 MiB chunks with a one-hour TTL', async () => {
    const { service, prisma } = setup();

    const result = await service.initializeUpload(
      {
        originalName: 'large-workbook.xlsx',
        sizeBytes: EXCEL_PDF_LIMITS.maxUploadBytes,
        businessType: 'other',
        options: { layout: 'workbook' },
      },
      'upload-key-200mib',
      actor,
      'request-1',
    );

    expect(result.chunkCount).toBe(25);
    expect(prisma.excelPdfUpload.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorId: actor.id,
          declaredSize: BigInt(EXCEL_PDF_LIMITS.maxUploadBytes),
          chunkCount: 25,
        }),
      }),
    );
    const created = (
      prisma.excelPdfUpload.create.mock.calls[0] as unknown as [{ data: { expiresAt: Date } }]
    )[0];
    const ttlSeconds = Math.round((created.data.expiresAt.getTime() - Date.now()) / 1000);
    expect(ttlSeconds).toBeGreaterThanOrEqual(EXCEL_PDF_LIMITS.uploadTtlSeconds - 5);
    expect(ttlSeconds).toBeLessThanOrEqual(EXCEL_PDF_LIMITS.uploadTtlSeconds + 5);
  });

  it('rejects an upload over the 200 MiB server limit before creating storage metadata', async () => {
    const { service, prisma } = setup();

    await expect(
      service.initializeUpload(
        {
          originalName: 'too-large.xlsx',
          sizeBytes: EXCEL_PDF_LIMITS.maxUploadBytes + 1,
          businessType: 'other',
          options: { layout: 'workbook' },
        },
        'upload-key-too-large',
        actor,
        'request-2',
      ),
    ).rejects.toMatchObject({ code: ERROR_CODES.uploadTooLarge });
    expect(prisma.excelPdfUpload.create).not.toHaveBeenCalled();
  });

  it('replays an idempotent request and rejects key reuse for different workbook metadata', async () => {
    const { service, prisma } = setup();
    prisma.excelPdfUpload.findUnique.mockResolvedValue(uploadFixture());
    const input = {
      originalName: 'quotation.xlsx',
      sizeBytes: 4,
      businessType: 'quotation' as const,
      options: { layout: 'workbook' as const },
    };

    await expect(
      service.initializeUpload(input, 'upload-key-0001', actor, 'request-3'),
    ).resolves.toEqual(expect.objectContaining({ uploadId }));
    await expect(
      service.initializeUpload(
        { ...input, originalName: 'different.xlsx' },
        'upload-key-0001',
        actor,
        'request-4',
      ),
    ).rejects.toMatchObject({ code: ERROR_CODES.conflict });
  });

  it('replays the winner when two idempotent initialization requests race', async () => {
    const { service, prisma } = setup();
    prisma.excelPdfUpload.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: ['idempotencyKey'] },
      }),
    );
    prisma.excelPdfUpload.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(uploadFixture());

    await expect(
      service.initializeUpload(
        {
          originalName: 'quotation.xlsx',
          sizeBytes: 4,
          businessType: 'quotation',
          options: { layout: 'workbook' },
        },
        'upload-key-0001',
        actor,
        'request-race',
      ),
    ).resolves.toMatchObject({ uploadId });
  });

  it('enforces feature disablement in the service, not only in the Admin UI', async () => {
    const { prisma } = setup();
    const disabled = new ExcelPdfService(
      prisma as unknown as PrismaService,
      { put: vi.fn() } as unknown as StorageService,
      { record: vi.fn() } as unknown as AuditService,
      { ...env, EXCEL_PDF_ENABLED: false } as AppEnv,
    );

    await expect(
      disabled.initializeUpload(
        {
          originalName: 'quotation.xlsx',
          sizeBytes: 4,
          businessType: 'quotation',
          options: { layout: 'workbook' },
        },
        'upload-key-disabled',
        actor,
        'request-disabled',
      ),
    ).rejects.toMatchObject({ code: ERROR_CODES.excelPdfDisabled });
    expect(prisma.excelPdfUpload.findUnique).not.toHaveBeenCalled();
  });

  it('rejects a wrong-sized chunk before writing it to storage', async () => {
    const { service, prisma, storage } = setup();
    prisma.excelPdfUpload.findUnique.mockResolvedValue(
      uploadFixture({ chunkSize: 8, chunkCount: 1, declaredSize: 8n }),
    );

    await expect(
      service.uploadChunk(uploadId, 0, Buffer.from('short'), actor),
    ).rejects.toMatchObject({ code: ERROR_CODES.excelPdfUploadChunkInvalid });
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('does not create a conversion job until every expected chunk exists', async () => {
    const { service, prisma, storage } = setup();
    prisma.excelPdfUpload.findUnique.mockResolvedValue(
      uploadFixture({ chunkCount: 2, chunkSize: 2, declaredSize: 4n }),
    );

    await expect(
      service.completeUpload(uploadId, actor, 'request-incomplete'),
    ).rejects.toMatchObject({ code: ERROR_CODES.excelPdfUploadIncomplete });
    expect(storage.get).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('atomically changes the upload, creates the job and publishes the outbox event', async () => {
    const { service, prisma, transaction, storage } = setup();
    const queued = uploadFixture({ status: 'QUEUED', jobId });
    prisma.excelPdfUpload.findUnique
      .mockResolvedValueOnce(uploadFixture())
      .mockResolvedValueOnce(queued);

    const result = await service.completeUpload(uploadId, actor, 'request-complete');

    expect(storage.get).toHaveBeenCalledWith(excelPdfChunkKey(uploadId, 0));
    expect(transaction.excelPdfUpload.updateMany).toHaveBeenCalledOnce();
    expect(transaction.fileAsset.create).toHaveBeenCalledOnce();
    expect(transaction.pdfConversionJob.create).toHaveBeenCalledOnce();
    expect(transaction.outboxEvent.create).toHaveBeenCalledOnce();
    expect(result.status).toBe('QUEUED');
  });
});

describe('ExcelPdfService access and lifecycle', () => {
  it('keeps downloads owner-scoped and audits no storage key', async () => {
    const { service, prisma, storage, audit } = setup();
    prisma.pdfConversionJob.findFirst.mockResolvedValue({
      id: jobId,
      requestedById: actor.id,
      sourceFileName: 'quotation.xlsx',
      businessType: 'quotation',
      inputSizeBytes: 4n,
      status: 'SUCCEEDED',
      pageCount: 1,
      outputSizeBytes: 4n,
      errorCode: null,
      createdAt: new Date(),
      startedAt: new Date(),
      completedAt: new Date(),
      expiresAt: future,
      purgeState: 'NONE',
      outputKey: 'private/excel-pdf/outputs/result.pdf',
      outputAsset: { status: 'ready', storageKey: 'private/excel-pdf/outputs/result.pdf' },
      sourceAsset: { status: 'ready', storageKey: 'private/excel-pdf/inputs/source.xlsx' },
      requestedBy: { displayName: 'Excel User', username: 'excel-user' },
    });
    storage.stat.mockResolvedValue({ sizeBytes: 4 });

    await service.getDownload(jobId, actor, 'attachment', 'request-download');

    expect(prisma.pdfConversionJob.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: jobId, requestedById: actor.id } }),
    );
    expect(audit.record).toHaveBeenCalledWith({
      actorId: actor.id,
      action: 'EXCEL_PDF_DOWNLOAD',
      entityType: 'pdf_conversion_job',
      entityId: jobId,
      requestId: 'request-download',
      metadata: { mode: 'attachment', outputSizeBytes: 4 },
    });
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain('private/excel-pdf');
  });

  it('rejects a stale retry when another request already changed the failed job', async () => {
    const { service, prisma, transaction } = setup();
    prisma.pdfConversionJob.findFirst.mockResolvedValue({
      id: jobId,
      requestedById: actor.id,
      sourceFileName: 'quotation.xlsx',
      businessType: 'quotation',
      inputSizeBytes: 4n,
      status: 'FAILED',
      pageCount: null,
      outputSizeBytes: null,
      errorCode: ERROR_CODES.excelPdfFileInvalid,
      createdAt: new Date(),
      startedAt: new Date(),
      completedAt: new Date(),
      expiresAt: future,
      purgeState: 'NONE',
      uploadId,
      sourceAsset: { status: 'ready', storageKey: 'private/excel-pdf/inputs/source.xlsx' },
      outputAsset: null,
    });
    transaction.pdfConversionJob.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(service.retry(jobId, actor, 'request-retry')).rejects.toMatchObject({
      code: ERROR_CODES.conflict,
    });
    expect(transaction.outboxEvent.create).not.toHaveBeenCalled();
  });

  it('does not queue physical deletion when delete loses a processing-state race', async () => {
    const { service, prisma, transaction } = setup();
    prisma.pdfConversionJob.findFirst.mockResolvedValue({
      id: jobId,
      requestedById: actor.id,
      sourceFileName: 'quotation.xlsx',
      businessType: 'quotation',
      inputSizeBytes: 4n,
      status: 'FAILED',
      pageCount: null,
      outputSizeBytes: null,
      errorCode: ERROR_CODES.storageUnavailable,
      createdAt: new Date(),
      startedAt: new Date(),
      completedAt: new Date(),
      expiresAt: future,
      purgeState: 'NONE',
      uploadId,
      sourceAsset: {
        id: assetId,
        status: 'ready',
        storageKey: 'private/excel-pdf/inputs/source.xlsx',
      },
      outputAsset: null,
    });
    prisma.excelPdfUploadChunk.findMany.mockResolvedValue([{ index: 0 }]);
    transaction.pdfConversionJob.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(service.deleteJob(jobId, actor, 'request-delete')).rejects.toMatchObject({
      code: ERROR_CODES.excelPdfUploadStateInvalid,
    });
    expect(transaction.fileDeletionJob.upsert).not.toHaveBeenCalled();
  });
});
