import type { RoleSummary } from '@b2b/contracts';

// Pure form logic for the unified role create/edit dialog (docs/18 §2.3, §2.4).
//
// Validation returns i18n message keys so the component never hardcodes copy,
// and the role code stays a machine identifier: it is never trimmed of meaning
// or translated.

export interface RoleFormValues {
  code: string;
  nameZh: string;
  nameEn: string;
  description: string;
}

export type RoleFormMode = 'create' | 'edit';

export interface RoleFormErrors {
  code?: string;
  nameZh?: string;
  nameEn?: string;
}

export const EMPTY_ROLE_FORM: RoleFormValues = { code: '', nameZh: '', nameEn: '', description: '' };

/** Stable machine identifier: lowercase, starts with a letter (docs/18 §5.1). */
export const ROLE_CODE_PATTERN = /^[a-z][a-z0-9_]*$/;
export const ROLE_CODE_MIN = 2;
export const ROLE_CODE_MAX = 80;
export const ROLE_NAME_MAX = 160;
export const ROLE_DESCRIPTION_MAX = 500;

export function validateRoleForm(values: RoleFormValues, mode: RoleFormMode): RoleFormErrors {
  const errors: RoleFormErrors = {};

  if (mode === 'create') {
    const code = values.code.trim();
    if (code.length === 0) {
      errors.code = 'roles.errors.codeRequired';
    } else if (code.length < ROLE_CODE_MIN || code.length > ROLE_CODE_MAX || !ROLE_CODE_PATTERN.test(code)) {
      errors.code = 'roles.errors.codeInvalid';
    }
  }

  if (values.nameZh.trim().length === 0) errors.nameZh = 'roles.errors.nameZhRequired';
  if (values.nameEn.trim().length === 0) errors.nameEn = 'roles.errors.nameEnRequired';

  return errors;
}

export function hasRoleFormErrors(errors: RoleFormErrors): boolean {
  return Object.keys(errors).length > 0;
}

/** Seeds the edit dialog from the list row; a custom role's names come from the API. */
export function toRoleFormValues(role: RoleSummary | null): RoleFormValues {
  if (!role) return { ...EMPTY_ROLE_FORM };
  return {
    code: role.code,
    nameZh: role.names['zh-CN'] ?? '',
    nameEn: role.names['en-US'] ?? '',
    description: role.description ?? '',
  };
}

export function isRoleFormDirty(current: RoleFormValues, initial: RoleFormValues): boolean {
  return (
    current.code.trim() !== initial.code.trim() ||
    current.nameZh.trim() !== initial.nameZh.trim() ||
    current.nameEn.trim() !== initial.nameEn.trim() ||
    current.description.trim() !== initial.description.trim()
  );
}

export function toRolePayload(
  values: RoleFormValues,
  mode: RoleFormMode,
): {
  code?: string;
  names: { 'zh-CN': string; 'en-US': string };
  description: string | null;
} {
  const description = values.description.trim();
  return {
    ...(mode === 'create' ? { code: values.code.trim() } : {}),
    names: { 'zh-CN': values.nameZh.trim(), 'en-US': values.nameEn.trim() },
    description: description.length > 0 ? description : null,
  };
}

/**
 * Maps API `details` onto form fields. The server reports a duplicate code as
 * `{ code: 'validation.conflict' }`; anything else stays a top-level error.
 */
export function mapRoleFieldErrors(details: Record<string, unknown> | undefined): RoleFormErrors {
  if (!details) return {};
  const errors: RoleFormErrors = {};
  if (typeof details.code === 'string') errors.code = 'roles.errors.codeTaken';
  return errors;
}
