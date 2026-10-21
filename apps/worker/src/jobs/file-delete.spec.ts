import type { PrismaClient } from '@b2b/database';
import { describe, expect, it, vi } from 'vitest';
import type { WorkerLogger } from '../logger';
import type { ObjectStorage } from '../storage';
import { processFileDeletion } from './file-delete';

const sourceKey = 'product-image/2026/10/source.png';
const derivativeKey = 'public/products/asset/version/640.webp';

function imageFixture() {
  return {
    id: 'image-1',
    productId: 'product-1',
    fileAssetId: 'asset-1',
    isCover: false,
    asset: {
      derivatives: {
        variants: [
          {
            width: 640,
            height: 480,
            key: derivativeKey,
            format: 'webp',
            sizeBytes: 100,
          },
        ],
      },
    },
  };
}

function transactionMock() {
  return {
    productImage: {
      deleteMany: vi.fn(async () => ({ count: 1 })),
      count: vi.fn(async () => 0),
      findFirst: vi.fn(async () => null),
      update: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    category: { count: vi.fn(async () => 0) },
    ad: { count: vi.fn(async () => 0) },
    pdfConversionJob: { count: vi.fn(async () => 0) },
    fileAsset: { deleteMany: vi.fn(async () => ({ count: 1 })) },
    fileDeletionJob: { updateMany: vi.fn(async () => ({ count: 1 })) },
    auditLog: { create: vi.fn(async () => ({})) },
  };
}

function depsWith(deleteImpl: (key: string) => Promise<void>) {
  const transaction = transactionMock();
  const prisma = {
    productImage: { findUnique: vi.fn(async () => imageFixture()) },
    fileDeletionJob: { findFirst: vi.fn(async () => null) },
    $transaction: vi.fn(async (callback: (tx: typeof transaction) => unknown) =>
      callback(transaction),
    ),
  };
  const logger = {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  return {
    deps: {
      prisma: prisma as unknown as PrismaClient,
      storage: { delete: vi.fn(deleteImpl) } as unknown as ObjectStorage,
      logger: logger as unknown as WorkerLogger,
      env: null,
    },
    transaction,
    logger,
  };
}

describe('physical product-image deletion', () => {
  it('deletes the source and every responsive object before clearing DB state', async () => {
    const { deps, transaction } = depsWith(async () => undefined);

    await processFileDeletion(
      {
        jobId: 'job-1',
        storageKey: sourceKey,
        entityType: 'product_image',
        entityId: 'image-1',
        productId: 'product-1',
      },
      deps,
    );

    expect(deps.storage.delete).toHaveBeenNthCalledWith(1, sourceKey);
    expect(deps.storage.delete).toHaveBeenNthCalledWith(2, derivativeKey);
    expect(transaction.productImage.deleteMany).toHaveBeenCalledOnce();
    expect(transaction.fileDeletionJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'job-1' },
        data: expect.objectContaining({ status: 'SUCCEEDED' }),
      }),
    );
  });

  it('keeps the task failed when a derivative object cannot be deleted', async () => {
    let calls = 0;
    const { deps, transaction, logger } = depsWith(async () => {
      calls += 1;
      if (calls === 2) throw new Error('storage.derivative_delete_failed');
    });

    await expect(
      processFileDeletion(
        {
          jobId: 'job-1',
          storageKey: sourceKey,
          entityType: 'product_image',
          entityId: 'image-1',
          productId: 'product-1',
        },
        deps,
      ),
    ).rejects.toThrow('storage.derivative_delete_failed');

    expect(transaction.fileDeletionJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'job-1' },
        data: expect.objectContaining({ status: 'FAILED' }),
      }),
    );
    expect(transaction.productImage.deleteMany).not.toHaveBeenCalled();
    expect(transaction.productImage.updateMany).toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
  });
});
