import { Inject, Injectable } from '@nestjs/common';
import {
  imageVariantStorageKey,
  publicImageVariantPath,
  storageVisibilityForKey,
  type StorageVisibility,
} from '@b2b/contracts';
import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import type { Readable } from 'node:stream';
import { APP_ENV, type AppEnv } from '../../config/config.module';
import { JsonLogger } from '../logger.service';
import { LocalStorageDriver } from './object-storage/local.driver';
import { S3StorageDriver } from './object-storage/s3.driver';
import type { StorageDriver, StoredObject } from './object-storage/storage.types';
import { resolveFromRepoRoot } from './storage-path';

// Storage keys are always generated here: never derived from a user-supplied
// filename, and never taken from the client (docs/07 §7, docs/11 §2).
@Injectable()
export class StorageService {
  private readonly drivers = new Map<StorageVisibility, StorageDriver>();

  constructor(
    @Inject(APP_ENV) private readonly env: AppEnv,
    private readonly logger: JsonLogger,
  ) {}

  private getDriver(visibility: StorageVisibility): StorageDriver {
    const existing = this.drivers.get(visibility);
    if (existing) return existing;
    if (this.env.STORAGE_DRIVER === 's3') {
      const bucket =
        visibility === 'public'
          ? this.env.S3_PUBLIC_BUCKET || this.env.S3_BUCKET
          : this.env.S3_PRIVATE_BUCKET || this.env.S3_BUCKET;
      if (!bucket || !this.env.S3_ACCESS_KEY_ID || !this.env.S3_SECRET_ACCESS_KEY) {
        throw new Error(
          'STORAGE_DRIVER=s3 requires configured public/private buckets and S3 credentials.',
        );
      }
      const driver = new S3StorageDriver({
        endpoint: this.env.S3_ENDPOINT || `https://s3.${this.env.S3_REGION}.amazonaws.com`,
        region: this.env.S3_REGION || 'us-east-1',
        bucket,
        accessKeyId: this.env.S3_ACCESS_KEY_ID,
        secretAccessKey: this.env.S3_SECRET_ACCESS_KEY,
        forcePathStyle: this.env.S3_FORCE_PATH_STYLE,
      });
      this.drivers.set(visibility, driver);
      return driver;
    } else {
      const driver =
        existing ?? new LocalStorageDriver(resolveFromRepoRoot(this.env.STORAGE_LOCAL_ROOT));
      this.drivers.set(visibility, driver);
      return driver;
    }
  }

  buildKey(prefix: string, originalName: string, forcedExtension?: string): string {
    const now = new Date();
    const year = now.getUTCFullYear().toString();
    const month = (now.getUTCMonth() + 1).toString().padStart(2, '0');
    const extension = (forcedExtension ?? extname(originalName))
      .toLowerCase()
      .replace(/[^a-z0-9.]/g, '');
    return `${prefix}/${year}/${month}/${randomUUID()}${extension}`;
  }

  async put(key: string, body: Buffer, contentType: string): Promise<StoredObject> {
    try {
      return await this.getDriver(storageVisibilityForKey(key)).put(key, body, contentType);
    } catch (error) {
      this.logger.error(
        'storage.put_failed',
        error instanceof Error ? error.stack : String(error),
        'StorageService',
        { key },
      );
      throw error;
    }
  }

  async get(key: string): Promise<Buffer> {
    return this.getDriver(storageVisibilityForKey(key)).get(key);
  }

  createReadStream(key: string): Readable {
    return this.getDriver(storageVisibilityForKey(key)).createReadStream(key);
  }

  async exists(key: string): Promise<boolean> {
    return this.getDriver(storageVisibilityForKey(key)).exists(key);
  }

  async delete(key: string): Promise<void> {
    await this.getDriver(storageVisibilityForKey(key)).delete(key);
  }

  async stat(key: string) {
    return this.getDriver(storageVisibilityForKey(key)).stat(key);
  }

  supportsPresignedUploads(): boolean {
    return this.env.STORAGE_DRIVER === 's3';
  }

  async presignPut(key: string, contentType: string, expiresSeconds: number): Promise<string> {
    return this.getDriver(storageVisibilityForKey(key)).presignPut(
      key,
      contentType,
      expiresSeconds,
    );
  }

  async presignGet(key: string, expiresSeconds: number): Promise<string> {
    return this.getDriver(storageVisibilityForKey(key)).presignGet(key, expiresSeconds);
  }

  /** Public URL for derived, published image assets only. */
  publicUrl(key: string): string {
    const base = this.env.S3_PUBLIC_BASE_URL.replace(/\/+$/, '');
    if (
      storageVisibilityForKey(key) === 'public' &&
      this.env.STORAGE_DRIVER === 's3' &&
      base.length > 0
    ) {
      return `${base}/${key}`;
    }
    return `${this.env.API_BASE_URL.replace(/\/+$/, '')}/api/v1/files/${key}`;
  }

  /** Immutable, publication-gated public product-image URL. */
  publicProductImageUrl(assetId: string, version: string, name: string): string {
    // Published derivatives live at the exact R2 object key and should bypass
    // the API proxy. Keep the API route for local development and source fallback.
    const publicBase = this.env.S3_PUBLIC_BASE_URL.replace(/\/+$/, '');
    const isVariantName = /^\d+\.webp$/.test(name);
    if (this.env.STORAGE_DRIVER === 's3' && publicBase.length > 0 && isVariantName) {
      const width = Number.parseInt(name, 10);
      const key = imageVariantStorageKey(assetId, version, width);
      return `${publicBase}/${key}`;
    }
    return `${this.env.API_BASE_URL.replace(/\\/+$/, '')}${publicImageVariantPath(assetId, version, name)}`;
  }

  /** Authenticated admin-only preview for a product-image source object. */
  adminProductImageUrl(assetId: string): string {
    // Relative to the Admin origin so the browser uses its authenticated
    // same-origin proxy and the session cookie is never sent cross-site.
    return `/api/v1/admin/media/assets/${assetId}/preview`;
  }
}
