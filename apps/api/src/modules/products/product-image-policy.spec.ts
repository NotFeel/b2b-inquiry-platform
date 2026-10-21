import { describe, expect, it } from 'vitest';
import {
  canPublishProduct,
  defaultAltText,
  describeSharedAsset,
  isManagedProductImageKey,
  isSharedAsset,
  normalizeImageOrder,
  pickReplacementCover,
  resolveCoverAssignment,
} from './product-image-policy';

describe('isManagedProductImageKey', () => {
  it('accepts a server-generated product image key', () => {
    expect(isManagedProductImageKey('product-image/2026/10/6f1f0b0e-1.png')).toBe(true);
  });

  it('refuses traversal, absolute paths and other purposes', () => {
    expect(isManagedProductImageKey('product-image/../../etc/passwd')).toBe(false);
    expect(isManagedProductImageKey('/etc/passwd')).toBe(false);
    expect(isManagedProductImageKey('C:\\Users\\x.png')).toBe(false);
    expect(isManagedProductImageKey('category-cover/2026/10/a.png')).toBe(false);
    expect(isManagedProductImageKey('quote-template/2026/10/a.xlsx')).toBe(false);
    expect(isManagedProductImageKey('')).toBe(false);
    expect(isManagedProductImageKey(null)).toBe(false);
  });

  it('refuses a key with unexpected characters', () => {
    expect(isManagedProductImageKey('product-image/2026/10/a b.png')).toBe(false);
    expect(isManagedProductImageKey('product-image/2026/10/a"b.png')).toBe(false);
  });
});

describe('shared asset detection', () => {
  it('treats a fully exclusive object as deletable', () => {
    const usage = { otherProductImages: 0, categoryCovers: 0, ads: 0, pdfSourceJobs: 0 };
    expect(isSharedAsset(usage)).toBe(false);
    expect(describeSharedAsset(usage)).toEqual([]);
  });

  it('lists every other consumer so the conflict can be explained', () => {
    const usage = { otherProductImages: 2, categoryCovers: 1, ads: 0, pdfSourceJobs: 0 };
    expect(isSharedAsset(usage)).toBe(true);
    expect(describeSharedAsset(usage)).toEqual(['otherProductImages', 'categoryCovers']);
  });
});

describe('normalizeImageOrder', () => {
  it('accepts the complete list and returns the new order', () => {
    const result = normalizeImageOrder(['b', 'a'], ['a', 'b']);
    expect(result).toEqual({ ordered: ['b', 'a'] });
  });

  it('rejects duplicates', () => {
    expect(normalizeImageOrder(['a', 'a'], ['a', 'b'])).toEqual({ error: 'DUPLICATE' });
  });

  it('rejects ids that belong to another product', () => {
    const result = normalizeImageOrder(['a', 'z'], ['a', 'b']);
    expect(result).toEqual({ error: 'UNKNOWN', unknownIds: ['z'] });
  });

  it('rejects a partial list instead of silently dropping an image', () => {
    const result = normalizeImageOrder(['a'], ['a', 'b']);
    expect(result).toEqual({ error: 'INCOMPLETE', unknownIds: ['b'] });
  });
});

describe('cover resolution', () => {
  it('keeps the requested cover when it is usable', () => {
    const images = [
      { id: 'a', sortOrder: 0, deleteState: 'READY', isCover: true },
      { id: 'b', sortOrder: 1, deleteState: 'READY', isCover: false },
    ];
    expect(resolveCoverAssignment(images, 'b')).toEqual({ coverId: 'b', covers: ['b'] });
  });

  it('promotes the first usable image when none is marked', () => {
    const images = [
      { id: 'b', sortOrder: 1, deleteState: 'READY', isCover: false },
      { id: 'a', sortOrder: 0, deleteState: 'READY', isCover: false },
    ];
    expect(resolveCoverAssignment(images, null).coverId).toBe('a');
  });

  it('never promotes an image that is being or failed to be deleted', () => {
    const images = [
      { id: 'gone', sortOrder: 0, deleteState: 'DELETE_PENDING', isCover: true },
      { id: 'failed', sortOrder: 1, deleteState: 'DELETE_FAILED', isCover: false },
      { id: 'ok', sortOrder: 5, deleteState: 'READY', isCover: false },
    ];
    expect(resolveCoverAssignment(images, null)).toEqual({ coverId: 'ok', covers: ['ok'] });
  });

  it('reports no cover when the product has no usable image', () => {
    const images = [{ id: 'x', sortOrder: 0, deleteState: 'DELETE_PENDING', isCover: true }];
    expect(resolveCoverAssignment(images, 'x')).toEqual({ coverId: null, covers: [] });
  });

  it('picks the next usable image when the cover is removed', () => {
    const images = [
      { id: 'a', sortOrder: 0, deleteState: 'DELETE_PENDING' },
      { id: 'b', sortOrder: 2, deleteState: 'READY' },
      { id: 'c', sortOrder: 1, deleteState: 'READY' },
    ];
    expect(pickReplacementCover(images, 'a')).toBe('c');
  });
});

describe('publish guard and alt text', () => {
  it('requires at least one usable image', () => {
    expect(canPublishProduct(0)).toBe(false);
    expect(canPublishProduct(1)).toBe(true);
  });

  it('falls back to the original file name and truncates to the column width', () => {
    expect(defaultAltText('Steel Gate', 'a.png')).toBe('Steel Gate');
    expect(defaultAltText(null, 'a.png')).toBe('a.png');
    expect(defaultAltText('x'.repeat(400), 'a.png')).toHaveLength(240);
  });
});
