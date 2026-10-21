import { Inject, Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  QUEUE_NAMES,
  imageAssetVersion,
  imageVariantStorageKey,
} from '@b2b/contracts';
import type { FileAssetStatusResult, FileAssetSummary, MediaStagingResult } from '@b2b/contracts';
import { APP_ENV, type AppEnv } from '../../config/config.module';
import { ApiError } from '../../common/errors/api-error';
import { AuditService } from '../../common/services/audit.service';
import { CryptoService } from '../../common/services/crypto.service';
import { JobsService } from '../../common/services/jobs.service';
import { JsonLogger } from '../../common/logger.service';
import { StorageService } from '../../common/services/storage.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  PURPOSE_RULES,
  XLSX_MIME,
  detectKind,
  extensionOf,
  IMAGE_MIME_BY_KIND,
  PDF_MIME,
  VIDEO_MIME_BY_KIND,
  looksLikeXlsx,
  isPublicFileServable,
  readImageDimensions,
} from './file-validation';
import { readStoredImageVariants } from './image-variant-policy';

export interface UploadInput {
  purpose: string;
  originalName: string;
  declaredMime: string;
  buffer: Buffer;
}

@Injectable()
export class FilesService {
  constructor(
    @Inject(APP_ENV) private readonly env: AppEnv,
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly crypto: CryptoService,
    private readonly jobs: JobsService,
    private readonly audit: AuditService,
    private readonly logger: JsonLogger,
  ) {}

