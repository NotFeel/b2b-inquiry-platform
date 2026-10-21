import { describe, expect, it } from 'vitest';
import type { RoleSummary } from '@b2b/contracts';
import {
  EMPTY_ROLE_FORM,
  hasRoleFormErrors,
  isRoleFormDirty,
  mapRoleFieldErrors,
  toRoleFormValues,
  toRolePayload,
  validateRoleForm,
} from './role-form';

const CUSTOM_ROLE: RoleSummary = {
  id: 'r-custom',
  code: 'catalog_editor',
  nameKey: 'role.catalog_editor',
  names: { 'zh-CN': '商品维护', 'en-US': 'Catalog editor' },
  description: 'Maintains the catalogue',
  isSystem: false,
  permissions: ['product.read', 'product.update'],
  permissionCount: 2,
  userCount: 0,
  updatedAt: '2026-10-15T10:00:00.000Z',
};

const VALID = { code: 'sales_apac', nameZh: '亚太销售', nameEn: 'APAC sales', description: '' };

describe('validateRoleForm', () => {
  it('requires a code, a Chinese name and an English name', () => {
    const errors = validateRoleForm(EMPTY_ROLE_FORM, 'create');
    expect(errors).toEqual({
      code: 'roles.errors.codeRequired',
      nameZh: 'roles.errors.nameZhRequired',
      nameEn: 'roles.errors.nameEnRequired',
    });
    expect(hasRoleFormErrors(errors)).toBe(true);
  });

  it('rejects illegal, uppercase and over-long role codes', () => {
    for (const code of ['Sales', '1sales', 'sales-apac', 'a', 'x'.repeat(81)]) {
      expect(validateRoleForm({ ...VALID, code }, 'create').code).toBe('roles.errors.codeInvalid');
    }
    expect(hasRoleFormErrors(validateRoleForm(VALID, 'create'))).toBe(false);
  });

  it('does not validate the code while editing (it is read-only and immutable)', () => {
    expect(validateRoleForm({ ...VALID, code: 'SALES' }, 'edit')).toEqual({});
  });
});

describe('seeding and payloads', () => {
  it('seeds the edit form from a custom role row', () => {
    expect(toRoleFormValues(CUSTOM_ROLE)).toEqual({
      code: 'catalog_editor',
      nameZh: '商品维护',
      nameEn: 'Catalog editor',
      description: 'Maintains the catalogue',
    });
    expect(toRoleFormValues(null)).toEqual(EMPTY_ROLE_FORM);
  });

  it('sends the code only on create and both locales always', () => {
    expect(toRolePayload(VALID, 'create')).toEqual({
      code: 'sales_apac',
      names: { 'zh-CN': '亚太销售', 'en-US': 'APAC sales' },
      description: null,
    });
    expect(toRolePayload(VALID, 'edit')).not.toHaveProperty('code');
  });

  it('detects changes in any editable field', () => {
    const initial = toRoleFormValues(CUSTOM_ROLE);
    expect(isRoleFormDirty({ ...initial }, initial)).toBe(false);
    expect(isRoleFormDirty({ ...initial, nameEn: 'Catalog maintainer' }, initial)).toBe(true);
    expect(isRoleFormDirty({ ...initial, description: '' }, initial)).toBe(true);
  });
});

describe('mapRoleFieldErrors', () => {
  it('maps a duplicate code onto the code field', () => {
    expect(mapRoleFieldErrors({ code: 'validation.conflict' })).toEqual({
      code: 'roles.errors.codeTaken',
    });
    expect(mapRoleFieldErrors(undefined)).toEqual({});
  });
});
