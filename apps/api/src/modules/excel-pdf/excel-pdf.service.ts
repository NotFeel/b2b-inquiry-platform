import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  DEFAULT_EXCEL_PDF_OPTIONS,
  ERROR_CODES,
  EXCEL_PDF_BUSINESS_TYPES,
  EXCEL_PDF_LIMITS,
  buildPaginationMeta,
  effectiveExcelPdfJobStatus,
  excelPdfChunkKey,
  excelPdfInputKey,
  type ExcelPdfConfig,
  type ExcelPdfConvertJobPayload,
  type ExcelPdfJobListResult,
  type ExcelPdfJobSummary,
  type ExcelPdfUploadInitResult,
  type ExcelPdfUploadStatus,
} from '@b2b/contracts';
import type { ExcelPdfJobListQueryInput, ExcelPdfUploadInitInput } from '@b2b/validation';
import { Prisma } from '@b2b/database';
import { APP_ENV, type AppEnv } from '../../config/config.module';
import { ApiError } from '../../common/errors/api-error';
import type { AuthenticatedActor } from '../../common/request-context';
import { AuditService } from '../../common/services/audit.service';
import { StorageService } from '../../common/services/storage.service';
import { PrismaService } from '../../prisma/prisma.service';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const ACTIVE_UPLOAD_STATUSES = ['UPLOADING', 'QUEUED', 'CONVERTING'] as const;

interface UploadInitRow {
  id: string;
  chunkSize: number;
  chunkCount: number;
  expiresAt: Date;
}

