import { describe, expect, it } from 'vitest';
import { imageAssetVersion, imageVariantStorageKey, publicImageVariantPath } from './images';

describe('immutable public image URLs', () => {
  it('uses a content version and never a client-supplied storage key', () => {
    const assetId = '11111111-1111-4111-8111-111111111111';
    const version = imageAssetVersion(assetId, 'A'.repeat(64));
    expect(version).toBe('aaaaaaaaaaaaaaaa');
    expect(imageVariantStorageKey(assetId, version, 640)).toBe(
      `public/products/${assetId}/aaaaaaaaaaaaaaaa/640.webp`,
    );
    expect(publicImageVariantPath(assetId, version, '640.webp')).toBe(
      `/api/v1/files/images/${assetId}/aaaaaaaaaaaaaaaa/640.webp`,
    );
  });

  it('falls back to the unique asset id when a legacy hash is unavailable', () => {
    expect(imageAssetVersion('11111111-1111-4111-8111-111111111111', null)).toBe(
      '1111111111114111',
    );
  });
});
