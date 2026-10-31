import type { PrismaClient } from '@b2b/database';
import { ERROR_CODES } from '@b2b/contracts';
import { describe, expect, it, vi } from 'vitest';
import type { WorkerEnv } from '../../env';
import type { WorkerLogger } from '../../logger';
import { processExcelPdfCleanup } from './excel-pdf-cleanup';

const uploadId = '11111111-1111-4111-8111-111111111111';
const jobId = '22222222-2222-4222-8222-222222222222';
const sourceAssetId = '33333333-3333-4333-8333-333333333333';
const outputAssetId = '44444444-4444-4444-8444-444444444444';
const actorId = '55555555-5555-4555-8555-555555555555';

type JobResponse = Record<string, unknown>[];
type ProcessingJobResponse = { id: string; uploadId: string | null }[];

function setup() {
  const transaction = {
    excelPdfUpload: {
      updateMany: vi.fn(async () => ({ count: 1 })),
      deleteMany: vi.fn(async () => ({ count: 1 })),
      findUnique: vi.fn(async () => null),
    },
    excelPdfUploadChunk: {
      findMany: vi.fn(async () => []),
      deleteMany: vi.fn(async () => ({ count: 1 })),
    },
    pdfConversionJob: {
      findUnique: vi.fn(async () => null),
      updateMany: vi.fn(async () => ({ count: 1 })),
      deleteMany: vi.fn(async () => ({ count: 1 })),
    },
    fileAsset: {
      updateMany: vi.fn(async () => ({ count: 1 })),
      deleteMany: vi.fn(async () => ({ count: 1 })),
    },
    fileDeletionJob: {
      findMany: vi.fn(async () => []),
      updateMany: vi.fn(async () => ({ count: 1 })),
      upsert: vi.fn(async () => ({})),
    },
    auditLog: { create: vi.fn(async () => ({})) },
  };

  let interruptedJobs: ProcessingJobResponse = [];
  let expiredJobs: JobResponse = [];
  const prisma = {
    excelPdfUpload: { findMany: vi.fn(async () => []) },
    excelPdfUploadChunk: {
      findMany: vi.fn(async () => []),
      deleteMany: vi.fn(async () => ({ count: 1 })),
    },
    pdfConversionJob: {
      findMany: vi.fn(async ({ where }: { where: { status?: unknown } }) =>
        where.status === 'PROCESSING' ? interruptedJobs : expiredJobs,
      ),
    },
    $transaction: vi.fn(async (callback: (tx: typeof transaction) => unknown) =>
      callback(transaction),
    ),
  };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const deps = {
    prisma: prisma as unknown as PrismaClient,
    logger: logger as unknown as WorkerLogger,
    env: { EXCEL_PDF_RETENTION_DAYS: 1 } as WorkerEnv,
  };

  return {
    deps,
    prisma,
    transaction,
    logger,
    setInterruptedJobs: (jobs: ProcessingJobResponse) => {
      interruptedJobs = jobs;
    },
    setExpiredJobs: (jobs: JobResponse) => {
      expiredJobs = jobs;
    },
  };
}

