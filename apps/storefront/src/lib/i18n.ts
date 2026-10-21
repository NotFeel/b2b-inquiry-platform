import { commonMessages, createTranslator, deepMergeMessages, type Messages } from '@b2b/i18n';
import { PUBLIC_LOCALE, type SupportedLocale } from '@b2b/contracts';
import enUS from '../messages/en-US.json';
import zhCN from '../messages/zh-CN.json';

// Both locale dictionaries are shipped together so switching language never
// silently falls back to the other language (前台执行手册 §6).
export const messages: Record<string, Messages> = {
  'en-US': deepMergeMessages(commonMessages['en-US'], enUS as Messages),
  'zh-CN': deepMergeMessages(commonMessages['zh-CN'], zhCN as Messages),
};

export type StorefrontLocale = SupportedLocale;

export function getTranslator(locale: string = PUBLIC_LOCALE) {
  const resolved: SupportedLocale = locale === 'zh-CN' ? 'zh-CN' : 'en-US';
  return createTranslator(messages, resolved, PUBLIC_LOCALE);
}

export const storefrontLocales: SupportedLocale[] = ['en-US', 'zh-CN'];

export function isStorefrontLocale(value: string): value is SupportedLocale {
  return (storefrontLocales as string[]).includes(value);
}

/**
 * Builds an internal link that already carries the locale segment, so navigation
 * never relies on a redirect hop.
 */
export function localeHref(locale: string, path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return normalized === '/' ? `/${locale}` : `/${locale}${normalized}`;
}

/**
 * Product counts need a real singular form in English. Keeping the two keys in
 * the locale resources avoids the common "1 products" output while still
 * falling back cleanly if a locale has no plural-specific string.
 */
export function productCountLabel(
  t: (key: string, params?: Record<string, string | number>) => string,
  count: number,
  oneKey = 'catalog.resultCountOne',
  manyKey = 'catalog.resultCount',
): string {
  return count === 1 ? t(oneKey) : t(manyKey, { count });
}
