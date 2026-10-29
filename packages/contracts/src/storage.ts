export type StorageVisibility = 'public' | 'private';

const PUBLIC_KEY_PREFIXES = ['public/'] as const;

const PRIVATE_KEY_PREFIXES = [
  'private/',
  'product-image/',
  'quote-template/',
  'quote-exports/',
  'product-import/',
  'pdf/',
  'category-cover/',
  'ad-image/',
  'logo/',
  'content/',
  'factory-media-image/',
  'factory-media-video/',
  'factory-process-image/',
  'credential-document/',
] as const;

/**
 * Object visibility is part of the storage design, not a URL guess.
 *
 * Unknown prefixes fail closed: callers that need a public object must use an
 * explicitly approved prefix, while legacy/private keys are never routed to the
 * public bucket by accident.
 */
export function storageVisibilityForKey(key: string): StorageVisibility {
  const normalized = key.replace(/^\/+/, '');
  if (PRIVATE_KEY_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    return 'private';
  }
  if (PUBLIC_KEY_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    return 'public';
  }
  return 'private';
}

/** Deterministic private key for one browser upload chunk. Never user supplied. */
export function productImportChunkKey(uploadId: string, index: number): string {
  return `product-import/${uploadId}/chunks/${String(index).padStart(6, '0')}.part`;
}

export interface PresignedUploadResult {
  fileAssetId: string;
  storageKey: string;
  method: 'PUT';
  uploadUrl: string;
  headers: Record<string, string>;
  expiresAt: string;
}
