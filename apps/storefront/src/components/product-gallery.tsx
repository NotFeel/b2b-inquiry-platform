'use client';

import { ImageGallery } from '@b2b/ui';
import type { GalleryImage } from '@b2b/ui';

// Thin client wrapper so the server-rendered detail page can hand the shared
// gallery component its image list (the gallery needs interaction state).
export function ProductGallery({
  images,
  labels,
}: {
  images: GalleryImage[];
  labels: { empty: string; previous: string; next: string; zoom: string; close: string };
}) {
  return <ImageGallery images={images} labels={labels} />;
}
