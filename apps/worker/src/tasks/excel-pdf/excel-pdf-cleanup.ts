import type { ExcelPdfCleanupJobPayload } from '@b2b/contracts';
import { ERROR_CODES } from '@b2b/contracts';
import type { PrismaClient } from '@b2b/database';
import type { WorkerEnv } from '../../env';
import type { WorkerLogger } from '../../logger';
import { purgeExcelPdfRecordsIfReady } from './excel-pdf-record-purge';
import { queueChunkDeletions } from './excel-pdf-task.handler';

interface Dependencies {
  prisma: PrismaClient;
  logger: WorkerLogger;
  env: WorkerEnv;
}

/** Persists object-delete tasks for expired uploads and conversion records. */
export async function processExcelPdfCleanup(
  _payload: ExcelPdfCleanupJobPayload,
  deps: Dependencies,
): Promise<void> {
  const { prisma, logger, env } = deps;
  const now = new Date();
  const retentionCutoff = new Date(
    now.getTime() - env.EXCEL_PDF_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  );

  const interrupted = await finalizeInterruptedJobs(prisma, now);

  const expiredUploads = await prisma.excelPdfUpload.findMany({
    where: {
      expiresAt: { lte: now },
      OR: [
        { status: 'UPLOADING' },
        { status: 'CANCELLED' },
        { status: 'EXPIRED' },
        { status: 'FAILED' },
      ],
    },
    include: { chunks: true },
    orderBy: { expiresAt: 'asc' },
    take: 100,
  });

  for (const upload of expiredUploads) {
    await prisma.$transaction(async (transaction) => {
      if (upload.status === 'UPLOADING') {
        await transaction.excelPdfUpload.updateMany({
          where: { id: upload.id, status: 'UPLOADING' },
          data: { status: 'EXPIRED', errorCode: 'EXCEL_PDF_UPLOAD_EXPIRED' },
        });
      }
      if (!upload.jobId && upload.chunks.length === 0) {
        await transaction.excelPdfUpload.deleteMany({ where: { id: upload.id, jobId: null } });
      } else {
        await queueChunkDeletions(transaction, upload.id, upload.chunks, upload.actorId);
      }
    });
  }

  const expiredJobs = await prisma.pdfConversionJob.findMany({
    where: {
      OR: [{ expiresAt: { lte: now } }, { createdAt: { lte: retentionCutoff } }],
      status: { not: 'PROCESSING' },
      purgeState: { in: ['NONE', 'PENDING', 'FAILED'] },
    },
    include: { sourceAsset: true, outputAsset: true },
    orderBy: { expiresAt: 'asc' },
    take: 100,
  });

  for (const job of expiredJobs) {
    const chunks = job.uploadId
      ? await prisma.excelPdfUploadChunk.findMany({ where: { uploadId: job.uploadId } })
      : [];
    await prisma.$transaction(async (transaction) => {
      const transitioned = await transaction.pdfConversionJob.updateMany({
        where: {
          id: job.id,
          status: { not: 'PROCESSING' },
          purgeState: { in: ['NONE', 'FAILED'] },
        },
        data: { purgeState: 'PENDING', purgeRequestedAt: job.purgeRequestedAt ?? now },
      });
      if (job.uploadId) {
        await transaction.excelPdfUpload.updateMany({
          where: { id: job.uploadId, status: { not: 'CANCELLED' } },
          data: { status: 'EXPIRED', errorCode: 'EXCEL_PDF_UPLOAD_EXPIRED' },
        });
        await queueChunkDeletions(transaction, job.uploadId, chunks, job.requestedById);
      }
      for (const asset of [job.sourceAsset, job.outputAsset]) {
        if (!asset) continue;
        await transaction.fileAsset.updateMany({
          where: { id: asset.id },
          data: { status: 'delete_pending' },
        });
        await queueAssetDeletion(transaction, asset, job.requestedById);
      }
      if (transitioned.count === 1) {
        await transaction.auditLog.create({
          data: {
            actorId: null,
            action: 'excel_pdf.retention_expired',
            entityType: 'pdf_conversion_job',
            entityId: job.id,
            metadata: { source: 'scheduled_cleanup' },
          },
        });
      }
    });
    // Normally completion of the final file-deletion task triggers this. It is
    // also called here so rows whose tasks completed before a Worker crash do
    // not remain as orphaned conversion records forever.
    await purgeExcelPdfRecordsIfReady(prisma, job.id);
  }

  if (expiredUploads.length > 0 || expiredJobs.length > 0 || interrupted > 0) {
    logger.info('excel_pdf.cleanup_scheduled', {
      uploads: expiredUploads.length,
      jobs: expiredJobs.length,
      interrupted,
    });
  }
}

async function finalizeInterruptedJobs(prisma: PrismaClient, now: Date): Promise<number> {
  const rows = await prisma.pdfConversionJob.findMany({
    where: {
      status: 'PROCESSING',
      OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }],
    },
    select: { id: true, uploadId: true },
    take: 100,
  });
  let changed = 0;
  for (const row of rows) {
    await prisma.$transaction(async (transaction) => {
      const updated = await transaction.pdfConversionJob.updateMany({
        where: {
          id: row.id,
          status: 'PROCESSING',
          OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }],
        },
        data: {
          status: 'FAILED',
          errorCode: ERROR_CODES.excelPdfConversionInterrupted,
          completedAt: now,
          leaseOwner: null,
          leaseUntil: null,
        },
      });
      if (updated.count !== 1) return;
      changed += 1;
      if (row.uploadId) {
        await transaction.excelPdfUpload.updateMany({
          where: { id: row.uploadId, jobId: row.id, status: 'CONVERTING' },
          data: { status: 'FAILED', errorCode: ERROR_CODES.excelPdfConversionInterrupted },
        });
      }
      await transaction.auditLog.create({
        data: {
          action: 'excel_pdf.conversion_interrupted',
          entityType: 'pdf_conversion_job',
          entityId: row.id,
          metadata: { source: 'scheduled_recovery', leaseExpired: true },
        },
      });
    });
  }
  return changed;
}

async function queueAssetDeletion(
  transaction: Parameters<Parameters<PrismaClient['$transaction']>[0]>[0],
  asset: { id: string; storageKey: string },
  requestedBy: string | null,
): Promise<void> {
  const idempotencyKey = `excel-pdf-asset:${asset.id}`;
  await transaction.fileDeletionJob.updateMany({
    where: { idempotencyKey, status: 'FAILED' },
    data: {
      status: 'QUEUED',
      attempts: 0,
      runAfter: new Date(),
      lockedBy: null,
      lockedUntil: null,
      heartbeatAt: null,
      lastErrorCode: null,
      completedAt: null,
    },
  });
  await transaction.fileDeletionJob.upsert({
    where: { idempotencyKey },
    create: {
      storageKey: asset.storageKey,
      entityType: 'excel_pdf_asset',
      entityId: asset.id,
      requestedBy,
      idempotencyKey,
    },
    update: {},
  });
}
