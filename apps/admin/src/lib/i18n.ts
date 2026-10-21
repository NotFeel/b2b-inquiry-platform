import { commonMessages, createTranslator, deepMergeMessages, errorMessageKey, type Messages } from '@b2b/i18n';
import { DEFAULT_ADMIN_LOCALE, type SupportedLocale } from '@b2b/contracts';
import zhCN from '../messages/zh-CN.json';
import enUS from '../messages/en-US.json';

export const adminMessages: Record<SupportedLocale, Messages> = {
  'zh-CN': deepMergeMessages(commonMessages['zh-CN'], zhCN as Messages),
  'en-US': deepMergeMessages(commonMessages['en-US'], enUS as Messages),
};

export const ADMIN_LOCALES: SupportedLocale[] = ['zh-CN', 'en-US'];
export const DEFAULT_LOCALE = DEFAULT_ADMIN_LOCALE;

export function isAdminLocale(value: string): value is SupportedLocale {
  return (ADMIN_LOCALES as string[]).includes(value);
}

export function getTranslator(locale: string) {
  const resolved: SupportedLocale = isAdminLocale(locale) ? locale : DEFAULT_LOCALE;
  return createTranslator(adminMessages, resolved, 'en-US');
}

// Error codes are translated, never branched on (docs/06 §5).
export function translateError(locale: string, code: string): string {
  const { t } = getTranslator(locale);
  return t(errorMessageKey(code));
}

export function localeHref(locale: string, path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return normalized === '/' ? `/${locale}` : `/${locale}${normalized}`;
}

/**
 * Maps an audit action code to a human-readable, translated label while keeping
 * the technical code available in the detail drawer (docs/16 §5.2).
 *
 * Codes are stable machine values such as `auth.login_succeeded`; the lookup key
 * replaces dots with underscores because the translator walks a dotted path.
 */
export function auditActionLabel(locale: string, code: string): string {
  const { t, has } = getTranslator(locale);
  const normalized = code.replace(/\./g, '_');
  if (has(`auditActions.${normalized}`)) return t(`auditActions.${normalized}`);
  // Status transitions are dynamic (`pi.status.issued`); collapse them onto one
  // label so a new status never renders as a raw code.
  if (code.startsWith('pi.status.')) return t('auditActions.pi_status');
  return code;
}
