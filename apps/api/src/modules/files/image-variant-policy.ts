import type { StoredImageVariant } from '@b2b/contracts';

/**
 * Reads worker-written derivative metadata defensively.
 *
 * FileAsset.derivatives is JSON and may predate the current schema. Unknown
 * shapes are treated as "no variants" so callers can fall back to the versioned
 * source route instead of emitting an invalid URL.
 */
export function readStoredImageVariants(derivatives: unknown): StoredImageVariant[] {
  if (typeof derivatives !== 'object' || derivatives === null) return [];
  const variants = (derivatives as { variants?: unknown }).variants;
  if (!Array.isArray(variants)) return [];
  return variants.flatMap((variant) => {
    if (typeof variant !== 'object' || variant === null) return [];
    const row = variant as {
      width?: unknown;
      height?: unknown;
      key?: unknown;
      format?: unknown;
      sizeBytes?: unknown;
    };
    if (
      typeof row.width !== 'number' ||
      !Number.isInteger(row.width) ||
      row.width < 1 ||
      typeof row.height !== 'number' ||
      !Number.isInteger(row.height) ||
      row.height < 1 ||
      typeof row.key !== 'string' ||
      row.format !== 'webp' ||
      typeof row.sizeBytes !== 'number' ||
      !Number.isFinite(row.sizeBytes) ||
      row.sizeBytes < 1
    ) {
      return [];
    }
    return [
      {
        width: row.width,
        height: row.height,
        key: row.key,
        format: row.format,
        sizeBytes: row.sizeBytes,
      },
    ];
  });
}
