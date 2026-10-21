import type { PublicImageVariant } from '@b2b/contracts';

/** Builds a standards-based `srcset` from server-provided WebP variants. */
export function imageSrcSet(variants: PublicImageVariant[] | null | undefined): string | undefined {
  if (!variants || variants.length === 0) return undefined;
  return [...variants]
    .sort((left, right) => left.width - right.width)
    .map((variant) => `${variant.url} ${variant.width}w`)
    .join(', ');
}

export const PRODUCT_GRID_IMAGE_SIZES =
  '(max-width: 359px) 100vw, (max-width: 767px) 50vw, (max-width: 1279px) 33vw, 25vw';
export const HOME_HERO_IMAGE_SIZES = '(max-width: 767px) 100vw, 33vw';
export const INQUIRY_THUMB_IMAGE_SIZES = '72px';
