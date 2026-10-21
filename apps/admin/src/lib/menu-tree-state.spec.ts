import { describe, expect, it } from 'vitest';
import type { MenuNode } from '@b2b/contracts';
import {
  allNodeIds,
  ancestorIds,
  countNodes,
  findNode,
  findSiblings,
  flattenTree,
  moveWithinSiblings,
  parentOptions,
  subtreeIds,
} from './menu-tree-state';

const node = (id: string, children: MenuNode[] = [], overrides: Partial<MenuNode> = {}): MenuNode => ({
  id,
  code: id,
  label: id,
  labels: { 'zh-CN': id, 'en-US': id },
  parentId: null,
  route: null,
  icon: null,
  permissionCode: null,
  sortOrder: 10,
  visible: true,
  enabled: true,
  external: false,
  updatedAt: '2026-10-15T10:00:00.000Z',
  children,
  ...overrides,
});

const TREE: MenuNode[] = [
  node('catalog', [
    node('products', [], { parentId: 'catalog' }),
    node('categories', [node('sub-categories', [], { parentId: 'categories' })], { parentId: 'catalog' }),
  ]),
  node('administration', [node('users', [], { parentId: 'administration' })]),
];

describe('flattening', () => {
  it('hides children while collapsed and includes them when expanded', () => {
    expect(flattenTree(TREE, new Set()).map((row) => row.node.id)).toEqual(['catalog', 'administration']);
    expect(flattenTree(TREE, new Set(['catalog'])).map((row) => row.node.id)).toEqual([
      'catalog',
      'products',
      'categories',
      'administration',
    ]);
    const expanded = flattenTree(TREE, new Set(['catalog', 'categories']));
    expect(expanded.map((row) => [row.node.id, row.depth])).toEqual([
      ['catalog', 0],
      ['products', 1],
      ['categories', 1],
      ['sub-categories', 2],
      ['administration', 0],
    ]);
  });

  it('reports whether a row can be expanded', () => {
    const rows = flattenTree(TREE, new Set());
    expect(rows.map((row) => row.hasChildren)).toEqual([true, true]);
  });
});

describe('lookups', () => {
  it('collects ids, counts nodes and finds a node', () => {
    expect(allNodeIds(TREE)).toEqual([
      'catalog',
      'products',
      'categories',
      'sub-categories',
      'administration',
      'users',
    ]);
    expect(countNodes(TREE)).toBe(6);
    expect(findNode(TREE, 'sub-categories')?.id).toBe('sub-categories');
    expect(findNode(TREE, 'ghost')).toBeNull();
  });

  it('returns the node plus its descendants for the parent selector', () => {
    const catalog = findNode(TREE, 'catalog')!;
    expect(subtreeIds(catalog)).toEqual(['catalog', 'products', 'categories', 'sub-categories']);
    expect(ancestorIds(TREE, 'sub-categories')).toEqual(['catalog', 'categories']);
    expect(ancestorIds(TREE, 'catalog')).toEqual([]);
    expect(ancestorIds(TREE, 'ghost')).toEqual([]);
  });

  it('lists siblings for root and nested levels', () => {
    expect(findSiblings(TREE, null).map((n) => n.id)).toEqual(['catalog', 'administration']);
    expect(findSiblings(TREE, 'catalog').map((n) => n.id)).toEqual(['products', 'categories']);
    expect(findSiblings(TREE, 'ghost')).toEqual([]);
  });
});

describe('sibling reorder', () => {
  it('swaps a node with its neighbour and returns the full order', () => {
    expect(moveWithinSiblings(TREE, 'catalog', 'products', 'down')).toEqual(['categories', 'products']);
    expect(moveWithinSiblings(TREE, 'catalog', 'categories', 'up')).toEqual(['categories', 'products']);
  });

  it('returns null at the ends of the list and for unknown ids', () => {
    expect(moveWithinSiblings(TREE, 'catalog', 'products', 'up')).toBeNull();
    expect(moveWithinSiblings(TREE, 'catalog', 'categories', 'down')).toBeNull();
    expect(moveWithinSiblings(TREE, 'catalog', 'ghost', 'up')).toBeNull();
    expect(moveWithinSiblings(TREE, null, 'catalog', 'up')).toBeNull();
  });
});

describe('parent options', () => {
  it('reports depth so the selector can indent', () => {
    expect(parentOptions(TREE, { excludedIds: new Set() })).toEqual([
      { value: 'catalog', label: 'catalog', depth: 0 },
      { value: 'products', label: 'products', depth: 1 },
      { value: 'categories', label: 'categories', depth: 1 },
      { value: 'sub-categories', label: 'sub-categories', depth: 2 },
      { value: 'administration', label: 'administration', depth: 0 },
      { value: 'users', label: 'users', depth: 1 },
    ]);
  });

  it('excludes the edited node and its whole subtree so no cycle can be chosen', () => {
    const excluded = new Set(subtreeIds(findNode(TREE, 'categories')!));
    expect(parentOptions(TREE, { excludedIds: excluded }).map((option) => option.value)).toEqual([
      'catalog',
      'products',
      'administration',
      'users',
    ]);
  });
});
