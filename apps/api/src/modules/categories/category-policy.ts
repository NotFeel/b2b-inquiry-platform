import { ERROR_CODES } from '@b2b/contracts';
import { ApiError } from '../../common/errors/api-error';

// Pure tree/count policy for category management (docs/22 §4, §6.2-§6.6).
//
// Kept free of Prisma so every structural rule - cycle, depth, sibling order,
// product counting - can be unit tested directly. The service supplies the
// current rows and runs these checks inside the write transaction, so a rejected
// request never leaves a half-updated tree.

/**
 * Business depth guard for the tree (docs/01 §3.8, docs/22 §4.2).
 *
 * "Root depth" is 1. The model itself stays unlimited; this is the single place
 * the limit is defined so no UI or service can drift to a different number.
 */
export const MAX_CATEGORY_DEPTH = 8;

/**
 * The minimum shape every structural rule needs.
 *
 * Callers pass their full database row; the helpers stay generic so the returned
 * chain keeps the caller's own fields (translations, timestamps) instead of
 * narrowing them away.
 */
export interface CategoryRefLike {
  id: string;
  parentId: string | null;
}

export interface CategoryRef extends CategoryRefLike {
  code: string;
  slug: string;
  sortOrder: number;
  enabled: boolean;
  visible: boolean;
}

export function childrenOf<T extends CategoryRefLike>(rows: T[], parentId: string | null): T[] {
  return rows.filter((row) => row.parentId === parentId);
}

/** Every descendant of `rootId` (children, grandchildren, ...), excluding the root. */
export function collectDescendantIds<T extends CategoryRefLike>(
  rows: T[],
  rootId: string,
): Set<string> {
  const byParent = new Map<string | null, T[]>();
  for (const row of rows) {
    const bucket = byParent.get(row.parentId) ?? [];
    bucket.push(row);
    byParent.set(row.parentId, bucket);
  }

  const result = new Set<string>();
  const queue = [...(byParent.get(rootId) ?? [])];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || result.has(current.id)) continue;
    result.add(current.id);
    queue.push(...(byParent.get(current.id) ?? []));
  }
  return result;
}

/**
 * Nesting level of a node placed under `parentId`; a root category is level 1.
 *
 * The walk is guarded against a pre-existing cycle in the data so a corrupt row
 * cannot hang the request.
 */
export function depthUnder<T extends CategoryRefLike>(rows: T[], parentId: string | null): number {
  const byId = new Map(rows.map((row) => [row.id, row]));
  let depth = 1;
  let current = parentId;
  const seen = new Set<string>();
  while (current) {
    if (seen.has(current)) break;
    seen.add(current);
    const parent = byId.get(current);
    if (!parent) break;
    depth += 1;
    current = parent.parentId;
  }
  return depth;
}

/** Tallest chain of descendants below `rootId` (0 when it has no children). */
export function subtreeHeight<T extends CategoryRefLike>(rows: T[], rootId: string): number {
  const children = childrenOf(rows, rootId);
  if (children.length === 0) return 0;
  return 1 + Math.max(...children.map((child) => subtreeHeight(rows, child.id)));
}

/** Ancestor chain root → self for breadcrumbs; empty when the id is unknown. */
export function collectPath<T extends CategoryRefLike>(rows: T[], id: string): T[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const chain: T[] = [];
  let current: string | null = id;
  const seen = new Set<string>();
  while (current && !seen.has(current)) {
    seen.add(current);
    const row = byId.get(current);
    if (!row) break;
    chain.unshift(row);
    current = row.parentId;
  }
  return chain;
}

/**
 * Validates the requested parent (docs/22 §6.6).
 *
 * Rejects a missing parent, the node itself, any of its descendants (a cycle)
 * and any move that would push the subtree past the configured depth. The
 * front-end hides those choices, but this is the authority.
 */
export function assertCategoryParentIsValid(params: {
  rows: CategoryRefLike[];
  parentId: string | null;
  selfId?: string;
  maxDepth?: number;
}): void {
  const { rows, parentId, selfId } = params;
  const maxDepth = params.maxDepth ?? MAX_CATEGORY_DEPTH;
  if (parentId === null) return;

  if (!rows.some((row) => row.id === parentId)) {
    throw new ApiError(ERROR_CODES.categoryParentInvalid, 'The parent category does not exist.', {
      details: { parentId: 'category.parent.missing' },
    });
  }
  if (!selfId) return;

  if (parentId === selfId) {
    throw new ApiError(ERROR_CODES.categoryCycleDetected, 'A category cannot be its own parent.');
  }
  if (collectDescendantIds(rows, selfId).has(parentId)) {
    throw new ApiError(
      ERROR_CODES.categoryCycleDetected,
      'A category cannot be moved under itself or one of its descendants.',
    );
  }

  const resultingDepth = depthUnder(rows, parentId) + subtreeHeight(rows, selfId);
  if (resultingDepth > maxDepth) {
    throw new ApiError(
      ERROR_CODES.categoryDepthExceeded,
      `This change would exceed the maximum category depth of ${maxDepth}.`,
    );
  }
}

