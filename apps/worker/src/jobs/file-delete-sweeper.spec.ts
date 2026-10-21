import type { PrismaClient } from '@b2b/database';
import type { Queue } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';
import type { WorkerLogger } from '../logger';
import { recoverStaleFileDeletions } from './file-delete-sweeper';

function loggerStub() {
  return {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as WorkerLogger;
}

const now = new Date('2026-10-19T18:00:00.000Z');
const staleRow = {
  id: 'job-1',
  storageKey: 'product-image/2026/10/photo.jpg',
  entityType: 'product_image',
  entityId: 'image-1',
  productId: 'product-1',
};

describe('recoverStaleFileDeletions', () => {
  it('re-enqueues a durable queued job whose message was lost', async () => {
    const prisma = {
      fileDeletionJob: {
        findMany: vi.fn(async () => [staleRow]),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
    } as unknown as PrismaClient;
    const queue = { add: vi.fn(async () => ({ id: 'q1' })) } as unknown as Queue;
    const logger = loggerStub();

    const result = await recoverStaleFileDeletions({
      prisma,
      queue,
      logger,
      now,
      staleAfterMs: 60_000,
    });

    expect(result).toEqual({ found: 1, enqueued: 1 });
    expect(prisma.fileDeletionJob.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'job-1',
        status: 'QUEUED',
        runAfter: { lte: new Date(now.getTime() - 60_000) },
      },
      data: { runAfter: new Date(now.getTime() + 60_000) },
    });
    expect(queue.add).toHaveBeenCalledWith(
      'file-delete',
      {
        jobId: 'job-1',
        storageKey: staleRow.storageKey,
        entityType: 'product_image',
        entityId: 'image-1',
        productId: 'product-1',
      },
      { jobId: `file-delete-job-1-recover-${now.getTime().toString(36)}` },
    );
  });

  it('does not enqueue a job another worker claimed first', async () => {
    const prisma = {
      fileDeletionJob: {
        findMany: vi.fn(async () => [staleRow]),
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
    } as unknown as PrismaClient;
    const queue = { add: vi.fn() } as unknown as Queue;

    const result = await recoverStaleFileDeletions({
      prisma,
      queue,
      logger: loggerStub(),
      now,
    });

    expect(result).toEqual({ found: 1, enqueued: 0 });
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('keeps the row retryable when the queue rejects the recovered message', async () => {
    const prisma = {
      fileDeletionJob: {
        findMany: vi.fn(async () => [staleRow]),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
    } as unknown as PrismaClient;
    const queue = {
      add: vi.fn(async () => {
        throw new Error('redis unavailable');
      }),
    } as unknown as Queue;
    const logger = loggerStub();

    const result = await recoverStaleFileDeletions({
      prisma,
      queue,
      logger,
      now,
    });

    expect(result).toEqual({ found: 1, enqueued: 0 });
    expect(logger.warn).toHaveBeenCalledWith('file.delete_recover_enqueue_failed', {
      jobId: 'job-1',
      entityType: 'product_image',
      error: 'redis unavailable',
    });
  });
});
