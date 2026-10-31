import { afterEach, describe, expect, it, vi } from 'vitest';
import { excelPdfApi, validateExcelPdfFile, type ExcelPdfUploadProgress } from './excel-pdf-api';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: vi.fn(async () => body),
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Excel-to-PDF chunk upload API', () => {
  it('reuses the idempotency key, retries a chunk and polls the created job', async () => {
    const uploadId = '22222222-2222-4222-8222-222222222222';
    const jobId = '33333333-3333-4333-8333-333333333333';
    const chunkBodies: Blob[] = [];
    const idempotencyKeys: string[] = [];
    let firstChunkAttempts = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/admin/excel-pdf/uploads')) {
        idempotencyKeys.push(new Headers(init?.headers).get('Idempotency-Key') ?? '');
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
          data: {
            uploadId,
            status: 'QUEUED',
            jobId,
            errorCode: null,
            originalName: 'quotation.xlsx',
            sizeBytes: 10,
            chunkCount: 3,
            uploadedChunks: 3,
            uploadedBytes: 10,
            expiresAt: '2030-01-01T00:00:00.000Z',
          },
        });
      }
      if (url.endsWith(`/jobs/${jobId}`)) {
        return jsonResponse({
          data: {
            id: jobId,
            fileName: 'quotation.xlsx',
            businessType: 'quotation',
            fileSize: 10,
            status: 'succeeded',
            pageCount: 2,
            outputSize: 2048,
            errorCode: null,
            createdAt: '2030-01-01T00:00:00.000Z',
            startedAt: '2030-01-01T00:00:01.000Z',
            completedAt: '2030-01-01T00:00:02.000Z',
            expiresAt: '2030-01-08T00:00:00.000Z',
            createdBy: 'admin',
            canDownload: true,
          },
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const progress: ExcelPdfUploadProgress[] = [];

    const result = await excelPdfApi.uploadAndConvert(
      new File(['abcdefghij'], 'quotation.xlsx'),
      'quotation',
      {
        idempotencyKey: 'excel-pdf-test-key',
        maxChunkRetries: 1,
        pollIntervalMs: 0,
        onProgress: (event) => progress.push(event),
      },
    );

    expect(result.status).toBe('succeeded');
    expect(idempotencyKeys).toEqual(['excel-pdf-test-key']);
    expect(chunkBodies.map((chunk) => chunk.size)).toEqual([4, 4, 2]);
    expect(firstChunkAttempts).toBe(2);
    expect(progress.some((event) => event.retryingChunkIndex === 0)).toBe(true);
    expect(progress).toContainEqual(
      expect.objectContaining({ phase: 'uploading', uploadedBytes: 10, uploadedChunks: 3 }),
    );
    expect(progress).toContainEqual(
      expect.objectContaining({ phase: 'converting', jobId, jobStatus: 'succeeded' }),
    );
  });

  it('validates extension, empty files and the deployment limit before upload', () => {
    expect(validateExcelPdfFile(new File(['x'], 'book.xls'), 10)).toBe('extension');
    expect(validateExcelPdfFile(new File([], 'book.xlsx'), 10)).toBe('empty');
    expect(validateExcelPdfFile(new File(['12345678901'], 'book.xlsx'), 10)).toBe('tooLarge');
    expect(validateExcelPdfFile(new File(['123'], 'BOOK.XLSX'), 10)).toBeNull();
  });
});
