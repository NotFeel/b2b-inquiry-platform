import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { Readable } from 'node:stream';
import { ERROR_CODES } from '@b2b/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ObjectStorage } from '../../storage';
import {
  assertExcelPdfChunkSet,
  excelPdfConversionClaimWhere,
  mergeExcelPdfChunks,
  processExcelPdfConversion,
} from './excel-pdf-task.handler';

const conversionMocks = vi.hoisted(() => ({
  createWorkspace: vi.fn(),
  convert: vi.fn(),
  validatePdf: vi.fn(),
  validateXlsx: vi.fn(),
}));

vi.mock('./temp-workspace', () => ({
  createExcelPdfTempWorkspace: conversionMocks.createWorkspace,
}));
vi.mock('./libreoffice.runner', () => ({
  convertWorkbookWithLibreOffice: conversionMocks.convert,
}));
vi.mock('./pdf-output-validator', () => ({
  validatePdfOutput: conversionMocks.validatePdf,
}));
vi.mock('./xlsx-zip-validator', () => ({
  validateXlsxArchive: conversionMocks.validateXlsx,
}));

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => fs.rm(path, { recursive: true, force: true })),
  );
});

describe('Excel-to-PDF job lease', () => {
  it('claims queued/failed jobs but only a PROCESSING job whose lease has expired', () => {
    const now = new Date('2026-10-30T12:00:00.000Z');
    expect(excelPdfConversionClaimWhere('job-1', 'attempt-1', now)).toEqual({
      id: 'job-1',
      attemptId: 'attempt-1',
      OR: [
        { status: { in: ['QUEUED', 'FAILED'] } },
        {
          status: 'PROCESSING',
          OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }],
        },
      ],
    });
  });

  it('rejects missing, duplicated and wrong-sized chunk metadata', () => {
    expect(() =>
      assertExcelPdfChunkSet([{ index: 1, sizeBytes: 2n, sha256: 'a'.repeat(64) }], 2, 4),
    ).toThrow('The uploaded workbook is missing one or more chunks.');
    expect(() =>
      assertExcelPdfChunkSet(
        [
          { index: 0, sizeBytes: 2n, sha256: 'a'.repeat(64) },
          { index: 0, sizeBytes: 2n, sha256: 'b'.repeat(64) },
        ],
        2,
        4,
      ),
    ).toThrow('The uploaded workbook is missing one or more chunks.');
    expect(() =>
      assertExcelPdfChunkSet(
        [
          { index: 0, sizeBytes: 2n, sha256: 'a'.repeat(64) },
          { index: 1, sizeBytes: 1n, sha256: 'b'.repeat(64) },
        ],
        2,
        4,
      ),
    ).toThrow('The uploaded workbook size is incomplete.');
  });

  it('keeps a durable wake-up when another worker still owns the conversion lease', async () => {
    const jobId = '22222222-2222-4222-8222-222222222222';
    const attemptId = '33333333-3333-4333-8333-333333333333';
    const leaseUntil = new Date(Date.now() + 10 * 60_000);
    const outboxUpsert = vi.fn(async () => ({}));
    const transaction = {
      pdfConversionJob: {
        updateMany: vi.fn(async () => ({ count: 0 })),
        findUnique: vi.fn(async () => ({
          status: 'PROCESSING',
          attemptId,
          leaseUntil,
        })),
      },
    };
    const prisma = {
      pdfConversionJob: {
        findUnique: vi.fn(async () => ({
          id: jobId,
          attemptId,
          uploadId: '44444444-4444-4444-8444-444444444444',
          sourceAssetId: '55555555-5555-4555-8555-555555555555',
          sourceFileName: 'products.xlsx',
          status: 'PROCESSING',
          purgeState: 'NONE',
          startedAt: new Date(),
          requestedById: null,
          sourceAsset: { storageKey: 'private/excel-pdf/inputs/source.xlsx' },
          outputAsset: null,
        })),
      },
      outboxEvent: { upsert: outboxUpsert },
      $transaction: vi.fn(async (callback: (client: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    };

    await processExcelPdfConversion(
      { jobId, attemptId },
      {
        prisma: prisma as never,
        storage: {} as ObjectStorage,
        env: {} as never,
        logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
      },
    );

    expect(outboxUpsert).toHaveBeenCalledWith({
      where: {
        idempotencyKey: `excel-pdf-convert:${jobId}:${attemptId}:lease:${leaseUntil.toISOString()}`,
      },
      create: {
        eventType: 'excel-pdf-convert',
        payload: { jobId, attemptId, leaseWakeup: true },
        runAfter: new Date(leaseUntil.getTime() + 1_000),
        idempotencyKey: `excel-pdf-convert:${jobId}:${attemptId}:lease:${leaseUntil.toISOString()}`,
      },
      update: {},
    });
  });

  it('ignores a late lease wake-up after the attempt has already finished', async () => {
    const jobId = '66666666-6666-4666-8666-666666666666';
    const attemptId = '77777777-7777-4777-8777-777777777777';
    const transaction = vi.fn();
    const prisma = {
      pdfConversionJob: {
        findUnique: vi.fn(async () => ({
          id: jobId,
          attemptId,
          uploadId: '88888888-8888-4888-8888-888888888888',
          sourceAssetId: '99999999-9999-4999-8999-999999999999',
          sourceFileName: 'products.xlsx',
          status: 'SUCCEEDED',
          purgeState: 'NONE',
          startedAt: new Date(),
          requestedById: null,
          sourceAsset: { storageKey: 'private/excel-pdf/inputs/source.xlsx' },
          outputAsset: { storageKey: 'private/excel-pdf/outputs/result.pdf' },
        })),
      },
      $transaction: transaction,
    };

    await processExcelPdfConversion(
      { jobId, attemptId, leaseWakeup: true },
      {
        prisma: prisma as never,
        storage: {} as ObjectStorage,
        env: {} as never,
        logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
      },
    );

    expect(transaction).not.toHaveBeenCalled();
  });
});

describe('Excel-to-PDF chunk merge', () => {
  it('merges streams in order and returns the workbook hash', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'b2b-excel-pdf-merge-'));
    temporaryDirectories.push(root);
    const destination = join(root, 'input.xlsx');
    const first = Buffer.from('first-part');
    const second = Buffer.from('-second-part');
    const storage = streamStorage(
      new Map([
        ['0', first],
        ['1', second],
      ]),
    );

    const hash = await mergeExcelPdfChunks({
      uploadId: '11111111-1111-4111-8111-111111111111',
      destination,
      storage,
      chunks: [
        { index: 0, sizeBytes: BigInt(first.byteLength), sha256: sha256(first) },
        { index: 1, sizeBytes: BigInt(second.byteLength), sha256: sha256(second) },
      ],
    });

    expect(await fs.readFile(destination)).toEqual(Buffer.concat([first, second]));
    expect(hash).toBe(sha256(Buffer.concat([first, second])));
  });

  it('stops when a chunk hash does not match its upload record', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'b2b-excel-pdf-merge-'));
    temporaryDirectories.push(root);
    const storage = streamStorage(new Map([['0', Buffer.from('tampered')]]));

    await expect(
      mergeExcelPdfChunks({
        uploadId: '11111111-1111-4111-8111-111111111111',
        destination: join(root, 'input.xlsx'),
        storage,
        chunks: [{ index: 0, sizeBytes: 8n, sha256: '0'.repeat(64) }],
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.excelPdfUploadChunkInvalid });
  });
});

