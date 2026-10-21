export const IMAGE_VARIANT_FORMAT = 'webp' as const;

export interface StoredImageVariant {
  width: number;
  height: number;
  key: string;
  format: typeof IMAGE_VARIANT_FORMAT;
  sizeBytes: number;
}

export interface PublicImageVariant {
  width: number;
  url: string;
  format: typeof IMAGE_VARIANT_FORMAT;
}

/**
 * Immutable public-image version.
 *
 * A content hash catches accidental object replacement; a missing hash falls
 * back to the database asset id, which is still unique and never reused.
 */
export function imageAssetVersion(assetId: string, sha256: string | null): string {
  const digest = sha256?.trim().toLowerCase();
  if (digest && /^[a-f0-9]{64}$/.test(digest)) return digest.slice(0, 16);
  return assetId.replace(/-/g, '').slice(0, 16);
}

/** Private storage key for a derived public WebP object. */
export function imageVariantStorageKey(assetId: string, version: string, width: number): string {
  return `public/products/${assetId}/${version}/${width}.webp`;
}

/** Stable API path; the host is added by the API which owns deployment config. */
export function publicImageVariantPath(assetId: string, version: string, name: string): string {
  return `/api/v1/files/images/${encodeURIComponent(assetId)}/${encodeURIComponent(version)}/${encodeURIComponent(name)}`;
}
