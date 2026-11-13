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
  '(max-width: 767px) calc(50vw - 20px), (max-width: 1023px) calc(33.333vw - 24px), (max-width: 1199px) calc(25vw - 24px), min(17vw, 300px)';
export const HOME_HERO_IMAGE_SIZES = '(max-width: 767px) 100vw, 33vw';
export const INQUIRY_THUMB_IMAGE_SIZES = '72px';
