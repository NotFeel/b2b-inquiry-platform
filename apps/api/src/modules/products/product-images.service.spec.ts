import { describe, expect, it, vi } from 'vitest';
import type { AppEnv } from '../../config/config.module';
import type { AuditService } from '../../common/services/audit.service';
import type { JobsService } from '../../common/services/jobs.service';
import type { JsonLogger } from '../../common/logger.service';
import type { StorageService } from '../../common/services/storage.service';
import type { PrismaService } from '../../prisma/prisma.service';
import { ProductImagesService } from './product-images.service';

const failedImage = {
  id: 'image-1',
  productId: 'product-1',
  fileAssetId: null,
  storageKey: 'product-image/2026/10/failed.jpg',
  altText: null,
  sortOrder: 0,
  isCover: false,
  width: null,
  height: null,
  sizeBytes: null,
  sha256: null,
  deleteState: 'DELETE_FAILED',
  createdAt: new Date('2026-10-19T00:00:00.000Z'),
  asset: null,
};

describe('ProductImagesService.planProductPurge', () => {
  it('retries an image whose earlier physical delete failed instead of stranding the product', async () => {
    const enqueue = vi.fn(async () => 'queued');
    const audit = { record: vi.fn(async () => undefined) };
    const transaction = {
      fileDeletionJob: {
        upsert: vi.fn(async ({ create }: { create: { entityType: string } }) => ({
          id: create.entityType === 'product' ? 'product-job' : 'image-job',
          ...create,
        })),
      },
      productImage: { update: vi.fn(async () => failedImage) },
    };
    const prisma = {
      productImage: {
        findMany: vi.fn(async () => [failedImage]),
        count: vi.fn(async () => 0),
      },
      category: { count: vi.fn(async () => 0) },
      ad: { count: vi.fn(async () => 0) },
      pdfConversionJob: { count: vi.fn(async () => 0) },
      fileDeletionJob: {
        findUnique: vi.fn(async () => ({ id: 'image-job' })),
      },
      $transaction: vi.fn(async (callback: (tx: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    };
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };

    const service = new ProductImagesService(
      { REVALIDATE_SECRET: undefined } as unknown as AppEnv,
      prisma as unknown as PrismaService,
      {} as StorageService,
      { enqueue } as unknown as JobsService,
      audit as unknown as AuditService,
      logger as unknown as JsonLogger,
    );

    const result = await service.planProductPurge('product-1', 'actor-1', 'request-1');

    expect(result).toEqual({ imageOperations: 1, productOperationId: 'product-job' });
    expect(transaction.fileDeletionJob.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { idempotencyKey: 'product-image:image-1' },
        update: expect.objectContaining({
          status: 'QUEUED',
          attempts: 0,
          lastErrorCode: null,
        }),
      }),
    );
    expect(transaction.productImage.update).toHaveBeenCalledWith({
      where: { id: 'image-1' },
      data: { deleteState: 'DELETE_PENDING', isCover: false },
    });
    expect(enqueue).toHaveBeenCalledTimes(2);
  });
});
