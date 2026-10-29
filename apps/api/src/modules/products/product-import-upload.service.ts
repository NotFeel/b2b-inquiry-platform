import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  PRODUCT_IMPORT_LIMITS,
  productImportChunkKey,
  type ProductImportIssue,
  type ProductImportSettings,
  type ProductImportSummary,
  type ProductImportUploadInitResult,
  type ProductImportUploadStatus,
  type ProductImportUploadStatusResult,
  type ProductImportValidationResult,
} from '@b2b/contracts';
import type { Prisma } from '@b2b/database';
import type { ProductImportUploadInitInput } from '@b2b/validation';
import { ApiError } from '../../common/errors/api-error';
import type { AuthenticatedActor } from '../../common/request-context';
import { AuditService } from '../../common/services/audit.service';
import { StorageService } from '../../common/services/storage.service';
import { PrismaService } from '../../prisma/prisma.service';

const ACTIVE_UPLOAD_STATUSES = new Set<ProductImportUploadStatus>([
  'UPLOADING',
  'QUEUED',
  'VALIDATING',
  'VALIDATED',
  'INVALID',
  'FAILED',
]);

@Injectable()
export class ProductImportUploadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  async initialize(
    input: ProductImportUploadInitInput,
    actor: AuthenticatedActor,
    requestId: string,
  ): Promise<ProductImportUploadInitResult> {
    const chunkSize = PRODUCT_IMPORT_LIMITS.maxChunkBytes;
    const chunkCount = Math.ceil(input.sizeBytes / chunkSize);
    const expiresAt = new Date(Date.now() + PRODUCT_IMPORT_LIMITS.uploadTtlSeconds * 1000);
    const settings: ProductImportSettings = {
      categoryId: input.categoryId,
      publishStatus: input.publishStatus,
      lifecycleStatus: input.lifecycleStatus,
      tagIds: input.tagIds,
      templateVersion: input.templateVersion,
    };
    const upload = await this.prisma.productImportUpload.create({
      data: {
        actorId: actor.id,
        originalName: input.originalName,
        declaredSize: BigInt(input.sizeBytes),
        chunkSize,
        chunkCount,
        settings: settings as unknown as Prisma.InputJsonValue,
        expiresAt,
      },
      select: { id: true },
    });
    await this.audit.record({
      actorId: actor.id,
      action: 'product_import.upload_started',
      entityType: 'product_import_upload',
      entityId: upload.id,
      requestId,
      metadata: {
        originalName: input.originalName,
        sizeBytes: input.sizeBytes,
        chunkCount,
      },
    });
    return {
      uploadId: upload.id,
      chunkSize,
      chunkCount,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async uploadChunk(
    uploadId: string,
    index: number,
    buffer: Buffer,
    actor: AuthenticatedActor,
  ): Promise<{ uploadId: string; index: number; uploadedBytes: number }> {
    const upload = await this.ownedUpload(uploadId, actor.id);
    this.assertNotExpired(upload.status, upload.expiresAt);
    if (upload.status !== 'UPLOADING') {
      throw new ApiError(
        ERROR_CODES.importUploadStateInvalid,
        'This import upload is no longer accepting chunks.',
      );
    }
    if (!Number.isInteger(index) || index < 0 || index >= upload.chunkCount) {
      throw new ApiError(ERROR_CODES.importUploadChunkInvalid, 'The chunk index is invalid.');
    }

    const declaredSize = Number(upload.declaredSize);
    const expectedSize =
      index === upload.chunkCount - 1
        ? declaredSize - upload.chunkSize * (upload.chunkCount - 1)
        : upload.chunkSize;
    if (buffer.byteLength !== expectedSize) {
      throw new ApiError(ERROR_CODES.importUploadChunkInvalid, 'The chunk size is invalid.', {
        details: { index, expectedSize, receivedSize: buffer.byteLength },
      });
    }

    const storageKey = productImportChunkKey(upload.id, index);
    const digest = createHash('sha256').update(buffer).digest('hex');
    await this.storage.put(storageKey, buffer, 'application/octet-stream');
    try {
      await this.prisma.productImportChunk.upsert({
        where: { uploadId_index: { uploadId: upload.id, index } },
        create: {
          uploadId: upload.id,
          index,
          sizeBytes: BigInt(buffer.byteLength),
          sha256: digest,
        },
        update: {
          sizeBytes: BigInt(buffer.byteLength),
          sha256: digest,
        },
      });
    } catch (error) {
      // A storage object without a chunk row cannot be merged or expired by the
      // normal database-driven cleanup. Remove it before surfacing the failure
      // so the browser can safely retry this deterministic chunk key.
      await this.storage.delete(storageKey).catch(() => undefined);
      throw error;
    }
    return { uploadId: upload.id, index, uploadedBytes: buffer.byteLength };
  }

  async complete(
    uploadId: string,
    actor: AuthenticatedActor,
    requestId: string,
  ): Promise<ProductImportUploadStatusResult> {
    const upload = await this.ownedUpload(uploadId, actor.id, true);
    this.assertNotExpired(upload.status, upload.expiresAt);
    if (['QUEUED', 'VALIDATING', 'VALIDATED', 'INVALID'].includes(upload.status)) {
      return this.toStatus(upload);
    }
    if (upload.status !== 'UPLOADING') {
      throw new ApiError(
        ERROR_CODES.importUploadStateInvalid,
        'This import upload cannot be completed in its current state.',
      );
    }
    const uploaded = upload.chunks.reduce((sum, chunk) => sum + Number(chunk.sizeBytes), 0);
    if (
      upload.chunks.length !== upload.chunkCount ||
      new Set(upload.chunks.map((chunk) => chunk.index)).size !== upload.chunkCount ||
      uploaded !== Number(upload.declaredSize)
    ) {
      throw new ApiError(
        ERROR_CODES.importUploadIncomplete,
        'The workbook upload is incomplete. Retry the missing chunks.',
        {
          details: {
            expectedChunks: upload.chunkCount,
            uploadedChunks: upload.chunks.length,
            expectedBytes: Number(upload.declaredSize),
            uploadedBytes: uploaded,
          },
        },
      );
    }

    const queued = await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.productImportUpload.updateMany({
        where: {
          id: upload.id,
          actorId: actor.id,
          status: 'UPLOADING',
          expiresAt: { gt: new Date() },
        },
        data: { status: 'QUEUED', completedAt: new Date(), errorCode: null },
      });
      if (updated.count !== 1) return null;
      await transaction.outboxEvent.create({
        data: {
          eventType: 'product-import-validate',
          payload: { uploadId: upload.id } as Prisma.InputJsonValue,
          status: 'QUEUED',
          idempotencyKey: `product-import-validate:${upload.id}`,
        },
      });
      await transaction.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'product_import.upload_completed',
          entityType: 'product_import_upload',
          entityId: upload.id,
          requestId,
          metadata: {
            originalName: upload.originalName,
            sizeBytes: Number(upload.declaredSize),
            chunkCount: upload.chunkCount,
          },
        },
      });
      return true;
    });
    if (!queued) {
      const current = await this.ownedUpload(upload.id, actor.id, true);
      return this.toStatus(current);
    }
    const current = await this.ownedUpload(upload.id, actor.id, true);
    return this.toStatus(current);
  }

  async status(
    uploadId: string,
    actor: AuthenticatedActor,
  ): Promise<ProductImportUploadStatusResult> {
    let upload = await this.ownedUpload(uploadId, actor.id, true);
    if (
      upload.expiresAt.getTime() <= Date.now() &&
      !['VALIDATED', 'INVALID', 'CANCELLED', 'EXPIRED'].includes(upload.status)
    ) {
      await this.prisma.productImportUpload.updateMany({
        where: { id: upload.id, status: { in: [...ACTIVE_UPLOAD_STATUSES] } },
        data: { status: 'EXPIRED', errorCode: ERROR_CODES.importUploadExpired },
      });
      upload = await this.ownedUpload(uploadId, actor.id, true);
    }
    return this.toStatus(upload);
  }

  async cancel(
    uploadId: string,
    actor: AuthenticatedActor,
    requestId: string,
  ): Promise<ProductImportUploadStatusResult> {
    const upload = await this.ownedUpload(uploadId, actor.id, true);
    if (['VALIDATED', 'INVALID', 'CANCELLED', 'EXPIRED'].includes(upload.status)) {
      return this.toStatus(upload);
    }
    if (!['UPLOADING', 'QUEUED', 'FAILED'].includes(upload.status)) {
      throw new ApiError(
        ERROR_CODES.importUploadStateInvalid,
        'The workbook is already being validated and cannot be cancelled.',
      );
    }
    await this.prisma.productImportUpload.update({
      where: { id: upload.id },
      data: { status: 'CANCELLED', errorCode: ERROR_CODES.importUploadCancelled },
    });
    await Promise.allSettled(
      upload.chunks.map((chunk) =>
        this.storage.delete(productImportChunkKey(upload.id, chunk.index)),
      ),
    );
    await this.audit.record({
      actorId: actor.id,
      action: 'product_import.upload_cancelled',
      entityType: 'product_import_upload',
      entityId: upload.id,
      requestId,
    });
    return this.status(upload.id, actor);
  }

  private async ownedUpload(uploadId: string, actorId: string, withChunks = false) {
    const upload = await this.prisma.productImportUpload.findUnique({
      where: { id: uploadId },
      include: { chunks: withChunks ? { orderBy: { index: 'asc' } } : false },
    });
    if (!upload || upload.actorId !== actorId) {
      throw new ApiError(ERROR_CODES.importUploadNotFound, 'The import upload was not found.');
    }
    return upload;
  }

  private assertNotExpired(status: string, expiresAt: Date): void {
    if (expiresAt.getTime() <= Date.now() && !['VALIDATED', 'INVALID'].includes(status)) {
      throw new ApiError(ERROR_CODES.importUploadExpired, 'The import upload has expired.');
    }
  }

  private async toStatus(upload: {
    id: string;
    status: string;
    originalName: string;
    declaredSize: bigint;
    chunkCount: number;
    chunks: { sizeBytes: bigint }[];
    settings: Prisma.JsonValue;
    summary: Prisma.JsonValue | null;
    errors: Prisma.JsonValue | null;
    warnings: Prisma.JsonValue | null;
    validationId: string | null;
    errorCode: string | null;
    expiresAt: Date;
  }): Promise<ProductImportUploadStatusResult> {
    const settings = upload.settings as unknown as ProductImportSettings;
    const summary = isSummary(upload.summary) ? upload.summary : null;
    const errors = isIssues(upload.errors) ? upload.errors : [];
    const warnings = isIssues(upload.warnings) ? upload.warnings : [];
    const validationExpiresAt =
      upload.status === 'VALIDATED' && upload.validationId
        ? ((
            await this.prisma.productImportValidation.findUnique({
              where: { id: upload.validationId },
              select: { expiresAt: true },
            })
          )?.expiresAt ?? null)
        : null;
    const validation: ProductImportValidationResult | null =
      summary && ['VALIDATED', 'INVALID'].includes(upload.status)
        ? {
            validationId: upload.status === 'VALIDATED' ? upload.validationId : null,
            templateVersion: settings.templateVersion,
            summary,
            errors,
            warnings,
            expiresAt:
              upload.status === 'VALIDATED'
                ? (validationExpiresAt ?? upload.expiresAt).toISOString()
                : null,
          }
        : null;
    return {
      uploadId: upload.id,
      status: upload.status as ProductImportUploadStatus,
      originalName: upload.originalName,
      sizeBytes: Number(upload.declaredSize),
      chunkCount: upload.chunkCount,
      uploadedChunks: upload.chunks.length,
      uploadedBytes: upload.chunks.reduce((sum, chunk) => sum + Number(chunk.sizeBytes), 0),
      expiresAt: upload.expiresAt.toISOString(),
      errorCode: upload.errorCode,
      validation,
    };
  }
}

function isSummary(value: unknown): value is ProductImportSummary {
  return (
    typeof value === 'object' && value !== null && !Array.isArray(value) && 'totalRows' in value
  );
}

function isIssues(value: unknown): value is ProductImportIssue[] {
  return Array.isArray(value);
}
