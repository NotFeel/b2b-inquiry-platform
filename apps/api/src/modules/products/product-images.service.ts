import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  ERROR_CODES,
  PRODUCT_IMAGE_LIMITS,
  QUEUE_NAMES,
  type FileOperationSummary,
  type ProductImageAttachResult,
  type ProductImageSummary,
} from '@b2b/contracts';
import type { ProductImage, FileAsset, Prisma } from '@b2b/database';
import { APP_ENV, type AppEnv } from '../../config/config.module';
import { ApiError } from '../../common/errors/api-error';
import { AuditService } from '../../common/services/audit.service';
import { JobsService } from '../../common/services/jobs.service';
import { JsonLogger } from '../../common/logger.service';
import { StorageService } from '../../common/services/storage.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { ProductImageAttachInput, ProductImageUpdateInput } from '@b2b/validation';
import {
  defaultAltText,
  describeSharedAsset,
  isManagedProductImageKey,
  isSharedAsset,
  normalizeImageOrder,
  resolveCoverAssignment,
  type AssetUsageSnapshot,
} from './product-image-policy';

type ImageWithAsset = ProductImage & { asset: FileAsset | null };

/**
 * Gallery maintenance and the permanent-delete outbox (docs/24 §4, §6.2, §8).
 *
 * Object storage and PostgreSQL share no transaction, so a delete is never
 * performed inline: the request writes a durable task, marks the image as
 * pending, and the `file-delete` worker removes the object and only then clears
 * the database rows. A failed storage delete keeps the key, the task and a
 * retryable state instead of reporting a success that did not happen.
 */
@Injectable()
export class ProductImagesService {
  constructor(
    @Inject(APP_ENV) private readonly env: AppEnv,
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly jobs: JobsService,
    private readonly audit: AuditService,
    private readonly logger: JsonLogger,
  ) {}

  /** Serialises a row for the editor, including its physical-delete state. */
  toSummary(image: ImageWithAsset, deleteOperationId: string | null = null): ProductImageSummary {
    return {
      id: image.id,
      fileAssetId: image.fileAssetId,
      url: this.storage.publicUrl(image.storageKey),
      originalName: image.asset?.originalName ?? null,
      alt: image.altText,
      sortOrder: image.sortOrder,
      isCover: image.isCover,
      width: image.width,
      height: image.height,
      sizeBytes: image.sizeBytes === null ? null : Number(image.sizeBytes),
      mimeType: image.asset?.mimeType ?? null,
      state: image.deleteState as ProductImageSummary['state'],
      deleteOperationId,
    };
  }