@Injectable()
export class ExcelPdfService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  config(): ExcelPdfConfig {
    return {
      enabled: this.env.EXCEL_PDF_ENABLED,
      maxUploadBytes: this.env.EXCEL_PDF_MAX_UPLOAD_BYTES,
      chunkBytes: this.env.EXCEL_PDF_CHUNK_BYTES,
      maxOutputBytes: this.env.EXCEL_PDF_MAX_OUTPUT_BYTES,
      maxPages: this.env.EXCEL_PDF_MAX_PAGES,
      retentionDays: this.env.EXCEL_PDF_RETENTION_DAYS,
      businessTypes: EXCEL_PDF_BUSINESS_TYPES,
    };
  }

  async initializeUpload(
    input: ExcelPdfUploadInitInput,
    idempotencyKey: string,
    actor: AuthenticatedActor,
    requestId: string,
  ): Promise<ExcelPdfUploadInitResult> {
    this.assertEnabled();
    const existing = await this.prisma.excelPdfUpload.findUnique({
      where: { idempotencyKey },
    });
    if (existing) {
      this.assertOwnedUpload(existing.actorId, actor);
      if (
        existing.originalName !== input.originalName ||
        Number(existing.declaredSize) !== input.sizeBytes ||
        existing.businessType !== input.businessType
      ) {
        throw new ApiError(
          ERROR_CODES.conflict,
          'The idempotency key was already used for a different workbook.',
        );
      }
      return this.initResult(existing);
    }

    if (input.sizeBytes > this.env.EXCEL_PDF_MAX_UPLOAD_BYTES) {
      throw new ApiError(ERROR_CODES.uploadTooLarge, 'The workbook exceeds the configured limit.');
    }
    const chunkSize = this.env.EXCEL_PDF_CHUNK_BYTES;
    const chunkCount = Math.ceil(input.sizeBytes / chunkSize);
    const expiresAt = new Date(Date.now() + EXCEL_PDF_LIMITS.uploadTtlSeconds * 1000);
    let upload: UploadInitRow;
    try {
      upload = await this.prisma.excelPdfUpload.create({
        data: {
          actorId: actor.id,
          idempotencyKey,
          originalName: input.originalName,
          declaredSize: BigInt(input.sizeBytes),
          chunkSize,
          chunkCount,
          businessType: input.businessType,
          options: (input.options ?? DEFAULT_EXCEL_PDF_OPTIONS) as unknown as Prisma.InputJsonValue,
          expiresAt,
        },
        select: {
          id: true,
          chunkSize: true,
          chunkCount: true,
          expiresAt: true,
        },
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
        throw error;
      }
      const concurrent = await this.prisma.excelPdfUpload.findUnique({
        where: { idempotencyKey },
      });
      if (!concurrent) throw error;
      this.assertOwnedUpload(concurrent.actorId, actor);
      if (
        concurrent.originalName !== input.originalName ||
        Number(concurrent.declaredSize) !== input.sizeBytes ||
        concurrent.businessType !== input.businessType
      ) {
        throw new ApiError(
          ERROR_CODES.conflict,
          'The idempotency key was already used for a different workbook.',
        );
      }
      return this.initResult(concurrent);
    }
    await this.audit.record({
      actorId: actor.id,
      action: 'excel_pdf.upload_started',
      entityType: 'excel_pdf_upload',
      entityId: upload.id,
      requestId,
      metadata: {
        sizeBytes: input.sizeBytes,
        chunkCount,
        businessType: input.businessType,
      },
    });
    return this.initResult(upload);
  }

  async uploadChunk(
    uploadId: string,
    index: number,
    buffer: Buffer,
    actor: AuthenticatedActor,
  ): Promise<{ uploadId: string; index: number; uploadedBytes: number }> {
    this.assertEnabled();
    const upload = await this.ownedUpload(uploadId, actor);
    this.assertUploadUsable(upload.status, upload.expiresAt);
    if (upload.status !== 'UPLOADING') {
      throw new ApiError(
        ERROR_CODES.excelPdfUploadStateInvalid,
        'This upload is no longer accepting chunks.',
      );
    }
    if (!Number.isInteger(index) || index < 0 || index >= upload.chunkCount) {
      throw new ApiError(ERROR_CODES.excelPdfUploadChunkInvalid, 'The chunk index is invalid.');
    }
    const declaredSize = Number(upload.declaredSize);
    const expectedSize =
      index === upload.chunkCount - 1
        ? declaredSize - upload.chunkSize * (upload.chunkCount - 1)
        : upload.chunkSize;
    if (buffer.byteLength !== expectedSize) {
      throw new ApiError(ERROR_CODES.excelPdfUploadChunkInvalid, 'The chunk size is invalid.', {
        details: { index, expectedSize, receivedSize: buffer.byteLength },
      });
    }

    const storageKey = excelPdfChunkKey(upload.id, index);
    const sha256 = createHash('sha256').update(buffer).digest('hex');
    await this.storage.put(storageKey, buffer, 'application/octet-stream');
    try {
      await this.prisma.excelPdfUploadChunk.upsert({
        where: { uploadId_index: { uploadId: upload.id, index } },
        create: { uploadId: upload.id, index, sizeBytes: BigInt(buffer.byteLength), sha256 },
        update: { sizeBytes: BigInt(buffer.byteLength), sha256 },
      });
    } catch (error) {
      // Do not delete a previously committed object when an overwrite update
      // fails. Remove the object only when the database confirms that this
      // chunk has no durable metadata; otherwise cleanup can safely reconcile it.
      const persisted = await this.prisma.excelPdfUploadChunk
        .findUnique({ where: { uploadId_index: { uploadId: upload.id, index } } })
        .catch(() => null);
      if (!persisted) await this.storage.delete(storageKey).catch(() => undefined);
      throw error;
    }
    return { uploadId: upload.id, index, uploadedBytes: buffer.byteLength };
  }

  async completeUpload(
    uploadId: string,
    actor: AuthenticatedActor,
    requestId: string,
  ): Promise<ExcelPdfUploadStatus> {
    this.assertEnabled();
    const upload = await this.ownedUpload(uploadId, actor, true);
    this.assertUploadUsable(upload.status, upload.expiresAt);
    if (upload.jobId) return this.uploadStatus(uploadId, actor);
    if (upload.status !== 'UPLOADING') {
      throw new ApiError(
        ERROR_CODES.excelPdfUploadStateInvalid,
        'This upload cannot be completed in its current state.',
      );
    }
    this.assertCompleteChunkSet(upload);

    // Check only the first 8 MiB before creating durable work. Full ZIP/OOXML
    // validation runs in the isolated Worker after all chunks have merged.
    const firstChunk = await this.storage.get(excelPdfChunkKey(upload.id, 0));
    if (!firstChunk.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
      throw new ApiError(
        ERROR_CODES.excelPdfFileInvalid,
        'The uploaded file is not a valid XLSX ZIP package.',
      );
    }

    const inputAssetId = randomUUID();
    const jobId = randomUUID();
    const attemptId = randomUUID();
    const inputKey = excelPdfInputKey(inputAssetId);
    const expiresAt = new Date(
      Date.now() + this.env.EXCEL_PDF_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    );
    const payload: ExcelPdfConvertJobPayload = { jobId, attemptId };

    await this.prisma.$transaction(
      async (transaction) => {
        const claimed = await transaction.excelPdfUpload.updateMany({
          where: { id: upload.id, actorId: actor.id, status: 'UPLOADING', jobId: null },
          data: { status: 'QUEUED', jobId },
        });
        if (claimed.count !== 1) {
          throw new ApiError(
            ERROR_CODES.excelPdfUploadStateInvalid,
            'This upload was completed by another request.',
          );
        }
        await transaction.fileAsset.create({
          data: {
            id: inputAssetId,
            storageKey: inputKey,
            originalName: upload.originalName,
            mimeType: XLSX_MIME,
            sizeBytes: upload.declaredSize,
            purpose: 'excel-pdf-input',
            status: 'processing',
            isPublic: false,
            uploadedById: actor.id,
          },
        });
        await transaction.pdfConversionJob.create({
          data: {
            id: jobId,
            uploadId: upload.id,
            sourceAssetId: inputAssetId,
            sourceFileName: upload.originalName,
            businessType: upload.businessType,
            options: upload.options as Prisma.InputJsonValue,
            status: 'QUEUED',
            attemptId,
            inputSizeBytes: upload.declaredSize,
            expiresAt,
            requestedById: actor.id,
          },
        });
        await transaction.outboxEvent.create({
          data: {
            eventType: 'excel-pdf-convert',
            payload: payload as unknown as Prisma.InputJsonValue,
            idempotencyKey: `excel-pdf-convert:${jobId}:${attemptId}`,
          },
        });
      },
      { maxWait: 10_000, timeout: 30_000 },
    );
    await this.audit.record({
      actorId: actor.id,
      action: 'excel_pdf.convert_requested',
      entityType: 'pdf_conversion_job',
      entityId: jobId,
      requestId,
      metadata: { fileSize: Number(upload.declaredSize), businessType: upload.businessType },
    });
    return this.uploadStatus(uploadId, actor);
  }

  async uploadStatus(uploadId: string, actor: AuthenticatedActor): Promise<ExcelPdfUploadStatus> {
    this.assertEnabled();
    const upload = await this.ownedUpload(uploadId, actor, true);
    const expired =
      upload.expiresAt.getTime() <= Date.now() &&
      (ACTIVE_UPLOAD_STATUSES as readonly string[]).includes(upload.status);
    if (expired) {
      await this.prisma.excelPdfUpload.updateMany({
        where: { id: upload.id, status: { in: [...ACTIVE_UPLOAD_STATUSES] } },
        data: { status: 'EXPIRED', errorCode: ERROR_CODES.excelPdfUploadExpired },
      });
    }
    return {
      uploadId: upload.id,
      status: (expired ? 'EXPIRED' : upload.status) as ExcelPdfUploadStatus['status'],
      originalName: upload.originalName,
      sizeBytes: Number(upload.declaredSize),
      chunkCount: upload.chunkCount,
      uploadedChunks: upload.chunks.length,
      uploadedBytes: upload.chunks.reduce((sum, chunk) => sum + Number(chunk.sizeBytes), 0),
      expiresAt: upload.expiresAt.toISOString(),
      errorCode: expired ? ERROR_CODES.excelPdfUploadExpired : upload.errorCode,
      jobId: upload.jobId,
    };
  }

  async cancelUpload(
    uploadId: string,
    actor: AuthenticatedActor,
    requestId: string,
  ): Promise<ExcelPdfUploadStatus> {
    this.assertEnabled();
    const upload = await this.ownedUpload(uploadId, actor, true);
    if (upload.jobId) {
      throw new ApiError(
        ERROR_CODES.excelPdfUploadStateInvalid,
        'A completed upload cannot be cancelled; delete its conversion job instead.',
      );
    }
    const cancelled = await this.prisma.excelPdfUpload.updateMany({
      where: { id: upload.id, actorId: actor.id, status: 'UPLOADING', jobId: null },
      data: { status: 'CANCELLED', errorCode: ERROR_CODES.excelPdfUploadStateInvalid },
    });
    if (cancelled.count !== 1) {
      throw new ApiError(
        ERROR_CODES.excelPdfUploadStateInvalid,
        'The upload state changed and can no longer be cancelled.',
      );
    }
    await this.queueChunkDeletes(upload.id, upload.chunks, actor.id);
    await this.audit.record({
      actorId: actor.id,
      action: 'excel_pdf.upload_cancelled',
      entityType: 'excel_pdf_upload',
      entityId: upload.id,
      requestId,
    });
    return this.uploadStatus(upload.id, actor);
  }

  async listJobs(
    query: ExcelPdfJobListQueryInput,
    actor: AuthenticatedActor,
  ): Promise<ExcelPdfJobListResult> {
    this.assertEnabled('read');
    const now = new Date();
    const where: Prisma.PdfConversionJobWhereInput = {
      requestedById: actor.id,
      ...(query.businessType === 'all' ? {} : { businessType: query.businessType }),
      ...(query.status === 'all'
        ? {}
        : query.status === 'queued'
          ? { status: 'QUEUED', OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }
          : query.status === 'processing'
            ? { status: 'PROCESSING', OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }
            : query.status === 'succeeded'
              ? { status: 'SUCCEEDED', OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }
              : query.status === 'failed'
                ? { status: 'FAILED', OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }
                : query.status === 'cancelled'
                  ? { status: { in: ['CANCELLED', 'CANCEL_REQUESTED'] } }
                  : { expiresAt: { lte: now }, status: { not: 'CANCELLED' } }),
    };
    const [rows, total] = await Promise.all([
      this.prisma.pdfConversionJob.findMany({
        where,
        include: { requestedBy: { select: { displayName: true, username: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.pdfConversionJob.count({ where }),
    ]);
    return {
      data: rows.map((row) => this.toSummary(row)),
      pagination: buildPaginationMeta(query.page, query.pageSize, total),
    };
  }

  async getJob(jobId: string, actor: AuthenticatedActor): Promise<ExcelPdfJobSummary> {
    this.assertEnabled('read');
    const job = await this.ownedJob(jobId, actor);
    return this.toSummary(job);
  }

  async getDownload(
    jobId: string,
    actor: AuthenticatedActor,
    mode: 'attachment' | 'inline',
    requestId: string,
  ): Promise<{
    storageKey: string;
    sizeBytes: number;
    filename: string;
    mode: 'attachment' | 'inline';
  }> {
    this.assertEnabled('download');
    const job = await this.ownedJob(jobId, actor);
    const status = effectiveExcelPdfJobStatus(job);
    if (status !== 'succeeded' || job.purgeState !== 'NONE' || !job.outputAsset || !job.outputKey) {
      throw new ApiError(
        ERROR_CODES.excelPdfJobNotDownloadable,
        'The converted PDF is not available for download.',
      );
    }
    if (job.outputAsset.status !== 'ready') {
      throw new ApiError(ERROR_CODES.excelPdfOutputInvalid, 'The PDF file is not ready.');
    }
    const stat = await this.storage.stat(job.outputKey);
    if (!stat || stat.sizeBytes !== Number(job.outputSizeBytes ?? 0)) {
      throw new ApiError(ERROR_CODES.excelPdfOutputInvalid, 'The PDF file could not be verified.');
    }
    await this.audit.record({
      actorId: actor.id,
      action: 'EXCEL_PDF_DOWNLOAD',
      entityType: 'pdf_conversion_job',
      entityId: job.id,
      requestId,
      metadata: { mode, outputSizeBytes: stat.sizeBytes },
    });
    const base = job.sourceFileName.replace(/\.xlsx$/i, '').replace(/[^\p{L}\p{N}._-]+/gu, '_');
    return {
      storageKey: job.outputKey,
      sizeBytes: stat.sizeBytes,
      filename: `${base || 'excel-conversion'}.pdf`,
      mode,
    };
  }

  async retry(
    jobId: string,
    actor: AuthenticatedActor,
    requestId: string,
  ): Promise<ExcelPdfJobSummary> {
    this.assertEnabled('retry');
    const job = await this.ownedJob(jobId, actor);
    if (job.status !== 'FAILED' || !job.sourceAsset || job.sourceAsset.status !== 'ready') {
      throw new ApiError(
        ERROR_CODES.excelPdfJobNotRetryable,
        'Only a failed conversion with a verified input can be retried.',
      );
    }
    if (job.expiresAt && job.expiresAt.getTime() <= Date.now()) {
      throw new ApiError(
        ERROR_CODES.excelPdfJobNotRetryable,
        'The conversion retention period has expired.',
      );
    }
    const attemptId = randomUUID();
    const payload: ExcelPdfConvertJobPayload = { jobId: job.id, attemptId };
    await this.prisma.$transaction(async (transaction) => {
      const changed = await transaction.pdfConversionJob.updateMany({
        where: { id: job.id, requestedById: actor.id, status: 'FAILED' },
        data: {
          status: 'QUEUED',
          attempts: 0,
          attemptId,
          errorCode: null,
          errorMessageKey: null,
          outputAssetId: null,
          outputKey: null,
          outputSizeBytes: null,
          outputSha256: null,
          pageCount: null,
          startedAt: null,
          completedAt: null,
        },
      });
      if (changed.count !== 1) {
        throw new ApiError(ERROR_CODES.conflict, 'The conversion state changed; reload and retry.');
      }
      if (job.uploadId) {
        const uploadChanged = await transaction.excelPdfUpload.updateMany({
          where: { id: job.uploadId, jobId: job.id, status: 'FAILED' },
          data: { status: 'QUEUED', errorCode: null },
        });
        if (uploadChanged.count !== 1) {
          throw new ApiError(ERROR_CODES.conflict, 'The upload state changed; reload and retry.');
        }
      }
      await transaction.outboxEvent.create({
        data: {
          eventType: 'excel-pdf-convert',
          payload: payload as unknown as Prisma.InputJsonValue,
          idempotencyKey: `excel-pdf-convert:${job.id}:${attemptId}`,
        },
      });
    });
    await this.audit.record({
      actorId: actor.id,
      action: 'excel_pdf.retry_requested',
      entityType: 'pdf_conversion_job',
      entityId: job.id,
      requestId,
    });
    return this.getJob(job.id, actor);
  }

  async deleteJob(
    jobId: string,
    actor: AuthenticatedActor,
    requestId: string,
  ): Promise<{ id: string; status: 'deletion_pending' | 'deleted' }> {
    this.assertEnabled('delete');
    const job = await this.ownedJob(jobId, actor);
    if (job.status === 'PROCESSING') {
      throw new ApiError(
        ERROR_CODES.excelPdfUploadStateInvalid,
        'A conversion that is processing cannot be deleted yet.',
      );
    }
    const keys = [job.sourceAsset?.storageKey, job.outputAsset?.storageKey].filter(
      (key): key is string => Boolean(key),
    );
    const uploadChunks = job.uploadId
      ? await this.prisma.excelPdfUploadChunk.findMany({ where: { uploadId: job.uploadId } })
      : [];
    await this.prisma.$transaction(async (transaction) => {
      const cancelled = await transaction.pdfConversionJob.updateMany({
        where: { id: job.id, requestedById: actor.id, status: { not: 'PROCESSING' } },
        data: {
          status: 'CANCELLED',
          purgeState: keys.length > 0 || uploadChunks.length > 0 ? 'PENDING' : 'PURGED',
          purgeRequestedAt: new Date(),
        },
      });
      if (cancelled.count !== 1) {
        throw new ApiError(
          ERROR_CODES.excelPdfUploadStateInvalid,
          'The conversion state changed and cannot be deleted safely.',
        );
      }
      if (job.uploadId) {
        await transaction.excelPdfUpload.updateMany({
          where: { id: job.uploadId },
          data: { status: 'CANCELLED' },
        });
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
            requestedBy: actor.id,
            idempotencyKey: `excel-pdf-asset:${asset.id}`,
          },
          update: {},
        });
      }
      for (const chunk of uploadChunks) {
        const key = excelPdfChunkKey(job.uploadId!, chunk.index);
        await transaction.fileDeletionJob.upsert({
          where: { idempotencyKey: `excel-pdf-chunk:${job.uploadId}:${chunk.index}` },
          create: {
            storageKey: key,
            entityType: 'excel_pdf_chunk',
            entityId: `${job.uploadId}:${chunk.index}`,
            requestedBy: actor.id,
            idempotencyKey: `excel-pdf-chunk:${job.uploadId}:${chunk.index}`,
          },
          update: {},
        });
      }
    });
    await this.audit.record({
      actorId: actor.id,
      action: 'excel_pdf.delete_requested',
      entityType: 'pdf_conversion_job',
      entityId: job.id,
      requestId,
    });
    return { id: job.id, status: 'deletion_pending' };
  }

  private assertEnabled(
    action: 'read' | 'download' | 'retry' | 'delete' | 'create' = 'create',
  ): void {
    if (!this.env.EXCEL_PDF_ENABLED) {
      throw new ApiError(
        ERROR_CODES.excelPdfDisabled,
        `Excel-to-PDF ${action} is disabled on this deployment.`,
      );
    }
  }

  private assertOwnedUpload(ownerId: string, actor: AuthenticatedActor): void {
    if (ownerId !== actor.id) {
      throw new ApiError(
        ERROR_CODES.excelPdfUploadNotFound,
        'The Excel-to-PDF upload was not found.',
      );
    }
  }

  private async ownedUpload(uploadId: string, actor: AuthenticatedActor, withChunks = false) {
    const upload = await this.prisma.excelPdfUpload.findUnique({
      where: { id: uploadId },
      include: { chunks: withChunks ? { orderBy: { index: 'asc' } } : false },
    });
    if (!upload || upload.actorId !== actor.id) {
      throw new ApiError(
        ERROR_CODES.excelPdfUploadNotFound,
        'The Excel-to-PDF upload was not found.',
      );
    }
    return upload;
  }

  private async ownedJob(jobId: string, actor: AuthenticatedActor) {
    const job = await this.prisma.pdfConversionJob.findFirst({
      where: { id: jobId, requestedById: actor.id },
      include: {
        sourceAsset: true,
        outputAsset: true,
        requestedBy: { select: { displayName: true, username: true } },
      },
    });
    if (!job) {
      throw new ApiError(ERROR_CODES.excelPdfJobNotFound, 'The conversion job was not found.');
    }
    return job;
  }

  private assertUploadUsable(status: string, expiresAt: Date): void {
    if (
      expiresAt.getTime() <= Date.now() &&
      (ACTIVE_UPLOAD_STATUSES as readonly string[]).includes(status)
    ) {
      throw new ApiError(ERROR_CODES.excelPdfUploadExpired, 'The upload session has expired.');
    }
    if (['EXPIRED', 'CANCELLED', 'FAILED'].includes(status)) {
      throw new ApiError(
        ERROR_CODES.excelPdfUploadStateInvalid,
        'The upload session is no longer active.',
      );
    }
  }

  private assertCompleteChunkSet(upload: {
    chunkCount: number;
    chunkSize: number;
    declaredSize: bigint;
    chunks: { index: number; sizeBytes: bigint; sha256: string }[];
  }): void {
    if (upload.chunks.length !== upload.chunkCount) {
      throw new ApiError(
        ERROR_CODES.excelPdfUploadIncomplete,
        'One or more upload chunks are missing.',
      );
    }
    let total = 0;
    for (let index = 0; index < upload.chunkCount; index += 1) {
      const chunk = upload.chunks[index];
      if (!chunk || chunk.index !== index || !/^[a-f0-9]{64}$/i.test(chunk.sha256)) {
        throw new ApiError(
          ERROR_CODES.excelPdfUploadIncomplete,
          'One or more upload chunks are invalid.',
        );
      }
      const expected =
        index === upload.chunkCount - 1
          ? Number(upload.declaredSize) - upload.chunkSize * (upload.chunkCount - 1)
          : upload.chunkSize;
      if (Number(chunk.sizeBytes) !== expected) {
        throw new ApiError(ERROR_CODES.excelPdfUploadChunkInvalid, 'A chunk has an invalid size.');
      }
      total += Number(chunk.sizeBytes);
    }
    if (total !== Number(upload.declaredSize)) {
      throw new ApiError(
        ERROR_CODES.excelPdfUploadIncomplete,
        'The uploaded byte count is incomplete.',
      );
    }
  }

  private async queueChunkDeletes(
    uploadId: string,
    chunks: { index: number }[],
    requestedBy: string,
  ): Promise<void> {
    for (const chunk of chunks) {
      await this.prisma.fileDeletionJob.upsert({
        where: { idempotencyKey: `excel-pdf-chunk:${uploadId}:${chunk.index}` },
        create: {
          storageKey: excelPdfChunkKey(uploadId, chunk.index),
          entityType: 'excel_pdf_chunk',
          entityId: `${uploadId}:${chunk.index}`,
          requestedBy,
          idempotencyKey: `excel-pdf-chunk:${uploadId}:${chunk.index}`,
        },
        update: {},
      });
    }
  }

  private initResult(upload: {
    id: string;
    chunkSize: number;
    chunkCount: number;
    expiresAt: Date;
  }): ExcelPdfUploadInitResult {
    return {
      uploadId: upload.id,
      chunkSize: upload.chunkSize,
      chunkCount: upload.chunkCount,
      expiresAt: upload.expiresAt.toISOString(),
    };
  }

  private toSummary(job: {
    id: string;
    sourceFileName: string;
    businessType: string;
    inputSizeBytes: bigint | null;
    status: 'QUEUED' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED' | 'CANCEL_REQUESTED' | 'CANCELLED';
    pageCount: number | null;
    outputSizeBytes: bigint | null;
    errorCode: string | null;
    createdAt: Date;
    startedAt: Date | null;
    completedAt: Date | null;
    expiresAt: Date | null;
    purgeState: 'NONE' | 'PENDING' | 'PURGED' | 'FAILED';
    requestedBy?: { displayName: string; username: string } | null;
  }): ExcelPdfJobSummary {
    const status = effectiveExcelPdfJobStatus(job);
    return {
      id: job.id,
      fileName: job.sourceFileName,
      businessType: (EXCEL_PDF_BUSINESS_TYPES as readonly string[]).includes(job.businessType)
        ? (job.businessType as ExcelPdfJobSummary['businessType'])
        : 'other',
      fileSize: Number(job.inputSizeBytes ?? 0),
      status,
      pageCount: job.pageCount,
      outputSize: job.outputSizeBytes === null ? null : Number(job.outputSizeBytes),
      errorCode: job.errorCode,
      createdAt: job.createdAt.toISOString(),
      startedAt: job.startedAt?.toISOString() ?? null,
      completedAt: job.completedAt?.toISOString() ?? null,
      expiresAt: job.expiresAt?.toISOString() ?? null,
      createdBy: job.requestedBy?.displayName ?? job.requestedBy?.username ?? null,
      canDownload: status === 'succeeded' && job.purgeState === 'NONE',
    };
  }
}
