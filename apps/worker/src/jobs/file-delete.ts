import { PrismaClient } from '@b2b/database';
import type { WorkerLogger } from '../logger';
import type { ObjectStorage } from '../storage';
import type { WorkerEnv } from '../env';

interface Payload {
  jobId?: string;
  /** Absent for aggregate tasks (the product finaliser) that only clear state. */
  storageKey?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  productId?: string | null;
}

interface Deps {
  prisma: PrismaClient;
  storage: ObjectStorage;
  logger: WorkerLogger;
  env?: WorkerEnv | null;
  /**
   * Re-queues this task with a delay.
   *
   * Waiting for another task is not a failure: consuming BullMQ attempts for it
   * would exhaust the retry budget of a healthy delete and surface a "failed"
   * task that is really just pending, so the wait path re-enqueues itself
   * instead. The database row stays the source of truth.
   */
  enqueue?: (payload: Record<string, unknown>, delayMs: number) => Promise<void>;
}

/**
 * Physical deletion worker (docs/24 §4.3, §8.2).
 *
 * The stored object is removed first; only a confirmed delete (or a missing
 * object, which is idempotently the same thing) clears the database rows. A
 * storage failure leaves the key, the task and the retry state intact and
 * reports the failure instead of pretending the file is gone.
 */
export async function processFileDeletion(
  payload: Payload,
  deps: Deps,
): Promise<{ deleted: true }> {
  const { logger } = deps;

  try {
    if (payload.storageKey) {
      await deps.storage.delete(payload.storageKey);
    }
    if (payload.entityType === 'product_image') {
      await finaliseImageDeletion(payload, deps);
      // An image retry can be what unblocks an already-failed product purge.
      // Resume that aggregate task so the product row is not left behind after
      // the operator successfully retried its last failed image.
      await resumeProductPurge(payload.productId, deps);
    } else {
      await finaliseLegacyJob(payload, deps);
    }
  } catch (error) {
    await recordFailure(payload, deps, error);
    // Rethrow so BullMQ applies its own backoff/attempt policy; the outbox row
    // stays FAILED and can also be retried manually by an operator.
    throw error;
  }

  logger.info('file.deleted', {
    storageKey: payload.storageKey ?? null,
    entityType: payload.entityType ?? null,
    entityId: payload.entityId ?? null,
  });
  return { deleted: true };
}

/**
 * After one image object is gone, restart a product purge that was waiting on
 * it. The aggregate task is idempotent and still checks every sibling image
 * before deleting the product, so a premature resume cannot skip a file.
 */
async function resumeProductPurge(productId: string | null | undefined, deps: Deps): Promise<void> {
  if (!productId) return;
  const productJob = await deps.prisma.fileDeletionJob.findFirst({
    where: {
      productId,
      entityType: 'product',
      status: { in: ['QUEUED', 'FAILED'] },
    },
    orderBy: { createdAt: 'desc' },
  });
  if (!productJob) return;

  await deps.prisma.fileDeletionJob.updateMany({
    where: { id: productJob.id, status: { in: ['QUEUED', 'FAILED'] } },
    data: { status: 'QUEUED', runAfter: new Date(), lastErrorCode: null },
  });
  await deps.enqueue?.(
    {
      jobId: productJob.id,
      storageKey: null,
      entityType: 'product',
      entityId: productId,
      productId,
    },
    0,
  );
}

/**
 * Clears one product-image row and its exclusive asset metadata.
 *
 * The object is already gone at this point. The asset row is only removed when
 * nothing else references it: a shared asset keeps its metadata even if the
 * delete of the object had to be refused earlier, because silently dropping a row
 * another entity still points at would corrupt that entity (docs/24 §4.2).
 */
