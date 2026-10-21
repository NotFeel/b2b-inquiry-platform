import { describe, expect, it } from 'vitest';
import {
  buildPermissionTree,
  collectTreePermissionCodes,
  moduleOfPermissionCode,
  serializePermissionTree,
  type MenuTreeRow,
  type PermissionTreeDraftNode,
  type PermissionRow,
} from './permission-tree';

// Mirrors the real seed shape: a group that shares a permission code with its
// leaf child, and action permissions that belong to a module.
const MENUS: MenuTreeRow[] = [
  {
    id: 'm-catalog',
    code: 'catalog',
    parentId: null,
    permissionCode: 'product.read',
    sortOrder: 20,
    translations: [
      { locale: 'zh-CN', label: '商品目录' },
      { locale: 'en-US', label: 'Catalog' },
    ],
  },
  {
    id: 'm-products',
    code: 'products',
    parentId: 'm-catalog',
    permissionCode: 'product.read',
    sortOrder: 21,
    translations: [
      { locale: 'zh-CN', label: '商品管理' },
      { locale: 'en-US', label: 'Products' },
    ],
  },
  {
    id: 'm-admin',
    code: 'administration',
    parentId: null,
    permissionCode: null,
    sortOrder: 90,
    translations: [{ locale: 'zh-CN', label: '系统管理' }],
  },
  {
    id: 'm-roles',
    code: 'roles',
    parentId: 'm-admin',
    permissionCode: 'role.read',
    sortOrder: 91,
    translations: [
      { locale: 'zh-CN', label: '角色' },
      { locale: 'en-US', label: 'Roles' },
    ],
  },
];

const PERMISSIONS: PermissionRow[] = [
  { code: 'product.read', nameKey: 'permission.product.read', module: 'product' },
  { code: 'product.update', nameKey: 'permission.product.update', module: 'product' },
  { code: 'role.read', nameKey: 'permission.role.read', module: 'role' },
  { code: 'role.permissions.update', nameKey: 'permission.role.permissions.update', module: 'role' },
  { code: 'job.read', nameKey: 'permission.job.read', module: 'job' },
];

function findNode(
  nodes: ReturnType<typeof buildPermissionTree>['items'],
  key: string,
): PermissionTreeDraftNode | undefined {
  for (const node of nodes) {
    if (node.key === key) return node;
    const child = findNode(node.children, key);
    if (child) return child;
  }
  return undefined;
}

describe('moduleOfPermissionCode', () => {
  it('derives the module from a dotted permission code', () => {
    expect(moduleOfPermissionCode('product.read')).toBe('product');
    expect(moduleOfPermissionCode('role.permissions.update')).toBe('role');
    expect(moduleOfPermissionCode('dashboard')).toBe('dashboard');
  });
});

describe('buildPermissionTree', () => {
  const draft = buildPermissionTree(MENUS, PERMISSIONS);

  it('keeps the real menu hierarchy and its translated labels', () => {
    const products = findNode(draft.items, 'menu:products');
    expect(products?.labels).toEqual({ 'zh-CN': '商品管理', 'en-US': 'Products' });
    expect(products?.kind).toBe('menu');
  });

  it('exposes the menu access permission on every node that declares one', () => {
    expect(findNode(draft.items, 'menu:catalog')?.accessPermission?.code).toBe('product.read');
    expect(findNode(draft.items, 'menu:products')?.accessPermission?.code).toBe('product.read');
    expect(findNode(draft.items, 'menu:administration')?.accessPermission).toBeNull();
  });

  it('attaches a module once, to the deepest node that references it', () => {
    const products = findNode(draft.items, 'menu:products');
    const catalog = findNode(draft.items, 'menu:catalog');
    expect(products?.permissions.map((permission) => permission.code)).toEqual([
      'product.read',
      'product.update',
    ]);
    expect(catalog?.permissions).toEqual([]);
  });

  it('appends a module group for permissions no menu references', () => {
    const job = findNode(draft.items, 'module:job');
    expect(job?.kind).toBe('module');
    expect(job?.labelKey).toBe('permissionModules.job');
    expect(job?.permissions.map((permission) => permission.code)).toEqual(['job.read']);
  });

  it('lists every permission exactly once for validation', () => {
    expect(collectTreePermissionCodes(draft.items)).toEqual([
      'job.read',
      'product.read',
      'product.update',
      'role.permissions.update',
      'role.read',
    ]);
    expect(draft.allPermissionCodes).toHaveLength(PERMISSIONS.length);
  });

  it('serialises without the layout-only fields', () => {
    const tree = serializePermissionTree(draft);
    const node = tree.items[0] as unknown as Record<string, unknown>;
    expect(node.depth).toBeUndefined();
    expect(node.order).toBeUndefined();
    expect(tree.allPermissionCodes).toContain('role.permissions.update');
  });
});
