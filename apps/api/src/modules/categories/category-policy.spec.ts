import { describe, expect, it } from 'vitest';
import { ApiError } from '../../common/errors/api-error';
import {
  MAX_CATEGORY_DEPTH,
  assertCategoryNotModified,
  assertCategoryParentIsValid,
  assertNewCategoryDepthIsValid,
  assertReorderIsComplete,
  buildTree,
  categoryDeleteBlock,
  collectDescendantIds,
  collectPath,
  computeCategoryCounts,
  depthUnder,
  isPubliclyReachable,
  orphanedParentRefs,
  siblingSortOrders,
  subtreeHeight,
  type CategoryRef,
} from './category-policy';

const ref = (
  id: string,
  parentId: string | null,
  overrides: Partial<CategoryRef> = {},
): CategoryRef => ({
  id,
  code: id,
  slug: id,
  parentId,
  sortOrder: 10,
  enabled: true,
  visible: true,
  ...overrides,
});

/** catalog / toys / (model-toys, electric-toys); toys also has a hidden branch. */
const ROWS: CategoryRef[] = [
  ref('catalog', null),
  ref('toys', 'catalog'),
  ref('model-toys', 'toys'),
  ref('electric-toys', 'toys'),
  ref('hidden-toys', 'toys', { visible: false }),
  ref('hidden-child', 'hidden-toys'),
  ref('disabled-branch', 'catalog', { enabled: false }),
  ref('disabled-child', 'disabled-branch'),
];

function codeOf(action: () => void): string {
  try {
    action();
  } catch (error) {
    return (error as ApiError).code;
  }
  throw new Error('expected the guard to throw');
}

describe('tree facts', () => {
  it('collects descendants without the root itself', () => {
    expect([...collectDescendantIds(ROWS, 'toys')].sort()).toEqual([
      'electric-toys',
      'hidden-child',
      'hidden-toys',
      'model-toys',
    ]);
  });

  it('measures depth with the root at level 1', () => {
    expect(depthUnder(ROWS, null)).toBe(1);
    expect(depthUnder(ROWS, 'catalog')).toBe(2);
    expect(depthUnder(ROWS, 'toys')).toBe(3);
  });

  it('measures the height of a subtree', () => {
    expect(subtreeHeight(ROWS, 'model-toys')).toBe(0);
    expect(subtreeHeight(ROWS, 'toys')).toBe(2);
    expect(subtreeHeight(ROWS, 'catalog')).toBe(3);
  });

  it('builds the ancestor chain root to self', () => {
    expect(collectPath(ROWS, 'model-toys').map((row) => row.id)).toEqual([
      'catalog',
      'toys',
      'model-toys',
    ]);
    expect(collectPath(ROWS, 'unknown')).toEqual([]);
  });

  it('tolerates a pre-existing cycle instead of hanging', () => {
    const cyclic = [ref('a', 'b'), ref('b', 'a')];
    expect(depthUnder(cyclic, 'a')).toBeLessThanOrEqual(3);
    expect(collectPath(cyclic, 'a').length).toBeLessThanOrEqual(2);
  });

  it('reports rows pointing at a parent that no longer exists', () => {
    expect(orphanedParentRefs([...ROWS, ref('orphan', 'gone')])).toEqual(['orphan']);
  });
});

describe('parent validation', () => {
  it('accepts a root and an existing unrelated parent', () => {
    expect(() =>
      assertCategoryParentIsValid({ rows: ROWS, parentId: null, selfId: 'toys' }),
    ).not.toThrow();
    expect(() =>
      assertCategoryParentIsValid({ rows: ROWS, parentId: 'electric-toys', selfId: 'model-toys' }),
    ).not.toThrow();
  });

  it('rejects a missing parent with CATEGORY_PARENT_INVALID', () => {
    expect(
      codeOf(() => assertCategoryParentIsValid({ rows: ROWS, parentId: 'nope', selfId: 'toys' })),
    ).toBe('CATEGORY_PARENT_INVALID');
  });

  it('rejects self-parenting and moving under a descendant', () => {
    expect(
      codeOf(() => assertCategoryParentIsValid({ rows: ROWS, parentId: 'toys', selfId: 'toys' })),
    ).toBe('CATEGORY_CYCLE_DETECTED');
    expect(
      codeOf(() =>
        assertCategoryParentIsValid({ rows: ROWS, parentId: 'model-toys', selfId: 'toys' }),
      ),
    ).toBe('CATEGORY_CYCLE_DETECTED');
  });

  it('rejects a move that would push the subtree past the depth limit', () => {
    // A chain of 7 levels moved under another root would reach level 9.
    const deep: CategoryRef[] = [ref('root', null)];
    let parent = 'root';
    for (let level = 2; level <= MAX_CATEGORY_DEPTH; level += 1) {
      const id = `level-${level}`;
      deep.push(ref(id, parent));
      parent = id;
    }
    const withSecondRoot = [...deep, ref('other-root', null)];
    expect(
      codeOf(() =>
        assertCategoryParentIsValid({
          rows: withSecondRoot,
          parentId: 'other-root',
          selfId: 'root',
        }),
      ),
    ).toBe('CATEGORY_DEPTH_EXCEEDED');
  });

  it('refuses a new child below the last allowed level', () => {
    expect(() =>
      assertNewCategoryDepthIsValid({ rows: ROWS, parentId: 'model-toys' }),
    ).not.toThrow();
    const deep: CategoryRef[] = [ref('l1', null)];
    let parent = 'l1';
    for (let level = 2; level <= MAX_CATEGORY_DEPTH; level += 1) {
      const id = `l${level}`;
      deep.push(ref(id, parent));
      parent = id;
    }
    expect(codeOf(() => assertNewCategoryDepthIsValid({ rows: deep, parentId: parent }))).toBe(
      'CATEGORY_DEPTH_EXCEEDED',
    );
  });
});

