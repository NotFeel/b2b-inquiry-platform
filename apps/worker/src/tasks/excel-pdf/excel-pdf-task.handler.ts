import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream, promises as fs } from 'node:fs';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  ERROR_CODES,
  excelPdfChunkKey,
  excelPdfOutputKey,
  type ExcelPdfConvertJobPayload,
} from '@b2b/contracts';
import type { Prisma, PrismaClient } from '@b2b/database';
import type { WorkerEnv } from '../../env';
import type { WorkerLogger } from '../../logger';
import type { ObjectStorage } from '../../storage';
import { ExcelPdfProcessingError } from './excel-pdf-errors';
import { convertWorkbookWithLibreOffice } from './libreoffice.runner';
import { validatePdfOutput } from './pdf-output-validator';
import { createExcelPdfTempWorkspace } from './temp-workspace';
import { validateXlsxArchive } from './xlsx-zip-validator';

interface Dependencies {
  prisma: PrismaClient;
  storage: ObjectStorage;
  env: WorkerEnv;
  logger: WorkerLogger;
}

export interface ChunkRow {
  index: number;
  sizeBytes: bigint;
  sha256: string;
}

type WorkerConvertPayload = ExcelPdfConvertJobPayload & { leaseWakeup?: true };

interface OutputDeletionCompensation {
  outputAssetId: string;
  storageKey: string;
  requestedBy: string | null;
}

interface FailJobResult {
  failed: boolean;
  outputDeletionQueued: boolean;
}

export function excelPdfConversionClaimWhere(
  jobId: string,
  attemptId: string,
  now: Date,
): Prisma.PdfConversionJobWhereInput {
  return {
    id: jobId,
    attemptId,
    OR: [
      { status: { in: ['QUEUED', 'FAILED'] } },
      {
        status: 'PROCESSING',
        OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }],
      },
    ],
  };
}