  /**
   * Attaches staged assets to a product.
   *
   * Only a ready, image-purpose asset that is not already part of another
   * gallery may be attached: re-attaching the same object to a second product
   * would create exactly the shared object that a per-product delete cannot
   * safely remove (docs/24 §4.2).
   */
  async attach(
    productId: string,
    input: ProductImageAttachInput,
    actorId: string,
    requestId: string,
  ): Promise<ProductImageAttachResult> {
    const product = await this.requireProduct(productId);
    const assetIds = input.assets.map((asset) => asset.fileAssetId);
    if (new Set(assetIds).size !== assetIds.length) {
      throw ApiError.validation('The same image was submitted twice.', {
        assets: 'product.image.duplicate',
      });
    }

    const existingCount = await this.prisma.productImage.count({
      where: { productId, deleteState: { not: 'DELETE_PENDING' } },
    });
    if (existingCount + assetIds.length > PRODUCT_IMAGE_LIMITS.maxPerProduct) {
      throw new ApiError(
        ERROR_CODES.productImageLimitExceeded,
        `A product can hold at most ${PRODUCT_IMAGE_LIMITS.maxPerProduct} images.`,
        { details: { max: PRODUCT_IMAGE_LIMITS.maxPerProduct } },
      );
    }

    const assets = await this.prisma.fileAsset.findMany({ where: { id: { in: assetIds } } });
    const byId = new Map(assets.map((asset) => [asset.id, asset]));
    for (const assetId of assetIds) {
      const asset = byId.get(assetId);
      if (!asset || asset.status !== 'ready' || !asset.isPublic) {
        throw ApiError.validation('A referenced image is unavailable or unprocessed.', {
          fileAssetId: assetId,
        });
      }
      if (!PRODUCT_IMAGE_LIMITS.allowedMimeTypes.includes(asset.mimeType as never)) {
        throw new ApiError(
          ERROR_CODES.uploadTypeNotAllowed,
          'Only JPEG, PNG and WebP images can be attached to a product.',
          { details: { fileAssetId: assetId, mimeType: asset.mimeType } },
        );
      }
      if (!isManagedProductImageKey(asset.storageKey)) {
        throw ApiError.validation('The image is not stored under a managed key.', {
          fileAssetId: assetId,
        });
      }
      const usedElsewhere = await this.prisma.productImage.count({
        where: {
          fileAssetId: asset.id,
          productId: { not: productId },
          deleteState: { not: 'DELETE_PENDING' },
        },
      });
      if (usedElsewhere > 0) {
        throw new ApiError(
          ERROR_CODES.assetInUse,
          'This object already belongs to another product gallery.',
          { status: 409, details: { fileAssetId: assetId } },
        );
      }
    }

    const englishName = await this.prisma.productTranslation.findUnique({
      where: { productId_locale: { productId, locale: 'en-US' } },
      select: { name: true },
    });

    const currentMax = await this.prisma.productImage.aggregate({
      where: { productId },
      _max: { sortOrder: true },
    });
    let nextSort = (currentMax._max.sortOrder ?? -1) + 1;
    const preferredCover = input.assets.find((asset) => asset.isCover)?.fileAssetId ?? null;

    const created = await this.prisma.$transaction(async (transaction) => {
      const rows: string[] = [];
      for (const assetInput of input.assets) {
        const asset = byId.get(assetInput.fileAssetId)!;
        const row = await transaction.productImage.create({
          data: {
            productId,
            fileAssetId: asset.id,
            // The database key is the authoritative one; it is copied from the
            // asset, never from the request (docs/24 §5.3).
            storageKey: asset.storageKey,
            altText:
              assetInput.altText ??
              defaultAltText(englishName?.name ?? product.sku, asset.originalName),
            sortOrder: nextSort,
            isCover: false,
            width: asset.width,
            height: asset.height,
            sizeBytes: asset.sizeBytes,
            sha256: asset.sha256,
            deleteState: 'READY',
          },
        });
        rows.push(row.id);
        nextSort += 1;
      }
      await this.applyCover(transaction, productId, {
        preferredCoverImageId: preferredCover
          ? createdCoverId(rows, input.assets, preferredCover)
          : null,
      });
      return rows;
    });

    await this.audit.record({
      actorId,
      action: 'product.image.uploaded',
      entityType: 'product',
      entityId: productId,
      requestId,
      metadata: { fileAssetIds: assetIds, imageIds: created },
    });
    await this.revalidatePublicCatalogue('image_attach');
    return this.gallery(productId);
  }

  async updateAltText(
    productId: string,
    imageId: string,
    input: ProductImageUpdateInput,
    actorId: string,
    requestId: string,
  ) {
    const image = await this.requireImage(productId, imageId);
    const updated = await this.prisma.productImage.update({
      where: { id: image.id },
      data: { altText: input.altText ?? null },
    });
    await this.audit.record({
      actorId,
      action: 'product.image.updated',
      entityType: 'product_image',
      entityId: imageId,
      requestId,
      metadata: { productId, altTextChanged: true },
    });
    await this.revalidatePublicCatalogue('image_alt_text');
    return this.toSummary({ ...updated, asset: null });
  }

