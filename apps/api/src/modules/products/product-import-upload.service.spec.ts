import { productImportChunkKey } from '@b2b/contracts';
import { describe, expect, it, vi } from 'vitest';
import type { AuthenticatedActor } from '../../common/request-context';
import type { AuditService } from '../../common/services/audit.service';
import type { StorageService } from '../../common/services/storage.service';
import type { PrismaService } from '../../prisma/prisma.service';
import { ProductImportUploadService } from './product-import-upload.service';

const actor: AuthenticatedActor = {
  id: '11111111-1111-4111-8111-111111111111',
  username: 'import-user',
  displayName: 'Import User',
  roles: ['super_admin'],
  permissions: new Set(),
  sessionId: 'session-id',
  mustChangePassword: false,
};

describe('ProductImportUploadService', () => {
  it('removes an uploaded chunk object when its database row cannot be persisted', async () => {
    const uploadId = '22222222-2222-4222-8222-222222222222';
    const prisma = {
      productImportUpload: {
        findUnique: vi.fn(async () => ({
          id: uploadId,
          actorId: actor.id,
          status: 'UPLOADING',
          expiresAt: new Date(Date.now() + 60_000),
          declaredSize: 4n,
          chunkSize: 8 * 1024 * 1024,
          chunkCount: 1,
        })),
      },
      productImportChunk: {
        upsert: vi.fn(async () => {
          throw new Error('database unavailable');
        }),
      },
    };
    const storage = {
      put: vi.fn(async () => ({ key: 'unused', sizeBytes: 4 })),
      delete: vi.fn(async () => undefined),
    };
    const service = new ProductImportUploadService(
      prisma as unknown as PrismaService,
      storage as unknown as StorageService,
      { record: vi.fn() } as unknown as AuditService,
    );

    await expect(service.uploadChunk(uploadId, 0, Buffer.from('data'), actor)).rejects.toThrow(
      'database unavailable',
    );
    expect(storage.put).toHaveBeenCalledWith(
      productImportChunkKey(uploadId, 0),
      Buffer.from('data'),
      'application/octet-stream',
    );
    expect(storage.delete).toHaveBeenCalledWith(productImportChunkKey(uploadId, 0));
  });
});
