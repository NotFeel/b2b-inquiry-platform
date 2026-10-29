import { productImportChunkKey, type ProductImportCleanupJobPayload } from '@b2b/contracts';
import type { PrismaClient } from '@b2b/database';
import type { StoredImportPayload } from '@b2b/product-import';
import type { WorkerEnv } from '../env';
import type { WorkerLogger } from '../logger';
import type { ObjectStorage } from '../storage';

export async function processProductImportCleanup(
  _payload: ProductImportCleanupJobPayload,
  deps: { prisma: PrismaClient; storage: ObjectStorage; env: WorkerEnv; logger: WorkerLogger },
): Promise<void> {
  const { prisma, storage, logger } = deps;
  const now = new Date();

  const expiredUploads = await prisma.productImportUpload.findMany({
    where: { expiresAt: { lt: now } },
    include: { chunks: { select: { index: true } } },
    take: 100,
  });
  let retriedChunkDeletes = 0;
  for (const upload of expiredUploads) {
    const results = await Promise.allSettled(
      upload.chunks.map((chunk) => storage.delete(productImportChunkKey(upload.id, chunk.index))),
    );
    const failedChunks = upload.chunks.filter(
      (_chunk, index) => results[index]?.status === 'rejected',
    );
    await prisma.$transaction(async (transaction) => {
      for (const chunk of failedChunks) {
        const storageKey = productImportChunkKey(upload.id, chunk.index);
        await transaction.fileDeletionJob.upsert({
          where: { idempotencyKey: `product-import-chunk:${upload.id}:${chunk.index}` },
          create: {
            storageKey,
            entityType: 'product_import_chunk',
            entityId: `${upload.id}:${chunk.index}`,
            status: 'QUEUED',
            idempotencyKey: `product-import-chunk:${upload.id}:${chunk.index}`,
          },
          update: {},
        });
      }
      // A failed object delete is now represented by a durable deletion job.
      // Only then may the chunk metadata be removed, otherwise a storage outage
      // would leave an orphan object that the database can no longer discover.
      await transaction.productImportChunk.deleteMany({ where: { uploadId: upload.id } });
      await transaction.productImportUpload.updateMany({
        where: {
          id: upload.id,
          status: { notIn: ['CANCELLED', 'EXPIRED', 'VALIDATED', 'INVALID'] },
        },
        data: { status: 'EXPIRED', errorCode: 'IMPORT_UPLOAD_EXPIRED' },
      });
    });
    retriedChunkDeletes += failedChunks.length;
  }

  const expiredValidations = await prisma.productImportValidation.findMany({
    where: { expiresAt: { lt: now }, consumedAt: null },
    take: 100,
  });
  let stagedAssetCount = 0;
  for (const validation of expiredValidations) {
    const payload = validation.payload as unknown as StoredImportPayload;
    const images = Array.isArray(payload?.rows)
      ? payload.rows.flatMap((row) => (Array.isArray(row.images) ? row.images : []))
      : [];
    await prisma.$transaction(async (transaction) => {
      for (const image of images) {
        if (!image.fileAssetId || !image.storageKey) continue;
        const referenced = await transaction.productImage.count({
          where: { fileAssetId: image.fileAssetId },
        });
        if (referenced > 0) continue;
        await transaction.fileDeletionJob.upsert({
          where: { idempotencyKey: `file-asset:${image.fileAssetId}` },
          create: {
            storageKey: image.storageKey,
            entityType: 'file_asset',
            entityId: image.fileAssetId,
            status: 'QUEUED',
            idempotencyKey: `file-asset:${image.fileAssetId}`,
          },
          update: {},
        });
        await transaction.fileAsset.deleteMany({ where: { id: image.fileAssetId } });
        stagedAssetCount += 1;
      }
      await transaction.productImportUpload.updateMany({
        where: { validationId: validation.id },
        data: { status: 'EXPIRED', validationId: null, errorCode: 'IMPORT_VALIDATION_EXPIRED' },
      });
      await transaction.auditLog.create({
        data: {
          action: 'product_import.cleanup_expired',
          entityType: 'product_import_validation',
          entityId: validation.id,
          metadata: { imageCount: images.length },
        },
      });
      await transaction.productImportValidation.delete({ where: { id: validation.id } });
    });
  }

  // Consumed validation rows no longer own staging images; they can be removed
  // after their short retention window without touching product attachments.
  const deletedConsumed = await prisma.productImportValidation.deleteMany({
    where: { expiresAt: { lt: now }, consumedAt: { not: null } },
  });
  const deletedCancelled = await prisma.productImportUpload.deleteMany({
    where: {
      status: { in: ['CANCELLED', 'EXPIRED'] },
      updatedAt: { lt: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
      chunks: { none: {} },
    },
  });

  logger.info('product_import.cleanup_done', {
    uploads: expiredUploads.length,
    validations: expiredValidations.length,
    stagedAssets: stagedAssetCount,
    retriedChunkDeletes,
    consumedValidationsDeleted: deletedConsumed.count,
    cancelledUploadsDeleted: deletedCancelled.count,
  });
}
