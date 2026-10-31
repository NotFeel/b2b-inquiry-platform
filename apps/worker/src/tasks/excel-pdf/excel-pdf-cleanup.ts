import type { ExcelPdfCleanupJobPayload } from '@b2b/contracts';
import type { PrismaClient } from '@b2b/database';
import type { WorkerLogger } from '../../logger';
import { queueChunkDeletions } from './excel-pdf-task.handler';

interface Dependencies {
  prisma: PrismaClient;
  logger: WorkerLogger;
}

/** Persists object-delete tasks for expired uploads and conversion records. */
export async function processExcelPdfCleanup(
  _payload: ExcelPdfCleanupJobPayload,
  deps: Dependencies,
): Promise<void> {
  const { prisma, logger } = deps;
  const now = new Date();

  const expiredUploads = await prisma.excelPdfUpload.findMany({
    where: {
      expiresAt: { lte: now },
      OR: [{ status: 'UPLOADING' }, { status: 'CANCELLED' }, { status: 'EXPIRED' }],
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
      await queueChunkDeletions(transaction, upload.id, upload.chunks, upload.actorId);
    });
  }

  const expiredJobs = await prisma.pdfConversionJob.findMany({
    where: {
      uploadId: { not: null },
      expiresAt: { lte: now },
      status: { not: 'PROCESSING' },
      purgeState: { in: ['NONE', 'PENDING'] },
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
          purgeState: 'NONE',
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
        await transaction.fileDeletionJob.upsert({
          where: { idempotencyKey: `excel-pdf-asset:${asset.id}` },
          create: {
            storageKey: asset.storageKey,
            entityType: 'excel_pdf_asset',
            entityId: asset.id,
            requestedBy: job.requestedById,
            idempotencyKey: `excel-pdf-asset:${asset.id}`,
          },
          update: {},
        });
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
  }

  if (expiredUploads.length > 0 || expiredJobs.length > 0) {
    logger.info('excel_pdf.cleanup_scheduled', {
      uploads: expiredUploads.length,
      jobs: expiredJobs.length,
    });
  }
}
