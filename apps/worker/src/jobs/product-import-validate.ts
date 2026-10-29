import { createHash } from 'node:crypto';
import {
  ERROR_CODES,
  PERMISSIONS,
  PRODUCT_IMPORT_LIMITS,
  PRODUCT_LIFECYCLE_STATUSES,
  PUBLISH_STATUSES,
  productImportChunkKey,
  type ProductImportIssue,
  type ProductImportSettings,
  type ProductImportSummary,
  type ProductImportValidateJobPayload,
} from '@b2b/contracts';
import type { Prisma, PrismaClient } from '@b2b/database';
import {
  ProductImportProcessingError,
  looksLikeXlsx,
  validateAndStageProductImport,
} from '@b2b/product-import';
import { z } from 'zod';
import type { WorkerEnv } from '../env';
import type { WorkerLogger } from '../logger';
import type { ObjectStorage } from '../storage';

const settingsSchema = z.object({
  categoryId: z.string().uuid(),
  publishStatus: z.enum(PUBLISH_STATUSES),
  lifecycleStatus: z.enum(PRODUCT_LIFECYCLE_STATUSES),
  tagIds: z.array(z.string().uuid()).max(30),
  templateVersion: z.enum(['optimized-v1', 'wps-price-list-v1']),
});

export async function processProductImportValidation(
  payload: ProductImportValidateJobPayload,
  deps: { prisma: PrismaClient; storage: ObjectStorage; env: WorkerEnv; logger: WorkerLogger },
): Promise<void> {
  const { prisma, storage, env, logger } = deps;
  const upload = await prisma.productImportUpload.findUnique({
    where: { id: payload.uploadId },
    include: { chunks: { orderBy: { index: 'asc' } } },
  });
  if (!upload) {
    logger.warn('product_import.upload_missing', { uploadId: payload.uploadId });
    return;
  }

  if (['CANCELLED', 'EXPIRED', 'VALIDATED', 'INVALID'].includes(upload.status)) {
    await removeChunkObjects(
      storage,
      upload.id,
      upload.chunks.map((chunk) => chunk.index),
      logger,
    );
    return;
  }
  if (upload.expiresAt.getTime() <= Date.now()) {
    await prisma.productImportUpload.update({
      where: { id: upload.id },
      data: { status: 'EXPIRED', errorCode: ERROR_CODES.importUploadExpired },
    });
    await removeChunkObjects(
      storage,
      upload.id,
      upload.chunks.map((chunk) => chunk.index),
      logger,
    );
    return;
  }

  await prisma.productImportUpload.update({
    where: { id: upload.id },
    data: { status: 'VALIDATING', errorCode: null },
  });

  try {
    const settings = settingsSchema.parse(upload.settings) as ProductImportSettings;
    if (
      upload.chunks.length !== upload.chunkCount ||
      new Set(upload.chunks.map((chunk) => chunk.index)).size !== upload.chunkCount
    ) {
      throw new Error(ERROR_CODES.importUploadIncomplete);
    }

    const totalBytes = upload.chunks.reduce((sum, chunk) => sum + Number(chunk.sizeBytes), 0);
    if (totalBytes !== Number(upload.declaredSize)) {
      throw new Error(ERROR_CODES.importUploadIncomplete);
    }
    if (totalBytes > PRODUCT_IMPORT_LIMITS.maxBytes) {
      throw new Error(ERROR_CODES.importFileTooLarge);
    }
    // Allocate the merged workbook once instead of retaining every chunk and
    // then allocating a second full-size Buffer.concat copy. A 200MB workbook
    // therefore needs one workbook-sized buffer here rather than two.
    const workbook = Buffer.allocUnsafe(totalBytes);
    let offset = 0;
    for (const chunk of upload.chunks) {
      const part = await storage.get(productImportChunkKey(upload.id, chunk.index));
      const digest = createHash('sha256').update(part).digest('hex');
      if (
        part.byteLength !== Number(chunk.sizeBytes) ||
        (chunk.sha256 !== null && chunk.sha256 !== digest)
      ) {
        throw new Error(ERROR_CODES.importUploadChunkInvalid);
      }
      part.copy(workbook, offset);
      offset += part.byteLength;
    }
    if (offset !== totalBytes) {
      throw new Error(ERROR_CODES.importUploadIncomplete);
    }
    if (!looksLikeXlsx(workbook)) {
      throw new ProductImportProcessingError(
        ERROR_CODES.importFileTypeInvalid,
        'The upload is not a valid macro-free .xlsx workbook.',
      );
    }

    const actor = await resolveActorPermissions(prisma, upload.actorId);
    const outcome = await validateAndStageProductImport(
      {
        buffer: workbook,
        settings,
        actor,
        maxImageBytes: Math.min(PRODUCT_IMPORT_LIMITS.maxImageBytes, env.UPLOAD_MAX_BYTES),
        maxPixels: env.UPLOAD_MAX_PIXELS,
        validationId: validationIdForUpload(upload.id),
      },
      { prisma, storage },
    );
    const status = outcome.result.validationId ? 'VALIDATED' : 'INVALID';
    await prisma.$transaction(async (transaction) => {
      await transaction.productImportUpload.update({
        where: { id: upload.id },
        data: {
          status,
          fileSha256: outcome.fileSha256,
          summary: outcome.result.summary as unknown as Prisma.InputJsonValue,
          errors: outcome.result.errors as unknown as Prisma.InputJsonValue,
          warnings: outcome.result.warnings as unknown as Prisma.InputJsonValue,
          validationId: outcome.result.validationId,
          errorCode: status === 'INVALID' ? 'IMPORT_VALIDATION_FAILED' : null,
        },
      });
      await transaction.auditLog.create({
        data: {
          actorId: upload.actorId,
          action:
            status === 'VALIDATED'
              ? 'product_import.validation_passed'
              : 'product_import.validation_failed',
          entityType: 'product_import_upload',
          entityId: upload.id,
          requestId: null,
          metadata: {
            templateVersion: outcome.result.templateVersion,
            fileSha256: outcome.fileSha256,
            totalRows: outcome.result.summary.totalRows,
            invalidRows: outcome.result.summary.invalidRows,
            errorCount: outcome.result.errors.length,
            imageCount: outcome.result.summary.imageCount,
          },
        },
      });
    });
    await removeChunkObjects(
      storage,
      upload.id,
      upload.chunks.map((chunk) => chunk.index),
      logger,
    );
    logger.info('product_import.validation_done', {
      uploadId: upload.id,
      status,
      bytes: totalBytes,
      rows: outcome.result.summary.totalRows,
      images: outcome.result.summary.imageCount,
    });
  } catch (error) {
    const code =
      error instanceof ProductImportProcessingError
        ? error.code
        : error instanceof Error
          ? error.message.slice(0, 120)
          : 'IMPORT_PROCESSING_FAILED';
    await prisma.productImportUpload.update({
      where: { id: upload.id },
      data: { status: 'FAILED', errorCode: code },
    });
    logger.error('product_import.validation_failed', { uploadId: upload.id, errorCode: code });
    throw error;
  }
}