  async upload(input: UploadInput, actorId: string, requestId: string) {
    const rules = PURPOSE_RULES[input.purpose];
    if (!rules) {
      throw new ApiError(ERROR_CODES.uploadTypeNotAllowed, 'Unsupported upload purpose.');
    }
    if (input.buffer.byteLength === 0) {
      throw new ApiError(ERROR_CODES.uploadTypeNotAllowed, 'The uploaded file is empty.');
    }
    if (input.buffer.byteLength > this.env.UPLOAD_MAX_BYTES) {
      throw new ApiError(ERROR_CODES.uploadTooLarge, 'The uploaded file exceeds the size limit.');
    }
    const extension = extensionOf(input.originalName);
    if (!rules.extensions.includes(extension)) {
      throw new ApiError(
        ERROR_CODES.uploadTypeNotAllowed,
        `Allowed extensions for this purpose: ${rules.extensions.join(', ')}.`,
      );
    }

    const kind = detectKind(input.buffer);
    const isImageKind = kind === 'jpeg' || kind === 'png' || kind === 'webp';
    let mimeType: string;

    if (rules.kind === 'image') {
      if (kind === 'unknown' || kind === 'xlsx') {
        throw new ApiError(
          ERROR_CODES.uploadSignatureMismatch,
          'The file is not a supported image.',
        );
      }
      if (!isImageKind) {
        throw new ApiError(
          ERROR_CODES.uploadSignatureMismatch,
          'The file is not a supported image.',
        );
      }
      if (kind === 'jpeg' && !['.jpg', '.jpeg'].includes(extension)) {
        throw new ApiError(
          ERROR_CODES.uploadSignatureMismatch,
          'The file content does not match its extension.',
        );
      }
      if (
        IMAGE_MIME_BY_KIND[kind] !== input.declaredMime &&
        input.declaredMime !== 'application/octet-stream'
      ) {
        this.logger.warn(
          'upload.mime_mismatch',
          {
            declared: input.declaredMime,
            detected: IMAGE_MIME_BY_KIND[kind],
            purpose: input.purpose,
          },
          'FilesService',
        );
      }
      mimeType = IMAGE_MIME_BY_KIND[kind];
    } else if (rules.kind === 'video') {
      if (kind !== 'mp4' && kind !== 'webm') {
        throw new ApiError(
          ERROR_CODES.uploadTypeNotAllowed,
          'Only MP4 and WebM videos are accepted.',
        );
      }
      const expected = kind === 'mp4' ? ['.mp4'] : ['.webm'];
      if (!expected.includes(extension)) {
        throw new ApiError(
          ERROR_CODES.uploadSignatureMismatch,
          'The video content does not match its extension.',
        );
      }
      mimeType = VIDEO_MIME_BY_KIND[kind];
    } else if (rules.kind === 'document') {
      if (kind === 'pdf') {
        if (extension !== '.pdf') {
          throw new ApiError(
            ERROR_CODES.uploadSignatureMismatch,
            'The PDF content does not match its extension.',
          );
        }
        mimeType = PDF_MIME;
      } else if (isImageKind) {
        if (kind === 'jpeg' && !['.jpg', '.jpeg'].includes(extension)) {
          throw new ApiError(
            ERROR_CODES.uploadSignatureMismatch,
            'The image content does not match its extension.',
          );
        }
        mimeType = IMAGE_MIME_BY_KIND[kind];
      } else {
        throw new ApiError(
          ERROR_CODES.uploadTypeNotAllowed,
          'Only PDF, JPEG, PNG and WebP documents are accepted.',
        );
      }
    } else {
      if (kind !== 'xlsx' || !looksLikeXlsx(input.buffer)) {
        throw new ApiError(
          ERROR_CODES.uploadTypeNotAllowed,
          'Only macro-free .xlsx workbooks are accepted.',
        );
      }
      mimeType = XLSX_MIME;
    }

    // Pixel budget and real decoded size, both read from the file header before
    // anything is written to storage. The API owns the storage key, but it must
    // not own a decompression bomb either (docs/24 §7).
    const hasImageDimensions = rules.kind === 'image' || (rules.kind === 'document' && isImageKind);
    const dimensions = hasImageDimensions ? readImageDimensions(input.buffer, kind) : null;
    if (hasImageDimensions) {
      if (!dimensions) {
        throw new ApiError(
          ERROR_CODES.uploadSignatureMismatch,
          'The image header could not be read; the file is corrupt or not a supported image.',
        );
      }
      if (dimensions.width * dimensions.height > this.env.UPLOAD_MAX_PIXELS) {
        throw new ApiError(
          ERROR_CODES.uploadPixelLimitExceeded,
          `The image exceeds the ${this.env.UPLOAD_MAX_PIXELS} pixel limit.`,
          { details: { width: dimensions.width, height: dimensions.height } },
        );
      }
    }

    const storageKey = this.storage.buildKey(input.purpose, input.originalName);
    const sha256 = this.crypto.sha256(input.buffer);
    const stored = await this.storage.put(storageKey, input.buffer, mimeType);

    const asset = await this.prisma.fileAsset.create({
      data: {
        storageKey,
        originalName: input.originalName.slice(0, 255),
        mimeType,
        sizeBytes: BigInt(stored.sizeBytes),
        sha256,
        width: dimensions?.width ?? null,
        height: dimensions?.height ?? null,
        purpose: input.purpose,
        // The original is validated and stored; derivative generation is a
        // follow-up job and does not block using the asset.
        // Sharp owns the real decode. The asset cannot be attached or served
        // as ready until the worker has produced at least one safe variant.
        status: hasImageDimensions ? 'processing' : 'ready',
        isPublic: rules.isPublic,
        uploadedById: actorId,
      },
    });

    if (hasImageDimensions) {
      try {
        await this.enqueueDerivatives(asset.id, storageKey);
      } catch {
        await this.prisma.fileAsset.update({
          where: { id: asset.id },
          data: { status: 'failed' },
        });
        throw new ApiError(
          ERROR_CODES.uploadProcessingFailed,
          'The image could not be queued for safe processing.',
        );
      }
    }

    await this.audit.record({
      actorId,
      action: 'file.upload',
      entityType: 'file_asset',
      entityId: asset.id,
      requestId,
      metadata: { purpose: input.purpose, mimeType, sizeBytes: stored.sizeBytes },
    });

    return {
      id: asset.id,
      storageKey: asset.storageKey,
      version: imageAssetVersion(asset.id, asset.sha256),
      originalName: asset.originalName,
      mimeType: asset.mimeType,
      sizeBytes: stored.sizeBytes,
      width: asset.width,
      height: asset.height,
      status: asset.status,
      url:
        asset.purpose === 'product-image'
          ? this.storage.adminProductImageUrl(asset.id)
          : asset.isPublic
            ? this.storage.publicUrl(asset.storageKey)
            : null,
    };
  }

