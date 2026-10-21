import { describe, expect, it } from 'vitest';
import { ApiError } from '../../common/errors/api-error';
import {
  assertExpectedUpdatedAt,
  assertPermissionSelectionIsValid,
  assertRoleIsDeletable,
  assertRoleIsWritable,
  canonicalPermissionCodes,
  diffPermissionSets,
  findForbiddenGrants,
  findUnknownPermissionCodes,
  missingRoleNameLocales,
  permissionSignature,
  toTranslationRows,
  type ActorScope,
} from './role-permission-policy';

const CUSTOM_ROLE = { id: 'r1', code: 'sales', isSystem: false };
const SYSTEM_ROLE = { id: 'r2', code: 'viewer', isSystem: true };
const SUPER_ADMIN = { id: 'r3', code: 'super_admin', isSystem: true };

const superAdmin: ActorScope = { isSuperAdmin: true, permissions: new Set() };
const limitedAdmin: ActorScope = {
  isSuperAdmin: false,
  permissions: new Set(['product.read', 'product.update']),
};

describe('role protection', () => {
  it('allows edits on a custom role', () => {
    expect(() => assertRoleIsWritable(CUSTOM_ROLE)).not.toThrow();
  });

  it('protects system roles, including super_admin, with ROLE_SYSTEM_PROTECTED', () => {
    for (const role of [SYSTEM_ROLE, SUPER_ADMIN]) {
      try {
        assertRoleIsWritable(role);
        throw new Error('expected the guard to throw');
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).code).toBe('ROLE_SYSTEM_PROTECTED');
        expect((error as ApiError).getStatus()).toBe(409);
      }
    }
  });

  it('refuses to delete a role that is still assigned to users', () => {
    expect(() => assertRoleIsDeletable(CUSTOM_ROLE, 0)).not.toThrow();
    try {
      assertRoleIsDeletable(CUSTOM_ROLE, 3);
      throw new Error('expected the guard to throw');
    } catch (error) {
      expect((error as ApiError).code).toBe('ROLE_IN_USE');
      expect((error as ApiError).details).toMatchObject({ userCount: 3 });
    }
  });

  it('refuses to delete a system role before looking at the user count', () => {
    expect(() => assertRoleIsDeletable(SYSTEM_ROLE, 0)).toThrowError(/protected/i);
  });
});

describe('permission set validation', () => {
  const known = ['product.read', 'product.update', 'role.read'];

  it('rejects unknown codes instead of silently dropping them', () => {
    expect(findUnknownPermissionCodes(['product.read', 'ghost.read'], known)).toEqual(['ghost.read']);
    try {
      assertPermissionSelectionIsValid({
        requested: ['product.read', 'ghost.read'],
        known,
        current: [],
        actor: superAdmin,
      });
      throw new Error('expected the validator to throw');
    } catch (error) {
      expect((error as ApiError).code).toBe('PERMISSION_CODE_INVALID');
      expect((error as ApiError).getStatus()).toBe(400);
    }
  });

  it('lets a super administrator grant anything and returns a canonical list', () => {
    expect(
      assertPermissionSelectionIsValid({
        requested: ['product.update', 'product.read', 'product.read'],
        known,
        current: [],
        actor: superAdmin,
      }),
    ).toEqual(['product.read', 'product.update']);
  });

  it('clamps a non-super-admin to the permissions they already hold', () => {
    expect(() =>
      assertPermissionSelectionIsValid({
        requested: ['product.read'],
        known,
        current: [],
        actor: limitedAdmin,
      }),
    ).not.toThrow();

    try {
      assertPermissionSelectionIsValid({
        requested: ['product.read', 'role.read'],
        known,
        current: [],
        actor: limitedAdmin,
      });
      throw new Error('expected the validator to throw');
    } catch (error) {
      expect((error as ApiError).code).toBe('PERMISSION_ASSIGNMENT_FORBIDDEN');
      expect((error as ApiError).getStatus()).toBe(403);
      expect((error as ApiError).details).toMatchObject({ codes: 'role.read' });
    }
  });

  it('allows re-saving a role that already holds permissions the actor lacks', () => {
    expect(
      findForbiddenGrants({
        requested: ['product.read', 'role.read'],
        current: ['role.read'],
        actor: limitedAdmin,
      }),
    ).toEqual([]);
  });
});

describe('diffing and normalization', () => {
  it('reports added and removed codes in a stable order', () => {
    expect(diffPermissionSets(['b', 'a'], ['a', 'c'])).toEqual({
      before: ['a', 'b'],
      after: ['a', 'c'],
      added: ['c'],
      removed: ['b'],
    });
  });

  it('deduplicates and sorts codes', () => {
    expect(canonicalPermissionCodes(['b', 'a', 'b'])).toEqual(['a', 'b']);
    expect(permissionSignature(['b', 'a'])).toBe('a,b');
  });
});

describe('optimistic concurrency', () => {
  const updatedAt = new Date('2026-10-15T10:00:00.000Z');

  it('accepts a matching timestamp and a missing one', () => {
    expect(() => assertExpectedUpdatedAt(updatedAt.toISOString(), updatedAt)).not.toThrow();
    expect(() => assertExpectedUpdatedAt(undefined, updatedAt)).not.toThrow();
  });

  it('reports a stale editor as CONCURRENT_ROLE_UPDATE', () => {
    try {
      assertExpectedUpdatedAt('2026-10-15T09:00:00.000Z', updatedAt);
      throw new Error('expected the guard to throw');
    } catch (error) {
      expect((error as ApiError).code).toBe('CONCURRENT_ROLE_UPDATE');
      expect((error as ApiError).getStatus()).toBe(409);
    }
  });
});

describe('role names', () => {
  it('drops empty names and trims the rest', () => {
    expect(toTranslationRows({ 'zh-CN': ' 销售 ', 'en-US': '' })).toEqual([
      { locale: 'zh-CN', name: '销售' },
    ]);
  });

  it('requires both admin locales', () => {
    expect(missingRoleNameLocales({ 'zh-CN': '销售', 'en-US': 'Sales' })).toEqual([]);
    expect(missingRoleNameLocales({ 'zh-CN': '销售' })).toEqual(['en-US']);
  });
});
