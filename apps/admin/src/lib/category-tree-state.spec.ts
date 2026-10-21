import { describe, expect, it } from 'vitest';
import type { CategoryNode } from '@b2b/contracts';
import {
  allNodeIds,
  ancestorIds,
  categoryMatchesSearch,
  categoryPickerRows,
  countNodes,
  defaultExpandedIds,
  findNode,
  findSiblings,
  flattenTree,
  highlightParts,
  localizedName,
  moveWithinSiblings,
  nextSortOrder,
  pathLabel,
  pathOf,
  subtreeIds,
  toParentTreeNodes,
} from './category-tree-state';

const node = (
  id: string,
  children: CategoryNode[] = [],
  overrides: Partial<CategoryNode> = {},
): CategoryNode => ({
  id,
  code: id,
  slug: id,
  name: id,
  parentId: null,
  sortOrder: 10,
  enabled: true,
  visible: true,
  coverImageId: null,
  names: { 'zh-CN': id, 'en-US': id },
  descriptions: {},
  productCount: 0,
  totalProductCount: 0,
  updatedAt: '2026-10-16T10:00:00.000Z',
  children,
  ...overrides,
});

const TREE: CategoryNode[] = [
  node('catalog', [
    node(
      'toys',
      [
        node('model-toys', [], { parentId: 'toys' }),
        node('electric-toys', [], { parentId: 'toys' }),
      ],
      { parentId: 'catalog' },
    ),
    node('auto', [], { parentId: 'catalog' }),
  ]),
  node('outdoor'),
];

describe('flattening', () => {
  it('only lists children while the parent is expanded', () => {
    const collapsed = flattenTree(TREE, new Set());
    expect(collapsed.map((row) => row.node.id)).toEqual(['catalog', 'outdoor']);

    const partly = flattenTree(TREE, new Set(['catalog']));
    expect(partly.map((row) => row.node.id)).toEqual(['catalog', 'toys', 'auto', 'outdoor']);
    expect(partly.find((row) => row.node.id === 'toys')?.depth).toBe(1);

    const deep = flattenTree(TREE, new Set(['catalog', 'toys']));
    expect(deep.map((row) => row.node.id)).toEqual([
      'catalog',
      'toys',
      'model-toys',
      'electric-toys',
      'auto',
      'outdoor',
    ]);
  });

  it('counts every node and lists every id', () => {
    expect(countNodes(TREE)).toBe(6);
    expect(allNodeIds(TREE)).toEqual([
      'catalog',
      'toys',
      'model-toys',
      'electric-toys',
      'auto',
      'outdoor',
    ]);
  });

  it('expands only the top-level branches by default', () => {
    expect(defaultExpandedIds(TREE)).toEqual(['catalog']);
  });
});

describe('lookups and paths', () => {
  it('finds nodes, ancestors and the full path', () => {
    expect(findNode(TREE, 'model-toys')?.id).toBe('model-toys');
    expect(findNode(TREE, 'nope')).toBeNull();
    expect(ancestorIds(TREE, 'model-toys')).toEqual(['catalog', 'toys']);
    expect(pathOf(TREE, 'model-toys').map((item) => item.id)).toEqual([
      'catalog',
      'toys',
      'model-toys',
    ]);
    expect(pathLabel(TREE, 'model-toys', 'zh-CN')).toBe('catalog / toys / model-toys');
    expect(pathLabel(TREE, 'missing', 'zh-CN')).toBeNull();
  });

  it('lists the node itself plus its descendants for the parent picker', () => {
    const toys = findNode(TREE, 'toys');
    expect(toys).not.toBeNull();
    expect(subtreeIds(toys as CategoryNode).sort()).toEqual([
      'electric-toys',
      'model-toys',
      'toys',
    ]);
  });

  it('resolves display names with the API fallback order', () => {
    const localized = node('x', [], { names: { 'en-US': 'English only' } });
    expect(localizedName(localized, 'zh-CN')).toBe('English only');
    const untranslated = node('y', [], { names: {} });
    expect(localizedName(untranslated, 'zh-CN')).toBe('y');
  });

  it('builds selector nodes carrying the code as a hint', () => {
    const options = toParentTreeNodes(TREE, 'en-US');
    expect(options[0]?.id).toBe('catalog');
    expect(options[0]?.children?.[0]?.hint).toBe('toys');
  });
});

