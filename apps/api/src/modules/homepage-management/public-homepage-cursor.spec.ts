import { describe, expect, it } from 'vitest';
import {
  decodeCollectionCursor,
  decodeNewArrivalsCursor,
  encodeHomepageCursor,
} from './public-homepage-cursor';

const COLLECTION_ID = '843498b1-3dc9-4137-97fa-ff64854be803';
const MEMBERSHIP_ID = 'f0e1d2c3-b4a5-4678-9abc-def012345678';
const UPDATED_AT = '2026-11-12T15:30:00.000Z';

describe('homepage cursors', () => {
  it('round-trips New Arrivals and collection cursors', () => {
    const arrivals = {
      version: 1 as const,
      kind: 'new-arrivals' as const,
      configuredLimit: 600,
      returned: 24,
      afterSortOrder: 12,
      afterSku: 'SKU-000024',
    };
    const collection = {
      version: 1 as const,
      kind: 'collection' as const,
      collectionId: COLLECTION_ID,
      collectionUpdatedAt: UPDATED_AT,
      productLimit: 120,
      returned: 24,
      afterSortOrder: 30,
      afterId: MEMBERSHIP_ID,
    };

    expect(decodeNewArrivalsCursor(encodeHomepageCursor(arrivals))).toEqual(arrivals);
    expect(decodeCollectionCursor(encodeHomepageCursor(collection))).toEqual(collection);
  });

  it('rejects malformed, cross-kind and invalid-payload cursors', () => {
    const arrivals = encodeHomepageCursor({
      version: 1,
      kind: 'new-arrivals',
      configuredLimit: 48,
      returned: 24,
      afterSortOrder: 1,
      afterSku: 'SKU-1',
    });

    expect(() => decodeNewArrivalsCursor('not+a+cursor')).toThrow(/cursor is invalid/);
    expect(() => decodeNewArrivalsCursor(arrivals)).not.toThrow();
    expect(() => decodeCollectionCursor(arrivals)).toThrow(/cursor is invalid/);
    expect(() =>
      decodeNewArrivalsCursor(
        Buffer.from(
          JSON.stringify({
            version: 1,
            kind: 'new-arrivals',
            configuredLimit: 48,
            returned: 49,
            afterSortOrder: 1,
            afterSku: 'SKU-1',
          }),
        ).toString('base64url'),
      ),
    ).toThrow(/cursor is invalid/);
    expect(() =>
      decodeNewArrivalsCursor(
        Buffer.from(
          JSON.stringify({
            version: 1,
            kind: 'new-arrivals',
            configuredLimit: 48,
            returned: 24,
            afterSortOrder: 1.5,
            afterSku: 'SKU-1',
          }),
        ).toString('base64url'),
      ),
    ).toThrow(/cursor is invalid/);
    expect(() =>
      decodeCollectionCursor(
        Buffer.from(
          JSON.stringify({
            version: 1,
            kind: 'collection',
            collectionId: 'not-a-uuid',
            collectionUpdatedAt: UPDATED_AT,
            productLimit: 48,
            returned: 24,
            afterSortOrder: 1,
            afterId: MEMBERSHIP_ID,
          }),
        ).toString('base64url'),
      ),
    ).toThrow(/cursor is invalid/);
  });

  it('rejects empty values and oversized strings before decoding', () => {
    expect(() => decodeNewArrivalsCursor('')).not.toThrow();
    expect(() => decodeNewArrivalsCursor('a'.repeat(1025))).toThrow(/cursor is invalid/);
    expect(() => decodeCollectionCursor('')).not.toThrow();
  });
});