  async list(query: { page: number; pageSize: number; status?: string; purpose?: string }) {
    const where = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.purpose ? { purpose: query.purpose } : {}),
    };
    const [total, assets] = await this.prisma.$transaction([
      this.prisma.fileAsset.count({ where }),
      this.prisma.fileAsset.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      data: assets.map((asset): FileAssetSummary => ({
        id: asset.id,
        storageKey: asset.storageKey,
        originalName: asset.originalName,
        mimeType: asset.mimeType,
        sizeBytes: Number(asset.sizeBytes),
        width: asset.width,
        height: asset.height,
        status: asset.status,
        url:
          asset.purpose === 'product-image'
            ? this.storage.adminProductImageUrl(asset.id)
            : asset.isPublic
              ? this.storage.publicUrl(asset.storageKey)
              : null,
        createdAt: asset.createdAt.toISOString(),
      })),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      },
    };
  }

  async getPublicAsset(storageKey: string) {
    const asset = await this.prisma.fileAsset.findUnique({ where: { storageKey } });
    // Product sources are intentionally excluded: public access must go through
    // the publication-gated, content-versioned image route below.
    if (!asset || !isPublicFileServable(asset)) {
      return null;
    }
    return asset;
  }

  async getAssetOrThrow(id: string) {
    const asset = await this.prisma.fileAsset.findUnique({ where: { id } });
    if (!asset) throw new ApiError(ERROR_CODES.fileNotFound, 'File not found.');
    return asset;
  }

  // Short-lived signed URL. The signature is bound to the storage key and an
  // expiry, so a link cannot be reused for a different object or after the
  // window closes (docs/05 §4).
  async createSignedUrl(
    id: string,
    ttlSeconds: number,
  ): Promise<{ url: string; expiresAt: string }> {
    const asset = await this.getAssetOrThrow(id);
    const token = this.crypto.signPayload(asset.storageKey, ttlSeconds);
    return {
      url: `${this.env.API_BASE_URL.replace(/\/+$/, '')}/api/v1/files/signed/${asset.storageKey}?token=${encodeURIComponent(token)}`,
      expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    };
  }

  verifySignedToken(storageKey: string, token: string): boolean {
    return this.crypto.verifyPayloadSignature(storageKey, token);
  }

  async getAnyAssetByKey(storageKey: string) {
    return this.prisma.fileAsset.findUnique({ where: { storageKey } });
  }

  async getStagingAsset(id: string): Promise<MediaStagingResult> {
    const asset = await this.getAssetOrThrow(id);
    if (asset.purpose !== 'product-image') {
      throw ApiError.validation('The file is not a product image.', {
        fileAssetId: 'product.image.invalidPurpose',
      });
    }
    return {
      fileAssetId: asset.id,
      storageKey: asset.storageKey,
      version: imageAssetVersion(asset.id, asset.sha256),
      originalName: asset.originalName,
      mimeType: asset.mimeType,
      sizeBytes: Number(asset.sizeBytes),
      width: asset.width,
      height: asset.height,
      status: asset.status === 'ready' || asset.status === 'failed' ? asset.status : 'processing',
      url: asset.isPublic ? this.storage.adminProductImageUrl(asset.id) : null,
    };
  }

  async getAssetStatus(id: string): Promise<FileAssetStatusResult> {
    const asset = await this.getAssetOrThrow(id);
    return {
      fileAssetId: asset.id,
      status: asset.status === 'ready' || asset.status === 'failed' ? asset.status : 'processing',
      url:
        asset.purpose === 'product-image'
          ? this.storage.adminProductImageUrl(asset.id)
          : asset.isPublic
            ? this.storage.publicUrl(asset.storageKey)
            : null,
      width: asset.width,
      height: asset.height,
    };
  }

  /**
   * Resolves an immutable product-image URL to a stored object.
   *
   * The database remains the access-control source: the asset must be a ready
   * product image and still be attached to a published product. A guessed asset
   * id, stale content version, detached image or unpublished product yields 404.
   */
  async resolvePublicProductImage(
    assetId: string,
    version: string,
    name: string,
  ): Promise<{ key: string; contentType: string } | null> {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(assetId)
    ) {
      return null;
    }
    const asset = await this.prisma.fileAsset.findUnique({ where: { id: assetId } });
    if (
      !asset ||
      !asset.isPublic ||
      asset.purpose !== 'product-image' ||
      asset.status !== 'ready' ||
      imageAssetVersion(asset.id, asset.sha256) !== version
    ) {
      return null;
    }

    const usage = await this.prisma.productImage.findFirst({
      where: {
        fileAssetId: asset.id,
        deleteState: 'READY',
        product: {
          publishStatus: 'PUBLISHED',
          lifecycleStatus: { not: 'DISCONTINUED' },
        },
      },
      select: { id: true },
    });
    if (!usage) return null;

    if (name === 'source') {
      return { key: asset.storageKey, contentType: asset.mimeType };
    }
    const match = /^(\d{1,5})\.webp$/.exec(name);
    if (!match) return null;
    const width = Number.parseInt(match[1] as string, 10);
    const variant = readStoredImageVariants(asset.derivatives).find(
      (candidate) => candidate.width === width && candidate.format === 'webp',
    );
    if (!variant) return null;
    const expectedKey = imageVariantStorageKey(asset.id, version, width);
    if (variant.key !== expectedKey) return null;
    return { key: variant.key, contentType: 'image/webp' };
  }

  /**
   * Deletes the asset record and queues physical deletion. The two systems have
   * no shared transaction, so the object is removed by an idempotent retryable
   * job instead of being assumed deleted (docs/10 §7).
   */
  async remove(id: string, actorId: string, requestId: string) {
    const asset = await this.getAssetOrThrow(id);
    const [productImageCount, categoryCount, adCount] = await this.prisma.$transaction([
      this.prisma.productImage.count({ where: { fileAssetId: id } }),
      this.prisma.category.count({ where: { coverFileAssetId: id } }),
      this.prisma.ad.count({
        where: { OR: [{ desktopAssetId: id }, { mobileAssetId: id }] },
      }),
    ]);
    const references = productImageCount + categoryCount + adCount;
    if (references > 0) {
      throw new ApiError(
        ERROR_CODES.conflict,
        'This image is still referenced. Detach it from products, categories or ads first.',
        { details: { productImageCount, categoryCount, adCount } },
      );
    }

    const job = await this.prisma.fileDeletionJob.create({
      data: {
        storageKey: asset.storageKey,
        entityType: 'file_asset',
        entityId: asset.id,
        status: 'QUEUED',
      },
    });
    await this.prisma.fileAsset.delete({ where: { id } });

    try {
      await this.jobs.enqueue(QUEUE_NAMES.fileDelete, {
        jobId: job.id,
        storageKey: asset.storageKey,
      });
    } catch (error) {
      this.logger.error(
        'file.delete_enqueue_failed',
        error instanceof Error ? error.message : String(error),
        'FilesService',
        { jobId: job.id, storageKey: asset.storageKey },
      );
      // The deletion job remains queued in the database and can be retried by an
      // operator or the scheduler; the API reports success because the record is
      // already gone from the UI.
    }

    await this.audit.record({
      actorId,
      action: 'file.delete',
      entityType: 'file_asset',
      entityId: id,
      requestId,
      metadata: { storageKey: asset.storageKey, deletionJobId: job.id },
    });
    return { deleted: true, deletionJobId: job.id };
  }

  async enqueueDerivatives(fileAssetId: string, storageKey: string): Promise<void> {
    await this.jobs.enqueue(QUEUE_NAMES.imageDerivatives, {
      fileAssetId,
      storageKey,
      widths: this.env.imageDerivativeWidths,
    });
  }
}