describe('sibling ordering', () => {
  it('suggests the next free sort order', () => {
    expect(nextSortOrder([])).toBe(10);
    expect(
      nextSortOrder([node('a', [], { sortOrder: 10 }), node('b', [], { sortOrder: 40 })]),
    ).toBe(50);
  });

  it('finds the siblings of a node', () => {
    expect(findSiblings(TREE, null).map((item) => item.id)).toEqual(['catalog', 'outdoor']);
    expect(findSiblings(TREE, 'toys').map((item) => item.id)).toEqual([
      'model-toys',
      'electric-toys',
    ]);
    expect(findSiblings(TREE, 'nope')).toEqual([]);
  });

  it('returns the new order for a move and null at the ends', () => {
    expect(moveWithinSiblings(TREE, null, 'outdoor', 'up')).toEqual(['outdoor', 'catalog']);
    expect(moveWithinSiblings(TREE, null, 'catalog', 'up')).toBeNull();
    expect(moveWithinSiblings(TREE, null, 'catalog', 'down')).toEqual(['outdoor', 'catalog']);
    expect(moveWithinSiblings(TREE, null, 'outdoor', 'down')).toBeNull();
    expect(moveWithinSiblings(TREE, 'toys', 'electric-toys', 'up')).toEqual([
      'electric-toys',
      'model-toys',
    ]);
    expect(moveWithinSiblings(TREE, 'toys', 'unknown', 'up')).toBeNull();
  });
});

describe('search highlighting', () => {
  it('splits a label around every occurrence of the term', () => {
    expect(highlightParts('Model toys', 'toy')).toEqual([
      { text: 'Model ', match: false },
      { text: 'toy', match: true },
      { text: 's', match: false },
    ]);
  });

  it('is case-insensitive and safe with an empty or absent term', () => {
    expect(highlightParts('Toys', 'to')).toEqual([
      { text: 'To', match: true },
      { text: 'ys', match: false },
    ]);
    expect(highlightParts('Toys', '   ')).toEqual([{ text: 'Toys', match: false }]);
    expect(highlightParts('Toys', 'zz')).toEqual([{ text: 'Toys', match: false }]);
  });
});

describe('category picker rows', () => {
  it('matches names in every locale plus the stable code and slug', () => {
    const toys = node('toys', [], {
      code: 'toys-code',
      slug: 'toys-slug',
      names: { 'zh-CN': '玩具', 'en-US': 'Toys' },
    });
    expect(categoryMatchesSearch(toys, '玩具')).toBe(true);
    expect(categoryMatchesSearch(toys, 'toys')).toBe(true);
    expect(categoryMatchesSearch(toys, 'toys-code')).toBe(true);
    expect(categoryMatchesSearch(toys, 'missing')).toBe(false);
  });

  it('shows only expanded branches without a search term', () => {
    expect(
      categoryPickerRows(TREE, { term: '', expandedIds: new Set() }).map((row) => row.node.id),
    ).toEqual(['catalog', 'outdoor']);
    expect(
      categoryPickerRows(TREE, {
        term: '',
        expandedIds: new Set(['catalog', 'toys']),
      }).map((row) => `${row.node.id}:${row.depth}`),
    ).toEqual(['catalog:0', 'toys:1', 'model-toys:2', 'electric-toys:2', 'auto:1', 'outdoor:0']);
  });

  it('opens the ancestor path of a deep search hit and keeps only matching branches', () => {
    const rows = categoryPickerRows(TREE, {
      term: 'model',
      expandedIds: new Set(),
    });
    expect(rows.map((row) => row.node.id)).toEqual(['catalog', 'toys', 'model-toys']);
    expect(rows.map((row) => row.expanded)).toEqual([true, true, false]);
    expect(rows.map((row) => row.matched)).toEqual([false, false, true]);
  });

  it('lets an operator collapse an auto-opened search branch', () => {
    const rows = categoryPickerRows(TREE, {
      term: 'model',
      expandedIds: new Set(),
      collapsedIds: new Set(['toys']),
    });
    expect(rows.map((row) => row.node.id)).toEqual(['catalog', 'toys']);
    expect(rows.map((row) => row.expanded)).toEqual([true, false]);
  });

  it('does not treat a parent as selectable-only or omit its children when expanded', () => {
    const rows = categoryPickerRows(TREE, {
      term: '',
      expandedIds: new Set(['catalog', 'toys']),
    });
    const parent = rows.find((row) => row.node.id === 'toys');
    expect(parent?.node.enabled).toBe(true);
    expect(parent?.hasChildren).toBe(true);
    expect(rows.some((row) => row.node.id === 'model-toys')).toBe(true);
  });
});
