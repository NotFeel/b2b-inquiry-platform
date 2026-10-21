import { describe, expect, it } from 'vitest';
import type { MenuNode, PermissionSummary } from '@b2b/contracts';
import {
  emptyMenuForm,
  hasMenuFormErrors,
  isMenuFormDirty,
  mapMenuFieldErrors,
  nextSortOrder,
  toMenuFormValues,
  toMenuPayload,
  toPermissionOptions,
  validateMenuForm,
  type MenuFormValues,
} from './menu-form';

const LOCALES = ['zh-CN', 'en-US'] as const;

const node = (overrides: Partial<MenuNode> = {}): MenuNode => ({
  id: 'm1',
  code: 'products',
  label: '商品管理',
  labels: { 'zh-CN': '商品管理', 'en-US': 'Products' },
  parentId: 'catalog',
  route: '/products',
  icon: 'box',
  permissionCode: 'product.read',
  sortOrder: 21,
  visible: true,
  enabled: true,
  external: false,
  updatedAt: '2026-10-15T10:00:00.000Z',
  children: [],
  ...overrides,
});

const valid: MenuFormValues = {
  ...emptyMenuForm(30),
  code: 'reports',
  labels: { 'zh-CN': '报表', 'en-US': 'Reports' },
  route: '/reports',
};

/** Group menus carry no route; page menus require one. */
const groupForm: MenuFormValues = { ...valid, type: 'group', route: '' };

describe('validateMenuForm', () => {
  it('requires a code, both labels and a valid sort order when creating', () => {
    const errors = validateMenuForm(emptyMenuForm(), 'create', LOCALES);
    expect(errors.code).toBe('menus.errors.codeRequired');
    expect(errors.labels).toEqual({
      'zh-CN': 'menus.errors.labelRequired',
      'en-US': 'menus.errors.labelRequired',
    });
    expect(hasMenuFormErrors(errors)).toBe(true);
    expect(hasMenuFormErrors(validateMenuForm(valid, 'create', LOCALES))).toBe(false);
  });

  it('rejects uppercase, spaced and over-long codes', () => {
    for (const code of ['Reports', 're ports', 'a', 'x'.repeat(101)]) {
      expect(validateMenuForm({ ...valid, code }, 'create', LOCALES).code).toBe('menus.errors.codeInvalid');
    }
  });

  it('does not re-validate the code while editing', () => {
    expect(validateMenuForm({ ...valid, code: 'Products' }, 'edit', LOCALES).code).toBeUndefined();
  });

  it('enforces the route shape for internal and external menus', () => {
    expect(validateMenuForm({ ...valid, route: 'products' }, 'create', LOCALES).route).toBe(
      'menus.errors.internalRoute',
    );
    expect(validateMenuForm({ ...valid, route: '' }, 'create', LOCALES).route).toBe(
      'menus.errors.pageRouteRequired',
    );
    expect(validateMenuForm(groupForm, 'create', LOCALES).route).toBeUndefined();
    expect(validateMenuForm({ ...groupForm, route: '/reports' }, 'create', LOCALES).route).toBe(
      'menus.errors.groupHasRoute',
    );
    expect(
      validateMenuForm({ ...valid, type: 'external', route: 'http://example.com' }, 'create', LOCALES).route,
    ).toBe('menus.errors.externalRoute');
    expect(
      validateMenuForm({ ...valid, type: 'external', route: 'https://example.com' }, 'create', LOCALES).route,
    ).toBeUndefined();
  });

  it('rejects a non-integer or out-of-range sort order', () => {
    for (const sortOrder of ['', '2.5', '-1', '10001', 'abc']) {
      expect(validateMenuForm({ ...valid, sortOrder }, 'create', LOCALES).sortOrder).toBe(
        'menus.errors.sortOrder',
      );
    }
  });

  it('reports an over-long label per locale', () => {
    const errors = validateMenuForm(
      { ...valid, labels: { 'zh-CN': 'x'.repeat(161), 'en-US': 'Reports' } },
      'create',
      LOCALES,
    );
    expect(errors.labels).toEqual({ 'zh-CN': 'menus.errors.labelTooLong' });
  });
});

