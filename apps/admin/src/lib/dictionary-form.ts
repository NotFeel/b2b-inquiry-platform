import type { DictionaryItemSummary, DictionaryTypeSummary } from '@b2b/contracts';

// Pure form logic for dictionary types and items (docs/20 §5.4, §5.5).
//
// Validation returns i18n message keys, never copy, and the machine keys
// (`typeCode`, item `code`) are never derived from a translated label.

export type FormMode = 'create' | 'edit';

// --------------------------------------------------------------- type form

export interface DictionaryTypeFormValues {
  code: string;
  nameKey: string;
  description: string;
  enabled: boolean;
}

export interface DictionaryTypeFormErrors {
  code?: string;
  nameKey?: string;
}

/** Same shape as other admin codes: lowercase, digits, dot, dash, underscore. */
export const DICTIONARY_CODE_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
/** i18n keys are dotted lowercase paths such as `dictionary.payment_terms`. */
export const DICTIONARY_NAME_KEY_PATTERN = /^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)*$/;
export const DICTIONARY_CODE_MAX = 100;
export const DICTIONARY_NAME_KEY_MAX = 180;
export const DICTIONARY_LABEL_MAX = 160;
export const DICTIONARY_VALUE_MAX = 240;
export const DICTIONARY_SORT_MAX = 10_000;

export const EMPTY_TYPE_FORM: DictionaryTypeFormValues = {
  code: '',
  nameKey: '',
  description: '',
  enabled: true,
};

export function toTypeFormValues(type: DictionaryTypeSummary | null): DictionaryTypeFormValues {
  if (!type) return { ...EMPTY_TYPE_FORM };
  return {
    code: type.code,
    nameKey: type.nameKey,
    description: type.description ?? '',
    enabled: type.enabled,
  };
}

export function validateTypeForm(
  values: DictionaryTypeFormValues,
  mode: FormMode,
): DictionaryTypeFormErrors {
  const errors: DictionaryTypeFormErrors = {};
  if (mode === 'create') {
    const code = values.code.trim();
    if (code.length === 0) errors.code = 'dictionary.errors.codeRequired';
    else if (code.length > DICTIONARY_CODE_MAX || !DICTIONARY_CODE_PATTERN.test(code)) {
      errors.code = 'dictionary.errors.codeInvalid';
    }
  }
  const nameKey = values.nameKey.trim();
  if (nameKey.length === 0) errors.nameKey = 'dictionary.errors.nameKeyRequired';
  else if (nameKey.length > DICTIONARY_NAME_KEY_MAX || !DICTIONARY_NAME_KEY_PATTERN.test(nameKey)) {
    errors.nameKey = 'dictionary.errors.nameKeyInvalid';
  }
  return errors;
}

export function hasTypeFormErrors(errors: DictionaryTypeFormErrors): boolean {
  return Object.keys(errors).length > 0;
}

export function isTypeFormDirty(
  current: DictionaryTypeFormValues,
  initial: DictionaryTypeFormValues,
): boolean {
  return (
    current.code.trim() !== initial.code.trim() ||
    current.nameKey.trim() !== initial.nameKey.trim() ||
    current.description.trim() !== initial.description.trim() ||
    current.enabled !== initial.enabled
  );
}

export function toTypePayload(
  values: DictionaryTypeFormValues,
  mode: FormMode,
): { code?: string; nameKey: string; description: string | null; enabled: boolean } {
  const description = values.description.trim();
  return {
    ...(mode === 'create' ? { code: values.code.trim() } : {}),
    nameKey: values.nameKey.trim(),
    description: description.length > 0 ? description : null,
    enabled: values.enabled,
  };
}

// --------------------------------------------------------------- item form

export interface DictionaryItemFormValues {
  code: string;
  value: string;
  sortOrder: string;
  enabled: boolean;
  labels: Record<string, string>;
}

export interface DictionaryItemFormErrors {
  code?: string;
  value?: string;
  sortOrder?: string;
  labels?: Record<string, string>;
}

export function emptyItemForm(sortOrder: number): DictionaryItemFormValues {
  return { code: '', value: '', sortOrder: String(sortOrder), enabled: true, labels: {} };
}

export function toItemFormValues(
  item: DictionaryItemSummary,
  locales: readonly string[],
): DictionaryItemFormValues {
  return {
    code: item.code,
    value: item.value ?? '',
    sortOrder: String(item.sortOrder),
    enabled: item.enabled,
    labels: Object.fromEntries(locales.map((locale) => [locale, item.labels[locale] ?? ''])),
  };
}

