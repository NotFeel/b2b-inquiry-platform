import { describe, expect, it } from 'vitest';
import { readStoredImageVariants } from './image-variant-policy';

describe('stored image variants', () => {
  it('returns only complete WebP metadata written by the worker', () => {
    expect(
      readStoredImageVariants({
        variants: [
          {
            width: 640,
            height: 480,
            key: 'public/products/asset/version/640.webp',
            format: 'webp',
            sizeBytes: 1234,
          },
          {
            width: 1280,
            height: 720,
            key: 'public/products/asset/version/1280.avif',
            format: 'avif',
            sizeBytes: 999,
          },
          { width: 'broken' },
        ],
      }),
    ).toEqual([
      {
        width: 640,
        height: 480,
        key: 'public/products/asset/version/640.webp',
        format: 'webp',
        sizeBytes: 1234,
      },
    ]);
  });

  it('treats unknown legacy JSON as no variants', () => {
    expect(readStoredImageVariants(null)).toEqual([]);
    expect(readStoredImageVariants({ variants: 'invalid' })).toEqual([]);
  });
});
