import { ERROR_CODES, PUBLIC_LOCALE, TAG_COLOR_TOKENS, type TagColorToken } from '@b2b/contracts';
import { ApiError } from '../../common/errors/api-error';

// Pure tag policy (docs/23 §3, §5, §6.5, §11).
//
// Free of Prisma so the label fallback, the style-token whitelist, the
// "English is required for the storefront" rule, optimistic concurrency and the
// delete guard can all be unit tested directly.

export interface TagTranslationInput {
  locale: string;
  label: string;
}

/**
 * A tag stores a style *token*, never CSS (docs/23 §3.1, §4.2).
 *
 * `null` is allowed and means "neutral"; anything else must be in the shared
 * whitelist that the UI maps onto badge tones.
 */
export function assertColorTokenAllowed(colorToken: string | null | undefined): void {
  if (colorToken === null || colorToken === undefined) return;
  if (!(TAG_COLOR_TOKENS as readonly string[]).includes(colorToken)) {
    throw new ApiError(
      ERROR_CODES.tagColorTokenInvalid,
      'The colour token is not part of the allowed tag styles.',
      { details: { colorToken: 'tag.colorToken.invalid' } },
    );
  }
}

/**
 * Whitelist filter for a token that came *out* of the database.
 *
 * Guards the read path the same way the write path is guarded: a token written
 * by an older release, a manual SQL edit or a future rename degrades to `null`
 * (neutral) instead of reaching a className.
 */
export function allowedTagColorToken(colorToken: string | null | undefined): TagColorToken | null {
  if (!colorToken) return null;
  return (TAG_COLOR_TOKENS as readonly string[]).includes(colorToken)
    ? (colorToken as TagColorToken)
    : null;
}

/**
 * The public storefront is English by default, so an English label is required
 * (docs/23 §5). This checks the *resulting* translation set, which is what makes
 * it useful on a partial PATCH: dropping `en-US` from a tag is refused even when
 * the request only mentions Chinese.
 */
export function assertEnglishLabelPresent(translations: { locale: string; label: string }[]): void {
  const english = translations.find((translation) => translation.locale === PUBLIC_LOCALE);
  if (!english || english.label.trim().length === 0) {
    throw new ApiError(
      ERROR_CODES.tagTranslationMissing,
      'An English tag label is required: the storefront is English by default.',
      { details: { 'translations.en-US': 'validation.tag.englishRequired' } },
    );
  }
}

/** Optimistic concurrency guard, same contract as categories (docs/23 §11). */
export function assertTagNotModified(current: Date | string, expected?: string): void {
  if (!expected) return;
  const currentIso =
    current instanceof Date ? current.toISOString() : new Date(current).toISOString();
  if (new Date(expected).toISOString() !== currentIso) {
    throw new ApiError(
      ERROR_CODES.tagConcurrentUpdate,
      'This tag was modified by another session.',
    );
  }
}

/**
 * A tag that is still attached to products must not be deleted (docs/23 §6.5).
 *
 * The service re-reads the count inside the delete path and the database holds a
 * `RESTRICT` foreign key as a second line of defence.
 */
export function assertTagDeletable(productCount: number): void {
  if (productCount > 0) {
    throw new ApiError(
      ERROR_CODES.tagInUse,
      `This tag is still attached to ${productCount} product(s). Disable it instead.`,
      { details: { productCount } },
    );
  }
}

/**
 * Admin display label: requested locale → English → code.
 *
 * Falling back to `code` (never to another language) keeps a half-translated tag
 * honest in the back office: the administrator sees the machine identifier and
 * can tell a translation is missing.
 */
export function adminTagLabel(labels: Record<string, string>, locale: string): string {
  return labels[locale] ?? labels[PUBLIC_LOCALE] ?? '';
}

/** Locales that have no label yet, for the "missing translation" hint. */
export function missingLocales(
  labels: Record<string, string>,
  locales: readonly string[],
): string[] {
  return locales.filter((locale) => (labels[locale] ?? '').trim().length === 0);
}

/**
 * Public label resolution (docs/23 §5, §8.2).
 *
 * Exact public locale → English → `code`. It deliberately never falls back to
 * another language: showing a Chinese label on the English storefront would be a
 * silent data-quality bug, whereas `code` is visibly a fallback.
 */
export function publicTagLabel(
  labels: Record<string, string>,
  locale: string = PUBLIC_LOCALE,
): string {
  const exact = labels[locale]?.trim();
  if (exact) return exact;
  const english = labels[PUBLIC_LOCALE]?.trim();
  if (english) return english;
  return '';
}

/** True when the public label had to fall back to the code. */
export function isPublicLabelMissing(
  labels: Record<string, string>,
  locale: string = PUBLIC_LOCALE,
): boolean {
  return publicTagLabel(labels, locale).length === 0;
}

/**
 * Normalises translation input (docs/23 §6.2).
 *
 * De-duplicates by locale, trims labels and drops empties so a save can never
 * write a blank label over an existing one.
 */
export function toTranslationRows(
  translations: TagTranslationInput[],
): { locale: string; label: string }[] {
  const byLocale = new Map<string, string>();
  for (const translation of translations) {
    const label = translation.label.trim();
    if (label.length === 0) continue;
    byLocale.set(translation.locale, label);
  }
  return [...byLocale.entries()].map(([locale, label]) => ({ locale, label }));
}
