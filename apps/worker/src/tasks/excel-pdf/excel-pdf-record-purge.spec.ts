import type { PrismaClient } from '@b2b/database';
import { excelPdfChunkKey } from '@b2b/contracts';
import { describe, expect, it, vi } from 'vitest';
import { purgeExcelPdfRecordsIfReady } from './excel-pdf-record-purge';

const jobId = '22222222-2222-4222-8222-222222222222';
const uploadId = '11111111-1111-4111-8111-111111111111';
const sourceAssetId = '33333333-3333-4333-8333-333333333333';
const outputAssetId = '44444444-4444-4444-8444-444444444444';
const actorId = '55555555-5555-4555-8555-555555555555';

function jobFixture() {
  return {
    id: jobId,
    uploadId,
    requestedById: actorId,
    sourceAssetId,
    outputAssetId,
    purgeRequestedAt: new Date('2026-10-30T00:00:00.000Z'),
    sourceAsset: { storageKey: `private/excel-pdf/inputs/${sourceAssetId}.xlsx` },
    outputAsset: { storageKey: `private/excel-pdf/outputs/${outputAssetId}.pdf` },
  };
}

function setup(statuses: Record<string, 'QUEUED' | 'FAILED' | 'SUCCEEDED'>) {
  let job: ReturnType<typeof jobFixture> | null = jobFixture();
  const transaction = {
    pdfConversionJob: {
      findUnique: vi.fn(async () => job),
      updateMany: vi.fn(async () => ({ count: 1 })),
      deleteMany: vi.fn(async () => {
        const deleted = job !== null;
        job = null;
        return { count: deleted ? 1 : 0 };
      }),
    },
    excelPdfUploadChunk: {
      findMany: vi.fn(async () => [{ index: 0 }, { index: 1 }]),
    },
    fileDeletionJob: {
      findMany: vi.fn(async () =>
        Object.entries(statuses).map(([storageKey, status]) => ({
          storageKey,
          status,
          lastErrorCode: status === 'FAILED' ? 'storage.delete_failed' : null,
        })),
      ),
      upsert: vi.fn(async () => ({})),
    },
    excelPdfUpload: {
      deleteMany: vi.fn(async () => ({ count: 1 })),
    },
    fileAsset: {
      deleteMany: vi.fn(async () => ({ count: 2 })),
    },
    auditLog: { create: vi.fn(async () => ({})) },
  };
  const prisma = {
    $transaction: vi.fn(async (callback: (tx: typeof transaction) => unknown) =>
      callback(transaction),
    ),
  };
  return {
    prisma: prisma as unknown as PrismaClient,
    transaction,
    replaceJob: (value: ReturnType<typeof jobFixture> | null) => {
      job = value;
    },
  };
}

const sourceKey = `private/excel-pdf/inputs/${sourceAssetId}.xlsx`;
const outputKey = `private/excel-pdf/outputs/${outputAssetId}.pdf`;
const chunkZeroKey = excelPdfChunkKey(uploadId, 0);
const chunkOneKey = excelPdfChunkKey(uploadId, 1);