async function finaliseImageDeletion(payload: Payload, deps: Deps): Promise<void> {
  const { prisma, storage } = deps;
  const imageId = payload.entityId;
  if (!imageId) return;

  const image = await prisma.productImage.findUnique({
    where: { id: imageId },
    include: { asset: { select: { derivatives: true } } },
  });

  // Responsive variants are derived from this object only, so they are removed
  // with it: leaving `__wNNN.webp` files behind would keep a "deleted" picture
  // reachable through its thumbnail URL (docs/24 §4.1 step 3).
  const derivativeKeys = derivativeKeysOf(image?.asset?.derivatives);
  for (const key of derivativeKeys) {
    // A derivative is still publicly addressable until its object is gone.
    // Let the outer failure path retain the task/key and retry the whole
    // idempotent delete; reporting success here would silently leak a file.
    await storage.delete(key);
  }

  await prisma.$transaction(async (transaction) => {
    if (image) {
      // Two queue attempts can race (for example a recovered message next to
      // the original one). `deleteMany` makes the second attempt a no-op instead
      // of failing with P2025 after the object is already gone.
      await transaction.productImage.deleteMany({ where: { id: image.id } });
      if (image.fileAssetId) {
        const [otherImages, categoryCovers, desktopAds, mobileAds, pdfSources] = await Promise.all([
          transaction.productImage.count({ where: { fileAssetId: image.fileAssetId } }),
          transaction.category.count({ where: { coverFileAssetId: image.fileAssetId } }),
          transaction.ad.count({ where: { desktopAssetId: image.fileAssetId } }),
          transaction.ad.count({ where: { mobileAssetId: image.fileAssetId } }),
          transaction.pdfConversionJob.count({ where: { sourceAssetId: image.fileAssetId } }),
        ]);
        if (otherImages + categoryCovers + desktopAds + mobileAds + pdfSources === 0) {
          await transaction.fileAsset.deleteMany({ where: { id: image.fileAssetId } });
        }
      }
      // A deleted cover leaves the product without one: the next usable image is
      // promoted so the storefront never renders a gallery without a cover.
      if (image.isCover) {
        const replacement = await transaction.productImage.findFirst({
          where: { productId: image.productId, deleteState: 'READY' },
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        });
        if (replacement) {
          await transaction.productImage.update({
            where: { id: replacement.id },
            data: { isCover: true },
          });
        }
      }
    }

    if (payload.jobId) {
      await transaction.fileDeletionJob.updateMany({
        where: { id: payload.jobId },
        data: {
          status: 'SUCCEEDED',
          attempts: { increment: 1 },
          lastErrorCode: null,
          completedAt: new Date(),
        },
      });
    }
    await transaction.auditLog.create({
      data: {
        action: 'product.image.permanent_delete_succeeded',
        entityType: 'product_image',
        entityId: imageId,
        metadata: {
          productId: payload.productId ?? image?.productId ?? null,
          storageKey: payload.storageKey ? scopeOf(payload.storageKey) : null,
        } as never,
      },
    });
  });

  await revalidateCatalogue(deps);
}

/**
 * Aggregate product purge: delete the product only when every image object of
 * that product is confirmed gone.
 *
 * While any image task is queued, processing or failed, the task reschedules
 * itself instead of deleting anything: the product row carries the
 * translations, tags and image keys that the remaining tasks still need.
 */
async function finaliseProductPurge(payload: Payload, deps: Deps): Promise<void> {
  const { prisma, logger } = deps;
  const productId = payload.entityId;
  if (!productId) return;

  const [outstandingImages, remainingImages] = await Promise.all([
    prisma.fileDeletionJob.count({
      where: {
        productId,
        entityType: 'product_image',
        status: { in: ['QUEUED', 'PROCESSING'] },
      },
    }),
    prisma.productImage.count({ where: { productId } }),
  ]);

  if (outstandingImages > 0 || remainingImages > 0) {
    const failed = await prisma.fileDeletionJob.count({
      where: { productId, entityType: 'product_image', status: 'FAILED' },
    });
    if (failed > 0 && outstandingImages === 0) {
      // Nothing is in flight and images are blocked on a failure: surface the
      // product task as failed so an operator can see and retry the cause.
      await prisma.fileDeletionJob.updateMany({
        where: { id: payload.jobId },
        data: {
          status: 'FAILED',
          attempts: { increment: 1 },
          lastErrorCode: 'IMAGE_DELETE_FAILED',
          runAfter: new Date(Date.now() + 300_000),
        },
      });
      logger.warn('product.purge_blocked', { productId, failed });
      return;
    }
    // Wait for the image tasks; the queue retry is what brings us back.
    await prisma.fileDeletionJob.updateMany({
      where: { id: payload.jobId },
      data: {
        status: 'QUEUED',
        runAfter: new Date(Date.now() + 30_000),
      },
    });
    await deps.enqueue?.(
      {
        jobId: payload.jobId,
        storageKey: null,
        entityType: 'product',
        entityId: productId,
        productId,
      },
      15_000,
    );
    logger.info('product.purge_waiting', { productId, outstandingImages });
    return;
  }

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, sku: true },
  });
  await prisma.$transaction(async (transaction) => {
    if (product) {
      // Images are already gone, so the cascade here only removes translations,
      // tag links and the product row itself (docs/24 §8.2).
      await transaction.product.deleteMany({ where: { id: product.id } });
    }
    if (payload.jobId) {
      await transaction.fileDeletionJob.updateMany({
        where: { id: payload.jobId },
        data: {
          status: 'SUCCEEDED',
          attempts: { increment: 1 },
          lastErrorCode: null,
          completedAt: new Date(),
        },
      });
    }
    await transaction.auditLog.create({
      data: {
        action: 'product.permanent_delete_succeeded',
        entityType: 'product',
        entityId: productId,
        metadata: { sku: product?.sku ?? null } as never,
      },
    });
  });

  await revalidateCatalogue(deps);
}

