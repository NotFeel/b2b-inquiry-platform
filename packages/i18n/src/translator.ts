import type { SupportedLocale } from './locales';
import { PUBLIC_LOCALE } from './locales';

export type Messages = Record<string, unknown>;
export type MessagesByLocale = Partial<Record<SupportedLocale, Messages>>;
export type TranslateParams = Record<string, string | number>;

export interface Translator {
  locale: SupportedLocale;
  t: (key: string, params?: TranslateParams) => string;
  has: (key: string) => boolean;
}

function lookup(messages: Messages, key: string): string | undefined {
  const segments = key.split('.');
  let current: unknown = messages;
  for (const segment of segments) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return typeof current === 'string' ? current : undefined;
}

export function interpolate(template: string, params?: TranslateParams): string {
  if (!params) return template;
  return template.replace(/\{\{?\s*([A-Za-z0-9_.]+)\s*\}?\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

// Build a translator for one locale.
//
// Missing keys fall back to the default locale and finally to the key itself, so
// a missing translation is visible instead of rendering blank - and no code ever
// branches on a translated label (docs/06 §5).
export function createTranslator(
  messages: MessagesByLocale,
  locale: SupportedLocale,
  fallbackLocale: SupportedLocale = PUBLIC_LOCALE,
): Translator {
  const primary = messages[locale] ?? {};
  const fallback = messages[fallbackLocale] ?? {};
  const t = (key: string, params?: TranslateParams): string => {
    const template = lookup(primary, key) ?? lookup(fallback, key) ?? key;
    return interpolate(template, params);
  };
  return {
    locale,
    t,
    has: (key: string) => lookup(primary, key) !== undefined || lookup(fallback, key) !== undefined,
  };
}

export function deepMergeMessages(base: Messages, override: Messages): Messages {
  const result: Messages = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const existing = result[key];
    if (
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      typeof existing === 'object' &&
      existing !== null &&
      !Array.isArray(existing)
    ) {
      result[key] = deepMergeMessages(existing as Messages, value as Messages);
    } else {
      result[key] = value;
    }
  }
  return result;
}

export function collectTranslationKeys(messages: Messages, prefix = ''): string[] {
  const keys: string[] = [];
  for (const [key, value] of Object.entries(messages)) {
    const next = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      keys.push(...collectTranslationKeys(value as Messages, next));
    } else {
      keys.push(next);
    }
  }
  return keys;
}