/** Depth guard for a brand new child of `parentId` (or a new root). */
export function assertNewCategoryDepthIsValid(params: {
  rows: CategoryRefLike[];
  parentId: string | null;
  maxDepth?: number;
}): void {
  const maxDepth = params.maxDepth ?? MAX_CATEGORY_DEPTH;
  const depth = depthUnder(params.rows, params.parentId);
  if (depth > maxDepth) {
    throw new ApiError(
      ERROR_CODES.categoryDepthExceeded,
      `The maximum category depth of ${maxDepth} has been reached.`,
      { details: { parentId: 'category.depth.exceeded' } },
    );
  }
}

/**
 * Optimistic concurrency guard (docs/22 §11.7).
 *
 * `expected` is the `updatedAt` the administrator actually saw; a mismatch means
 * somebody else saved in between, so the stale write is refused instead of
 * silently winning.
 */
export function assertCategoryNotModified(current: Date | string, expected?: string): void {
  if (!expected) return;
  const currentIso =
    current instanceof Date ? current.toISOString() : new Date(current).toISOString();
  if (new Date(expected).toISOString() !== currentIso) {
    throw new ApiError(
      ERROR_CODES.categoryConcurrentUpdate,
      'This category was modified by another session.',
    );
  }
}

/** A reorder must submit exactly the current siblings, in the intended order. */
export function assertReorderIsComplete(expectedIds: string[], orderedIds: string[]): void {
  const expected = [...expectedIds].sort();
  const submitted = [...orderedIds].sort();
  const same =
    expected.length === submitted.length && expected.every((id, index) => id === submitted[index]);
  if (!same) {
    throw new ApiError(
      ERROR_CODES.validationFailed,
      'A reorder must contain every current sibling of the parent exactly once.',
      { details: { orderedIds: 'category.reorder.incomplete' } },
    );
  }
}

/** Sort orders are renumbered in steps of 10 so a manual insert has room. */
export const SORT_ORDER_STEP = 10;

export function siblingSortOrders(count: number): number[] {
  return Array.from({ length: count }, (_, index) => (index + 1) * SORT_ORDER_STEP);
}

export interface CategoryCounts {
  /** Products linked directly to the node. */
  direct: number;
  /** Direct plus every descendant branch (never double counted). */
  total: number;
}

/**
 * Direct and rolled-up product counts for every category (docs/22 §5.2, §6.3).
 *
 * One pass over the rows plus a single grouped product query: the roll-up is a
 * memory walk, so adding a level never adds a query.
 */
export function computeCategoryCounts(
  rows: { id: string; parentId: string | null }[],
  directCounts: Map<string, number>,
): Map<string, CategoryCounts> {
  const childrenOfId = new Map<string, string[]>();
  for (const row of rows) {
    if (row.parentId === null) continue;
    const bucket = childrenOfId.get(row.parentId) ?? [];
    bucket.push(row.id);
    childrenOfId.set(row.parentId, bucket);
  }

  const resolved = new Map<string, CategoryCounts>();
  const walk = (id: string, guard: Set<string>): number => {
    // A pre-existing cycle in the data must not become an infinite recursion.
    if (guard.has(id)) return 0;
    guard.add(id);
    const own = directCounts.get(id) ?? 0;
    const childTotal = (childrenOfId.get(id) ?? []).reduce(
      (sum, child) => sum + walk(child, guard),
      0,
    );
    const total = own + childTotal;
    resolved.set(id, { direct: own, total });
    guard.delete(id);
    return total;
  };
  for (const row of rows) walk(row.id, new Set());
  return resolved;
}

export interface TreeLike {
  id: string;
  parentId: string | null;
  sortOrder: number;
}

/**
 * Stable DFS tree assembly (docs/22 §6.2).
 *
 * Rows whose `parentId` does not exist are reported separately instead of being
 * silently dropped: they mean the data is inconsistent, which is an alert, not a
 * reason to hide a category from the workbench.
 */
export function buildTree<R extends TreeLike, N extends { children: N[] }>(
  rows: R[],
  toNode: (row: R) => N,
  compare: (left: R, right: R) => number,
  parentId: string | null = null,
): N[] {
  return rows
    .filter((row) => row.parentId === parentId)
    .sort(compare)
    .map((row) => ({ ...toNode(row), children: buildTree(rows, toNode, compare, row.id) }));
}

/** Rows pointing at a parent that no longer exists (data-integrity diagnostic). */
export function orphanedParentRefs(rows: { id: string; parentId: string | null }[]): string[] {
  const ids = new Set(rows.map((row) => row.id));
  return rows.filter((row) => row.parentId !== null && !ids.has(row.parentId)).map((row) => row.id);
}

export type CategoryDeleteBlock = 'children' | 'products' | null;

/**
 * Physical deletion is refused while anything still points at the node
 * (docs/22 §6.5). Deleting a category never cascades into products.
 */
export function categoryDeleteBlock(params: {
  childCount: number;
  productCount: number;
}): CategoryDeleteBlock {
  if (params.childCount > 0) return 'children';
  if (params.productCount > 0) return 'products';
  return null;
}

/**
 * Public visibility of a node depends on its whole ancestor chain (docs/22 §3.3,
 * §7.1): a hidden or disabled parent hides its branch, so the storefront can
 * never surface an orphaned descendant.
 */
export function isPubliclyReachable(rows: CategoryRef[], id: string): boolean {
  const path = collectPath(rows, id);
  if (path.length === 0) return false;
  return path.every((row) => row.enabled && row.visible);
}