/** Existing queue consumers: quote exports and PDF conversions. */
async function finaliseLegacyJob(payload: Payload, deps: Deps): Promise<void> {
  const { prisma } = deps;
  if (payload.entityType === 'product') {
    await finaliseProductPurge(payload, deps);
    return;
  }

  if (payload.jobId) {
    await prisma.fileDeletionJob.updateMany({
      where: { id: payload.jobId },
      data: {
        status: 'SUCCEEDED',
        attempts: { increment: 1 },
        lastErrorCode: null,
        completedAt: new Date(),
      },
    });
  }

  if (payload.entityType === 'quote_export_job' && payload.entityId) {
    // Only now is the export record hard-deleted; a minimal audit trail keeps the
    // fact that an export existed without retaining the file.
    await prisma.quoteExportJob.update({
      where: { id: payload.entityId },
      data: { purgeState: 'PURGED', fileKey: null, status: 'CANCELLED' },
    });
  }

  if (payload.entityType === 'pdf_conversion_job' && payload.entityId) {
    await prisma.pdfConversionJob.update({
      where: { id: payload.entityId },
      data: { outputKey: null },
    });
  }
}

/**
 * A failed attempt keeps every clue: the key, the task, the error code and a
 * retry timestamp. The related image is marked `DELETE_FAILED` so the admin UI
 * shows "delete failed, retry" instead of a removed picture.
 */
async function recordFailure(payload: Payload, deps: Deps, error: unknown): Promise<void> {
  const { prisma, logger } = deps;
  const code = errorCodeOf(error);
  try {
    await prisma.$transaction(async (transaction) => {
      if (payload.jobId) {
        await transaction.fileDeletionJob.updateMany({
          where: { id: payload.jobId },
          data: {
            status: 'FAILED',
            attempts: { increment: 1 },
            lastErrorCode: code,
            runAfter: new Date(Date.now() + 60_000),
          },
        });
      }
      if (payload.entityType === 'product_image' && payload.entityId) {
        // The row is marked failed regardless of its previous state: a failed
        // delete must never leave an image that looks ready (docs/24 §4.4).
        await transaction.productImage.updateMany({
          where: { id: payload.entityId, deleteState: { not: 'DELETE_FAILED' } },
          data: { deleteState: 'DELETE_FAILED' },
        });
      }
      await transaction.auditLog.create({
        data: {
          action:
            payload.entityType === 'product'
              ? 'product.permanent_delete_blocked'
              : 'product.image.permanent_delete_failed',
          entityType: payload.entityType ?? 'file',
          entityId: payload.entityId ?? null,
          metadata: { errorCode: code, attemptRecorded: true } as never,
        },
      });
    });
  } catch (writeError) {
    logger.error('file.delete_failure_not_recorded', {
      jobId: payload.jobId ?? null,
      error: writeError instanceof Error ? writeError.message : String(writeError),
    });
  }
  logger.error('file.delete_failed', {
    jobId: payload.jobId ?? null,
    entityType: payload.entityType ?? null,
    errorCode: code,
  });
}

/** Pings the storefront so a removed image URL stops being served from ISR. */
async function revalidateCatalogue(deps: Deps): Promise<void> {
  const { env, logger } = deps;
  const secret = env?.REVALIDATE_SECRET ?? process.env.REVALIDATE_SECRET;
  const baseUrl = env?.APP_BASE_URL ?? process.env.APP_BASE_URL;
  if (!secret || !baseUrl) return;
  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/revalidate?tag=products`, {
      method: 'POST',
      headers: { 'x-revalidate-secret': secret },
    });
    if (!response.ok) {
      logger.warn('file.delete_revalidate_failed', { status: response.status });
    }
  } catch (error) {
    logger.warn('file.delete_revalidate_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function scopeOf(storageKey: string): string {
  return storageKey.split('/')[0] ?? 'unknown';
}

/**
 * Derivative object keys recorded on the asset (`{ variants: [{ key }] }`).
 *
 * The JSON is written by the image processor, so it is read defensively: an
 * unexpected shape yields no keys instead of throwing inside the delete task.
 */
function derivativeKeysOf(derivatives: unknown): string[] {
  if (typeof derivatives !== 'object' || derivatives === null) return [];
  const variants = (derivatives as { variants?: unknown }).variants;
  if (!Array.isArray(variants)) return [];
  return variants
    .map((variant) =>
      typeof variant === 'object' && variant !== null ? (variant as { key?: unknown }).key : null,
    )
    .filter((key): key is string => typeof key === 'string' && key.length > 0);
}

function errorCodeOf(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code) return `STORAGE_${code}`.slice(0, 120);
    return error.message.slice(0, 120);
  }
  return String(error).slice(0, 120);
}
