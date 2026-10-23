import { describe, expect, it, vi } from 'vitest';
import type { AppEnv } from '../../config/config.module';
import type { AuditService } from '../../common/services/audit.service';
import type { CryptoService } from '../../common/services/crypto.service';
import type { JsonLogger } from '../../common/logger.service';
import type { StorageService } from '../../common/services/storage.service';
import type { PrismaService } from '../../prisma/prisma.service';
import { FilesService } from './files.service';

const asset = {
  id: '11111111-1111-4111-8111-111111111111',
  storageKey: 'product-image/2026/10/generated.png',
  originalName: 'photo.png',
  mimeType: 'image/png',
  sizeBytes: 1024n,
  sha256: null,
  width: null,
  height: null,
  purpose: 'product-image',
  status: 'uploading',
  isPublic: true,
  uploadedById: 'actor-1',
  derivatives: null,
  createdAt: new Date('2026-10-23T00:00:00.000Z'),
  updatedAt: new Date('2026-10-23T00:00:00.000Z'),
};

function service() {
  const prisma = {
    fileAsset: {
      create: vi.fn(async () => asset),
      findUnique: vi.fn(async () => asset),
      update: vi.fn(async () => ({ ...asset, status: 'processing' })),
      delete: vi.fn(async () => asset),
    },
    outboxEvent: { upsert: vi.fn(async () => ({})) },
    $transaction: vi.fn(async (callback: (tx: unknown) => unknown) =>
      callback({
        fileAsset: {
          update: vi.fn(async () => ({ ...asset, status: 'processing' })),
        },
        outboxEvent: { upsert: vi.fn(async () => ({})) },
      }),
    ),
  };
  const storage = {
    supportsPresignedUploads: vi.fn(() => true),
    buildKey: vi.fn(() => asset.storageKey),
    presignPut: vi.fn(async () => 'https://r2.example.com/presigned-put'),
    stat: vi.fn(async () => ({
      sizeBytes: 1024,
      contentType: 'image/png',
      etag: 'etag',
    })),
    adminProductImageUrl: vi.fn(
      () => '/api/v1/admin/media/assets/11111111-1111-4111-8111-111111111111/preview',
    ),
  };
  const audit = { record: vi.fn(async () => undefined) };
  const instance = new FilesService(
    {
      UPLOAD_MAX_BYTES: 10_485_760,
      UPLOAD_MAX_PIXELS: 50_000_000,
      UPLOAD_URL_TTL_SECONDS: 900,
      imageDerivativeWidths: [320, 640, 1280],
    } as AppEnv,
    prisma as unknown as PrismaService,
    storage as unknown as StorageService,
    { sha256: vi.fn() } as unknown as CryptoService,
    audit as unknown as AuditService,
    {} as JsonLogger,
  );
  return { instance, prisma, storage, audit };
}

describe('R2 direct image upload', () => {
  it('creates a server-owned key and returns a short-lived presigned PUT', async () => {
    const { instance, storage } = service();
    const result = await instance.initiateDirectUpload(
      {
        purpose: 'product-image',
        originalName: 'photo.png',
        declaredMime: 'image/png',
        sizeBytes: 1024,
      },
      'actor-1',
      'request-1',
    );

    expect(result).toMatchObject({
      fileAssetId: asset.id,
      storageKey: asset.storageKey,
      method: 'PUT',
      uploadUrl: 'https://r2.example.com/presigned-put',
      headers: { 'Content-Type': 'image/png' },
    });
    expect(storage.presignPut).toHaveBeenCalledWith(asset.storageKey, 'image/png', 900);
  });

  it('HEAD-validates the object and persists an image derivative task before processing', async () => {
    const { instance, storage, audit } = service();
    const result = await instance.confirmDirectUpload(asset.id, 'actor-1', 'request-1');

    expect(storage.stat).toHaveBeenCalledWith(asset.storageKey);
    expect(result).toMatchObject({
      fileAssetId: asset.id,
      status: 'processing',
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'file.upload_confirmed' }),
    );
  });
});
