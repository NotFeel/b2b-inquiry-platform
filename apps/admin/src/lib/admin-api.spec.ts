import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildApiUrl } from './admin-api';

const source = readFileSync(fileURLToPath(new URL('./admin-api.ts', import.meta.url)), 'utf8');

describe('buildApiUrl', () => {
  it('defaults to a same-origin API path instead of a browser-visible localhost host', () => {
    expect(buildApiUrl('/admin/auth/me', { locale: 'zh-CN' }, '')).toBe(
      '/api/v1/admin/auth/me?locale=zh-CN',
    );
  });

  it('normalizes a path and omits empty query values', () => {
    expect(
      buildApiUrl('admin/products', { q: 'tomato', page: 1, hasImages: undefined, status: '' }, ''),
    ).toBe('/api/v1/admin/products?q=tomato&page=1');
  });

  it('uses an explicitly configured cross-origin API URL when provided', () => {
    expect(buildApiUrl('/admin/media/staging', undefined, 'https://api.example.com/')).toBe(
      'https://api.example.com/api/v1/admin/media/staging',
    );
  });

  it('uses R2 presigned PUT and confirm endpoints with a multipart fallback', () => {
    expect(source).toContain("'/admin/files/presign-upload'");
    expect(source).toContain('/admin/files/${upload.fileAssetId}/confirm-upload');
    expect(source).toContain("error.code !== 'UPLOAD_DIRECT_UNAVAILABLE'");
    expect(source).toContain("buildApiUrl('/admin/files/upload'");
  });
});
