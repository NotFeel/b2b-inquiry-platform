import type { PrismaClient } from '@b2b/database';
import { describe, expect, it, vi } from 'vitest';
import type { WorkerLogger } from '../../logger';
import { processExcelPdfCleanup } from './excel-pdf-cleanup';

const uploadId = '11111111-1111-4111-8111-111111111111';
const jobId = '22222222-2222-4222-8222-222222222222';
const sourceAssetId = '33333333-3333-4333-8333-333333333333';
const outputAssetId = '44444444-4444-4444-8444-444444444444';

function setup() {
  const transaction = {
    excelPdfUpload: { updateMany: vi.fn(async () => ({ count: 1 })) },
    pdfConversionJob: { updateMany: vi.fn(async () => ({ count: 1 })) },
    fileAsset: { updateMany: vi.fn(async () => ({ count: 1 })) },
    fileDeletionJob: { upsert: vi.fn(async () => ({})) },
    auditLog: { create: vi.fn(async () => ({})) },
  };
  const prisma = {
    excelPdfUpload: { findMany: vi.fn(async () => []) },
    excelPdfUploadChunk: { findMany: vi.fn(async () => []) },
    pdfConversionJob: { findMany: vi.fn(async () => []) },
    $transaction: vi.fn(async (callback: (tx: typeof transaction) => unknown) =>
      callback(transaction),
    ),
  };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const deps = {
    prisma: prisma as unknown as PrismaClient,
    logger: logger as unknown as WorkerLogger,
  };
  return { deps, prisma, transaction, logger };
}

describe('Excel-to-PDF retention cleanup', () => {
  it('expires an abandoned upload and durably queues every remaining chunk', async () => {
    const { deps, prisma, transaction } = setup();
    prisma.excelPdfUpload.findMany.mockResolvedValue([
      {
        id: uploadId,
        actorId: '55555555-5555-4555-8555-555555555555',
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
    const { deps, prisma, transaction } = setup();
    prisma.pdfConversionJob.findMany.mockResolvedValue([
      {
        id: jobId,
        uploadId,
        requestedById: '55555555-5555-4555-8555-555555555555',
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
        purgeState: 'NONE',
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

  it('is idempotent after purge state is already PENDING', async () => {
    const { deps, prisma, transaction } = setup();
    prisma.pdfConversionJob.findMany.mockResolvedValue([
      {
        id: jobId,
        uploadId: null,
        requestedById: null,
        status: 'CANCELLED',
        purgeState: 'PENDING',
        purgeRequestedAt: new Date(Date.now() - 60_000),
        expiresAt: new Date(Date.now() - 60_000),
        sourceAsset: {
          id: sourceAssetId,
          storageKey: `private/excel-pdf/inputs/${sourceAssetId}.xlsx`,
        },
        outputAsset: null,
      },
    ]);
    transaction.pdfConversionJob.updateMany.mockResolvedValueOnce({ count: 0 });

    await processExcelPdfCleanup({ scheduledAt: new Date().toISOString() }, deps);

    expect(transaction.fileDeletionJob.upsert).toHaveBeenCalledOnce();
    expect(transaction.auditLog.create).not.toHaveBeenCalled();
  });
});
