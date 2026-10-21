'use client';

import { useState } from 'react';
import { CategoryArt } from './CategoryArt';
import { Modal } from './Modal';
import { IconImage } from './icons';

export interface GalleryImage {
  url: string;
  alt: string;
  width?: number | null;
  height?: number | null;
}

export interface ImageGalleryProps {
  images: GalleryImage[];
  labels: { previous: string; next: string; empty: string; zoom: string; close: string };
}

export function ImageGallery({ images, labels }: ImageGalleryProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const active = images[activeIndex];
  const activeFailed = active ? failed[active.url] : false;

  if (images.length === 0) {
    return (
      <div className="gallery-main">
        <ImageFallback label={labels.empty} />
      </div>
    );
  }

  return (
    <div className="gallery">
      <div className="gallery-main">
        {active && !activeFailed ? (
          <button
            type="button"
            className="gallery-main-button"
            aria-label={`${labels.zoom}: ${active.alt}`}
            aria-haspopup="dialog"
            onClick={() => setLightboxOpen(true)}
          >
            <img
              src={active.url}
              alt={active.alt}
              width={active.width ?? undefined}
              height={active.height ?? undefined}
              fetchPriority="high"
              onError={() => setFailed((current) => ({ ...current, [active.url]: true }))}
            />
          </button>
        ) : (
          <ImageFallback label={labels.empty} seed={active?.alt} />
        )}
      </div>
      {images.length > 1 ? (
        <div className="gallery-thumbs" role="group" aria-label={labels.next}>
          {images.map((image, index) => (
            <button
              key={`${image.url}-${index}`}
              type="button"
              className="gallery-thumb"
              aria-current={index === activeIndex}
              aria-label={`${labels.next} ${index + 1}`}
              onClick={() => setActiveIndex(index)}
            >
              {failed[image.url] ? (
                <span className="media-fallback media-fallback-sm">
                  <IconImage size={20} />
                </span>
              ) : (
                <img
                  src={image.url}
                  alt=""
                  loading="lazy"
                  onError={() => setFailed((current) => ({ ...current, [image.url]: true }))}
                />
              )}
            </button>
          ))}
        </div>
      ) : null}

      <Modal
        open={lightboxOpen && Boolean(active) && !activeFailed}
        title={labels.zoom}
        onClose={() => setLightboxOpen(false)}
        size="lg"
        closeLabel={labels.close}
        footer={
          images.length > 1 ? (
            <div className="gallery-lightbox-controls">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() =>
                  setActiveIndex((index) => (index - 1 + images.length) % images.length)
                }
              >
                {labels.previous}
              </button>
              <span aria-live="polite">
                {activeIndex + 1} / {images.length}
              </span>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setActiveIndex((index) => (index + 1) % images.length)}
              >
                {labels.next}
              </button>
            </div>
          ) : undefined
        }
      >
        {active ? (
          <figure className="gallery-lightbox">
            <img
              src={active.url}
              alt={active.alt}
              width={active.width ?? undefined}
              height={active.height ?? undefined}
              onError={() => setFailed((current) => ({ ...current, [active.url]: true }))}
            />
          </figure>
        ) : null}
      </Modal>
    </div>
  );
}

interface ImageFallbackProps {
  label: string;
  seed?: string | null;
  small?: boolean;
}

// Shared fallback: category line art plus a short label. A missing asset must
// never render as a bare grey block (docs/16 §7.5).
function ImageFallback({ label, seed, small }: ImageFallbackProps) {
  return (
    <span
      className={['media-fallback', small ? 'media-fallback-sm' : ''].filter(Boolean).join(' ')}
    >
      <CategoryArt seed={seed} />
      <span>{label}</span>
    </span>
  );
}

export interface MediaFrameProps {
  src: string | null;
  alt: string;
  /** CSS aspect-ratio, e.g. `1 / 1` for catalogue cards. */
  ratio?: string;
  fit?: 'cover' | 'contain';
  loading?: 'lazy' | 'eager';
  /** Localised text shown when the asset is missing or fails to load. */
  fallbackLabel: string;
  /** Seeds the fallback art so the same product always gets the same drawing. */
  fallbackSeed?: string | null;
  className?: string;
}

/**
 * Reserves the media box before the asset loads (no layout shift) and swaps to
 * designed line art when the image is missing or fails.
 */
export function MediaFrame({
  src,
  alt,
  ratio = '1 / 1',
  fit = 'cover',
  loading = 'lazy',
  fallbackLabel,
  fallbackSeed,
  className,
}: MediaFrameProps) {
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(src) && !failed;

  return (
    <div
      className={['media-frame', fit === 'contain' ? 'media-frame-contain' : '', className]
        .filter(Boolean)
        .join(' ')}
      style={{ aspectRatio: ratio }}
    >
      {showImage ? (
        <img
          src={src as string}
          alt={alt}
          loading={loading}
          decoding="async"
          onError={() => setFailed(true)}
        />
      ) : (
        <ImageFallback label={fallbackLabel} seed={fallbackSeed} />
      )}
    </div>
  );
}
