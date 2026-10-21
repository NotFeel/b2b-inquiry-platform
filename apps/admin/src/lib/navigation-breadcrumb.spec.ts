import { describe, expect, it } from 'vitest';
import type { MenuNode } from '@b2b/contracts';
import { resolveNavigationBreadcrumb } from './navigation-breadcrumb';

function menu(
  code: string,
  label: string,
  route: string | null = null,
  children: MenuNode[] = [],
): MenuNode {
  return {
    id: code,
    code,
    label,
    labels: {},
    parentId: null,
    route,
    icon: null,
    permissionCode: null,
    sortOrder: 10,
    visible: true,
    enabled: true,
    external: false,
    updatedAt: '2026-10-18T00:00:00.000Z',
    children,
  };
}

const MENUS = [
  menu('workspace', 'Workspace', null, [menu('dashboard', 'Operations Overview', '/dashboard')]),
  menu('catalog', 'Catalog', null, [
    menu('products', 'Product Management', '/products'),
    menu('categories', 'Category Management', '/categories'),
  ]),
];

describe('resolveNavigationBreadcrumb', () => {
  it('uses localized menu labels for a deep product edit route', () => {
    expect(resolveNavigationBreadcrumb(MENUS, '/en-US/products/abc/edit', 'en-US')).toEqual([
      { label: 'Catalog' },
      { label: 'Product Management' },
    ]);
  });

  it('keeps the group and child trail for an exact route', () => {
    expect(resolveNavigationBreadcrumb(MENUS, '/zh-CN/categories', 'zh-CN')).toEqual([
      { label: 'Catalog' },
      { label: 'Category Management' },
    ]);
  });

  it('does not match a route prefix without a path boundary', () => {
    expect(resolveNavigationBreadcrumb(MENUS, '/en-US/products-archive', 'en-US')).toBeUndefined();
  });

  it('returns undefined when the user cannot see the route', () => {
    expect(resolveNavigationBreadcrumb([], '/en-US/products', 'en-US')).toBeUndefined();
  });
});
