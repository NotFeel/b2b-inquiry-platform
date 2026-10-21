import { describe, expect, it } from 'vitest';
import { buildApiUrl } from './admin-api';

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
});
