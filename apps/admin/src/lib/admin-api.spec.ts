import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AdminApiError,
  buildApiUrl,
  downloadAdminFileGet,
  parseContentDispositionFilename,
} from './admin-api';

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

describe('parseContentDispositionFilename', () => {
  it('prefers an RFC 5987 UTF-8 filename and decodes it', () => {
    expect(
      parseContentDispositionFilename(
        'attachment; filename="Quotation.xlsx"; filename*=UTF-8\'\'%E6%8A%A5%E4%BB%B7%E5%8D%95_USD.xlsx',
      ),
    ).toBe('报价单_USD.xlsx');
  });

  it('falls back safely when the encoded value is malformed', () => {
    expect(
      parseContentDispositionFilename(
        'attachment; filename="Quotation_USD.xlsx"; filename*=UTF-8\'\'%E0%A4%A',
      ),
    ).toBe('Quotation_USD.xlsx');
  });

  it('removes path/control characters and uses a fallback for an empty value', () => {
    expect(parseContentDispositionFilename('attachment; filename="../bad\\name.xlsx"')).toBe(
      '.._bad_name.xlsx',
    );
    expect(parseContentDispositionFilename(null, 'fallback.xlsx')).toBe('fallback.xlsx');
  });
});

describe('downloadAdminFileGet', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns binary data, the server filename and request id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new Blob(['xlsx']), {
        status: 200,
        headers: {
          'content-disposition': "attachment; filename*=UTF-8''B2B_Quotation_Template.xlsx",
          'x-request-id': 'request-file-1',
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await downloadAdminFileGet(
      '/admin/quote-templates/template-1/file',
      'quote-template.xlsx',
    );

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/admin/quote-templates/template-1/file', {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
    });
    expect(result.filename).toBe('B2B_Quotation_Template.xlsx');
    expect(result.requestId).toBe('request-file-1');
    expect(result.blob.size).toBe(4);
  });

  it('preserves the structured API error instead of treating JSON as a file', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: 'FILE_NOT_FOUND',
              message: 'Quote template file not found.',
              requestId: 'request-file-2',
            },
          }),
          { status: 404, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );

    const error = await downloadAdminFileGet('/admin/quote-templates/missing/file').catch(
      (reason: unknown) => reason,
    );

    expect(error).toBeInstanceOf(AdminApiError);
    expect(error).toMatchObject({
      status: 404,
      code: 'FILE_NOT_FOUND',
      requestId: 'request-file-2',
    });
  });
});
