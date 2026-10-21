import { ERROR_CODES, SYSTEM_ROLE_SUPER_ADMIN } from '@b2b/contracts';
import { ApiError } from '../../common/errors/api-error';

// Pure authorization policy for role & permission management (docs/18 §5).
//
// Kept free of Prisma so every rule can be unit tested directly; the service
// supplies the database facts (existing role, known permission codes, actor
// scope, user counts) and runs these checks inside the write transaction.

export interface RoleRef {
  id: string;
  code: string;
  isSystem: boolean;
}

/** What the acting administrator is allowed to hand out. */
export interface ActorScope {
  /** Holding the super administrator role bypasses the "own permissions" clamp. */
  isSuperAdmin: boolean;
  /** Permission codes the actor currently holds. */
  permissions: ReadonlySet<string>;
}

/** Stable, duplicate-free ordering used for comparisons, storage and audit snapshots. */
export function canonicalPermissionCodes(codes: string[]): string[] {
  return Array.from(new Set(codes)).sort();
}

export function permissionSignature(codes: string[]): string {
  return canonicalPermissionCodes(codes).join(',');
}

export interface PermissionDiff {
  added: string[];
  removed: string[];
  before: string[];
  after: string[];
}

export function diffPermissionSets(before: string[], after: string[]): PermissionDiff {
  const canonicalBefore = canonicalPermissionCodes(before);
  const canonicalAfter = canonicalPermissionCodes(after);
  const beforeSet = new Set(canonicalBefore);
  const afterSet = new Set(canonicalAfter);
  return {
    before: canonicalBefore,
    after: canonicalAfter,
    added: canonicalAfter.filter((code) => !beforeSet.has(code)),
    removed: canonicalBefore.filter((code) => !afterSet.has(code)),
  };
}

/**
 * System roles are read-only: their basic information and permission set cannot
 * be changed and they cannot be deleted, not even by a super administrator
 * (docs/18 §2.2, §5.4).
 */
export function assertRoleIsWritable(role: RoleRef): void {
  if (role.isSystem || role.code === SYSTEM_ROLE_SUPER_ADMIN) {
    throw new ApiError(
      ERROR_CODES.roleSystemProtected,
      'System roles are protected and cannot be modified or deleted.',
      { status: 409, details: { code: role.code } },
    );
  }
}

/**
 * A role can only be deleted when it is a custom role that no account holds.
 * The count is re-read inside the transaction, never taken from the client
 * (docs/18 §5.3).
 */
export function assertRoleIsDeletable(role: RoleRef, userCount: number): void {
  assertRoleIsWritable(role);
  if (userCount > 0) {
    throw new ApiError(
      ERROR_CODES.roleInUse,
      'This role is still assigned to users and cannot be deleted.',
      { status: 409, details: { code: role.code, userCount } },
    );
  }
}

export function findUnknownPermissionCodes(requested: string[], known: Iterable<string>): string[] {
  const knownSet = new Set(known);
  return canonicalPermissionCodes(requested).filter((code) => !knownSet.has(code));
}

/**
 * Codes an actor without the super administrator role may not hand out.
 *
 * Only *newly granted* codes are clamped: re-saving a role that already holds a
 * permission the actor lacks must stay possible, otherwise an administrator
 * could not maintain a role they can see but not fully hold (docs/18 §4.3.5).
 */
export function findForbiddenGrants(params: {
  requested: string[];
  current: string[];
  actor: ActorScope;
}): string[] {
  if (params.actor.isSuperAdmin) return [];
  const current = new Set(canonicalPermissionCodes(params.current));
  return canonicalPermissionCodes(params.requested).filter(
    (code) => !current.has(code) && !params.actor.permissions.has(code),
  );
}

/**
 * Validates a submitted permission set and returns the canonical list to store.
 *
 * Rejects unknown codes outright instead of silently dropping them, so a stale
 * client can never save a partial set without noticing (docs/18 §4.3.4).
 */
export function assertPermissionSelectionIsValid(params: {
  requested: string[];
  known: Iterable<string>;
  current: string[];
  actor: ActorScope;
}): string[] {
  const unknown = findUnknownPermissionCodes(params.requested, params.known);
  if (unknown.length > 0) {
    throw new ApiError(
      ERROR_CODES.permissionCodeInvalid,
      'One or more permission codes no longer exist.',
      { status: 400, details: { codes: unknown.join(',') } },
    );
  }

  const forbidden = findForbiddenGrants({
    requested: params.requested,
    current: params.current,
    actor: params.actor,
  });
  if (forbidden.length > 0) {
    throw new ApiError(
      ERROR_CODES.permissionAssignmentForbidden,
      'The current account cannot grant permissions it does not hold.',
      { status: 403, details: { codes: forbidden.join(',') } },
    );
  }

  return canonicalPermissionCodes(params.requested);
}

/**
 * Optimistic concurrency guard. A mismatch means another administrator saved
 * the role after this editor was opened (docs/18 §4.4). Omitting the timestamp
 * keeps the request valid for clients that do not track it.
 */
export function assertExpectedUpdatedAt(expected: string | undefined, actual: Date): void {
  if (!expected) return;
  const expectedTime = Date.parse(expected);
  if (Number.isNaN(expectedTime)) {
    throw ApiError.validation('The concurrency token is not a valid timestamp.');
  }
  if (expectedTime !== actual.getTime()) {
    throw new ApiError(
      ERROR_CODES.concurrentRoleUpdate,
      'The role was changed by another administrator. Reload it and try again.',
      { status: 409, details: { updatedAt: actual.toISOString() } },
    );
  }
}

export interface RoleTranslationInput {
  'zh-CN'?: string;
  'en-US'?: string;
}

/** Normalizes submitted display names into `locale -> name` rows. */
export function toTranslationRows(
  names: RoleTranslationInput,
): { locale: string; name: string }[] {
  return Object.entries(names)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length > 0)
    .map(([locale, name]) => ({ locale, name: name.trim() }));
}

/** All locales a role needs before it can be created from the back office. */
export function missingRoleNameLocales(names: RoleTranslationInput): string[] {
  return ['zh-CN', 'en-US'].filter((locale) => {
    const value = names[locale as keyof RoleTranslationInput];
    return typeof value !== 'string' || value.trim().length === 0;
  });
}
