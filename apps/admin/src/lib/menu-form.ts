import type { MenuNode, PermissionSummary } from '@b2b/contracts';

// Pure form logic for the shared menu create/edit drawer (docs/19 §3, §4.2).
//
// Validation returns i18n message keys so the component never hardcodes copy, and
// the code/route/permission values stay machine strings - no translated label is
// ever parsed to make a decision.

export type MenuFormMode = 'create' | 'edit';

/**
 * Menu kind shown in the form.
 *
 * The database has no `menuType` column (docs/19 §5.2), so the kind is derived
 * from the existing fields - and back again: a group has no route, a page has an
 * internal route, an external link has an absolute https URL.
 */
export type MenuFormType = 'group' | 'page' | 'external';

export interface MenuFormValues {
  code: string;
  type: MenuFormType;
  /** Empty string means "root menu". */
  parentId: string;
  route: string;
  /** Empty string means "no icon". */
  icon: string;
  /** Empty string means "not bound". */
  permissionCode: string;
  sortOrder: string;
  enabled: boolean;
  visible: boolean;
  /** locale -> label, seeded from the API translations. */
  labels: Record<string, string>;
}

export interface MenuFormErrors {
  code?: string;
  parentId?: string;
  route?: string;
  sortOrder?: string;
  permissionCode?: string;
  /** locale -> message key, rendered under the matching translation input. */
  labels?: Record<string, string>;
}

/** Stable machine identifier: lowercase, digits, dot, dash or underscore. */
export const MENU_CODE_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
export const MENU_CODE_MIN = 2;
export const MENU_CODE_MAX = 100;
export const MENU_LABEL_MAX = 160;
export const MENU_SORT_MIN = 0;
export const MENU_SORT_MAX = 10_000;

export function emptyMenuForm(defaultSortOrder = 0): MenuFormValues {
  return {
    code: '',
    type: 'page',
    parentId: '',
    route: '',
    icon: '',
    permissionCode: '',
    sortOrder: String(defaultSortOrder),
    enabled: true,
    visible: true,
    labels: {},
  };
}

export function toMenuFormValues(node: MenuNode, locales: readonly string[]): MenuFormValues {
  return {
    code: node.code,
    type: node.external ? 'external' : node.route === null ? 'group' : 'page',
    parentId: node.parentId ?? '',
    route: node.route ?? '',
    icon: node.icon ?? '',
    permissionCode: node.permissionCode ?? '',
    sortOrder: String(node.sortOrder),
    enabled: node.enabled,
    visible: node.visible,
    labels: Object.fromEntries(locales.map((locale) => [locale, node.labels[locale] ?? ''])),
  };
}

/**
 * Form-level validation mirroring the server rules (docs/19 §5.3).
 *
 * The API re-checks everything: this only exists to fail fast in the UI.
 */
export function validateMenuForm(
  values: MenuFormValues,
  mode: MenuFormMode,
  locales: readonly string[],
): MenuFormErrors {
  const errors: MenuFormErrors = {};

  if (mode === 'create') {
    const code = values.code.trim();
    if (code.length === 0) {
      errors.code = 'menus.errors.codeRequired';
    } else if (code.length < MENU_CODE_MIN || code.length > MENU_CODE_MAX || !MENU_CODE_PATTERN.test(code)) {
      errors.code = 'menus.errors.codeInvalid';
    }
  }

  const route = values.route.trim();
  if (values.type === 'external') {
    if (!route.startsWith('https://')) errors.route = 'menus.errors.externalRoute';
  } else if (values.type === 'page') {
    if (route.length === 0) errors.route = 'menus.errors.pageRouteRequired';
    else if (!route.startsWith('/')) errors.route = 'menus.errors.internalRoute';
  } else if (route.length > 0) {
    errors.route = 'menus.errors.groupHasRoute';
  }

  const sortOrder = Number(values.sortOrder);
  if (
    values.sortOrder.trim().length === 0 ||
    !Number.isInteger(sortOrder) ||
    sortOrder < MENU_SORT_MIN ||
    sortOrder > MENU_SORT_MAX
  ) {
    errors.sortOrder = 'menus.errors.sortOrder';
  }

  const labelErrors: Record<string, string> = {};
  for (const locale of locales) {
    const label = (values.labels[locale] ?? '').trim();
    if (label.length === 0) labelErrors[locale] = 'menus.errors.labelRequired';
    else if (label.length > MENU_LABEL_MAX) labelErrors[locale] = 'menus.errors.labelTooLong';
  }
  if (Object.keys(labelErrors).length > 0) errors.labels = labelErrors;

  return errors;
}

