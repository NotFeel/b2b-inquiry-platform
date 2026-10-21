import { describe, expect, it } from 'vitest';
import { normalizePreOrderOnLifecycleChange, resolvePreOrderFlag } from './product-lifecycle-policy';

describe('resolvePreOrderFlag', () => {
  it('accepts the home flag on a pre-order product', () => {
    expect(resolvePreOrderFlag({ lifecycleStatus: 'preorder', requested: true })).toEqual({
      isPreOrder: true,
    });
  });

  it('stores false when the operator leaves a pre-order product out of the home rail', () => {
    expect(resolvePreOrderFlag({ lifecycleStatus: 'preorder', requested: false })).toEqual({
      isPreOrder: false,
    });
  });

  it('rejects the flag on available or discontinued products instead of ignoring it', () => {
    expect(resolvePreOrderFlag({ lifecycleStatus: 'available', requested: true })).toEqual({
      error: 'PRE_ORDER_REQUIRES_PREORDER_LIFECYCLE',
    });
    expect(resolvePreOrderFlag({ lifecycleStatus: 'discontinued', requested: true })).toEqual({
      error: 'PRE_ORDER_REQUIRES_PREORDER_LIFECYCLE',
    });
  });

  it('always yields false for a non-pre-order lifecycle', () => {
    expect(resolvePreOrderFlag({ lifecycleStatus: 'available', requested: false })).toEqual({
      isPreOrder: false,
    });
  });
});

describe('normalizePreOrderOnLifecycleChange', () => {
  it('keeps the flag when the product stays a pre-order item', () => {
    expect(
      normalizePreOrderOnLifecycleChange({
        previousLifecycle: 'preorder',
        nextLifecycle: 'preorder',
        currentFlag: true,
      }),
    ).toEqual({ lifecycleChanged: false, isPreOrder: true });
  });

  it('clears the home flag when the lifecycle moves away from pre-order', () => {
    expect(
      normalizePreOrderOnLifecycleChange({
        previousLifecycle: 'preorder',
        nextLifecycle: 'available',
        currentFlag: true,
      }),
    ).toEqual({ lifecycleChanged: true, isPreOrder: false });
  });

  it('does not invent a flag when a product becomes a pre-order item', () => {
    expect(
      normalizePreOrderOnLifecycleChange({
        previousLifecycle: 'available',
        nextLifecycle: 'preorder',
        currentFlag: false,
      }),
    ).toEqual({ lifecycleChanged: true, isPreOrder: false });
  });
});