describe('Excel-to-PDF output compensation', () => {
  it('persists a retryable delete when saving the job and immediate cleanup both fail', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'b2b-excel-pdf-compensation-'));
    temporaryDirectories.push(root);
    const jobId = '22222222-2222-4222-8222-222222222222';
    const attemptId = '33333333-3333-4333-8333-333333333333';
    const uploadId = '44444444-4444-4444-8444-444444444444';
    const sourceAssetId = '55555555-5555-4555-8555-555555555555';
    const requestedById = '66666666-6666-4666-8666-666666666666';
    const sourceKey = `private/excel-pdf/inputs/${sourceAssetId}.xlsx`;
    const chunk = Buffer.from('merged workbook');
    const outputPath = join(root, 'converted.pdf');
    await fs.writeFile(outputPath, '%PDF-1.7\n%%EOF\n');

    conversionMocks.createWorkspace.mockResolvedValue({
      root,
      inputPath: join(root, 'input.xlsx'),
      outputDir: join(root, 'output'),
      profileDir: join(root, 'profile'),
      cleanup: vi.fn(async () => undefined),
    });
    conversionMocks.convert.mockResolvedValue({ outputPath, durationMs: 1 });
    conversionMocks.validatePdf.mockResolvedValue({ sizeBytes: 15, pageCount: 1 });
    conversionMocks.validateXlsx.mockResolvedValue({ entryCount: 1, uncompressedBytes: 1 });

    const queuedDeletion = vi.fn(async () => ({}));
    const claimTransaction = {
      pdfConversionJob: { updateMany: vi.fn(async () => ({ count: 1 })) },
      excelPdfUpload: { updateMany: vi.fn(async () => ({ count: 1 })) },
    };
    const failureTransaction = {
      pdfConversionJob: {
        updateMany: vi.fn(async () => ({ count: 1 })),
        findUnique: vi.fn(async () => ({ uploadId, attemptId })),
      },
      excelPdfUpload: { updateMany: vi.fn(async () => ({ count: 1 })) },
      fileDeletionJob: { upsert: queuedDeletion },
    };
    let transactionCall = 0;
    const prisma = {
      pdfConversionJob: {
        findUnique: vi.fn(async () => ({
          id: jobId,
          attemptId,
          uploadId,
          sourceAssetId,
          sourceFileName: 'products.xlsx',
          status: 'QUEUED',
          purgeState: 'NONE',
          startedAt: null,
          leaseUntil: new Date(0),
          inputSha256: null,
          requestedById,
          sourceAsset: { storageKey: sourceKey },
          outputAsset: null,
        })),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      excelPdfUpload: {
        findUnique: vi.fn(async () => ({
          id: uploadId,
          declaredSize: BigInt(chunk.byteLength),
          chunkCount: 1,
          expiresAt: new Date(Date.now() + 60_000),
          chunks: [
            {
              index: 0,
              sizeBytes: BigInt(chunk.byteLength),
              sha256: sha256(chunk),
            },
          ],
        })),
      },
      fileAsset: { updateMany: vi.fn(async () => ({ count: 1 })) },
      $transaction: vi.fn(async (callback: (transaction: unknown) => unknown) => {
        transactionCall += 1;
        if (transactionCall === 1) return callback(claimTransaction);
        if (transactionCall === 2) throw new Error('database_commit_failed');
        return callback(failureTransaction);
      }),
    };
    const putFile = vi.fn(async () => undefined);
    const deleteObject = vi.fn(async () => {
      throw new Error('storage_delete_failed');
    });
    const storage = {
      readStream: vi.fn(() => Readable.from([chunk])),
      put: vi.fn(async () => undefined),
      putFile,
      get: vi.fn(),
      exists: vi.fn(),
      delete: deleteObject,
    } as unknown as ObjectStorage;
    const logger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };

    await expect(
      processExcelPdfConversion(
        { jobId, attemptId },
        {
          prisma: prisma as never,
          storage,
          env: {
            WORKER_TMP_DIR: root,
            EXCEL_PDF_CONVERTER_PATH: '/usr/bin/soffice',
            EXCEL_PDF_PDFINFO_PATH: '/usr/bin/pdfinfo',
            EXCEL_PDF_TIMEOUT_MS: 300_000,
            EXCEL_PDF_MAX_OUTPUT_BYTES: 50 * 1024 * 1024,
            EXCEL_PDF_MAX_PAGES: 200,
          } as never,
          logger: logger as never,
        },
      ),
    ).rejects.toMatchObject({ code: ERROR_CODES.storageUnavailable });

    const outputKey = putFile.mock.calls[1]?.[0] as string;
    const outputAssetId = basename(outputKey, '.pdf');
    expect(deleteObject).toHaveBeenCalledWith(outputKey);
    expect(queuedDeletion).toHaveBeenCalledWith({
      where: { idempotencyKey: `excel-pdf-compensating-output:${jobId}:${outputAssetId}` },
      create: {
        storageKey: outputKey,
        entityType: 'excel_pdf_asset',
        entityId: outputAssetId,
        requestedBy: requestedById,
        idempotencyKey: `excel-pdf-compensating-output:${jobId}:${outputAssetId}`,
      },
      update: {},
    });
    expect(logger.warn).toHaveBeenCalledWith('excel_pdf.output_cleanup_failed', {
      jobId,
      retryQueued: true,
      errorCode: 'storage_delete_failed',
    });
  });
});

function streamStorage(chunks: Map<string, Buffer>): ObjectStorage {
  return {
    readStream(key: string): Readable {
      const index = /(?:^|\/)(\d+)\.part$/.exec(key)?.[1];
      const data = index ? chunks.get(index) : undefined;
      if (!data) throw new Error('unexpected_storage_key');
      return Readable.from([data]);
    },
  } as ObjectStorage;
}

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}
