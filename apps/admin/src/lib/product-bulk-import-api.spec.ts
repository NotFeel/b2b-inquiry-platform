import { afterEach, describe, expect, it, vi } from 'vitest';
import { productBulkImportApi, type ProductImportUploadProgress } from './product-bulk-import-api';

const settings = {
  categoryId: '11111111-1111-4111-8111-111111111111',
  publishStatus: 'draft' as const,
  lifecycleStatus: 'available' as const,
  tagIds: [],
  templateVersion: 'optimized-v1' as const,
};

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn(async () => body),
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('product bulk import chunk upload API', () => {
  it('slices by the server chunk size, retries a failed chunk, and polls to validation', async () => {
    const uploadId = '22222222-2222-4222-8222-222222222222';
    const chunkBodies: Blob[] = [];
    let firstChunkAttempts = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/admin/products/bulk-import/uploads')) {
        return jsonResponse({
          data: { uploadId, chunkSize: 4, chunkCount: 3, expiresAt: '2030-01-01T00:00:00.000Z' },
        });
      }
      if (url.includes('/chunks/0') && firstChunkAttempts++ === 0) {
        return jsonResponse(
          { error: { code: 'STORAGE_UNAVAILABLE', message: 'temporary storage failure' } },
          503,
        );
      }
      if (url.includes('/chunks/')) {
        chunkBodies.push((init?.body as FormData).get('file') as Blob);
        return jsonResponse({
          data: { uploadId, index: chunkBodies.length - 1, uploadedBytes: 4 },
        });
      }
      if (url.endsWith(`/uploads/${uploadId}/complete`)) {
        return jsonResponse({
          data: { uploadId, status: 'QUEUED', validation: null },
        });
      }
      if (url.endsWith(`/uploads/${uploadId}`)) {
        return jsonResponse({
          data: {
            uploadId,
            status: 'VALIDATED',
            validation: { validationId: 'validation-id' },
          },
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const progress: ProductImportUploadProgress[] = [];

    const result = await productBulkImportApi.uploadAndValidate(
      new File(['abcdefghij'], 'large.xlsx'),
      settings,
      {
        maxChunkRetries: 1,
        pollIntervalMs: 0,
        onProgress: (event) => progress.push(event),
      },
    );

    expect(result.status).toBe('VALIDATED');
    expect(chunkBodies.map((chunk) => chunk.size)).toEqual([4, 4, 2]);
    expect(firstChunkAttempts).toBe(2);
    expect(progress.some((event) => event.retryingChunkIndex === 0)).toBe(true);
    expect(progress).toContainEqual(
      expect.objectContaining({ phase: 'uploading', uploadedBytes: 10, uploadedChunks: 3 }),
    );
    expect(progress).toContainEqual(expect.objectContaining({ phase: 'validating' }));
  });

  it('uses the dedicated cancel endpoint when an upload is abandoned', async () => {
    const uploadId = '22222222-2222-4222-8222-222222222222';
    const fetchMock = vi.fn(async () =>
      jsonResponse({ data: { uploadId, status: 'CANCELLED', validation: null } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const status = await productBulkImportApi.cancelUpload(uploadId);

    expect(status.status).toBe('CANCELLED');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(`/uploads/${uploadId}/cancel`),
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    );
  });
});
