import { describe, expect, it, vi } from 'vitest';
import { S3StorageDriver } from './s3.driver';

function driver(bucket: string) {
  return new S3StorageDriver({
    endpoint: 'https://example-account.r2.cloudflarestorage.com',
    region: 'auto',
    bucket,
    accessKeyId: 'test-access-key',
    secretAccessKey: 'test-secret-key',
    forcePathStyle: true,
  });
}

describe('S3-compatible presigned URLs', () => {
  it('creates a bucket-scoped PUT URL with short-lived SigV4 parameters', async () => {
    const url = new URL(
      await driver('private-assets').presignPut(
        'product-image/2026/10/source.png',
        'image/png',
        900,
      ),
    );
    expect(url.origin).toBe('https://example-account.r2.cloudflarestorage.com');
    expect(url.pathname).toBe('/private-assets/product-image/2026/10/source.png');
    expect(url.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('900');
    expect(url.searchParams.get('X-Amz-Content-Sha256')).toBe('UNSIGNED-PAYLOAD');
    expect(url.searchParams.get('X-Amz-Credential')).toContain('/auto/s3/aws4_request');
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[a-f0-9]{64}$/);
  });

  it('derives a valid SigV4 signature with the date/region/service key chain', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-02T03:04:05.000Z'));
    try {
      const url = new URL(
        await driver('private-assets').presignPut(
          'product-image/2026/10/source.png',
          'image/png',
          900,
        ),
      );
      expect(url.searchParams.get('X-Amz-Date')).toBe('20260102T030405Z');
      expect(url.searchParams.get('X-Amz-Signature')).toBe(
        '332e8528ad6142c7e9da588c737e3e9091dde4b4865064c1158b615d3204ada4',
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('creates a GET URL for the selected bucket without exposing credentials', async () => {
    const url = new URL(
      await driver('public-assets').presignGet('public/products/a/v/640.webp', 300),
    );
    expect(url.pathname).toContain('/public-assets/public/products/');
    expect(url.toString()).not.toContain('test-secret-key');
  });
});
