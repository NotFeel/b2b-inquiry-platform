import { TAG_COLOR_TOKENS } from '@b2b/contracts';
import type { TagSummary } from '@b2b/contracts';

// Pure form logic for the shared tag create/edit drawer (docs/23 §4.3, §11).
//
// Validation returns i18n message keys so the component never hardcodes copy,
// and the code/token values stay machine strings - no translated label is ever
// parsed to make a decision.

export type TagFormMode = 'create' | 'edit';

export interface TagFormValues {
  code: string;
  /** Empty string means "no token", rendered as the neutral badge. */
  colorToken: string;
  enabled: boolean;
  /** locale -> label, seeded from the API translations. */
  labels: Record<string, string>;
}

export interface TagFormErrors {
  code?: string;
  /** locale -> message key, rendered under the matching label input. */
  labels?: Record<string, string>;
}

/**
 * Stable machine key: lowercase letters, digits, dash or underscore, matching
 * the shared `codeSchema` used by the API.
 */
export const TAG_CODE_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
export const TAG_CODE_MIN = 2;
export const TAG_CODE_MAX = 80;
export const TAG_LABEL_MAX = 100;

export function emptyTagForm(): TagFormValues {
  return { code: '', colorToken: '', enabled: true, labels: {} };
}

export function toTagFormValues(tag: TagSummary, locales: readonly string[]): TagFormValues {
  return {
    code: tag.code,
    colorToken: tag.colorToken ?? '',
    enabled: tag.enabled,
    labels: Object.fromEntries(locales.map((locale) => [locale, tag.labels[locale] ?? ''])),
  };
}

/**
 * Form validation mirroring the server rules.
 *
 * The English label is required because the storefront is English by default
 * (docs/23 §5); the API enforces the same rule on the merged translation set.
 */
export function validateTagForm(
  values: TagFormValues,
  mode: TagFormMode,
  locales: readonly string[],
  englishLocale: string,
): TagFormErrors {
  const errors: TagFormErrors = {};

  if (mode === 'create') {
    const code = values.code.trim();
    if (code.length === 0) {
      errors.code = 'tags.errors.codeRequired';
    } else if (
      code.length < TAG_CODE_MIN ||
      code.length > TAG_CODE_MAX ||
      !TAG_CODE_PATTERN.test(code)
    ) {
      errors.code = 'tags.errors.codeInvalid';
    }
  }

  const labelErrors: Record<string, string> = {};
  for (const locale of locales) {
    const label = (values.labels[locale] ?? '').trim();
    const required = locale === englishLocale;
    if (label.length === 0 && required) {
      labelErrors[locale] = 'tags.errors.labelRequired';
    } else if (label.length > TAG_LABEL_MAX) {
      labelErrors[locale] = 'tags.errors.labelTooLong';
    }
  }
  if (Object.keys(labelErrors).length > 0) errors.labels = labelErrors;

  return errors;
}

export function hasTagFormErrors(errors: TagFormErrors): boolean {
  return Boolean(errors.code) || Object.keys(errors.labels ?? {}).length > 0;
}

export function isTagFormDirty(current: TagFormValues, initial: TagFormValues): boolean {
  if (current.code !== initial.code) return true;
  if (current.colorToken !== initial.colorToken) return true;
  if (current.enabled !== initial.enabled) return true;
  const locales = new Set([...Object.keys(current.labels), ...Object.keys(initial.labels)]);
  for (const locale of locales) {
    if ((current.labels[locale] ?? '').trim() !== (initial.labels[locale] ?? '').trim())
      return true;
  }
  return false;
}

export interface TagPayload {
  code?: string;
  colorToken: string | null;
  enabled: boolean;
  translations: { locale: string; label: string }[];
}

export function toTagPayload(values: TagFormValues, mode: TagFormMode): TagPayload {
  const translations = Object.entries(values.labels)
    .map(([locale, label]) => ({ locale, label: label.trim() }))
    .filter((translation) => translation.label.length > 0);

  return {
    ...(mode === 'edit' ? {} : { code: values.code.trim() }),
    colorToken: values.colorToken.length > 0 ? values.colorToken : null,
    enabled: values.enabled,
    translations,
  };
}

/**
 * Maps API `details` onto form fields.
 *
 * The API reports a taken code as `{ code: 'tag.code.taken' }` and a missing
 * English label under `translations.en-US`, so each message lands on the input
 * the administrator has to change.
 */
export function mapTagFieldErrors(
  details: Record<string, unknown> | undefined,
  englishLocale: string,
): TagFormErrors {
  if (!details) return {};
  const errors: TagFormErrors = {};
  if (typeof details.code === 'string') errors.code = 'tags.errors.codeTaken';
  if (
    typeof details['translations.en-US'] === 'string' ||
    typeof details.translations === 'string'
  ) {
    errors.labels = { [englishLocale]: 'tags.errors.labelRequired' };
  }
  return errors;
}

/** Select options for the style token picker; labels come from i18n. */
export function tagColorOptions(
  translate: (key: string) => string,
): { value: string; label: string }[] {
  return [
    { value: '', label: translate('tags.colorOptions.none') },
    ...TAG_COLOR_TOKENS.map((token) => ({
      value: token,
      label: `${translate(`tags.colorOptions.${token.replace('tag.', '')}`)} (${token})`,
    })),
  ];
}

/** Secondary label for the list: the other admin language, when present. */
export function secondaryLabel(
  tag: TagSummary,
  locale: string,
  englishLocale: string,
): string | null {
  const other = locale === englishLocale ? 'zh-CN' : englishLocale;
  const label = tag.labels[other];
  return label && label.length > 0 ? label : null;
}