export async function processExcelPdfConversion(
  payload: WorkerConvertPayload,
  deps: Dependencies,
): Promise<void> {
  const workerPayload = payload;
  const { prisma, logger } = deps;
  const job = await prisma.pdfConversionJob.findUnique({
    where: { id: payload.jobId },
    include: { sourceAsset: true, outputAsset: true },
  });
  if (!job || job.attemptId !== payload.attemptId) {
    logger.warn('excel_pdf.attempt_superseded', {
      jobId: payload.jobId,
      attemptId: payload.attemptId,
    });
    return;
  }
  // A lease wake-up only resumes a still-active processing attempt. If the
  // original owner finished or failed before the wake-up became claimable, the
  // normal state machine decision is final and must not turn into a hidden retry.
  if (workerPayload.leaseWakeup && job.status !== 'PROCESSING') return;
  if (
    job.status === 'SUCCEEDED' ||
    job.status === 'CANCELLED' ||
    job.status === 'CANCEL_REQUESTED' ||
    job.purgeState !== 'NONE'
  ) {
    return;
  }
  const leaseOwner = randomUUID();
  const claim = await prisma.$transaction(async (transaction) => {
    const now = new Date();
    const jobUpdate = await transaction.pdfConversionJob.updateMany({
      where: {
        ...excelPdfConversionClaimWhere(job.id, payload.attemptId, now),
        purgeState: 'NONE',
      },
      data: {
        status: 'PROCESSING',
        startedAt: job.startedAt ?? now,
        leaseOwner,
        leaseUntil: new Date(now.getTime() + conversionLeaseMs(deps)),
        errorCode: null,
        errorMessageKey: null,
      },
    });
    if (jobUpdate.count !== 1) {
      const current = await transaction.pdfConversionJob.findUnique({
        where: { id: job.id },
        select: { status: true, attemptId: true, leaseUntil: true },
      });
      return { claimed: false as const, current };
    }
    if (!job.uploadId) return { claimed: true as const };
    const uploadUpdate = await transaction.excelPdfUpload.updateMany({
      where: {
        id: job.uploadId,
        status: { in: ['QUEUED', 'CONVERTING', 'FAILED'] },
      },
      data: { status: 'CONVERTING', errorCode: null },
    });
    if (uploadUpdate.count !== 1) {
      await transaction.pdfConversionJob.updateMany({
        where: {
          id: job.id,
          attemptId: payload.attemptId,
          leaseOwner,
          status: 'PROCESSING',
        },
        data: {
          status: 'FAILED',
          errorCode: ERROR_CODES.excelPdfUploadStateInvalid,
          completedAt: new Date(),
          leaseOwner: null,
          leaseUntil: null,
        },
      });
      return { claimed: false as const, current: null };
    }
    return { claimed: true as const };
  });
  if (!claim.claimed) {
    const activeLease =
      claim.current?.status === 'PROCESSING' &&
      claim.current.attemptId === payload.attemptId &&
      claim.current.leaseUntil &&
      claim.current.leaseUntil.getTime() > Date.now()
        ? claim.current.leaseUntil
        : null;
    if (activeLease) {
      await scheduleConversionLeaseWakeup(job.id, payload.attemptId, activeLease, deps);
    }
    logger.warn('excel_pdf.lease_not_acquired', {
      jobId: payload.jobId,
      attemptId: payload.attemptId,
      wakeupScheduled: Boolean(activeLease),
    });
    return;
  }
  if (!job.uploadId) {
    await failJob(job.id, payload.attemptId, leaseOwner, ERROR_CODES.excelPdfFileInvalid, deps);
    return;
  }

  const upload = await prisma.excelPdfUpload.findUnique({
    where: { id: job.uploadId },
    include: { chunks: { orderBy: { index: 'asc' } } },
  });
  if (!upload) {
    await failJob(job.id, payload.attemptId, leaseOwner, ERROR_CODES.excelPdfUploadNotFound, deps);
    return;
  }
  if (upload.expiresAt.getTime() <= Date.now()) {
    await failJob(job.id, payload.attemptId, leaseOwner, ERROR_CODES.excelPdfUploadExpired, deps);
    return;
  }

  const workspace = await createExcelPdfTempWorkspace(deps.env.WORKER_TMP_DIR);
  let outputStorageKey: string | null = null;
  let outputAssetId: string | null = null;
  try {
    assertExcelPdfChunkSet(upload.chunks, upload.chunkCount, Number(upload.declaredSize));
    const inputHash = await mergeExcelPdfChunks({
      chunks: upload.chunks,
      uploadId: upload.id,
      destination: workspace.inputPath,
      storage: deps.storage,
    });
    if (job.inputSha256 && job.inputSha256 !== inputHash) {
      throw new ExcelPdfProcessingError(
        ERROR_CODES.excelPdfFileInvalid,
        'The merged workbook hash does not match the saved checksum.',
      );
    }
    const archive = await validateXlsxArchive(workspace.inputPath);

    await putFileFromDisk(
      deps.storage,
      job.sourceAsset.storageKey,
      workspace.inputPath,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    await prisma.fileAsset.updateMany({
      where: { id: job.sourceAssetId, status: { in: ['processing', 'ready'] } },
      data: { status: 'ready', sha256: inputHash, sizeBytes: BigInt(upload.declaredSize) },
    });
    await prisma.pdfConversionJob.updateMany({
      where: {
        id: job.id,
        attemptId: payload.attemptId,
        leaseOwner,
        status: 'PROCESSING',
      },
      data: { inputSha256: inputHash, inputSizeBytes: upload.declaredSize },
    });

    const converted = await convertWorkbookWithLibreOffice({
      executable: deps.env.EXCEL_PDF_CONVERTER_PATH,
      inputPath: workspace.inputPath,
      outputDir: workspace.outputDir,
      profileDir: workspace.profileDir,
      timeoutMs: deps.env.EXCEL_PDF_TIMEOUT_MS,
    });
    const pdf = await validatePdfOutput({
      path: converted.outputPath,
      pdfInfoPath: deps.env.EXCEL_PDF_PDFINFO_PATH,
      maxBytes: deps.env.EXCEL_PDF_MAX_OUTPUT_BYTES,
      maxPages: deps.env.EXCEL_PDF_MAX_PAGES,
      timeoutMs: Math.min(deps.env.EXCEL_PDF_TIMEOUT_MS, 60_000),
    });
    const outputSha256 = await hashFile(converted.outputPath);
    const createdOutputAssetId = randomUUID();
    outputAssetId = createdOutputAssetId;
    outputStorageKey = excelPdfOutputKey(createdOutputAssetId);
    const savedOutputKey = outputStorageKey;
    await putFileFromDisk(deps.storage, savedOutputKey, converted.outputPath, 'application/pdf');

    await prisma.$transaction(async (transaction) => {
      await transaction.fileAsset.create({
        data: {
          id: createdOutputAssetId,
          storageKey: savedOutputKey,
          originalName: outputFileName(job.sourceFileName),
          mimeType: 'application/pdf',
          sizeBytes: BigInt(pdf.sizeBytes),
          sha256: outputSha256,
          purpose: 'excel-pdf-output',
          status: 'ready',
          isPublic: false,
          uploadedById: job.requestedById,
        },
      });
      const updated = await transaction.pdfConversionJob.updateMany({
        where: {
          id: job.id,
          attemptId: payload.attemptId,
          leaseOwner,
          status: 'PROCESSING',
          purgeState: 'NONE',
        },
        data: {
          status: 'SUCCEEDED',
          outputAssetId: createdOutputAssetId,
          outputKey: savedOutputKey,
          outputSizeBytes: BigInt(pdf.sizeBytes),
          outputSha256,
          pageCount: pdf.pageCount,
          errorCode: null,
          errorMessageKey: null,
          completedAt: new Date(),
          leaseOwner: null,
          leaseUntil: null,
        },
      });
      if (updated.count !== 1) {
        throw new ExcelPdfProcessingError(
          ERROR_CODES.excelPdfJobNotRetryable,
          'The conversion attempt was superseded before it could be saved.',
        );
      }
      const uploadUpdated = await transaction.excelPdfUpload.updateMany({
        where: { id: upload.id, status: 'CONVERTING', jobId: job.id },
        data: { status: 'SUCCEEDED', errorCode: null },
      });
      if (uploadUpdated.count !== 1) {
        throw new ExcelPdfProcessingError(
          ERROR_CODES.excelPdfJobNotRetryable,
          'The upload state changed before the conversion could be saved.',
        );
      }
      await queueChunkDeletions(transaction, upload.id, upload.chunks, job.requestedById);
      await transaction.auditLog.create({
        data: {
          actorId: job.requestedById,
          action: 'excel_pdf.conversion_succeeded',
          entityType: 'pdf_conversion_job',
          entityId: job.id,
          metadata: {
            inputSizeBytes: Number(upload.declaredSize),
            outputSizeBytes: pdf.sizeBytes,
            pageCount: pdf.pageCount,
            zipEntries: archive.entryCount,
          } as Prisma.InputJsonValue,
        },
      });
    });
    logger.info('excel_pdf.conversion_succeeded', {
      jobId: job.id,
      sizeBytes: Number(upload.declaredSize),
      outputSizeBytes: pdf.sizeBytes,
      pageCount: pdf.pageCount,
      durationMs: converted.durationMs,
    });
  } catch (error) {
    const processingError = normalizeProcessingError(error);
    const failure = await failJob(
      job.id,
      payload.attemptId,
      leaseOwner,
      processingError.code,
      deps,
      outputAssetId && outputStorageKey
        ? {
            outputAssetId,
            storageKey: outputStorageKey,
            requestedBy: job.requestedById,
          }
        : null,
    );
    if (failure.outputDeletionQueued) {
      await deps.storage.delete(outputStorageKey!).catch((cleanupError: unknown) => {
        logger.warn('excel_pdf.output_cleanup_failed', {
          jobId: job.id,
          retryQueued: true,
          errorCode: errorCodeOf(cleanupError),
        });
      });
    }
    if (processingError.retryable) throw processingError;
  } finally {
    await workspace.cleanup().catch((cleanupError: unknown) => {
      logger.warn('excel_pdf.temp_cleanup_failed', {
        jobId: job.id,
        errorCode: errorCodeOf(cleanupError),
      });
    });
  }
}

export function assertExcelPdfChunkSet(
  chunks: ChunkRow[],
  expectedCount: number,
  expectedSize: number,
): void {
  if (
    chunks.length !== expectedCount ||
    new Set(chunks.map((chunk) => chunk.index)).size !== expectedCount ||
    chunks.some((chunk, index) => chunk.index !== index)
  ) {
    throw new ExcelPdfProcessingError(
      ERROR_CODES.excelPdfUploadIncomplete,
      'The uploaded workbook is missing one or more chunks.',
    );
  }
  const total = chunks.reduce((sum, chunk) => sum + Number(chunk.sizeBytes), 0);
  if (total !== expectedSize) {
    throw new ExcelPdfProcessingError(
      ERROR_CODES.excelPdfUploadIncomplete,
      'The uploaded workbook size is incomplete.',
    );
  }
}

function conversionLeaseMs(deps: Dependencies): number {
  // Bound reclaim only after a normal conversion, PDF validation and private
  // storage upload have all had time to finish. The worker executes one claimed
  // task at a time, so an expired lease is the crash-recovery boundary.
  return Math.max(600_000, deps.env.EXCEL_PDF_TIMEOUT_MS * 2 + 120_000);
}

export async function mergeExcelPdfChunks(input: {
  chunks: ChunkRow[];
  uploadId: string;
  destination: string;
  storage: ObjectStorage;
}): Promise<string> {
  const workbookHash = createHash('sha256');
  for (const [position, chunk] of input.chunks.entries()) {
    const chunkHash = createHash('sha256');
    let bytes = 0;
    const meter = new Transform({
      transform(part: Buffer, _encoding, callback) {
        const buffer = Buffer.isBuffer(part) ? part : Buffer.from(part);
        bytes += buffer.byteLength;
        chunkHash.update(buffer);
        workbookHash.update(buffer);
        callback(null, buffer);
      },
    });
    await pipeline(
      input.storage.readStream(excelPdfChunkKey(input.uploadId, chunk.index)),
      meter,
      createWriteStream(input.destination, {
        flags: position === 0 ? 'w' : 'a',
        mode: 0o600,
      }),
    );
    if (bytes !== Number(chunk.sizeBytes) || chunkHash.digest('hex') !== chunk.sha256) {
      throw new ExcelPdfProcessingError(
        ERROR_CODES.excelPdfUploadChunkInvalid,
        'An uploaded chunk failed its size or checksum verification.',
      );
    }
  }
  await fs.chmod(input.destination, 0o600);
  return workbookHash.digest('hex');
}

async function failJob(
  jobId: string,
  attemptId: string,
  leaseOwner: string,
  code: string,
  deps: Dependencies,
  outputCompensation: OutputDeletionCompensation | null = null,
): Promise<FailJobResult> {
  const result = await deps.prisma.$transaction(async (transaction) => {
    const changed = await transaction.pdfConversionJob.updateMany({
      where: {
        id: jobId,
        attemptId,
        leaseOwner,
        status: { in: ['QUEUED', 'PROCESSING', 'FAILED'] },
      },
      data: {
        status: 'FAILED',
        errorCode: code.slice(0, 100),
        completedAt: new Date(),
        leaseOwner: null,
        leaseUntil: null,
      },
    });
    if (changed.count !== 1) {
      return { failed: false, outputDeletionQueued: false } satisfies FailJobResult;
    }
    const job = await transaction.pdfConversionJob.findUnique({
      where: { id: jobId },
      select: { uploadId: true, attemptId: true },
    });
    if (job?.uploadId && job.attemptId === attemptId) {
      await transaction.excelPdfUpload.updateMany({
        where: {
          id: job.uploadId,
          status: { in: ['QUEUED', 'CONVERTING', 'FAILED'] },
          jobId,
        },
        data: { status: 'FAILED', errorCode: code.slice(0, 120) },
      });
    }
    if (outputCompensation) {
      const idempotencyKey = `excel-pdf-compensating-output:${jobId}:${outputCompensation.outputAssetId}`;
      await transaction.fileDeletionJob.upsert({
        where: { idempotencyKey },
        create: {
          storageKey: outputCompensation.storageKey,
          entityType: 'excel_pdf_asset',
          entityId: outputCompensation.outputAssetId,
          requestedBy: outputCompensation.requestedBy,
          idempotencyKey,
        },
        update: {},
      });
    }
    return {
      failed: true,
      outputDeletionQueued: Boolean(outputCompensation),
    } satisfies FailJobResult;
  });
  if (result.failed) {
    deps.logger.error('excel_pdf.conversion_failed', { jobId, errorCode: code });
  }
  return result;
}

/**
 * The outbox lease is intentionally shorter than the conversion lease. If a
 * worker dies after claiming the job, another worker can reclaim the outbox
 * row first. Keep an idempotent wake-up event in PostgreSQL so the job is
 * resumed after its conversion lease expires instead of being stranded in
 * PROCESSING with no remaining queue row.
 */
async function scheduleConversionLeaseWakeup(
  jobId: string,
  attemptId: string,
  leaseUntil: Date,
  deps: Dependencies,
): Promise<void> {
  const idempotencyKey = `excel-pdf-convert:${jobId}:${attemptId}:lease:${leaseUntil.toISOString()}`;
  await deps.prisma.outboxEvent.upsert({
    where: { idempotencyKey },
    create: {
      eventType: 'excel-pdf-convert',
      payload: {
        jobId,
        attemptId,
        leaseWakeup: true,
      } satisfies WorkerConvertPayload as Prisma.InputJsonValue,
      runAfter: new Date(leaseUntil.getTime() + 1_000),
      idempotencyKey,
    },
    update: {},
  });
}

function normalizeProcessingError(error: unknown): ExcelPdfProcessingError {
  if (error instanceof ExcelPdfProcessingError) return error;
  return new ExcelPdfProcessingError(
    ERROR_CODES.storageUnavailable,
    error instanceof Error ? error.message : 'Excel-to-PDF processing failed.',
    true,
  );
}

function outputFileName(sourceFileName: string): string {
  return `${sourceFileName.replace(/\.xlsx$/i, '') || 'excel-conversion'}.pdf`;
}

async function putFileFromDisk(
  storage: ObjectStorage,
  key: string,
  path: string,
  contentType: string,
): Promise<void> {
  if (storage.putFile) return storage.putFile(key, path, contentType);
  await storage.put(key, await fs.readFile(path), contentType);
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of storageStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

function storageStream(path: string): AsyncIterable<Buffer> {
  const stream = createReadStream(path);
  return stream;
}

export async function queueChunkDeletions(
  transaction: Prisma.TransactionClient,
  uploadId: string,
  chunks: { index: number }[],
  requestedBy: string | null,
): Promise<void> {
  for (const chunk of chunks) {
    await transaction.fileDeletionJob.upsert({
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

function errorCodeOf(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code;
    return (code ?? error.message).slice(0, 120);
  }
  return String(error).slice(0, 120);
}
