import { excelPdfChunkKey } from '@b2b/contracts';
import type { PrismaClient } from '@b2b/database';

interface ExpectedObject {
  storageKey: string;
  entityType: 'excel_pdf_asset' | 'excel_pdf_chunk';
  entityId: string;
  idempotencyKey: string;
}

/**
 * Removes an Excel-to-PDF job only after every object owned by it has been
 * physically deleted. Object deletion tasks and their retry state remain
 * available until that point, so a storage failure cannot hide the record or
 * leave an untracked private file behind.
 */
export async function purgeExcelPdfRecordsIfReady(
  prisma: PrismaClient,
  jobId: string,
): Promise<boolean> {
  return prisma.$transaction(async (transaction) => {
    const job = await transaction.pdfConversionJob.findUnique({
      where: { id: jobId },
      include: { sourceAsset: true, outputAsset: true },
    });
    if (!job) return false;

    const chunks = job.uploadId
      ? await transaction.excelPdfUploadChunk.findMany({
          where: { uploadId: job.uploadId },
          select: { index: true },
        })
      : [];
    const expected = expectedObjects(job, chunks);
    if (expected.length > 0) {
      const tasks = await transaction.fileDeletionJob.findMany({
        where: { storageKey: { in: expected.map((item) => item.storageKey) } },
        select: { storageKey: true, status: true, lastErrorCode: true },
      });
      const taskByKey = new Map(tasks.map((task) => [task.storageKey, task]));
      let waiting = false;
      let failed = false;
      for (const item of expected) {
        const task = taskByKey.get(item.storageKey);
        if (!task) {
          await transaction.fileDeletionJob.upsert({
            where: { idempotencyKey: item.idempotencyKey },
            create: {
              storageKey: item.storageKey,
              entityType: item.entityType,
              entityId: item.entityId,
              requestedBy: job.requestedById,
              idempotencyKey: item.idempotencyKey,
            },
            update: {},
          });
          waiting = true;
          continue;
        }
        if (task.status !== 'SUCCEEDED') {
          waiting = true;
          failed ||= task.status === 'FAILED';
        }
      }
      if (waiting) {
        await transaction.pdfConversionJob.updateMany({
          where: { id: job.id, purgeState: { not: 'PURGED' } },
          data: { purgeState: failed ? 'FAILED' : 'PENDING' },
        });
        return false;
      }
    }

    // Delete the job first because sourceAssetId is a Restrict relation. The
    // remaining deletes are idempotent, so two workers reaching this point can
    // never recreate or partially retain the page record.
    const deleted = await transaction.pdfConversionJob.deleteMany({ where: { id: job.id } });
    if (deleted.count !== 1) return false;
    const assetIds = [job.sourceAssetId, job.outputAssetId].filter((value): value is string =>
      Boolean(value),
    );
    if (assetIds.length > 0) {
      await transaction.fileAsset.deleteMany({ where: { id: { in: assetIds } } });
    }
    if (job.uploadId) {
      await transaction.excelPdfUpload.deleteMany({
        where: { id: job.uploadId, jobId: job.id },
      });
    }
    await transaction.auditLog.create({
      data: {
        actorId: job.requestedById,
        action: 'excel_pdf.records_purged',
        entityType: 'pdf_conversion_job',
        entityId: job.id,
        metadata: {
          storageObjects: expected.length,
          source: job.purgeRequestedAt ? 'delete_or_retention' : 'record_cleanup',
        },
      },
    });
    return true;
  });
}

/** Cleans an abandoned upload that has no conversion job but whose chunks are gone. */
export async function purgeExcelPdfUploadIfReady(
  prisma: PrismaClient,
  uploadId: string,
): Promise<boolean> {
  return prisma.$transaction(async (transaction) => {
    const jobCount = await transaction.pdfConversionJob.count({ where: { uploadId } });
    if (jobCount > 0) return false;
    const chunks = await transaction.excelPdfUploadChunk.findMany({
      where: { uploadId },
      select: { index: true },
    });
    if (chunks.length > 0) return false;
    const upload = await transaction.excelPdfUpload.findUnique({
      where: { id: uploadId },
      select: { id: true, jobId: true, status: true },
    });
    if (!upload || upload.jobId || !['CANCELLED', 'EXPIRED', 'FAILED'].includes(upload.status)) {
      return false;
    }
    await transaction.excelPdfUpload.deleteMany({ where: { id: upload.id, jobId: null } });
    return true;
  });
}

function expectedObjects(
  job: {
    sourceAssetId: string;
    sourceAsset: { storageKey: string } | null;
    outputAssetId: string | null;
    outputAsset: { storageKey: string } | null;
    uploadId: string | null;
  },
  chunks: { index: number }[],
): ExpectedObject[] {
  const result: ExpectedObject[] = [];
  if (job.sourceAsset) {
    result.push({
      storageKey: job.sourceAsset.storageKey,
      entityType: 'excel_pdf_asset',
      entityId: job.sourceAssetId,
      idempotencyKey: `excel-pdf-asset:${job.sourceAssetId}`,
    });
  }
  if (job.outputAsset && job.outputAssetId) {
    result.push({
      storageKey: job.outputAsset.storageKey,
      entityType: 'excel_pdf_asset',
      entityId: job.outputAssetId,
      idempotencyKey: `excel-pdf-asset:${job.outputAssetId}`,
    });
  }
  if (job.uploadId) {
    for (const chunk of chunks) {
      result.push({
        storageKey: excelPdfChunkKey(job.uploadId, chunk.index),
        entityType: 'excel_pdf_chunk',
        entityId: `${job.uploadId}:${chunk.index}`,
        idempotencyKey: `excel-pdf-chunk:${job.uploadId}:${chunk.index}`,
      });
    }
  }
  return result;
}
