import {
  DEFAULT_ADMIN_LOCALE,
  PUBLIC_LOCALE,
  SUPPORTED_LOCALES,
  type SupportedLocale,
} from '@b2b/contracts';

export { SUPPORTED_LOCALES, PUBLIC_LOCALE, DEFAULT_ADMIN_LOCALE };
export type { SupportedLocale };

export const LOCALE_LABELS: Record<SupportedLocale, string> = {
  'en-US': 'English',
  'zh-CN': '简体中文',
};

export function htmlLang(locale: SupportedLocale): string {
  return locale;
}

export function isSupportedLocale(value: unknown): value is SupportedLocale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

export function resolveLocale(
  value: unknown,
  fallback: SupportedLocale = PUBLIC_LOCALE,
): SupportedLocale {
  if (isSupportedLocale(value)) return value;
  if (typeof value === 'string') {
    const base = value.toLowerCase().split('-')[0];
    const match = SUPPORTED_LOCALES.find((locale) => locale.toLowerCase().startsWith(`${base}-`));
    if (match) return match;
  }
  return fallback;
}

export function otherLocale(locale: SupportedLocale): SupportedLocale {
  return locale === 'en-US' ? 'zh-CN' : 'en-US';
}

// Back-office timestamps render in the configured site timezone; the API always
// transports UTC ISO strings (docs/04 §1, docs/06 §5).
export function formatDateTime(
  value: string | Date,
  locale: SupportedLocale,
  timeZone = 'UTC',
): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(date);
}

export function formatDate(value: string | Date, locale: SupportedLocale, timeZone = 'UTC'): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone }).format(date);
}

export function formatNumber(value: number, locale: SupportedLocale): string {
  return new Intl.NumberFormat(locale).format(value);
}