  /** Promotes an image to cover; every other usable image is demoted. */
  async setCover(productId: string, imageId: string, actorId: string, requestId: string) {
    const image = await this.requireImage(productId, imageId);
    if (image.deleteState !== 'READY') {
      throw new ApiError(
        ERROR_CODES.productImageDeletePending,
        'An image that is being permanently deleted cannot become the cover.',
        { status: 409, details: { imageId, state: image.deleteState } },
      );
    }
    await this.prisma.$transaction(async (transaction) => {
      await this.applyCover(transaction, productId, { preferredCoverImageId: imageId });
    });
    await this.audit.record({
      actorId,
      action: 'product.image.cover_changed',
      entityType: 'product_image',
      entityId: imageId,
      requestId,
      metadata: { productId },
    });
    await this.revalidatePublicCatalogue('image_cover');
    return this.gallery(productId);
  }

  /**
   * Applies a complete, ordered gallery.
   *
   * The submitted list must match the product's usable images exactly; a
   * mismatch is a conflict (another editor changed the gallery) rather than a
   * silent partial update. Positions come from the array index, so a client
   * cannot invent floating-point sort keys (docs/24 §8.3).
   */
  async reorder(productId: string, imageIds: string[], actorId: string, requestId: string) {
    await this.requireProduct(productId);
    const images = await this.prisma.productImage.findMany({
      where: { productId, deleteState: 'READY' },
      select: { id: true, sortOrder: true, deleteState: true, isCover: true },
    });
    const result = normalizeImageOrder(
      imageIds,
      images.map((image) => image.id),
    );
    if ('error' in result) {
      throw new ApiError(
        ERROR_CODES.conflict,
        'The submitted image order does not match the current gallery.',
        { status: 409, details: { reason: result.error, ids: result.unknownIds ?? [] } },
      );
    }
    const coverId = images.find((image) => image.isCover)?.id ?? null;
    await this.prisma.$transaction(async (transaction) => {
      for (const [index, imageId] of result.ordered.entries()) {
        await transaction.productImage.update({
          where: { id: imageId },
          data: { sortOrder: index },
        });
      }
      await this.applyCover(transaction, productId, { preferredCoverImageId: coverId });
    });
    await this.audit.record({
      actorId,
      action: 'product.image.reordered',
      entityType: 'product',
      entityId: productId,
      requestId,
      metadata: { count: result.ordered.length },
    });
    await this.revalidatePublicCatalogue('image_order');
    return this.gallery(productId);
  }

  /**
   * Requests the permanent physical delete of one image.
   *
   * Nothing is deleted here: the object key is written to the outbox and the
   * image is hidden from the public projection immediately. Only the worker's
   * confirmed storage delete clears the rows (docs/24 §4.3).
   */
  async requestDeletion(productId: string, imageId: string, actorId: string, requestId: string) {
    await this.requireProduct(productId);
    const image = await this.prisma.productImage.findFirst({
      where: { id: imageId, productId },
      include: { asset: true },
    });
    if (!image) {
      throw new ApiError(
        ERROR_CODES.productImageNotFound,
        'This image does not belong to the product.',
      );
    }

    const existing = await this.prisma.fileDeletionJob.findUnique({
      where: { idempotencyKey: this.imageIdempotencyKey(imageId) },
    });
    if (existing && existing.status !== 'SUCCEEDED') {
      throw new ApiError(
        ERROR_CODES.productImageDeletePending,
        'A permanent delete is already registered for this image.',
        { status: 409, details: { operationId: existing.id, status: existing.status } },
      );
    }

    this.assertDeletableKey(image.storageKey);
    const usage = await this.assetUsage(image);
    if (isSharedAsset(usage)) {
      throw new ApiError(
        ERROR_CODES.assetInUse,
        'The stored object is referenced by another product, a category cover or an ad.',
        { status: 409, details: { sharedWith: describeSharedAsset(usage) } },
      );
    }

    const job = await this.prisma.$transaction(async (transaction) => {
      const record = await transaction.fileDeletionJob.create({
        data: {
          storageKey: image.storageKey,
          entityType: 'product_image',
          entityId: image.id,
          productId,
          requestedBy: actorId,
          status: 'QUEUED',
          idempotencyKey: this.imageIdempotencyKey(image.id),
        },
      });
      await transaction.productImage.update({
        where: { id: image.id },
        data: { deleteState: 'DELETE_PENDING', isCover: false },
      });
      // The cover must stay valid while the object is being removed.
      await this.applyCover(transaction, productId, { preferredCoverImageId: null });
      return record;
    });

    await this.enqueueDeletion(job.id, {
      storageKey: image.storageKey,
      entityType: 'product_image',
      entityId: image.id,
      productId,
    });

    await this.audit.record({
      actorId,
      action: 'product.image.permanent_delete_requested',
      entityType: 'product_image',
      entityId: image.id,
      requestId,
      metadata: { productId, operationId: job.id, storageScope: image.storageKey.split('/')[0] },
    });
    // The image must disappear from the storefront the moment the delete is
    // accepted, not when the worker gets to it.
    await this.revalidatePublicCatalogue('image_delete_requested');
    return { operationId: job.id, status: 'PENDING' as const, imageId: image.id };
  }

