import { PRODUCT_IMAGE_LIMITS } from '@b2b/contracts';

/**
 * Pure rules for the product gallery (docs/24 §4, §7, §8).
 *
 * Everything here is deliberately free of Prisma, HTTP and the filesystem so the
 * dangerous parts of image handling - which key may be deleted, who else uses an
 * object, which image becomes the new cover, whether a submitted order is
 * trustworthy - can be unit tested without a database or a storage driver.
 */

export interface AssetUsageSnapshot {
  /** Other product-image rows (any product) pointing at the same object. */
  otherProductImages: number;
  /** Category cover references. */
  categoryCovers: number;
  /** Ad creatives (desktop + mobile). */
  ads: number;
  /** Spreadsheet sources of PDF conversion jobs. */
  pdfSourceJobs: number;
}

export type AssetUsageKind = keyof AssetUsageSnapshot;

/**
 * A storage key may only be deleted when it is a key this application manages.
 *
 * The key always comes from the database row - never from the request - but it
 * is re-checked here so a malformed or hand-edited row can never turn a delete
 * request into a traversal outside the managed prefix (docs/24 §5.3, §7).
 */
export function isManagedProductImageKey(
  key: string | null | undefined,
  prefixes: readonly string[] = PRODUCT_IMAGE_LIMITS.managedKeyPrefixes,
): boolean {
  if (!key) return false;
  if (key.length < 4 || key.length > 500) return false;
  if (key.includes('..')) return false;
  if (key.startsWith('/') || key.startsWith('\\')) return false;
  if (!/^[A-Za-z0-9/_.-]+$/.test(key)) return false;
  return prefixes.some((prefix) => key.startsWith(prefix));
}

/** True when at least one other business entity points at the same object. */
export function describeSharedAsset(usage: AssetUsageSnapshot): AssetUsageKind[] {
  return (Object.keys(usage) as AssetUsageKind[]).filter((kind) => usage[kind] > 0);
}

export function isSharedAsset(usage: AssetUsageSnapshot): boolean {
  return describeSharedAsset(usage).length > 0;
}

/**
 * Validates a submitted gallery order.
 *
 * The client must submit the complete list of the product's *usable* images:
 * a partial list, an unknown id or an id belonging to another product is
 * rejected outright instead of being silently ignored, because a silently
 * ignored id is how a concurrent editor loses their ordering (docs/24 §8.3).
 */
export function normalizeImageOrder(
  submitted: string[],
  currentImageIds: string[],
): { ordered: string[] } | { error: 'DUPLICATE' | 'UNKNOWN' | 'INCOMPLETE'; unknownIds?: string[] } {
  const unique = new Set(submitted);
  if (unique.size !== submitted.length) return { error: 'DUPLICATE' };

  const known = new Set(currentImageIds);
  const unknown = submitted.filter((id) => !known.has(id));
  if (unknown.length > 0) return { error: 'UNKNOWN', unknownIds: unknown };
  if (unique.size !== known.size) {
    return { error: 'INCOMPLETE', unknownIds: [...known].filter((id) => !unique.has(id)) };
  }
  return { ordered: submitted };
}

export interface CoverCandidate {
  id: string;
  sortOrder: number;
  deleteState: string;
}

/**
 * The image that becomes cover after the current cover is removed.
 *
 * Only a usable image can be promoted: an image whose object is being (or
 * failed to be) deleted must never be presented as the product's cover.
 */
export function pickReplacementCover(
  images: CoverCandidate[],
  excludedId: string | null,
): string | null {
  const candidates = images
    .filter((image) => image.deleteState === 'READY' && image.id !== excludedId)
    .sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id));
  return candidates[0]?.id ?? null;
}

/**
 * Maps a product's images onto a single, guaranteed cover.
 *
 * Exactly one usable image carries `isCover`. When none was marked - an attach
 * that did not name a cover, or a cover that was just deleted - the first usable
 * image in display order is promoted, so the storefront never receives a gallery
 * without a cover (docs/24 §3.3 F).
 */
export function resolveCoverAssignment(
  images: { id: string; sortOrder: number; deleteState: string; isCover: boolean }[],
  preferredCoverId: string | null,
): { coverId: string | null; covers: string[] } {
  const usable = images.filter((image) => image.deleteState === 'READY');
  const requested =
    preferredCoverId && usable.some((image) => image.id === preferredCoverId)
      ? preferredCoverId
      : null;
  const existing = usable
    .filter((image) => image.isCover)
    .sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id))[0];
  const coverId = requested ?? existing?.id ?? pickReplacementCover(images, null);
  return { coverId, covers: coverId ? [coverId] : [] };
}

/** Alt text is never left empty: it is generated from the product name. */
export function defaultAltText(productName: string | null | undefined, fallback: string): string {
  const base = (productName ?? '').trim() || fallback.trim() || 'Product image';
  return base.slice(0, PRODUCT_IMAGE_LIMITS.maxAltTextLength);
}

/**
 * Whether a product may be published.
 *
 * A published product is reachable by the storefront, so it needs at least one
 * usable image; an image that is processing, pending deletion or failed to
 * delete is not a usable image (docs/24 §3.4, §8.1).
 */
export function canPublishProduct(usableImageCount: number): boolean {
  return usableImageCount > 0;
}

/** `product-image/2026/10/<uuid>.png` -> `product-image` bucket for reporting. */
export function imageKeyScope(key: string): string {
  return key.split('/')[0] ?? 'unknown';
}
