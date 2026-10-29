import { createHash } from 'node:crypto';
import { ERROR_CODES } from '@b2b/contracts';
import type { PrismaClient } from '@b2b/database';
import { describe, expect, it, vi } from 'vitest';
import type { WorkerEnv } from '../env';
import type { WorkerLogger } from '../logger';
import type { ObjectStorage } from '../storage';
import { processProductImportValidation } from './product-import-validate';

function setup(stored: Buffer, expectedSize: number, expectedSha256: string) {
  const update = vi.fn(async () => ({}));
  const prisma = {
    productImportUpload: {
      findUnique: vi.fn(async () => ({
        id: '11111111-1111-4111-8111-111111111111',
        actorId: '22222222-2222-4222-8222-222222222222',
        status: 'QUEUED',
        expiresAt: new Date(Date.now() + 60_000),
        declaredSize: BigInt(expectedSize),
        chunkCount: 1,
        settings: {
          categoryId: '33333333-3333-4333-8333-333333333333',
          publishStatus: 'draft',
          lifecycleStatus: 'available',
          tagIds: [],
          templateVersion: 'optimized-v1',
        },
        chunks: [{ index: 0, sizeBytes: BigInt(expectedSize), sha256: expectedSha256 }],
      })),
      update,
    },
  };
  const storage = { get: vi.fn(async () => stored), delete: vi.fn(async () => undefined) };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return {
    update,
    deps: {
      prisma: prisma as unknown as PrismaClient,
      storage: storage as unknown as ObjectStorage,
      env: { UPLOAD_MAX_BYTES: 10_485_760, UPLOAD_MAX_PIXELS: 50_000_000 } as WorkerEnv,
      logger: logger as unknown as WorkerLogger,
    },
  };
}

describe('processProductImportValidation chunk verification', () => {
  it('rejects a chunk whose SHA-256 does not match the uploaded chunk row', async () => {
    const bytes = Buffer.from('verified chunk');
    const { deps, update } = setup(bytes, bytes.byteLength, '0'.repeat(64));

    await expect(processProductImportValidation({ uploadId: 'upload-1' }, deps)).rejects.toThrow(
      ERROR_CODES.importUploadChunkInvalid,
    );
    expect(update).toHaveBeenLastCalledWith({
      where: { id: '11111111-1111-4111-8111-111111111111' },
      data: { status: 'FAILED', errorCode: ERROR_CODES.importUploadChunkInvalid },
    });
  });

  it('rejects a chunk whose stored byte length differs from its database row', async () => {
    const bytes = Buffer.from('short');
    const { deps, update } = setup(
      bytes,
      bytes.byteLength + 1,
      createHash('sha256').update(bytes).digest('hex'),
    );

    await expect(processProductImportValidation({ uploadId: 'upload-1' }, deps)).rejects.toThrow(
      ERROR_CODES.importUploadChunkInvalid,
    );
    expect(update).toHaveBeenLastCalledWith({
      where: { id: '11111111-1111-4111-8111-111111111111' },
      data: { status: 'FAILED', errorCode: ERROR_CODES.importUploadChunkInvalid },
    });
  });
});
