import { createHash } from 'node:crypto';
import type { PrismaClient } from '@b2b/database';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import type { WorkerEnv } from '../env';
import type { WorkerLogger } from '../logger';
import type { ObjectStorage } from '../storage';
import { processImageDerivatives } from './image-derivatives';

function makeDeps(original: Buffer, sha256 = createHash('sha256').update(original).digest('hex')) {
  const updates: Record<string, unknown>[] = [];
  const objects = new Map<string, Buffer>([['product-image/2026/10/source.png', original]]);
  const put = vi.fn(async (key: string, bytes: Buffer) => {
    objects.set(key, Buffer.from(bytes));
  });
  const prisma = {
    fileAsset: {
      findUnique: vi.fn(async () => ({
        id: '11111111-1111-4111-8111-111111111111',
        storageKey: 'product-image/2026/10/source.png',
        sha256,
      })),
      update: vi.fn(async (input: { data: Record<string, unknown> }) => {
        updates.push(input.data);
        return {};
      }),
    },
  };
  const storage = {
    get: vi.fn(async () => original),
    put,
    exists: vi.fn(async (key: string) => objects.has(key)),
    delete: vi.fn(async (key: string) => {
      objects.delete(key);
    }),
    readStream: vi.fn(),
  } as unknown as ObjectStorage;
  const env = {
    imageWidths: [320, 640, 1280],
    UPLOAD_MAX_PIXELS: 50_000_000,
    IMAGE_PROCESSING_TIMEOUT_SECONDS: 20,
    IMAGE_WEBP_QUALITY: 82,
  } as WorkerEnv;
  const logger = {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as WorkerLogger;
  return {
    deps: { prisma: prisma as unknown as PrismaClient, storage, env, logger },
    updates,
    put,
    objects,
  };
}

describe('processImageDerivatives', () => {
  it('really decodes the image and writes immutable WebP variants without upscaling', async () => {
    const original = await sharp({
      create: { width: 800, height: 600, channels: 3, background: '#2f7d68' },
    })
      .png()
      .toBuffer();
    const { deps, updates, put, objects } = makeDeps(original);

    const result = await processImageDerivatives(
      {
        fileAssetId: '11111111-1111-4111-8111-111111111111',
        storageKey: 'product-image/2026/10/source.png',
        widths: [320, 640, 1280],
      },
      deps,
    );

    expect(result.version).toMatch(/^[a-f0-9]{16}$/);
    expect(result.derivatives).toBe(3);
    expect(put).toHaveBeenCalledTimes(3);
    const keys = [...objects.keys()].filter((key) => key !== 'product-image/2026/10/source.png');
    expect(keys).toHaveLength(3);
    expect(keys.every((key) => key.endsWith('.webp'))).toBe(true);
    expect(keys.some((key) => key.endsWith('.avif'))).toBe(false);
    for (const width of [320, 640, 800]) {
      const key = keys.find((candidate) => candidate.endsWith(`/${width}.webp`));
      expect(key).toBeDefined();
      const metadata = await sharp(objects.get(key as string)).metadata();
      expect(metadata.format).toBe('webp');
      expect(metadata.width).toBe(width);
    }
    expect(updates.at(-1)).toMatchObject({ status: 'ready', width: 800, height: 600 });
  });

  it('marks the asset failed when Sharp cannot decode a plausible image header', async () => {
    const invalid = Buffer.alloc(64);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(invalid, 0);
    invalid.writeUInt32BE(13, 8);
    invalid.write('IHDR', 12, 'latin1');
    invalid.writeUInt32BE(640, 16);
    invalid.writeUInt32BE(480, 20);
    const { deps, updates, put } = makeDeps(invalid);

    await expect(
      processImageDerivatives(
        {
          fileAssetId: '11111111-1111-4111-8111-111111111111',
          storageKey: 'product-image/2026/10/source.png',
          widths: [320, 640],
        },
        deps,
      ),
    ).rejects.toThrow();

    expect(put).not.toHaveBeenCalled();
    expect(updates.at(-1)).toMatchObject({ status: 'failed' });
  });
});
