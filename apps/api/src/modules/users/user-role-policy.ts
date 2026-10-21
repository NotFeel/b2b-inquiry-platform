import { ERROR_CODES, SYSTEM_ROLE_SUPER_ADMIN } from '@b2b/contracts';
import type { AssignableRoleSummary } from '@b2b/contracts';
import { ApiError } from '../../common/errors/api-error';

// Pure policy for user role assignment (docs/17 §6.2, §7).
//
// Kept free of Prisma so the rules can be unit tested directly; the service
// supplies the database facts (existing roles, current assignments, counts) and
// runs these checks inside the write transaction.

export interface RoleRef {
  id: string;
  code: string;
}

/** Roles that only a super administrator may grant or revoke. */
export function isPrivilegedRole(code: string): boolean {
  return code === SYSTEM_ROLE_SUPER_ADMIN;
}

export function canActorAssignRole(roleCode: string, actorRoles: string[]): boolean {
  if (isPrivilegedRole(roleCode)) return actorRoles.includes(SYSTEM_ROLE_SUPER_ADMIN);
  return true;
}

/**
 * Builds the assignable-role options for the user form.
 *
 * Every role is returned with an `assignable` flag rather than being filtered
 * out, so a role the actor may not change but the target already holds stays
 * visible and clearly marked (docs/17 §3.3).
 */
export function buildAssignableRoleOptions(
  roles: {
    id: string;
    code: string;
    nameKey: string;
    description: string | null;
    isSystem: boolean;
    translations?: { locale: string; name: string }[];
  }[],
  actorRoles: string[],
): AssignableRoleSummary[] {
  return roles.map((role) => ({
    id: role.id,
    code: role.code,
    nameKey: role.nameKey,
    // Administrator-maintained names win over the seeded i18n key; the client
    // resolves `names[locale]` first and falls back to `nameKey` (docs/18 §2.4).
    names: Object.fromEntries((role.translations ?? []).map((item) => [item.locale, item.name])),
    description: role.description,
    isSystem: role.isSystem,
    assignable: canActorAssignRole(role.code, actorRoles),
  }));
}

export function dedupeIds(ids: string[]): string[] {
  return Array.from(new Set(ids));
}

export function findMissingRoleIds(requestedIds: string[], knownRoles: RoleRef[]): string[] {
  const known = new Set(knownRoles.map((role) => role.id));
  return dedupeIds(requestedIds).filter((id) => !known.has(id));
}

export function findUnassignableRoleCodes(requestedIds: string[], roles: RoleRef[], actorRoles: string[]): string[] {
  const byId = new Map(roles.map((role) => [role.id, role.code]));
  return dedupeIds(requestedIds)
    .map((id) => byId.get(id))
    .filter((code): code is string => typeof code === 'string')
    .filter((code) => !canActorAssignRole(code, actorRoles));
}

/** Throws the stable business error for a role selection (docs/17 §6.3). */
export function assertRoleSelectionIsValid(params: {
  requestedIds: string[];
  knownRoles: RoleRef[];
  actorRoles: string[];
}): RoleRef[] {
  const unique = dedupeIds(params.requestedIds);
  if (unique.length === 0) {
    throw ApiError.validation('At least one role must be assigned.', { roleIds: 'validation.required' });
  }

  const missing = findMissingRoleIds(unique, params.knownRoles);
  if (missing.length > 0) {
    throw new ApiError(
      ERROR_CODES.roleNotFound,
      'One or more selected roles no longer exist. Reload the role list and try again.',
      { status: 400, details: { roleIds: missing.join(',') } },
    );
  }

  const unassignable = findUnassignableRoleCodes(unique, params.knownRoles, params.actorRoles);
  if (unassignable.length > 0) {
    throw new ApiError(
      ERROR_CODES.roleNotAssignable,
      'You are not allowed to grant one of the selected roles.',
      { status: 403, details: { codes: unassignable.join(',') } },
    );
  }

  const byId = new Map(params.knownRoles.map((role) => [role.id, role]));
  return unique.map((id) => byId.get(id)).filter((role): role is RoleRef => role !== undefined);
}

/**
 * The "last effective super administrator" rule.
 *
 * An effective super administrator is an ACTIVE account holding the
 * super_admin role. Removing the role (or disabling the account) is refused when
 * no other active super administrator would remain (docs/17 §6.2).
 */
export function wouldRemoveLastSuperAdmin(params: {
  targetCurrentlySuperAdmin: boolean;
  nextSelectionIncludesSuperAdmin: boolean;
  otherActiveSuperAdmins: number;
}): boolean {
  if (!params.targetCurrentlySuperAdmin) return false;
  if (params.nextSelectionIncludesSuperAdmin) return false;
  return params.otherActiveSuperAdmins === 0;
}

export function assertLastSuperAdminRule(params: {
  targetCurrentlySuperAdmin: boolean;
  nextSelectionIncludesSuperAdmin: boolean;
  otherActiveSuperAdmins: number;
}): void {
  if (wouldRemoveLastSuperAdmin(params)) {
    throw new ApiError(
      ERROR_CODES.lastSuperAdminProtected,
      'The last active super administrator cannot be demoted, disabled or deleted.',
      { status: 409 },
    );
  }
}

/** Comparable role-code signature used for change detection and audit snapshots. */
export function roleCodeSignature(codes: string[]): string {
  return [...codes].sort().join(',');
}
