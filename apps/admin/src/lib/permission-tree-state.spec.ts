import { describe, expect, it } from 'vitest';
import type { PermissionTreeNode } from '@b2b/contracts';
import {
  allNodeKeys,
  allPermissionCodes,
  countSelected,
  filterPermissionTree,
  nodeCodes,
  nodeOwnCodes,
  resolveNodeLabel,
  resolvePermissionLabel,
  summarizeNode,
  toggleNodeSelection,
} from './permission-tree-state';

const permission = (code: string, module: string, nameKey = `permission.${code}`) => ({
  code,
  module,
  nameKey,
});

const TREE: PermissionTreeNode[] = [
  {
    key: 'menu:catalog',
    kind: 'menu',
    code: 'catalog',
    labels: { 'zh-CN': '商品目录', 'en-US': 'Catalog' },
    labelKey: 'menuLabels.catalog',
    accessPermission: permission('product.read', 'product'),
    permissions: [],
    children: [
      {
        key: 'menu:products',
        kind: 'menu',
        code: 'products',
        labels: { 'zh-CN': '商品管理', 'en-US': 'Products' },
        labelKey: 'menuLabels.products',
        accessPermission: permission('product.read', 'product'),
        permissions: [permission('product.read', 'product'), permission('product.update', 'product')],
        children: [],
      },
    ],
  },
  {
    key: 'module:job',
    kind: 'module',
    code: 'job',
    labels: {},
    labelKey: 'permissionModules.job',
    accessPermission: null,
    permissions: [permission('job.read', 'job')],
    children: [],
  },
];

const CATALOG = TREE[0]!;
const PRODUCTS = CATALOG.children[0]!;
const translate = (key: string) => {
  const dictionary: Record<string, string> = {
    'permissionModules.job': '后台任务',
    'permission.product.read': '查看商品',
    'permission.product.update': '编辑商品',
    'permission.job.read': '查看任务',
  };
  return dictionary[key] ?? key;
};

describe('selection state', () => {
  it('lists own codes and deduplicated subtree codes', () => {
    expect(nodeOwnCodes(PRODUCTS)).toEqual(['product.read', 'product.update']);
    expect(nodeCodes(CATALOG).sort()).toEqual(['product.read', 'product.update']);
    expect(nodeOwnCodes(TREE[1]!)).toEqual(['job.read']);
  });

  it('derives checked, indeterminate and unchecked from the selected set', () => {
    expect(summarizeNode(CATALOG, new Set())).toEqual({ checked: false, indeterminate: false });
    expect(summarizeNode(CATALOG, new Set(['product.read']))).toEqual({
      checked: false,
      indeterminate: true,
    });
    expect(summarizeNode(CATALOG, new Set(['product.read', 'product.update']))).toEqual({
      checked: true,
      indeterminate: false,
    });
    // A node without any selectable code can never look checked.
    expect(
      summarizeNode({ ...TREE[1]!, permissions: [], labelKey: 'x' }, new Set(['job.read'])),
    ).toEqual({ checked: false, indeterminate: false });
  });

  it('selects and clears a whole subtree without mutating the input set', () => {
    const selected = new Set(['job.read']);
    const checked = toggleNodeSelection(PRODUCTS, selected, true);
    expect([...checked].sort()).toEqual(['job.read', 'product.read', 'product.update']);
    expect([...selected]).toEqual(['job.read']);

    const cleared = toggleNodeSelection(CATALOG, checked, false);
    expect([...cleared]).toEqual(['job.read']);
  });

  it('counts only codes reachable from the tree', () => {
    expect(countSelected(TREE, new Set(['product.read', 'ghost.read']))).toBe(1);
    expect(allPermissionCodes(TREE)).toEqual(['job.read', 'product.read', 'product.update']);
  });
});

describe('labels', () => {
  it('prefers the database translation and falls back per locale', () => {
    expect(resolveNodeLabel(CATALOG, 'zh-CN', translate)).toBe('商品目录');
    expect(resolveNodeLabel(CATALOG, 'fr-FR', translate)).toBe('Catalog');
    expect(resolveNodeLabel(CATALOG.children[0]!, 'zh-CN', translate)).toBe('商品管理');
  });

  it('resolves a module group through i18n and finally the code', () => {
    expect(resolveNodeLabel(TREE[1]!, 'zh-CN', translate)).toBe('后台任务');
    expect(resolveNodeLabel({ ...TREE[1]!, labelKey: 'permissionModules.ghost' }, 'zh-CN', translate)).toBe(
      'job',
    );
  });

  it('resolves a permission label through i18n and falls back to the code', () => {
    expect(resolvePermissionLabel(permission('product.read', 'product'), translate)).toBe('查看商品');
    expect(resolvePermissionLabel(permission('ghost.read', 'ghost'), translate)).toBe('ghost.read');
  });
});

describe('search filtering', () => {
  it('keeps the parent path when a child matches', () => {
    const filtered = filterPermissionTree(TREE, '编辑商品', 'zh-CN', translate);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.code).toBe('catalog');
    expect(filtered[0]!.children.map((child) => child.code)).toEqual(['products']);
  });

  it('keeps the whole subtree when the parent matches', () => {
    const filtered = filterPermissionTree(TREE, 'CATALOG', 'zh-CN', translate);
    expect(filtered.map((node) => node.code)).toEqual(['catalog']);
    expect(filtered[0]!.children).toHaveLength(1);
  });

  it('matches on machine codes and drops nothing when the term is empty', () => {
    expect(filterPermissionTree(TREE, 'job.read', 'zh-CN', translate).map((node) => node.code)).toEqual([
      'job',
    ]);
    expect(filterPermissionTree(TREE, '   ', 'zh-CN', translate)).toBe(TREE);
  });

  it('never mutates the selection set', () => {
    const selected = new Set(['product.read', 'product.update']);
    filterPermissionTree(TREE, '任务', 'zh-CN', translate);
    expect([...selected].sort()).toEqual(['product.read', 'product.update']);
    expect(summarizeNode(CATALOG, selected).checked).toBe(true);
  });

  it('returns an empty list when nothing matches', () => {
    expect(filterPermissionTree(TREE, 'zzz', 'zh-CN', translate)).toEqual([]);
  });
});

describe('allNodeKeys', () => {
  it('lists every key for expand-all', () => {
    expect(allNodeKeys(TREE)).toEqual([
      'menu:catalog',
      'menu:products',
      'module:job',
    ]);
  });
});
