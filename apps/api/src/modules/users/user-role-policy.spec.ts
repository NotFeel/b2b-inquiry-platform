import { describe, expect, it } from 'vitest';
import { ApiError } from '../../common/errors/api-error';
import {
  assertLastSuperAdminRule,
  assertRoleSelectionIsValid,
  canActorAssignRole,
  dedupeIds,
  findMissingRoleIds,
  findUnassignableRoleCodes,
  roleCodeSignature,
  wouldRemoveLastSuperAdmin,
  type RoleRef,
} from './user-role-policy';

const ROLES: RoleRef[] = [
  { id: 'r-super', code: 'super_admin' },
  { id: 'r-catalog', code: 'catalog_manager' },
  { id: 'r-sales', code: 'sales' },
  { id: 'r-viewer', code: 'viewer' },
];
const ACTOR_SUPER = ['super_admin'];
const ACTOR_SALES = ['sales'];

describe('role id hygiene', () => {
  it('de-duplicates submitted ids while preserving order', () => {
    expect(dedupeIds(['b', 'a', 'b'])).toEqual(['b', 'a']);
  });

  it('reports ids that no longer exist', () => {
    expect(findMissingRoleIds(['r-sales', 'r-gone'], ROLES)).toEqual(['r-gone']);
  });
});

describe('privileged role policy', () => {
  it('only lets a super administrator grant super_admin', () => {
    expect(canActorAssignRole('super_admin', ACTOR_SUPER)).toBe(true);
    expect(canActorAssignRole('super_admin', ACTOR_SALES)).toBe(false);
    expect(canActorAssignRole('sales', ACTOR_SALES)).toBe(true);
  });

  it('flags unassignable roles for a non-super-admin actor', () => {
    expect(findUnassignableRoleCodes(['r-sales', 'r-super'], ROLES, ACTOR_SALES)).toEqual(['super_admin']);
    expect(findUnassignableRoleCodes(['r-sales', 'r-super'], ROLES, ACTOR_SUPER)).toEqual([]);
  });
});

describe('assertRoleSelectionIsValid', () => {
  it('accepts a valid selection and returns the resolved roles', () => {
    const resolved = assertRoleSelectionIsValid({
      requestedIds: ['r-sales', 'r-viewer', 'r-sales'],
      knownRoles: ROLES,
      actorRoles: ACTOR_SUPER,
    });
    expect(resolved.map((role) => role.code)).toEqual(['sales', 'viewer']);
  });

  it('rejects an empty selection', () => {
    expect(() =>
      assertRoleSelectionIsValid({ requestedIds: [], knownRoles: ROLES, actorRoles: ACTOR_SUPER }),
    ).toThrow(ApiError);
  });

  it('rejects unknown role ids with ROLE_NOT_FOUND', () => {
    let caught: unknown;
    try {
      assertRoleSelectionIsValid({ requestedIds: ['r-gone'], knownRoles: ROLES, actorRoles: ACTOR_SUPER });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).code).toBe('ROLE_NOT_FOUND');
    expect((caught as ApiError).getStatus()).toBe(400);
  });

  it('rejects a privileged role granted by a non-super-admin with ROLE_NOT_ASSIGNABLE', () => {
    let caught: unknown;
    try {
      assertRoleSelectionIsValid({
        requestedIds: ['r-super'],
        knownRoles: ROLES,
        actorRoles: ACTOR_SALES,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).code).toBe('ROLE_NOT_ASSIGNABLE');
    expect((caught as ApiError).getStatus()).toBe(403);
  });
});

describe('last effective super administrator', () => {
  it('blocks removing the role from the only active super admin', () => {
    expect(
      wouldRemoveLastSuperAdmin({
        targetCurrentlySuperAdmin: true,
        nextSelectionIncludesSuperAdmin: false,
        otherActiveSuperAdmins: 0,
      }),
    ).toBe(true);
    expect(() =>
      assertLastSuperAdminRule({
        targetCurrentlySuperAdmin: true,
        nextSelectionIncludesSuperAdmin: false,
        otherActiveSuperAdmins: 0,
      }),
    ).toThrow(ApiError);
  });

  it('allows the change when another active super admin exists', () => {
    expect(
      wouldRemoveLastSuperAdmin({
        targetCurrentlySuperAdmin: true,
        nextSelectionIncludesSuperAdmin: false,
        otherActiveSuperAdmins: 1,
      }),
    ).toBe(false);
  });

  it('allows keeping the role and ignores non-super-admin targets', () => {
    expect(
      wouldRemoveLastSuperAdmin({
        targetCurrentlySuperAdmin: true,
        nextSelectionIncludesSuperAdmin: true,
        otherActiveSuperAdmins: 0,
      }),
    ).toBe(false);
    expect(
      wouldRemoveLastSuperAdmin({
        targetCurrentlySuperAdmin: false,
        nextSelectionIncludesSuperAdmin: false,
        otherActiveSuperAdmins: 0,
      }),
    ).toBe(false);
  });
});

describe('roleCodeSignature', () => {
  it('is order independent so re-ordering is not reported as a change', () => {
    expect(roleCodeSignature(['viewer', 'sales'])).toBe(roleCodeSignature(['sales', 'viewer']));
    expect(roleCodeSignature(['sales'])).not.toBe(roleCodeSignature(['sales', 'viewer']));
  });
});
