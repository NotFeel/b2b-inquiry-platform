import { describe, expect, it } from 'vitest';
import { imageSrcSet } from './image-srcset';

describe('responsive image srcset', () => {
  it('uses only server-provided WebP variants and sorts by width', () => {
    expect(
      imageSrcSet([
        { width: 640, url: 'https://cdn.test/640.webp', format: 'webp' },
        { width: 320, url: 'https://cdn.test/320.webp', format: 'webp' },
      ]),
    ).toBe('https://cdn.test/320.webp 320w, https://cdn.test/640.webp 640w');
  });

  it('omits srcset when no derivatives exist', () => {
    expect(imageSrcSet([])).toBeUndefined();
    expect(imageSrcSet(undefined)).toBeUndefined();
  });
});
