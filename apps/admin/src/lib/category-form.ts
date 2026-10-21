import type { CategoryDetail, CategoryNode } from '@b2b/contracts';
import { localizedName } from './category-tree-state';

// Pure form logic for the shared category create/edit drawer (docs/22 §3).
//
// Validation returns i18n message keys so the component never hardcodes copy,
// and `code`/`slug` stay machine strings - no translated label is parsed to make
// a decision.

export type CategoryFormMode = 'createRoot' | 'createChild' | 'edit';

export interface CategoryFormValues {
  code: string;
  slug: string;
  /** Empty string means "top level category". */
  parentId: string;
  sortOrder: string;
  enabled: boolean;
  visible: boolean;
  /** locale -> name. */
  names: Record<string, string>;
  /** locale -> description. */
  descriptions: Record<string, string>;
}

export interface CategoryFormErrors {
  code?: string;
  slug?: string;
  parentId?: string;
  sortOrder?: string;
  /** locale -> message key, rendered under the matching translation input. */
  names?: Record<string, string>;
}

/**
 * Machine code: lowercase letters, digits, dash or underscore (docs/22 §3.2).
 *
 * The API holds the authority through the `category.code` unique index; this
 * only stops an obviously invalid value before a round trip.
 */
export const CATEGORY_CODE_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;
export const CATEGORY_CODE_MIN = 2;
export const CATEGORY_CODE_MAX = 100;
export const CATEGORY_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const CATEGORY_SLUG_MAX = 180;
export const CATEGORY_NAME_MAX = 240;
export const CATEGORY_DESCRIPTION_MAX = 2000;
export const CATEGORY_SORT_MIN = 0;
export const CATEGORY_SORT_MAX = 10_000;

export function emptyCategoryForm(defaultSortOrder = 10): CategoryFormValues {
  return {
    code: '',
    slug: '',
    parentId: '',
    sortOrder: String(defaultSortOrder),
    enabled: true,
    visible: true,
    names: {},
    descriptions: {},
  };
}

/**
 * Seed the form from an API detail (docs/22 §3.2).
 *
 * Every stored value is echoed back - including a category whose status is
 * disabled or hidden - so saving can never silently reactivate or unhide a node
 * the administrator did not touch.
 */
export function toCategoryFormValues(
  detail: CategoryDetail,
  locales: readonly string[],
): CategoryFormValues {
  return {
    code: detail.code,
    slug: detail.slug,
    parentId: detail.parentId ?? '',
    sortOrder: String(detail.sortOrder),
    enabled: detail.enabled,
    visible: detail.visible,
    names: Object.fromEntries(locales.map((locale) => [locale, detail.names[locale] ?? ''])),
    descriptions: Object.fromEntries(
      locales.map((locale) => [locale, detail.descriptions[locale] ?? '']),
    ),
  };
}

/**
 * Seed for "add child" straight from the tree node the user clicked.
 *
 * Neither the code nor the slug is guessed from the parent name: inventing an
 * identifier or a public URL nobody chose is worse than one extra keystroke.
 */
export function seedFromParent(
  parent: CategoryNode | null,
  options: { locales: readonly string[]; sortOrder: number },
): CategoryFormValues {
  const base = emptyCategoryForm(options.sortOrder);
  const names = Object.fromEntries(options.locales.map((locale) => [locale, '']));
  return {
    ...base,
    parentId: parent?.id ?? '',
    names,
    descriptions: { ...names },
  };
}

