import type { PrismaClient } from '@b2b/database';
import { describe, expect, it, vi } from 'vitest';
import type { WorkerEnv } from '../env';
import type { WorkerLogger } from '../logger';
import type { ObjectStorage } from '../storage';
import { processProductImportCleanup } from './product-import-cleanup';

const uploadId = '11111111-1111-4111-8111-111111111111';

function setup(deleteImpl: (key: string) => Promise<void>) {
  const transaction = {
    fileDeletionJob: { upsert: vi.fn(async () => ({})) },
    productImportChunk: { deleteMany: vi.fn(async () => ({ count: 2 })) },
    productImportUpload: { updateMany: vi.fn(async () => ({ count: 1 })) },
    productImage: { count: vi.fn(async () => 0) },
    fileAsset: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    auditLog: { create: vi.fn(async () => ({})) },
    productImportValidation: { delete: vi.fn(async () => ({})) },
  };
  const prisma = {
    productImportUpload: {
      findMany: vi.fn(async () => [
        {
          id: uploadId,
          expiresAt: new Date(Date.now() - 60_000),
          chunks: [{ index: 0 }, { index: 1 }],
        },
      ]),
      updateMany: vi.fn(async () => ({ count: 1 })),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    productImportValidation: {
      findMany: vi.fn(async () => []),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    $transaction: vi.fn(async (callback: (tx: typeof transaction) => unknown) =>
      callback(transaction),
    ),
  };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return {
    deps: {
      prisma: prisma as unknown as PrismaClient,
      storage: { delete: vi.fn(deleteImpl) } as unknown as ObjectStorage,
      env: {} as WorkerEnv,
      logger: logger as unknown as WorkerLogger,
    },
    prisma,
    transaction,
    logger,
  };
}

describe('product import cleanup', () => {
  it('queues a durable deletion job before removing failed chunk metadata', async () => {
    const { deps, transaction, logger } = setup(async (key) => {
      if (key.endsWith('/000001.part')) throw new Error('storage.delete_failed');
    });

    await processProductImportCleanup({}, deps);

    expect(transaction.fileDeletionJob.upsert).toHaveBeenCalledOnce();
    expect(transaction.fileDeletionJob.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { idempotencyKey: `product-import-chunk:${uploadId}:1` },
        create: expect.objectContaining({
          storageKey: `product-import/${uploadId}/chunks/000001.part`,
          entityType: 'product_import_chunk',
        }),
      }),
    );
    expect(transaction.productImportChunk.deleteMany).toHaveBeenCalledWith({
      where: { uploadId },
    });
    expect(transaction.productImportUpload.updateMany).toHaveBeenCalledWith({
      where: {
        id: uploadId,
        status: { notIn: ['CANCELLED', 'EXPIRED', 'VALIDATED', 'INVALID'] },
      },
      data: { status: 'EXPIRED', errorCode: 'IMPORT_UPLOAD_EXPIRED' },
    });
    expect(logger.info).toHaveBeenCalledWith(
      'product_import.cleanup_done',
      expect.objectContaining({ retriedChunkDeletes: 1 }),
    );
  });

  it('does not create deletion jobs when every object is removed', async () => {
    const { deps, transaction } = setup(async () => undefined);

    await processProductImportCleanup({}, deps);

    expect(transaction.fileDeletionJob.upsert).not.toHaveBeenCalled();
    expect(transaction.productImportChunk.deleteMany).toHaveBeenCalledOnce();
  });
});