describe('Excel-to-PDF retention cleanup', () => {
  it('expires an abandoned upload and durably queues every remaining chunk', async () => {
    const { deps, prisma, transaction } = setup();
    prisma.excelPdfUpload.findMany.mockResolvedValue([
      {
        id: uploadId,
        actorId,
        jobId: null,
        status: 'UPLOADING',
        expiresAt: new Date(Date.now() - 60_000),
        chunks: [{ index: 0 }, { index: 1 }],
      },
    ]);

    await processExcelPdfCleanup({ scheduledAt: new Date().toISOString() }, deps);

    expect(transaction.excelPdfUpload.updateMany).toHaveBeenCalledWith({
      where: { id: uploadId, status: 'UPLOADING' },
      data: { status: 'EXPIRED', errorCode: 'EXCEL_PDF_UPLOAD_EXPIRED' },
    });
    expect(transaction.fileDeletionJob.upsert).toHaveBeenCalledTimes(2);
    expect(transaction.fileDeletionJob.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { idempotencyKey: `excel-pdf-chunk:${uploadId}:1` },
        create: expect.objectContaining({
          storageKey: `private/excel-pdf/uploads/${uploadId}/1.part`,
          entityType: 'excel_pdf_chunk',
        }),
      }),
    );
  });

  it('queues source, output and chunk deletion for an expired failed job', async () => {
    const { deps, prisma, transaction, setExpiredJobs } = setup();
    setExpiredJobs([
      {
        id: jobId,
        uploadId,
        requestedById: actorId,
        status: 'FAILED',
        purgeState: 'NONE',
        purgeRequestedAt: null,
        expiresAt: new Date(Date.now() - 60_000),
        sourceAsset: {
          id: sourceAssetId,
          storageKey: `private/excel-pdf/inputs/${sourceAssetId}.xlsx`,
        },
        outputAsset: {
          id: outputAssetId,
          storageKey: `private/excel-pdf/outputs/${outputAssetId}.pdf`,
        },
      },
    ]);
    prisma.excelPdfUploadChunk.findMany.mockResolvedValue([{ index: 0 }]);

    await processExcelPdfCleanup({ scheduledAt: new Date().toISOString() }, deps);

    expect(transaction.pdfConversionJob.updateMany).toHaveBeenCalledWith({
      where: {
        id: jobId,
        status: { not: 'PROCESSING' },
        purgeState: { in: ['NONE', 'FAILED'] },
      },
      data: { purgeState: 'PENDING', purgeRequestedAt: expect.any(Date) },
    });
    expect(transaction.fileAsset.updateMany).toHaveBeenCalledTimes(2);
    expect(transaction.fileDeletionJob.upsert).toHaveBeenCalledTimes(3);
    expect(transaction.fileDeletionJob.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { idempotencyKey: `excel-pdf-asset:${sourceAssetId}` },
        create: expect.objectContaining({
          storageKey: `private/excel-pdf/inputs/${sourceAssetId}.xlsx`,
          entityType: 'excel_pdf_asset',
        }),
      }),
    );
    expect(transaction.fileDeletionJob.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { idempotencyKey: `excel-pdf-asset:${outputAssetId}` },
        create: expect.objectContaining({
          storageKey: `private/excel-pdf/outputs/${outputAssetId}.pdf`,
          entityType: 'excel_pdf_asset',
        }),
      }),
    );
    expect(transaction.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'excel_pdf.retention_expired',
        entityType: 'pdf_conversion_job',
        entityId: jobId,
      }),
    });
  });

  it('re-enqueues previously failed physical-delete work and keeps the record until it succeeds', async () => {
    const { deps, transaction, setExpiredJobs } = setup();
    setExpiredJobs([
      {
        id: jobId,
        uploadId: null,
        requestedById: null,
        status: 'CANCELLED',
        purgeState: 'FAILED',
        purgeRequestedAt: new Date(Date.now() - 60_000),
        expiresAt: new Date(Date.now() - 60_000),
        sourceAsset: {
          id: sourceAssetId,
          storageKey: `private/excel-pdf/inputs/${sourceAssetId}.xlsx`,
        },
        outputAsset: null,
      },
    ]);

    await processExcelPdfCleanup({ scheduledAt: new Date().toISOString() }, deps);

    expect(transaction.fileDeletionJob.updateMany).toHaveBeenCalledWith({
      where: { idempotencyKey: `excel-pdf-asset:${sourceAssetId}`, status: 'FAILED' },
      data: expect.objectContaining({ status: 'QUEUED', attempts: 0, lastErrorCode: null }),
    });
    expect(transaction.pdfConversionJob.deleteMany).not.toHaveBeenCalled();
  });

  it('uses a one-day createdAt cutoff for legacy jobs without an expiry', async () => {
    const { deps, prisma, setExpiredJobs } = setup();
    setExpiredJobs([
      {
        id: jobId,
        uploadId: null,
        requestedById: null,
        status: 'FAILED',
        purgeState: 'NONE',
        purgeRequestedAt: null,
        expiresAt: null,
        sourceAsset: null,
        outputAsset: null,
      },
    ]);

    const before = Date.now();
    await processExcelPdfCleanup({ scheduledAt: new Date().toISOString() }, deps);
    const after = Date.now();
    const call = prisma.pdfConversionJob.findMany.mock.calls.find(
      ([query]: [{ where?: { status?: unknown } }]) => query.where?.status !== 'PROCESSING',
    );
    const or = call?.[0].where?.OR as [
      { expiresAt?: { lte: Date } },
      { createdAt?: { lte: Date } },
    ];
    const cutoff = or[1].createdAt?.lte.getTime();

    expect(cutoff).toBeGreaterThanOrEqual(before - 24 * 60 * 60 * 1000 - 1_000);
    expect(cutoff).toBeLessThanOrEqual(after - 24 * 60 * 60 * 1000 + 1_000);
  });

  it('marks a processing job failed only after its worker lease has expired', async () => {
    const { deps, transaction, setInterruptedJobs } = setup();
    setInterruptedJobs([{ id: jobId, uploadId }]);

    await processExcelPdfCleanup({ scheduledAt: new Date().toISOString() }, deps);

    expect(transaction.pdfConversionJob.updateMany).toHaveBeenCalledWith({
      where: {
        id: jobId,
        status: 'PROCESSING',
        OR: [{ leaseUntil: null }, { leaseUntil: { lte: expect.any(Date) } }],
      },
      data: expect.objectContaining({
        status: 'FAILED',
        errorCode: ERROR_CODES.excelPdfConversionInterrupted,
        leaseOwner: null,
        leaseUntil: null,
      }),
    });
    expect(transaction.excelPdfUpload.updateMany).toHaveBeenCalledWith({
      where: { id: uploadId, jobId, status: 'CONVERTING' },
      data: {
        status: 'FAILED',
        errorCode: ERROR_CODES.excelPdfConversionInterrupted,
      },
    });
    expect(transaction.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'excel_pdf.conversion_interrupted',
        entityId: jobId,
        metadata: { source: 'scheduled_recovery', leaseExpired: true },
      }),
    });
  });

  it('does not touch a processing job while its worker lease remains active', async () => {
    const { deps, prisma, transaction } = setup();

    await processExcelPdfCleanup({ scheduledAt: new Date().toISOString() }, deps);

    const interruptedQuery = prisma.pdfConversionJob.findMany.mock.calls.find(
      ([query]: [{ where?: { status?: unknown } }]) => query.where?.status === 'PROCESSING',
    );
    expect(interruptedQuery?.[0].where).toMatchObject({
      status: 'PROCESSING',
      OR: [{ leaseUntil: null }, { leaseUntil: { lte: expect.any(Date) } }],
    });
    expect(transaction.pdfConversionJob.updateMany).not.toHaveBeenCalled();
  });

  it('does not delete an empty upload when an orphan conversion job still references it', async () => {
    const { deps, prisma, transaction } = setup();
    prisma.excelPdfUpload.findMany.mockResolvedValue([
      {
        id: uploadId,
        actorId,
        jobId,
        status: 'FAILED',
        expiresAt: new Date(Date.now() - 60_000),
        chunks: [],
      },
    ]);

    await processExcelPdfCleanup({ scheduledAt: new Date().toISOString() }, deps);

    expect(transaction.excelPdfUpload.deleteMany).not.toHaveBeenCalled();
  });
});
