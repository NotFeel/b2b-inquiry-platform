import { describe, expect, it } from 'vitest';
import { ApiError } from '../../common/errors/api-error';
import {
  assertExpectedUpdatedAt,
  assertItemBelongsToType,
  assertItemIsDeletable,
  assertItemMutationAllowed,
  assertNotSystemLocked,
  assertReorderIsComplete,
  assertTypeIsDeletable,
  isBehaviourLockedType,
  resolveLabel,
  toOptions,
} from './dictionary-policy';

const LOCKED_ITEM = { id: 'i1', typeId: 't1', code: 'published', enabled: true, systemLocked: true };
const FREE_ITEM = { id: 'i2', typeId: 't2', code: 'tt-30', enabled: true, systemLocked: false };

function codeOf(action: () => void): string {
  try {
    action();
  } catch (error) {
    return (error as ApiError).code;
  }
  throw new Error('expected the guard to throw');
}

describe('label resolution', () => {
  it('prefers the requested locale and falls back to en-US then zh-CN', () => {
    expect(resolveLabel({ 'zh-CN': '可用', 'en-US': 'Available' }, 'zh-CN')).toBe('可用');
    expect(resolveLabel({ 'zh-CN': '可用', 'en-US': 'Available' }, 'fr-FR')).toBe('Available');
    expect(resolveLabel({ 'zh-CN': '可用' }, 'fr-FR')).toBe('可用');
  });

  it('never returns a blank label', () => {
    expect(resolveLabel({}, 'zh-CN')).toBeNull();
    expect(resolveLabel({ 'zh-CN': '   ' }, 'zh-CN')).toBeNull();
  });
});

describe('option mapping', () => {
  it('sorts by sortOrder then code and falls back to the code as label', () => {
    const options = toOptions(
      [
        { id: 'b', code: 'preorder', value: null, sortOrder: 20, enabled: true, labels: { 'en-US': 'Pre-order' } },
        { id: 'a', code: 'available', value: null, sortOrder: 10, enabled: true, labels: { 'en-US': 'Available' } },
        { id: 'c', code: 'legacy', value: 'legacy payload', sortOrder: 10, enabled: false, labels: {} },
      ],
      'en-US',
    );
    expect(options.map((option) => option.code)).toEqual(['available', 'legacy', 'preorder']);
    expect(options[1]!.label).toBe('legacy');
    expect(options[1]!.enabled).toBe(false);
    expect(options[1]!.value).toBe('legacy payload');
  });
});

describe('behaviour-locked types', () => {
  it('recognises the product status and classification types', () => {
    expect(isBehaviourLockedType('product_lifecycle')).toBe(true);
    expect(isBehaviourLockedType('publish_status')).toBe(true);
    expect(isBehaviourLockedType('payment_terms')).toBe(false);
    expect(isBehaviourLockedType('packaging_type')).toBe(false);
  });

  it('blocks adding or removing items of a locked type', () => {
    expect(() =>
      assertItemMutationAllowed({ typeCode: 'payment_terms', typeSystemLocked: false, action: 'create' }),
    ).not.toThrow();
    expect(
      codeOf(() =>
        assertItemMutationAllowed({ typeCode: 'publish_status', typeSystemLocked: true, action: 'create' }),
      ),
    ).toBe('SYSTEM_LOCKED');
    expect(
      codeOf(() =>
        assertItemMutationAllowed({ typeCode: 'product_lifecycle', typeSystemLocked: false, action: 'delete' }),
      ),
    ).toBe('SYSTEM_LOCKED');
    // A database-flagged locked type is protected too, even if its code is not in the constant list.
    expect(
      codeOf(() =>
        assertItemMutationAllowed({ typeCode: 'inquiry_source', typeSystemLocked: true, action: 'delete' }),
      ),
    ).toBe('SYSTEM_LOCKED');
  });

  it('blocks deleting or disabling locked entries', () => {
    expect(codeOf(() => assertNotSystemLocked(LOCKED_ITEM, 'delete'))).toBe('SYSTEM_LOCKED');
    expect(codeOf(() => assertNotSystemLocked(LOCKED_ITEM, 'disable'))).toBe('SYSTEM_LOCKED');
    expect(() => assertNotSystemLocked(FREE_ITEM, 'delete')).not.toThrow();
  });
});

describe('deletion protection', () => {
  it('refuses to delete a type that still has items', () => {
    expect(
      codeOf(() =>
        assertTypeIsDeletable({
          type: { id: 't', code: 'payment_terms', systemLocked: false, enabled: true },
          itemCount: 2,
          references: 0,
        }),
      ),
    ).toBe('DICTIONARY_TYPE_HAS_ITEMS');
  });

  it('refuses to delete a type that is still referenced', () => {
    expect(
      codeOf(() =>
        assertTypeIsDeletable({
          type: { id: 't', code: 'payment_terms', systemLocked: false, enabled: true },
          itemCount: 0,
          references: 3,
        }),
      ),
    ).toBe('DICTIONARY_ITEM_IN_USE');
  });

  it('allows deleting an empty, unlocked, unreferenced type', () => {
    expect(() =>
      assertTypeIsDeletable({
        type: { id: 't', code: 'packaging_type', systemLocked: false, enabled: true },
        itemCount: 0,
        references: 0,
      }),
    ).not.toThrow();
  });

  it('refuses to delete an item that business data references', () => {
    expect(
      codeOf(() => assertItemIsDeletable({ item: FREE_ITEM, typeCode: 'payment_terms', usageCount: 4 })),
    ).toBe('DICTIONARY_ITEM_IN_USE');
    expect(() =>
      assertItemIsDeletable({ item: FREE_ITEM, typeCode: 'payment_terms', usageCount: 0 }),
    ).not.toThrow();
  });
});

describe('type membership', () => {
  it('rejects an item from another type with 422', () => {
    try {
      assertItemBelongsToType({
        expectedTypeCode: 'product_lifecycle',
        actualTypeCode: 'publish_status',
        itemCode: 'draft',
      });
      throw new Error('expected the guard to throw');
    } catch (error) {
      const apiError = error as ApiError;
      expect(apiError.code).toBe('DICTIONARY_TYPE_MISMATCH');
      expect(apiError.getStatus()).toBe(422);
    }
    expect(() =>
      assertItemBelongsToType({
        expectedTypeCode: 'publish_status',
        actualTypeCode: 'publish_status',
        itemCode: 'draft',
      }),
    ).not.toThrow();
  });
});

describe('reorder and concurrency', () => {
  it('requires the complete item set exactly once', () => {
    expect(() => assertReorderIsComplete({ orderedIds: ['b', 'a'], itemIds: ['a', 'b'] })).not.toThrow();
    expect(codeOf(() => assertReorderIsComplete({ orderedIds: ['a'], itemIds: ['a', 'b'] }))).toBe(
      'VALIDATION_FAILED',
    );
    expect(codeOf(() => assertReorderIsComplete({ orderedIds: ['a', 'z'], itemIds: ['a', 'b'] }))).toBe(
      'VALIDATION_FAILED',
    );
  });

  it('reports a stale editor as a conflict', () => {
    const updatedAt = new Date('2026-10-16T10:00:00.000Z');
    expect(() => assertExpectedUpdatedAt(updatedAt.toISOString(), updatedAt)).not.toThrow();
    expect(() => assertExpectedUpdatedAt(undefined, updatedAt)).not.toThrow();
    expect(codeOf(() => assertExpectedUpdatedAt('2026-10-16T09:00:00.000Z', updatedAt))).toBe('CONFLICT');
  });
});
