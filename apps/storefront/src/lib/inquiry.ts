export const MAX_INQUIRY_QUANTITY = 999_999;

/** Keeps quantity values inside the same range as the public API schema. */
export function normalizeQuantity(
  value: number,
  min = 1,
  max = MAX_INQUIRY_QUANTITY,
): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