export function validateCategoryForm(
  values: CategoryFormValues,
  mode: CategoryFormMode,
  locales: readonly string[],
): CategoryFormErrors {
  const errors: CategoryFormErrors = {};

  if (mode !== 'edit') {
    const code = values.code.trim();
    if (code.length === 0) {
      errors.code = 'categories.errors.codeRequired';
    } else if (
      code.length < CATEGORY_CODE_MIN ||
      code.length > CATEGORY_CODE_MAX ||
      !CATEGORY_CODE_PATTERN.test(code)
    ) {
      errors.code = 'categories.errors.codeInvalid';
    }
  }

  const slug = values.slug.trim();
  if (slug.length === 0) {
    errors.slug = 'categories.errors.slugRequired';
  } else if (slug.length > CATEGORY_SLUG_MAX || !CATEGORY_SLUG_PATTERN.test(slug)) {
    errors.slug = 'categories.errors.slugInvalid';
  }

  const sortOrder = Number(values.sortOrder);
  if (
    values.sortOrder.trim().length === 0 ||
    !Number.isInteger(sortOrder) ||
    sortOrder < CATEGORY_SORT_MIN ||
    sortOrder > CATEGORY_SORT_MAX
  ) {
    errors.sortOrder = 'categories.errors.sortOrder';
  }

  const nameErrors: Record<string, string> = {};
  for (const locale of locales) {
    const name = (values.names[locale] ?? '').trim();
    if (name.length === 0) {
      nameErrors[locale] = 'categories.errors.nameRequired';
    } else if (name.length > CATEGORY_NAME_MAX) {
      nameErrors[locale] = 'categories.errors.nameTooLong';
    } else if ((values.descriptions[locale] ?? '').length > CATEGORY_DESCRIPTION_MAX) {
      nameErrors[locale] = 'categories.errors.descriptionTooLong';
    }
  }
  if (Object.keys(nameErrors).length > 0) errors.names = nameErrors;

  return errors;
}

export function hasCategoryFormErrors(errors: CategoryFormErrors): boolean {
  return (
    Object.keys(errors).some((key) => key !== 'names') || Object.keys(errors.names ?? {}).length > 0
  );
}

export function isCategoryFormDirty(
  current: CategoryFormValues,
  initial: CategoryFormValues,
): boolean {
  const keys = Object.keys(initial) as (keyof CategoryFormValues)[];
  return keys.some((key) => {
    if (key === 'names' || key === 'descriptions') {
      const locales = new Set([...Object.keys(current[key]), ...Object.keys(initial[key])]);
      for (const locale of locales) {
        if ((current[key][locale] ?? '').trim() !== (initial[key][locale] ?? '').trim())
          return true;
      }
      return false;
    }
    return current[key] !== initial[key];
  });
}

export interface CategoryPayload {
  code?: string;
  slug: string;
  parentId: string | null;
  sortOrder: number;
  enabled: boolean;
  visible: boolean;
  translations: { locale: string; name: string; description: string | null }[];
}

export function toCategoryPayload(
  values: CategoryFormValues,
  mode: CategoryFormMode,
): CategoryPayload {
  const translations = Object.entries(values.names)
    .map(([locale, name]) => ({
      locale,
      name: name.trim(),
      description: (values.descriptions[locale] ?? '').trim() || null,
    }))
    .filter((translation) => translation.name.length > 0);

  return {
    ...(mode === 'edit' ? {} : { code: values.code.trim() }),
    slug: values.slug.trim(),
    parentId: values.parentId.length > 0 ? values.parentId : null,
    sortOrder: Number(values.sortOrder),
    enabled: values.enabled,
    visible: values.visible,
    translations,
  };
}

/**
 * Maps API `details` onto form fields.
 *
 * The API reports a taken code as `{ code: ... }`, a taken slug as
 * `{ slug: ... }` and an unusable parent as `{ parentId: ... }`, so each message
 * lands on the input the administrator has to change.
 */
export function mapCategoryFieldErrors(
  details: Record<string, unknown> | undefined,
): CategoryFormErrors {
  if (!details) return {};
  const errors: CategoryFormErrors = {};
  if (typeof details.code === 'string') errors.code = 'categories.errors.codeTaken';
  if (typeof details.slug === 'string') errors.slug = 'categories.errors.slugTaken';
  if (typeof details.parentId === 'string') errors.parentId = 'categories.errors.parentInvalid';
  return errors;
}

/** Human-readable parent label for the form summary; never a bare UUID. */
export function parentLabel(
  nodes: CategoryNode[],
  parentId: string | null,
  locale: string,
): string | null {
  if (!parentId) return null;
  const find = (list: CategoryNode[]): CategoryNode | null => {
    for (const node of list) {
      if (node.id === parentId) return node;
      const found = find(node.children);
      if (found) return found;
    }
    return null;
  };
  const parent = find(nodes);
  return parent ? localizedName(parent, locale) : null;
}
