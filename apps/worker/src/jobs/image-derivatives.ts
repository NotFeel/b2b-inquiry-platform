import { PrismaClient } from '@b2b/database';
import sharp from 'sharp';
import type { WorkerEnv } from '../env';
import type { WorkerLogger } from '../logger';
import type { ObjectStorage } from '../storage';

interface Payload {
  fileAssetId: string;
  storageKey: string;
  widths: number[];
}

/**
 * Generates responsive derivatives for an uploaded image.
 *
 * The original is re-encoded (which strips EXIF/GPS metadata), and each
 * derivative is stored under a predictable key derived from the asset key
 * (docs/11 §2).
 */
export async function processImageDerivatives(
  payload: Payload,
  deps: { prisma: PrismaClient; storage: ObjectStorage; env: WorkerEnv; logger: WorkerLogger },
): Promise<{ derivatives: number }> {
  const { prisma, storage, env, logger } = deps;
  const widths = payload.widths.length > 0 ? payload.widths : env.imageWidths;
  const original = await storage.get(payload.storageKey);

  const metadata = await sharp(original).metadata();
  const derivatives: { width: number; key: string; format: string; sizeBytes: number }[] = [];

  for (const width of widths) {
    if (metadata.width && width >= metadata.width) continue;
    const key = `${payload.storageKey.replace(/\.[a-z0-9]+$/i, '')}__w${width}.webp`;
    const buffer = await sharp(original)
      .rotate()
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
    await storage.put(key, buffer, 'image/webp');
    derivatives.push({ width, key, format: 'webp', sizeBytes: buffer.byteLength });
  }

  // The stored original is re-encoded once so metadata cannot leak.
  const stripped = await sharp(original).rotate().toBuffer();

  await prisma.fileAsset.update({
    where: { id: payload.fileAssetId },
    data: {
      width: metadata.width ?? null,
      height: metadata.height ?? null,
      derivatives: { variants: derivatives, processedAt: new Date().toISOString() } as never,
    },
  });

  logger.info('image.derivatives_done', {
    fileAssetId: payload.fileAssetId,
    count: derivatives.length,
    originalBytes: original.byteLength,
    strippedBytes: stripped.byteLength,
  });
  return { derivatives: derivatives.length };
}
