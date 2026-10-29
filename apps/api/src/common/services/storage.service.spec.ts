import { describe, expect, it } from 'vitest';
import type { AppEnv } from '../../config/config.module';
import type { JsonLogger } from '../logger.service';
import { StorageService } from './storage.service';

const env = {
  STORAGE_DRIVER: 's3',
  STORAGE_LOCAL_ROOT: './.data/uploads',
  S3_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
  S3_REGION: 'auto',
  S3_BUCKET: '',
  S3_PUBLIC_BUCKET: 'public-assets',
  S3_PRIVATE_BUCKET: 'private-assets',
  S3_ACCESS_KEY_ID: 'key',
  S3_SECRET_ACCESS_KEY: 'secret',
  S3_PUBLIC_BASE_URL: 'https://images.example.com',
  S3_FORCE_PATH_STYLE: true,
  API_BASE_URL: 'https://api.example.com',
} as unknown as AppEnv;

function service() {
  return new StorageService(env, {} as JsonLogger);
}

describe('R2 bucket routing', () => {
  it('presigns private product sources against the private bucket', async () => {
    const url = new URL(
      await service().presignPut('product-image/2026/10/source.png', 'image/png', 900),
    );
    expect(url.pathname).toBe('/private-assets/product-image/2026/10/source.png');
  });

  it('presigns generated product variants against the public bucket', async () => {
    const url = new URL(
      await service().presignPut('public/products/asset/version/640.webp', 'image/webp', 900),
    );
    expect(url.pathname).toBe('/public-assets/public/products/asset/version/640.webp');
  });


  it('serves published product variants from the configured R2 custom domain', () => {
    expect(service().publicProductImageUrl('asset-id', 'version-id', '1280.webp')).toBe(
      'https://images.example.com/public/products/asset-id/version-id/1280.webp',
    );
    expect(service().publicProductImageUrl('asset-id', 'version-id', '640.webp')).toBe(
      'https://images.example.com/public/products/asset-id/version-id/640.webp',
    );
  });

  it('uses a same-origin path for product images when local storage is enabled', () => {
    const localEnv = {
      ...env,
      STORAGE_DRIVER: 'local',
      API_BASE_URL: 'http://api:3002',
      S3_PUBLIC_BASE_URL: '',
      NODE_ENV: 'production',
    } as unknown as AppEnv;
    const localService = new StorageService(localEnv, {} as JsonLogger);

    expect(localService.publicProductImageUrl('asset-id', 'version-id', '1280.webp')).toBe(
      '/api/v1/files/images/asset-id/version-id/1280.webp',
    );
  });

  it('keeps non-CDN file URLs same-origin and does not expose private keys via the CDN', () => {
    expect(service().publicUrl('quote-exports/2026/10/job.xlsx')).toBe(
      '/api/v1/files/quote-exports/2026/10/job.xlsx',
    );
    expect(service().publicUrl('public/products/asset/version/640.webp')).toBe(
      'https://images.example.com/public/products/asset/version/640.webp',
    );
  });
});
