import type { AdminUserSummary, AssignableRoleSummary } from '@b2b/contracts';

// Pure form logic for the unified create/edit dialog (docs/17 §4.3).
// Validation returns i18n message keys so the component never hardcodes copy and
// business branching never depends on a translated string.

export interface UserFormValues {
  username: string;
  displayName: string;
  roleIds: string[];
}

export type UserFormMode = 'create' | 'edit';

export interface UserFormErrors {
  username?: string;
  displayName?: string;
  roleIds?: string;
}

export const EMPTY_USER_FORM: UserFormValues = { username: '', displayName: '', roleIds: [] };

export const USERNAME_PATTERN = /^[a-z0-9._-]+$/;

export function validateUserForm(values: UserFormValues, mode: UserFormMode): UserFormErrors {
  const errors: UserFormErrors = {};

  if (mode === 'create') {
    const username = values.username.trim();
    if (username.length < 3 || username.length > 80 || !USERNAME_PATTERN.test(username)) {
      errors.username = 'users.errors.username';
    }
  }

  const displayName = values.displayName.trim();
  if (displayName.length === 0) {
    errors.displayName = 'users.errors.displayNameRequired';
  } else if (displayName.length > 120) {
    errors.displayName = 'users.errors.displayNameTooLong';
  }

  if (values.roleIds.length === 0) {
    errors.roleIds = 'users.errors.rolesRequired';
  }

  return errors;
}

export function hasErrors(errors: UserFormErrors): boolean {
  return Object.keys(errors).length > 0;
}

/** Seeds the edit form from the list row so the dialog opens instantly. */
export function toUserFormValues(user: AdminUserSummary | null): UserFormValues {
  if (!user) return { ...EMPTY_USER_FORM, roleIds: [] };
  return {
    username: user.username,
    displayName: user.displayName,
    roleIds: user.roles.map((role) => role.id),
  };
}

export function isFormDirty(current: UserFormValues, initial: UserFormValues): boolean {
  const sameRoles =
    current.roleIds.length === initial.roleIds.length &&
    [...current.roleIds].sort().join(',') === [...initial.roleIds].sort().join(',');
  return (
    current.username.trim() !== initial.username.trim() ||
    current.displayName.trim() !== initial.displayName.trim() ||
    !sameRoles
  );
}

/** i18n key for a role's display name; the code is the stable fallback. */
export function roleLabelKey(role: { code: string; nameKey?: string | null }): string {
  return role.nameKey && role.nameKey.length > 0 ? role.nameKey : `roles.${role.code}`;
}

export interface RoleNameSource {
  code: string;
  nameKey?: string | null;
  /** Administrator-maintained names per locale; empty for seeded roles. */
  names?: Record<string, string> | null;
}

/**
 * Resolves the name shown to the signed-in administrator (docs/18 §2.4, §7).
 *
 * Order: administrator-maintained name for the active locale, then the seeded
 * i18n dictionary, then the English name, then the stable role code. A raw
 * `role.sales` key is never shown, and the code - not a translated label - is
 * what any business logic branches on.
 */
export function roleDisplayName(
  role: RoleNameSource,
  locale: string,
  translate: (key: string) => string,
): string {
  const names = role.names ?? {};
  const localized = names[locale];
  if (localized && localized.length > 0) return localized;

  const key = roleLabelKey(role);
  const translated = translate(key);
  if (translated !== key) return translated;

  const english = names['en-US'];
  if (english && english.length > 0) return english;
  return role.code;
}

/**
 * Options for the role multi-select.
 *
 * A role the actor may not grant stays visible but disabled with a reason, so an
 * existing assignment is never silently dropped from the form (docs/17 §3.3).
 */
export function toRoleOptions(
  roles: AssignableRoleSummary[],
  translate: (key: string) => string,
  labels: { systemSuffix: string; notAssignable: string },
  locale: string,
): { value: string; label: string; hint: string; disabled: boolean; disabledReason: string | null }[] {
  return roles.map((role) => ({
    value: role.id,
    label: roleDisplayName(role, locale, translate),
    hint: role.isSystem ? `${role.code} · ${labels.systemSuffix}` : role.code,
    disabled: !role.assignable,
    disabledReason: role.assignable ? null : labels.notAssignable,
  }));
}

/**
 * Maps an API field error payload onto form fields. The server returns
 * `details` keyed by field name (for example `{ username: 'validation.conflict' }`).
 */
export function mapFieldErrors(details: Record<string, unknown> | undefined): UserFormErrors {
  if (!details) return {};
  const errors: UserFormErrors = {};
  if (typeof details.username === 'string') errors.username = 'users.errors.usernameTaken';
  if (typeof details.displayName === 'string') errors.displayName = 'users.errors.displayNameRequired';
  if (typeof details.roleIds === 'string') errors.roleIds = 'users.errors.rolesRequired';
  return errors;
}