describe('counts', () => {
  it('separates direct from rolled-up product counts', () => {
    const direct = new Map([
      ['toys', 4],
      ['model-toys', 12],
      ['electric-toys', 7],
      ['catalog', 1],
    ]);
    const counts = computeCategoryCounts(ROWS, direct);
    expect(counts.get('model-toys')).toEqual({ direct: 12, total: 12 });
    expect(counts.get('toys')).toEqual({ direct: 4, total: 23 });
    expect(counts.get('catalog')).toEqual({ direct: 1, total: 24 });
    expect(counts.get('hidden-child')).toEqual({ direct: 0, total: 0 });
  });

  it('does not recurse forever on cyclic data', () => {
    const cyclic = [ref('a', 'b'), ref('b', 'a')];
    const counts = computeCategoryCounts(cyclic, new Map([['a', 2]]));
    expect(counts.get('a')?.direct).toBe(2);
  });
});

describe('reorder', () => {
  it('accepts a complete, reordered sibling list', () => {
    expect(() => assertReorderIsComplete(['a', 'b', 'c'], ['c', 'a', 'b'])).not.toThrow();
  });

  it('rejects a partial or unknown submission', () => {
    expect(codeOf(() => assertReorderIsComplete(['a', 'b', 'c'], ['a', 'b']))).toBe(
      'VALIDATION_FAILED',
    );
    expect(codeOf(() => assertReorderIsComplete(['a', 'b'], ['a', 'zzz']))).toBe(
      'VALIDATION_FAILED',
    );
  });

  it('renumbers siblings in steps of ten', () => {
    expect(siblingSortOrders(3)).toEqual([10, 20, 30]);
    expect(siblingSortOrders(0)).toEqual([]);
  });
});

describe('delete protection', () => {
  it('blocks on children first, then products', () => {
    expect(categoryDeleteBlock({ childCount: 2, productCount: 3 })).toBe('children');
    expect(categoryDeleteBlock({ childCount: 0, productCount: 3 })).toBe('products');
    expect(categoryDeleteBlock({ childCount: 0, productCount: 0 })).toBeNull();
  });
});

describe('concurrency', () => {
  it('accepts a matching version and rejects a stale one', () => {
    const current = new Date('2026-10-16T10:00:00.000Z');
    expect(() => assertCategoryNotModified(current, '2026-10-16T10:00:00.000Z')).not.toThrow();
    expect(() => assertCategoryNotModified(current, undefined)).not.toThrow();
    expect(codeOf(() => assertCategoryNotModified(current, '2026-10-16T09:00:00.000Z'))).toBe(
      'CATEGORY_CONCURRENT_UPDATE',
    );
  });
});

describe('public reachability', () => {
  it('requires the whole ancestor chain to be enabled and visible', () => {
    expect(isPubliclyReachable(ROWS, 'model-toys')).toBe(true);
    expect(isPubliclyReachable(ROWS, 'hidden-toys')).toBe(false);
    expect(isPubliclyReachable(ROWS, 'hidden-child')).toBe(false);
    expect(isPubliclyReachable(ROWS, 'disabled-child')).toBe(false);
    expect(isPubliclyReachable(ROWS, 'gone')).toBe(false);
  });
});

describe('buildTree', () => {
  it('nests children and orders siblings stably', () => {
    interface TestNode {
      id: string;
      children: TestNode[];
    }
    const rows = [
      ref('root', null, { sortOrder: 10 }),
      ref('b', 'root', { sortOrder: 20 }),
      ref('a', 'root', { sortOrder: 10 }),
      ref('a1', 'a', { sortOrder: 10 }),
    ];
    const tree = buildTree<CategoryRef, TestNode>(
      rows,
      (row) => ({ id: row.id, children: [] }),
      (left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id),
    );
    expect(tree.map((node) => node.id)).toEqual(['root']);
    expect(tree[0]?.children.map((node) => node.id)).toEqual(['a', 'b']);
    expect(tree[0]?.children[0]?.children.map((node) => node.id)).toEqual(['a1']);
  });
});