async function resolveActorPermissions(prisma: PrismaClient, actorId: string) {
  const user = await prisma.adminUser.findUnique({
    where: { id: actorId },
    select: {
      id: true,
      status: true,
      userRoles: { select: { role: { select: { code: true, permissions: true } } } },
    },
  });
  if (!user || user.status !== 'ACTIVE') {
    throw new Error('IMPORT_OPERATOR_UNAVAILABLE');
  }
  const roles = user.userRoles.map((entry) => entry.role.code);
  const permissions = new Set(
    user.userRoles.flatMap((entry) => entry.role.permissions.map((item) => item.permissionCode)),
  );
  const isSuperAdmin = roles.includes('super_admin');
  return {
    id: user.id,
    canUpdateCost: isSuperAdmin || permissions.has(PERMISSIONS.productCostUpdate),
    canPublish: isSuperAdmin || permissions.has(PERMISSIONS.productPublish),
  };
}

function validationIdForUpload(uploadId: string): string {
  const hash = createHash('sha256').update(`product-import:${uploadId}`).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

async function removeChunkObjects(
  storage: ObjectStorage,
  uploadId: string,
  indexes: number[],
  logger: WorkerLogger,
): Promise<void> {
  const results = await Promise.allSettled(
    indexes.map((index) => storage.delete(productImportChunkKey(uploadId, index))),
  );
  const failed = results.filter((result) => result.status === 'rejected').length;
  if (failed > 0) logger.warn('product_import.chunk_cleanup_failed', { uploadId, failed });
}

export type { ProductImportIssue, ProductImportSummary };