export function validateItemForm(
  values: DictionaryItemFormValues,
  mode: FormMode,
  locales: readonly string[],
): DictionaryItemFormErrors {
  const errors: DictionaryItemFormErrors = {};
  if (mode === 'create') {
    const code = values.code.trim();
    if (code.length === 0) errors.code = 'dictionary.errors.codeRequired';
    else if (code.length > DICTIONARY_CODE_MAX || !DICTIONARY_CODE_PATTERN.test(code)) {
      errors.code = 'dictionary.errors.codeInvalid';
    }
  }
  if (values.value.trim().length > DICTIONARY_VALUE_MAX) errors.value = 'dictionary.errors.valueTooLong';
  const sortOrder = Number(values.sortOrder);
  if (
    values.sortOrder.trim().length === 0 ||
    !Number.isInteger(sortOrder) ||
    sortOrder < 0 ||
    sortOrder > DICTIONARY_SORT_MAX
  ) {
    errors.sortOrder = 'dictionary.errors.sortOrder';
  }
  const labelErrors: Record<string, string> = {};
  for (const locale of locales) {
    const label = (values.labels[locale] ?? '').trim();
    if (label.length === 0) labelErrors[locale] = 'dictionary.errors.labelRequired';
    else if (label.length > DICTIONARY_LABEL_MAX) labelErrors[locale] = 'dictionary.errors.labelTooLong';
  }
  if (Object.keys(labelErrors).length > 0) errors.labels = labelErrors;
  return errors;
}

export function hasItemFormErrors(errors: DictionaryItemFormErrors): boolean {
  return Object.keys(errors).some((key) => key !== 'labels') || Object.keys(errors.labels ?? {}).length > 0;
}

export function isItemFormDirty(
  current: DictionaryItemFormValues,
  initial: DictionaryItemFormValues,
): boolean {
  if (
    current.code.trim() !== initial.code.trim() ||
    current.value.trim() !== initial.value.trim() ||
    current.sortOrder !== initial.sortOrder ||
    current.enabled !== initial.enabled
  ) {
    return true;
  }
  const locales = new Set([...Object.keys(current.labels), ...Object.keys(initial.labels)]);
  for (const locale of locales) {
    if ((current.labels[locale] ?? '').trim() !== (initial.labels[locale] ?? '').trim()) return true;
  }
  return false;
}

export function toItemPayload(
  values: DictionaryItemFormValues,
  mode: FormMode,
): {
  code?: string;
  value: string | null;
  sortOrder: number;
  enabled: boolean;
  labels: { 'zh-CN'?: string; 'en-US'?: string };
} {
  const labels: { 'zh-CN'?: string; 'en-US'?: string } = {};
  for (const locale of ['zh-CN', 'en-US'] as const) {
    const label = (values.labels[locale] ?? '').trim();
    if (label.length > 0) labels[locale] = label;
  }
  const value = values.value.trim();
  return {
    ...(mode === 'create' ? { code: values.code.trim() } : {}),
    value: value.length > 0 ? value : null,
    sortOrder: Number(values.sortOrder),
    enabled: values.enabled,
    labels,
  };
}

/** Next suggestion for a new item inside a type (steps of 10). */
export function nextItemSortOrder(items: DictionaryItemSummary[]): number {
  if (items.length === 0) return 10;
  return Math.max(...items.map((item) => item.sortOrder)) + 10;
}

// ------------------------------------------------------- protection reasons

export interface ProtectionFacts {
  systemLocked: boolean;
  usageCount?: number;
  itemCount?: number;
  behaviourLockedType?: boolean;
}

/**
 * Explains why a destructive action is unavailable, so the UI can disable the
 * button with a reason instead of failing after the click (docs/20 §5.6).
 * Returns `null` when the action is allowed.
 */
export function lockReason(
  facts: ProtectionFacts,
  action: 'delete-item' | 'delete-type' | 'disable-item' | 'add-item' | 'toggle-type',
  translate: (key: string) => string,
): string | null {
  if (facts.systemLocked) {
    return translate(action === 'delete-item' || action === 'delete-type' ? 'dictionary.locked.delete' : 'dictionary.locked.disable');
  }
  if (facts.behaviourLockedType && (action === 'add-item' || action === 'delete-item')) {
    return translate('dictionary.locked.behaviourType');
  }
  if (action === 'delete-type' && (facts.itemCount ?? 0) > 0) {
    return translate('dictionary.locked.hasItems');
  }
  if ((action === 'delete-item' || action === 'delete-type') && (facts.usageCount ?? 0) > 0) {
    return translate('dictionary.locked.inUse');
  }
  return null;
}

/** Sibling order move used by the up/down controls. */
export function moveWithinItems(
  items: DictionaryItemSummary[],
  id: string,
  direction: 'up' | 'down',
): string[] | null {
  const ordered = [...items].sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code));
  const index = ordered.findIndex((item) => item.id === id);
  if (index < 0) return null;
  const target = direction === 'up' ? index - 1 : index + 1;
  if (target < 0 || target >= ordered.length) return null;
  const ids = ordered.map((item) => item.id);
  const [moved] = ids.splice(index, 1);
  if (!moved) return null;
  ids.splice(target, 0, moved);
  return ids;
}
