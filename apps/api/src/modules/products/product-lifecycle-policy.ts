import type { ProductLifecycleStatus } from '@b2b/contracts';

/**
 * Home-page pre-order curation rule (business decision 2026-10-17).
 *
 * Two distinct concepts must not drift apart:
 *
 * - `lifecycleStatus` is what the product *is*: available, pre-order or
 *   discontinued. It drives the catalogue badge and the `lifecycle` filter.
 * - `isPreOrder` is whether the operator wants it in the storefront home page's
 *   pre-order rail. It is a display decision, not a second source of truth.
 *
 * Therefore the flag can only be true for a PREORDER product. Asking for it on
 * any other lifecycle is an explicit error (not a silent reset): the operator
 * may have forgotten to change the lifecycle first, and silently dropping the
 * checkbox would look like the save worked when it did not.
 */
export type PreOrderResolution =
  | { isPreOrder: boolean }
  | { error: 'PRE_ORDER_REQUIRES_PREORDER_LIFECYCLE' };

export function resolvePreOrderFlag(input: {
  /** Effective lifecycle after this write (existing value when not submitted). */
  lifecycleStatus: ProductLifecycleStatus;
  /** Requested flag, or the current value when the field was not submitted. */
  requested: boolean;
}): PreOrderResolution {
  if (input.requested && input.lifecycleStatus !== 'preorder') {
    return { error: 'PRE_ORDER_REQUIRES_PREORDER_LIFECYCLE' };
  }
  return { isPreOrder: input.lifecycleStatus === 'preorder' && input.requested };
}

/**
 * A lifecycle change away from `preorder` cannot keep the home flag: the two
 * would contradict each other. The service applies this before validating, so
 * "set lifecycle to available" always succeeds and simply removes the product
 * from the home rail.
 */
export function normalizePreOrderOnLifecycleChange(input: {
  previousLifecycle: ProductLifecycleStatus;
  nextLifecycle: ProductLifecycleStatus;
  currentFlag: boolean;
}): { lifecycleChanged: boolean; isPreOrder: boolean } {
  const lifecycleChanged = input.previousLifecycle !== input.nextLifecycle;
  if (input.nextLifecycle === 'preorder') {
    return { lifecycleChanged, isPreOrder: input.currentFlag };
  }
  return { lifecycleChanged, isPreOrder: false };
}