  async operationStatus(operationId: string): Promise<FileOperationSummary> {
    const job = await this.prisma.fileDeletionJob.findUnique({ where: { id: operationId } });
    if (!job) throw new ApiError(ERROR_CODES.fileOperationNotFound, 'The delete task is unknown.');
    return this.toOperationSummary(job);
  }

  /** Manual retry for a task whose automatic attempts are exhausted. */
  async retryOperation(operationId: string, actorId: string, requestId: string) {
    const job = await this.prisma.fileDeletionJob.findUnique({ where: { id: operationId } });
    if (!job) throw new ApiError(ERROR_CODES.fileOperationNotFound, 'The delete task is unknown.');
    // A queued task past its own retry time may have lost its queue message (a
    // Redis restart, for example); its row is the source of truth, so an
    // operator can restart it instead of waiting for a task nobody holds.
    const isOverdue = job.status === 'QUEUED' && job.runAfter.getTime() <= Date.now();
    if (job.status !== 'FAILED' && !isOverdue) {
      throw new ApiError(
        ERROR_CODES.fileOperationNotRetryable,
        `Only a failed or overdue task can be retried (current status: ${job.status}).`,
        { status: 409, details: { status: job.status } },
      );
    }

    const { retried, imageJobs } = await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.fileDeletionJob.update({
        where: { id: job.id },
        data: { status: 'QUEUED', attempts: 0, runAfter: new Date(), lastErrorCode: null },
      });
      if (job.entityType === 'product_image' && job.entityId) {
        await transaction.productImage.updateMany({
          where: { id: job.entityId, deleteState: { not: 'DELETE_PENDING' } },
          data: { deleteState: 'DELETE_PENDING' },
        });
      }
      // A product purge is blocked by its image tasks. Retrying only the
      // aggregate task would never make progress, so a product retry also
      // restarts every image task that is not confirmed finished.
      const relatedImages =
        job.entityType === 'product' && job.productId
          ? await transaction.fileDeletionJob.findMany({
              where: {
                productId: job.productId,
                entityType: 'product_image',
                status: { in: ['QUEUED', 'FAILED'] },
              },
            })
          : [];
      for (const imageJob of relatedImages) {
        await transaction.fileDeletionJob.update({
          where: { id: imageJob.id },
          data: { status: 'QUEUED', attempts: 0, runAfter: new Date(), lastErrorCode: null },
        });
        if (imageJob.entityId) {
          await transaction.productImage.updateMany({
            where: { id: imageJob.entityId, deleteState: { not: 'DELETE_PENDING' } },
            data: { deleteState: 'DELETE_PENDING', isCover: false },
          });
        }
      }
      return { retried: updated, imageJobs: relatedImages };
    });

    for (const imageJob of imageJobs) {
      await this.enqueueDeletion(imageJob.id, {
        storageKey: imageJob.storageKey,
        entityType: imageJob.entityType,
        entityId: imageJob.entityId,
        productId: imageJob.productId,
      });
    }
    await this.enqueueDeletion(retried.id, {
      storageKey: retried.storageKey,
      entityType: retried.entityType,
      entityId: retried.entityId,
      productId: retried.productId,
    });
    await this.audit.record({
      actorId,
      action: 'product.image.permanent_delete_retried',
      entityType: 'product_image',
      entityId: retried.entityId,
      requestId,
      metadata: { operationId: retried.id, attemptsBeforeRetry: job.attempts },
    });
    return this.toOperationSummary(retried);
  }

  /**
   * Plans the permanent delete of a whole product.
   *
   * Every image object is queued first and the product row is only removed by a
   * final aggregate task once no image task is outstanding. This is the opposite
   * of a database cascade, which would drop the rows - and with them the only
   * record of the storage keys - before any object was removed (docs/24 §8.2).
   */
  async planProductPurge(
    productId: string,
    actorId: string,
    requestId: string,
  ): Promise<{ imageOperations: number; productOperationId: string }> {
    const images = await this.prisma.productImage.findMany({
      where: { productId },
      include: { asset: true },
    });

    for (const image of images) {
      this.assertDeletableKey(image.storageKey);
      const usage = await this.assetUsage(image);
      if (isSharedAsset(usage)) {
        throw new ApiError(
          ERROR_CODES.assetInUse,
          'An image of this product is shared with another entity, so the product cannot be purged.',
          { status: 409, details: { imageId: image.id, sharedWith: describeSharedAsset(usage) } },
        );
      }
    }

    // Every image must be retried, including a previous `DELETE_FAILED` one.
    // Skipping the failed row would leave `remainingImages > 0` forever and make
    // the product permanently undeletable (docs/24 §8.2).
    const pendingImages = images;
    const productJob = await this.prisma.$transaction(async (transaction) => {
      for (const image of pendingImages) {
        await transaction.fileDeletionJob.upsert({
          where: { idempotencyKey: this.imageIdempotencyKey(image.id) },
          create: {
            storageKey: image.storageKey,
            entityType: 'product_image',
            entityId: image.id,
            productId,
            requestedBy: actorId,
            status: 'QUEUED',
            idempotencyKey: this.imageIdempotencyKey(image.id),
          },
          update: {
            status: 'QUEUED',
            attempts: 0,
            runAfter: new Date(),
            lastErrorCode: null,
          },
        });
        await transaction.productImage.update({
          where: { id: image.id },
          data: { deleteState: 'DELETE_PENDING', isCover: false },
        });
      }
      return transaction.fileDeletionJob.upsert({
        where: { idempotencyKey: this.productIdempotencyKey(productId) },
        create: {
          storageKey: null,
          entityType: 'product',
          entityId: productId,
          productId,
          requestedBy: actorId,
          status: 'QUEUED',
          // Run after the image tasks so the first run usually finishes in one go.
          runAfter: new Date(Date.now() + 5_000),
          idempotencyKey: this.productIdempotencyKey(productId),
        },
        update: {
          status: 'QUEUED',
          attempts: 0,
          runAfter: new Date(Date.now() + 5_000),
          lastErrorCode: null,
        },
      });
    });

    for (const image of pendingImages) {
      const job = await this.prisma.fileDeletionJob.findUnique({
        where: { idempotencyKey: this.imageIdempotencyKey(image.id) },
      });
      if (job) {
        await this.enqueueDeletion(job.id, {
          storageKey: image.storageKey,
          entityType: 'product_image',
          entityId: image.id,
          productId,
        });
      }
    }
    await this.enqueueDeletion(productJob.id, {
      storageKey: null,
      entityType: 'product',
      entityId: productId,
      productId,
    });

    await this.audit.record({
      actorId,
      action: 'product.permanent_delete_requested',
      entityType: 'product',
      entityId: productId,
      requestId,
      metadata: { imageOperations: pendingImages.length, operationId: productJob.id },
    });
    await this.revalidatePublicCatalogue('product_delete_requested');
    return { imageOperations: pendingImages.length, productOperationId: productJob.id };
  }

  /** Usable gallery for the editor, with the delete operation of each row. */
  async gallery(productId: string): Promise<ProductImageAttachResult> {
    const images = await this.prisma.productImage.findMany({
      where: { productId },
      include: { asset: true },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
    const operations = await this.prisma.fileDeletionJob.findMany({
      where: {
        entityType: 'product_image',
        entityId: { in: images.map((image) => image.id) },
      },
      select: { id: true, entityId: true },
    });
    const byImage = new Map(operations.map((operation) => [operation.entityId, operation.id]));
    return {
      images: images.map((image) => this.toSummary(image, byImage.get(image.id) ?? null)),
      coverImageId:
        images.find((image) => image.isCover && image.deleteState === 'READY')?.id ?? null,
    };
  }

  /** Publishes a revalidation ping for the catalogue caches (docs/24 §9). */
  async revalidatePublicCatalogue(reason: string): Promise<void> {
    const secret = this.env.REVALIDATE_SECRET;
    if (!secret) {
      this.logger.info('products.revalidate_skipped', {
        reason,
        cause: 'REVALIDATE_SECRET is not configured',
      });
      return;
    }
    try {
      const response = await fetch(`${this.env.APP_BASE_URL}/api/revalidate?tag=products`, {
        method: 'POST',
        headers: { 'x-revalidate-secret': secret },
      });
      if (!response.ok) {
        this.logger.warn('products.revalidate_failed', { reason, status: response.status });
      }
    } catch (error) {
      this.logger.warn('products.revalidate_failed', {
        reason,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async applyCover(
    transaction: Prisma.TransactionClient,
    productId: string,
    options: { preferredCoverImageId: string | null },
  ): Promise<void> {
    const images = await transaction.productImage.findMany({
      where: { productId },
      select: { id: true, sortOrder: true, deleteState: true, isCover: true },
    });
    const { coverId } = resolveCoverAssignment(images, options.preferredCoverImageId);
    await transaction.productImage.updateMany({
      where: { productId, isCover: true, ...(coverId ? { id: { not: coverId } } : {}) },
      data: { isCover: false },
    });
    if (coverId) {
      await transaction.productImage.updateMany({
        where: { id: coverId },
        data: { isCover: true },
      });
    }
  }

  private async requireProduct(productId: string) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, sku: true, publishStatus: true },
    });
    if (!product) throw new ApiError(ERROR_CODES.productNotFound, 'Product not found.');
    return product;
  }

  private async requireImage(productId: string, imageId: string): Promise<ImageWithAsset> {
    const image = await this.prisma.productImage.findFirst({
      where: { id: imageId, productId },
      include: { asset: true },
    });
    if (!image) {
      throw new ApiError(
        ERROR_CODES.productImageNotFound,
        'This image does not belong to the product.',
      );
    }
    return image;
  }

  /**
   * Every other place that could be pointing at the same stored object.
   *
   * A shared object must never be deleted from one business context: doing so
   * would silently break the other product, category cover or ad that still
   * renders it (docs/24 §4.2).
   */
  private async assetUsage(image: ImageWithAsset): Promise<AssetUsageSnapshot> {
    const assetId = image.fileAssetId;
    // Each guard is only queried when the row actually has an asset id; a
    // placeholder id would be cast to `uuid` in PostgreSQL and fail the request.
    const [otherProductImages, categoryCovers, desktopAds, mobileAds, pdfSourceJobs] =
      await Promise.all([
        this.prisma.productImage.count({
          where: {
            id: { not: image.id },
            OR: [{ storageKey: image.storageKey }, ...(assetId ? [{ fileAssetId: assetId }] : [])],
          },
        }),
        assetId
          ? this.prisma.category.count({ where: { coverFileAssetId: assetId } })
          : Promise.resolve(0),
        assetId ? this.prisma.ad.count({ where: { desktopAssetId: assetId } }) : Promise.resolve(0),
        assetId ? this.prisma.ad.count({ where: { mobileAssetId: assetId } }) : Promise.resolve(0),
        assetId
          ? this.prisma.pdfConversionJob.count({ where: { sourceAssetId: assetId } })
          : Promise.resolve(0),
      ]);
    return {
      otherProductImages,
      categoryCovers,
      ads: desktopAds + mobileAds,
      pdfSourceJobs,
    };
  }

  private assertDeletableKey(storageKey: string): void {
    if (!isManagedProductImageKey(storageKey)) {
      throw ApiError.validation(
        'The stored object is not under a managed product-image key and will not be deleted.',
        { storageKey: 'product.image.unmanagedKey' },
      );
    }
  }

  private imageIdempotencyKey(imageId: string): string {
    return `product-image:${imageId}`;
  }

  private productIdempotencyKey(productId: string): string {
    return `product:${productId}`;
  }

  private async enqueueDeletion(
    jobId: string,
    payload: {
      storageKey: string | null;
      entityType: string | null;
      entityId: string | null;
      productId: string | null;
    },
  ): Promise<void> {
    try {
      await this.jobs.enqueue(
        QUEUE_NAMES.fileDelete,
        { jobId, ...payload },
        // A stable BullMQ id would make a retry a silent no-op: BullMQ ignores
        // `add()` when a job with that id already exists. The database row is
        // the deduplication point; each attempt needs its own queue id.
        { jobId: `file-delete-${jobId}-${randomUUID().slice(0, 8)}` },
      );
    } catch (error) {
      // The outbox row stays QUEUED: an unreachable queue must not turn into a
      // reported success, and the scheduler/operator retry path still sees it.
      this.logger.error(
        'products.file_delete_enqueue_failed',
        error instanceof Error ? error.message : String(error),
        'ProductImagesService',
        { jobId },
      );
    }
  }

  private toOperationSummary(job: {
    id: string;
    entityType: string | null;
    entityId: string | null;
    productId: string | null;
    storageKey: string | null;
    status: string;
    attempts: number;
    lastErrorCode: string | null;
    runAfter: Date;
    createdAt: Date;
    updatedAt: Date;
    completedAt: Date | null;
  }): FileOperationSummary {
    return {
      id: job.id,
      entityType: job.entityType,
      entityId: job.entityId,
      productId: job.productId,
      productImageId: job.entityType === 'product_image' ? job.entityId : null,
      status: job.status as FileOperationSummary['status'],
      attempts: job.attempts,
      lastErrorCode: job.lastErrorCode,
      // Failed, or queued past its retry time: both mean "nothing is running
      // for this task right now, an operator may restart it".
      retryable:
        job.status === 'FAILED' ||
        (job.status === 'QUEUED' && job.runAfter.getTime() <= Date.now()),
      storageKey: job.storageKey,
      createdAt: job.createdAt.toISOString(),
      updatedAt: job.updatedAt.toISOString(),
      completedAt: job.completedAt?.toISOString() ?? null,
    };
  }
}

/** Resolves the created row that should become cover, from the submitted assets. */
function createdCoverId(
  createdIds: string[],
  assets: { fileAssetId: string; isCover: boolean }[],
  preferredAssetId: string,
): string | null {
  const index = assets.findIndex((asset) => asset.fileAssetId === preferredAssetId);
  return index === -1 ? null : (createdIds[index] ?? null);
}