export function hasMenuFormErrors(errors: MenuFormErrors): boolean {
  return Object.keys(errors).some((key) => key !== 'labels') || Object.keys(errors.labels ?? {}).length > 0;
}

export function isMenuFormDirty(current: MenuFormValues, initial: MenuFormValues): boolean {
  const keys = Object.keys(initial) as (keyof MenuFormValues)[];
  return keys.some((key) => {
    if (key === 'labels') {
      const locales = new Set([...Object.keys(current.labels), ...Object.keys(initial.labels)]);
      for (const locale of locales) {
        if ((current.labels[locale] ?? '').trim() !== (initial.labels[locale] ?? '').trim()) return true;
      }
      return false;
    }
    return current[key] !== initial[key];
  });
}

export interface MenuPayload {
  code?: string;
  parentId: string | null;
  route: string | null;
  icon: string | null;
  permissionCode: string | null;
  sortOrder: number;
  visible: boolean;
  enabled: boolean;
  external: boolean;
  labels: Record<string, string>;
}

export function toMenuPayload(values: MenuFormValues, mode: MenuFormMode): MenuPayload {
  const labels = Object.fromEntries(
    Object.entries(values.labels)
      .map(([locale, label]) => [locale, label.trim()] as const)
      .filter(([, label]) => label.length > 0),
  );
  return {
    ...(mode === 'create' ? { code: values.code.trim() } : {}),
    parentId: values.parentId.length > 0 ? values.parentId : null,
    // A grouping menu must not carry a route: the API rejects that combination.
    route: values.type === 'group' || values.route.trim().length === 0 ? null : values.route.trim(),
    icon: values.icon.length > 0 ? values.icon : null,
    permissionCode: values.permissionCode.length > 0 ? values.permissionCode : null,
    sortOrder: Number(values.sortOrder),
    visible: values.visible,
    enabled: values.enabled,
    external: values.type === 'external',
    labels,
  };
}

/**
 * Maps API `details` onto form fields.
 *
 * A duplicate code is reported as `{ code: 'validation.conflict' }`, a missing
 * parent as `{ parentId: ... }` and an unknown bound permission under
 * `permissionCode`, so each message lands on the field the administrator edits.
 */
export function mapMenuFieldErrors(details: Record<string, unknown> | undefined): MenuFormErrors {
  if (!details) return {};
  const errors: MenuFormErrors = {};
  if (typeof details.code === 'string') errors.code = 'menus.errors.codeTaken';
  if (typeof details.parentId === 'string') errors.parentId = 'menus.errors.parentInvalid';
  if (typeof details.permissionCode === 'string') {
    errors.permissionCode = 'menus.errors.permissionUnknown';
  }
  return errors;
}

/** Suggestion for the next sort order inside a parent (docs/19 §4.1). */
export function nextSortOrder(siblings: MenuNode[]): number {
  if (siblings.length === 0) return 10;
  return Math.max(...siblings.map((node) => node.sortOrder)) + 10;
}

export interface PermissionOption {
  value: string;
  label: string;
  hint: string;
}

/**
 * Options for the permission picker.
 *
 * Labels come from the i18n dictionary keyed by `nameKey`; a missing translation
 * falls back to the raw code, which is the stable identifier anyway.
 */
export function toPermissionOptions(
  permissions: PermissionSummary[],
  translate: (key: string) => string,
): PermissionOption[] {
  return permissions.map((permission) => {
    const translated = translate(permission.nameKey);
    return {
      value: permission.code,
      label: translated === permission.nameKey ? permission.code : translated,
      hint: `${permission.module} · ${permission.code}`,
    };
  });
}
