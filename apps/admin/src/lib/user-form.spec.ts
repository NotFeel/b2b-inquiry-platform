import { describe, expect, it } from 'vitest';
import type { AdminUserSummary, AssignableRoleSummary } from '@b2b/contracts';
import {
  EMPTY_USER_FORM,
  hasErrors,
  isFormDirty,
  mapFieldErrors,
  roleDisplayName,
  roleLabelKey,
  toRoleOptions,
  toUserFormValues,
  validateUserForm,
} from './user-form';

const USER: AdminUserSummary = {
  id: 'u1',
  username: 'sales01',
  displayName: 'Alex',
  status: 'active',
  mustChangePassword: false,
  lastLoginAt: null,
  roles: [
    { id: 'r-sales', code: 'sales', nameKey: 'role.sales', names: {} },
    { id: 'r-viewer', code: 'viewer', nameKey: 'role.viewer', names: {} },
  ],
  createdAt: '2026-10-15T10:00:00.000Z',
  updatedAt: '2026-10-15T10:00:00.000Z',
};

const ROLES: AssignableRoleSummary[] = [
  {
    id: 'r-super',
    code: 'super_admin',
    nameKey: 'role.super_admin',
    names: {},
    description: null,
    isSystem: true,
    assignable: false,
  },
  {
    id: 'r-sales',
    code: 'sales',
    nameKey: 'role.sales',
    names: {},
    description: 'Sales team',
    isSystem: false,
    assignable: true,
  },
  {
    id: 'r-custom',
    code: 'catalog_editor',
    nameKey: 'role.catalog_editor',
    names: { 'zh-CN': '商品维护', 'en-US': 'Catalog editor' },
    description: null,
    isSystem: false,
    assignable: true,
  },
];

describe('validateUserForm', () => {
  it('requires username, display name and at least one role on create', () => {
    const errors = validateUserForm(EMPTY_USER_FORM, 'create');
    expect(errors.username).toBe('users.errors.username');
    expect(errors.displayName).toBe('users.errors.displayNameRequired');
    expect(errors.roleIds).toBe('users.errors.rolesRequired');
    expect(hasErrors(errors)).toBe(true);
  });

  it('rejects an invalid username pattern and accepts a valid one', () => {
    expect(
      validateUserForm({ username: 'Bad Name', displayName: 'A', roleIds: ['r'] }, 'create').username,
    ).toBe('users.errors.username');
    expect(
      hasErrors(validateUserForm({ username: 'sales_01', displayName: 'A', roleIds: ['r'] }, 'create')),
    ).toBe(false);
  });

  it('does not validate the username when editing (the field is read-only)', () => {
    expect(hasErrors(validateUserForm({ username: '', displayName: 'Alex', roleIds: ['r'] }, 'edit'))).toBe(
      false,
    );
  });

  it('rejects an over-long display name', () => {
    const errors = validateUserForm(
      { username: 'sales01', displayName: 'x'.repeat(121), roleIds: ['r'] },
      'create',
    );
    expect(errors.displayName).toBe('users.errors.displayNameTooLong');
  });

  it('requires at least one role when editing too', () => {
    expect(validateUserForm({ username: 'sales01', displayName: 'Alex', roleIds: [] }, 'edit').roleIds).toBe(
      'users.errors.rolesRequired',
    );
  });
});

describe('form seeding and dirty detection', () => {
  it('seeds the edit form from the list row', () => {
    expect(toUserFormValues(USER)).toEqual({
      username: 'sales01',
      displayName: 'Alex',
      roleIds: ['r-sales', 'r-viewer'],
    });
    expect(toUserFormValues(null)).toEqual(EMPTY_USER_FORM);
  });

  it('ignores role ordering but detects name and role changes', () => {
    const initial = toUserFormValues(USER);
    expect(isFormDirty({ ...initial, roleIds: ['r-viewer', 'r-sales'] }, initial)).toBe(false);
    expect(isFormDirty({ ...initial, displayName: 'Alex Chen' }, initial)).toBe(true);
    expect(isFormDirty({ ...initial, roleIds: ['r-sales'] }, initial)).toBe(true);
  });
});

describe('role options', () => {
  const translate = (key: string) => key;

  it('marks a non-assignable role as disabled with a reason instead of hiding it', () => {
    const options = toRoleOptions(ROLES, translate, {
      systemSuffix: 'system',
      notAssignable: 'not allowed',
    }, 'zh-CN');
    expect(options).toHaveLength(3);
    expect(options[0]).toMatchObject({ value: 'r-super', disabled: true, disabledReason: 'not allowed' });
    expect(options[1]).toMatchObject({ value: 'r-sales', disabled: false, disabledReason: null });
    expect(options[2]).toMatchObject({ value: 'r-custom', disabled: false });
  });

  it('prefers the translation key and falls back to the code', () => {
    expect(roleLabelKey({ code: 'sales', nameKey: 'role.sales' })).toBe('role.sales');
    expect(roleLabelKey({ code: 'sales' })).toBe('roles.sales');
  });

  it('renders a custom role with its administrator-maintained name, never the raw key', () => {
    const translated = (key: string) => (key === 'role.sales' ? '销售人员' : key);
    expect(roleDisplayName({ code: 'sales', nameKey: 'role.sales' }, 'zh-CN', translated)).toBe('销售人员');
    // A custom role has no i18n entry, so its stored name is used per locale.
    expect(roleDisplayName(ROLES[2]!, 'zh-CN', translated)).toBe('商品维护');
    expect(roleDisplayName(ROLES[2]!, 'en-US', translated)).toBe('Catalog editor');
    // Unknown role without any name falls back to the stable code.
    expect(roleDisplayName({ code: 'ghost', nameKey: 'role.ghost' }, 'zh-CN', translated)).toBe('ghost');
  });
});

describe('mapFieldErrors', () => {
  it('maps server field details onto form fields', () => {
    expect(mapFieldErrors({ username: 'validation.conflict' })).toEqual({
      username: 'users.errors.usernameTaken',
    });
    expect(mapFieldErrors(undefined)).toEqual({});
  });
});