describe('Excel-to-PDF record purge', () => {
  it('removes the record graph only after every physical object reports success', async () => {
    const { prisma, transaction } = setup({
      [sourceKey]: 'SUCCEEDED',
      [outputKey]: 'SUCCEEDED',
      [chunkZeroKey]: 'SUCCEEDED',
      [chunkOneKey]: 'SUCCEEDED',
    });

    await expect(purgeExcelPdfRecordsIfReady(prisma, jobId)).resolves.toBe(true);

    expect(transaction.pdfConversionJob.deleteMany).toHaveBeenCalledWith({ where: { id: jobId } });
    expect(transaction.fileAsset.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: [sourceAssetId, outputAssetId] } },
    });
    expect(transaction.excelPdfUpload.deleteMany).toHaveBeenCalledWith({
      where: { id: uploadId, jobId },
    });
    expect(transaction.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'excel_pdf.records_purged',
        entityType: 'pdf_conversion_job',
        entityId: jobId,
        metadata: { storageObjects: 4, source: 'delete_or_retention' },
      }),
    });
    expect(transaction.pdfConversionJob.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(
      transaction.fileAsset.deleteMany.mock.invocationCallOrder[0]!,
    );
  });

  it('keeps the job pending when one physical-delete task has not succeeded', async () => {
    const { prisma, transaction } = setup({
      [sourceKey]: 'SUCCEEDED',
      [outputKey]: 'QUEUED',
      [chunkZeroKey]: 'SUCCEEDED',
      [chunkOneKey]: 'SUCCEEDED',
    });

    await expect(purgeExcelPdfRecordsIfReady(prisma, jobId)).resolves.toBe(false);

    expect(transaction.pdfConversionJob.updateMany).toHaveBeenCalledWith({
      where: { id: jobId, purgeState: { not: 'PURGED' } },
      data: { purgeState: 'PENDING' },
    });
    expect(transaction.pdfConversionJob.deleteMany).not.toHaveBeenCalled();
    expect(transaction.fileAsset.deleteMany).not.toHaveBeenCalled();
    expect(transaction.auditLog.create).not.toHaveBeenCalled();
  });

  it('marks the purge failed while preserving records and retry facts after storage failure', async () => {
    const { prisma, transaction } = setup({
      [sourceKey]: 'SUCCEEDED',
      [outputKey]: 'FAILED',
      [chunkZeroKey]: 'SUCCEEDED',
      [chunkOneKey]: 'SUCCEEDED',
    });

    await expect(purgeExcelPdfRecordsIfReady(prisma, jobId)).resolves.toBe(false);

    expect(transaction.pdfConversionJob.updateMany).toHaveBeenCalledWith({
      where: { id: jobId, purgeState: { not: 'PURGED' } },
      data: { purgeState: 'FAILED' },
    });
    expect(transaction.pdfConversionJob.deleteMany).not.toHaveBeenCalled();
  });

  it('creates any missing delete task and waits instead of deleting its database record', async () => {
    const { prisma, transaction } = setup({
      [sourceKey]: 'SUCCEEDED',
      [outputKey]: 'SUCCEEDED',
      [chunkZeroKey]: 'SUCCEEDED',
    });

    await expect(purgeExcelPdfRecordsIfReady(prisma, jobId)).resolves.toBe(false);

    expect(transaction.fileDeletionJob.upsert).toHaveBeenCalledWith({
      where: { idempotencyKey: `excel-pdf-chunk:${uploadId}:1` },
      create: expect.objectContaining({
        storageKey: chunkOneKey,
        entityType: 'excel_pdf_chunk',
        entityId: `${uploadId}:1`,
        requestedBy: actorId,
      }),
      update: {},
    });
    expect(transaction.pdfConversionJob.updateMany).toHaveBeenCalledWith({
      where: { id: jobId, purgeState: { not: 'PURGED' } },
      data: { purgeState: 'PENDING' },
    });
    expect(transaction.pdfConversionJob.deleteMany).not.toHaveBeenCalled();
  });

  it('converges regardless of which file-delete task finishes last', async () => {
    const statuses: Record<string, 'QUEUED' | 'SUCCEEDED'> = {
      [sourceKey]: 'QUEUED',
      [outputKey]: 'QUEUED',
      [chunkZeroKey]: 'QUEUED',
      [chunkOneKey]: 'QUEUED',
    };
    const { prisma, transaction } = setup(statuses);

    statuses[chunkOneKey] = 'SUCCEEDED';
    await expect(purgeExcelPdfRecordsIfReady(prisma, jobId)).resolves.toBe(false);

    statuses[sourceKey] = 'SUCCEEDED';
    await expect(purgeExcelPdfRecordsIfReady(prisma, jobId)).resolves.toBe(false);

    statuses[outputKey] = 'SUCCEEDED';
    statuses[chunkZeroKey] = 'SUCCEEDED';
    await expect(purgeExcelPdfRecordsIfReady(prisma, jobId)).resolves.toBe(true);

    expect(transaction.pdfConversionJob.deleteMany).toHaveBeenCalledOnce();
  });

  it('is idempotent after the job has already been purged', async () => {
    const { prisma, transaction, replaceJob } = setup({
      [sourceKey]: 'SUCCEEDED',
      [outputKey]: 'SUCCEEDED',
      [chunkZeroKey]: 'SUCCEEDED',
      [chunkOneKey]: 'SUCCEEDED',
    });
    replaceJob(null);

    await expect(purgeExcelPdfRecordsIfReady(prisma, jobId)).resolves.toBe(false);

    expect(transaction.pdfConversionJob.deleteMany).not.toHaveBeenCalled();
    expect(transaction.fileAsset.deleteMany).not.toHaveBeenCalled();
    expect(transaction.auditLog.create).not.toHaveBeenCalled();
  });

  it('sets PURGED when a record has no physical objects left', async () => {
    const { prisma, transaction } = setup({});
    replaceJobOnly(transaction, {
      ...jobFixture(),
      uploadId: null,
      outputAssetId: null,
      outputAsset: null,
      sourceAsset: null,
      purgeRequestedAt: null,
    });

    await expect(purgeExcelPdfRecordsIfReady(prisma, jobId)).resolves.toBe(true);

    expect(transaction.pdfConversionJob.deleteMany).toHaveBeenCalledOnce();
    expect(transaction.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        metadata: { storageObjects: 0, source: 'record_cleanup' },
      }),
    });
  });
});

function replaceJobOnly(
  transaction: { pdfConversionJob: { findUnique: ReturnType<typeof vi.fn> } },
  value: Record<string, unknown>,
): void {
  transaction.pdfConversionJob.findUnique.mockResolvedValue(value);
}
