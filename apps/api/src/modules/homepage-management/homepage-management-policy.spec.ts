import { describe, expect, it } from 'vitest';
import { ApiError } from '../../common/errors/api-error';
import {
  assertCompleteCollectionOrder,
  assertHomepageCollectionNotModified,
  assertProductsBelongToCategory,
  assertSelectedProductCount,
  assertUniqueProductIds,
  productSortOrders,
  resolveHomepageTranslation,
} from './homepage-management-policy';

function codeOf(action: () => void): string {
  try {
    action();
  } catch (error) {
    return (error as ApiError).code;
  }
  throw new Error('expected the policy to reject the input');
}

describe('homepage collection policy', () => {
  it('requires the complete collection order exactly once', () => {
    expect(() => assertCompleteCollectionOrder(['b', 'a'], ['a', 'b'])).not.toThrow();
    expect(codeOf(() => assertCompleteCollectionOrder(['a'], ['a', 'b']))).toBe(
      'VALIDATION_FAILED',
    );
    expect(codeOf(() => assertCompleteCollectionOrder(['a', 'a'], ['a']))).toBe(
      'VALIDATION_FAILED',
    );
    expect(codeOf(() => assertCompleteCollectionOrder(['a', 'unknown'], ['a']))).toBe(
      'VALIDATION_FAILED',
    );
  });

  it('rejects a product from another category', () => {
    expect(() =>
      assertProductsBelongToCategory([{ id: 'p1', categoryId: 'c1' }], 'c1'),
    ).not.toThrow();
    expect(
      codeOf(() => assertProductsBelongToCategory([{ id: 'p1', categoryId: 'c2' }], 'c1')),
    ).toBe('HOMEPAGE_COLLECTION_PRODUCT_CATEGORY_MISMATCH');
  });

  it('rejects duplicate selected products and totals over productLimit', () => {
    expect(codeOf(() => assertUniqueProductIds(['p1', 'p1']))).toBe(
      'HOMEPAGE_COLLECTION_PRODUCT_DUPLICATE',
    );
    expect(() => assertSelectedProductCount(120, 120)).not.toThrow();
    expect(codeOf(() => assertSelectedProductCount(121, 120))).toBe(
      'HOMEPAGE_COLLECTION_PRODUCT_LIMIT_EXCEEDED',
    );
  });

  it('rejects a stale collection token', () => {
    const updatedAt = new Date('2026-11-12T10:00:00.000Z');
    expect(() => assertHomepageCollectionNotModified(updatedAt, undefined)).not.toThrow();
    expect(() =>
      assertHomepageCollectionNotModified(updatedAt, updatedAt.toISOString()),
    ).not.toThrow();
    expect(() =>
      assertHomepageCollectionNotModified(updatedAt, '2026-11-12T09:59:59.000Z'),
    ).toThrow(expect.objectContaining({ code: 'HOMEPAGE_COLLECTION_CONCURRENT_UPDATE' }));
  });

  it('normalises product order from the request array to stable ten-point positions', () => {
    expect(
      productSortOrders([
        { productId: 'p1', sortOrder: 30 },
        { productId: 'p2' },
        { productId: 'p3' },
      ]),
    ).toEqual([10, 20, 30]);
  });

  it('resolves translations by locale and falls back to English', () => {
    const rows = [
      { locale: 'zh-CN', title: '紧固件', subtitle: null },
      { locale: 'en-US', title: 'Fasteners', subtitle: 'OEM' },
    ];
    expect(resolveHomepageTranslation(rows, 'zh-CN').title).toBe('紧固件');
    expect(resolveHomepageTranslation(rows, 'de-DE')).toEqual({
      title: 'Fasteners',
      subtitle: 'OEM',
    });
  });
});