describe('seeding, payloads and dirty state', () => {
  it('seeds the edit form from the tree row and back again', () => {
    const values = toMenuFormValues(node(), LOCALES);
    expect(values).toMatchObject({
      code: 'products',
      type: 'page',
      parentId: 'catalog',
      route: '/products',
      icon: 'box',
      permissionCode: 'product.read',
      sortOrder: '21',
      labels: { 'zh-CN': '商品管理', 'en-US': 'Products' },
    });
    expect(toMenuPayload(values, 'edit')).toEqual({
      parentId: 'catalog',
      route: '/products',
      icon: 'box',
      permissionCode: 'product.read',
      sortOrder: 21,
      visible: true,
      enabled: true,
      external: false,
      labels: { 'zh-CN': '商品管理', 'en-US': 'Products' },
    });
    // A grouping menu reports itself as such and sends no route back.
    const groupValues = toMenuFormValues(node({ route: null, permissionCode: null }), LOCALES);
    expect(groupValues.type).toBe('group');
    expect(toMenuPayload(groupValues, 'edit')).toMatchObject({ route: null, external: false });
  });

  it('sends the code only on create and maps empty fields to null', () => {
    const payload = toMenuPayload({ ...emptyMenuForm(), code: 'reports', labels: { 'zh-CN': '报表' } }, 'create');
    expect(payload).toMatchObject({
      code: 'reports',
      parentId: null,
      route: null,
      icon: null,
      permissionCode: null,
      labels: { 'zh-CN': '报表' },
    });
  });

  it('detects changes in any editable field', () => {
    const initial = toMenuFormValues(node(), LOCALES);
    expect(isMenuFormDirty(initial, initial)).toBe(false);
    expect(isMenuFormDirty({ ...initial, enabled: false }, initial)).toBe(true);
    expect(isMenuFormDirty({ ...initial, labels: { ...initial.labels, 'en-US': 'Product list' } }, initial)).toBe(
      true,
    );
    expect(isMenuFormDirty({ ...initial, sortOrder: '99' }, initial)).toBe(true);
    expect(isMenuFormDirty({ ...initial, type: 'group' }, initial)).toBe(true);
    expect(isMenuFormDirty(initial, { ...initial, type: 'group' })).toBe(true);
    expect(isMenuFormDirty({ ...initial, type: 'group' }, { ...initial, type: 'group' })).toBe(false);
  });

  it('suggests the next sibling sort order', () => {
    expect(nextSortOrder([])).toBe(10);
    expect(nextSortOrder([node({ sortOrder: 21 }), node({ sortOrder: 22 })])).toBe(32);
  });
});

describe('error mapping and permission options', () => {
  it('maps server details onto the matching field', () => {
    expect(mapMenuFieldErrors({ code: 'validation.conflict' })).toEqual({ code: 'menus.errors.codeTaken' });
    expect(mapMenuFieldErrors({ parentId: 'menu.parent.missing' })).toEqual({
      parentId: 'menus.errors.parentInvalid',
    });
    expect(mapMenuFieldErrors({ permissionCode: 'ghost.read' })).toEqual({
      permissionCode: 'menus.errors.permissionUnknown',
    });
    expect(mapMenuFieldErrors(undefined)).toEqual({});
  });

  it('labels permission options from i18n and falls back to the code', () => {
    const permissions: PermissionSummary[] = [
      { code: 'product.read', nameKey: 'permission.product.read', module: 'product' },
      { code: 'ghost.read', nameKey: 'permission.ghost.read', module: 'ghost' },
    ];
    const translate = (key: string) => (key === 'permission.product.read' ? '查看商品' : key);
    expect(toPermissionOptions(permissions, translate)).toEqual([
      { value: 'product.read', label: '查看商品', hint: 'product · product.read' },
      { value: 'ghost.read', label: 'ghost.read', hint: 'ghost · ghost.read' },
    ]);
  });
});
