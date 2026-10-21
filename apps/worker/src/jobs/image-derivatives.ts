import {
  IMAGE_VARIANT_FORMAT,
  imageAssetVersion,
  imageVariantStorageKey,
  type StoredImageVariant,
} from '@b2b/contracts';
import { PrismaClient } from '@b2b/database';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import type { WorkerEnv } from '../env';
import type { WorkerLogger } from '../logger';
import type { ObjectStorage } from '../storage';

interface Payload {
  fileAssetId: string;
  storageKey: string;
  widths: number[];
  attemptsMade?: number;
  maxAttempts?: number;
}

interface DerivativeMetadata {
  version: string;
  variants: StoredImageVariant[];
  processedAt: string;
  source: {
    width: number;
    height: number;
    format: string;
    sizeBytes: number;
  };
}

/**
 * Validates and optimizes an uploaded image with the existing Sharp worker.
 *
 * The asset remains `processing` until every WebP variant has been written and
 * verified. Public product images consume these variants through immutable
 * content-versioned URLs; the private source object is never used by the
 * storefront (docs/31 §5.2-§5.4).
 */
export async function processImageDerivatives(
  payload: Payload,
  deps: { prisma: PrismaClient; storage: ObjectStorage; env: WorkerEnv; logger: WorkerLogger },
): Promise<{ derivatives: number; version: string }> {
  const { prisma, storage, env, logger } = deps;
  const asset = await prisma.fileAsset.findUnique({ where: { id: payload.fileAssetId } });
  if (!asset) throw new Error('image.asset_not_found');
  if (asset.storageKey !== payload.storageKey) throw new Error('image.storage_key_mismatch');

  await prisma.fileAsset.update({
    where: { id: asset.id },
    data: { status: 'processing' },
  });

  const createdKeys: string[] = [];
  try {
    const original = await storage.get(payload.storageKey);
    const sha256 = asset.sha256 ?? createHash('sha256').update(original).digest('hex');
    const version = imageAssetVersion(asset.id, sha256);
    const inputOptions = {
      failOn: 'error' as const,
      limitInputPixels: env.UPLOAD_MAX_PIXELS,
      sequentialRead: true,
    };
    const metadata = await sharp(original, inputOptions).metadata();
    const sourceWidth = metadata.autoOrient?.width ?? metadata.width;
    const sourceHeight = metadata.autoOrient?.height ?? metadata.height;
    if (
      !sourceWidth ||
      !sourceHeight ||
      !metadata.format ||
      !['jpeg', 'png', 'webp'].includes(metadata.format)
    ) {
      throw new Error('image.decode_failed');
    }

    const requestedWidths = payload.widths.length > 0 ? payload.widths : env.imageWidths;
    const targetWidths = [
      ...new Set(
        requestedWidths
          .map((width) => Math.min(width, sourceWidth))
          .filter((width) => Number.isInteger(width) && width > 0),
      ),
    ].sort((left, right) => left - right);
    if (targetWidths.length === 0) throw new Error('image.no_derivative_widths');

    const variants: StoredImageVariant[] = [];
    for (const width of targetWidths) {
      const key = imageVariantStorageKey(asset.id, version, width);
      const result = await sharp(original, inputOptions)
        .autoOrient()
        .resize({ width, withoutEnlargement: true })
        .webp({ quality: env.IMAGE_WEBP_QUALITY })
        .timeout({ seconds: env.IMAGE_PROCESSING_TIMEOUT_SECONDS })
        .toBuffer({ resolveWithObject: true });
      await storage.put(key, result.data, 'image/webp');
      createdKeys.push(key);
      if (!(await storage.exists(key))) throw new Error('image.derivative_missing_after_write');
      variants.push({
        width: result.info.width,
        height: result.info.height,
        key,
        format: IMAGE_VARIANT_FORMAT,
        sizeBytes: result.data.byteLength,
      });
    }

    const derivatives: DerivativeMetadata = {
      version,
      variants,
      processedAt: new Date().toISOString(),
      source: {
        width: sourceWidth,
        height: sourceHeight,
        format: metadata.format,
        sizeBytes: original.byteLength,
      },
    };
    await prisma.fileAsset.update({
      where: { id: asset.id },
      data: {
        width: sourceWidth,
        height: sourceHeight,
        status: 'ready',
        derivatives: derivatives as never,
      },
    });

    logger.info('image.derivatives_done', {
      fileAssetId: asset.id,
      version,
      count: variants.length,
      widths: variants.map((variant) => variant.width),
      originalBytes: original.byteLength,
      derivativeBytes: variants.reduce((total, variant) => total + variant.sizeBytes, 0),
    });
    return { derivatives: variants.length, version };
  } catch (error) {
    const orphanedKeys: string[] = [];
    for (const key of createdKeys) {
      try {
        await storage.delete(key);
      } catch {
        orphanedKeys.push(key);
      }
    }
    const errorCode =
      error instanceof Error ? error.message.slice(0, 120) : 'IMAGE_PROCESSING_FAILED';
    const finalAttempt = (payload.attemptsMade ?? 0) + 1 >= (payload.maxAttempts ?? 1);
    await prisma.fileAsset.update({
      where: { id: asset.id },
      data: {
        // Keep the staging UI in "processing" while BullMQ still has retries.
        // Only the terminal attempt exposes a failed asset.
        status: finalAttempt ? 'failed' : 'processing',
        derivatives: {
          status: finalAttempt ? 'failed' : 'retrying',
          errorCode,
          orphanedKeys,
          failedAt: new Date().toISOString(),
        } as never,
      },
    });
    logger.error('image.derivatives_failed', {
      fileAssetId: asset.id,
      errorCode,
    });
    throw error;
  }
}
