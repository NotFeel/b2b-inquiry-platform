import { describe, expect, it } from 'vitest';
import { ApiError } from '../../common/errors/api-error';
import {
  adminTagLabel,
  allowedTagColorToken,
  assertColorTokenAllowed,
  assertEnglishLabelPresent,
  assertTagDeletable,
  assertTagNotModified,
  isPublicLabelMissing,
  missingLocales,
  publicTagLabel,
  toTranslationRows,
} from './tag-policy';

function codeOf(action: () => void): string {
  try {
    action();
  } catch (error) {
    return (error as ApiError).code;
  }
  throw new Error('expected the guard to throw');
}

describe('style tokens', () => {
  it('accepts only whitelisted tokens and "no token"', () => {
    expect(() => assertColorTokenAllowed(null)).not.toThrow();
    expect(() => assertColorTokenAllowed(undefined)).not.toThrow();
    expect(() => assertColorTokenAllowed('tag.success')).not.toThrow();
    expect(codeOf(() => assertColorTokenAllowed('red'))).toBe('TAG_COLOR_TOKEN_INVALID');
    expect(codeOf(() => assertColorTokenAllowed('color:#f00'))).toBe('TAG_COLOR_TOKEN_INVALID');
    expect(codeOf(() => assertColorTokenAllowed('tag.unknown'))).toBe('TAG_COLOR_TOKEN_INVALID');
  });

  it('degrades an unknown stored token to neutral on the read path', () => {
    expect(allowedTagColorToken('tag.brand')).toBe('tag.brand');
    expect(allowedTagColorToken('red')).toBeNull();
    expect(allowedTagColorToken(null)).toBeNull();
    expect(allowedTagColorToken(undefined)).toBeNull();
  });
});

describe('english label requirement', () => {
  it('requires a non-empty English label', () => {
    expect(() => assertEnglishLabelPresent([{ locale: 'en-US', label: 'OEM' }])).not.toThrow();
    expect(codeOf(() => assertEnglishLabelPresent([{ locale: 'zh-CN', label: '支持 OEM' }]))).toBe(
      'TAG_TRANSLATION_MISSING',
    );
    expect(codeOf(() => assertEnglishLabelPresent([{ locale: 'en-US', label: '   ' }]))).toBe(
      'TAG_TRANSLATION_MISSING',
    );
    expect(codeOf(() => assertEnglishLabelPresent([]))).toBe('TAG_TRANSLATION_MISSING');
  });
});

describe('label resolution', () => {
  const labels = { 'en-US': 'OEM available', 'zh-CN': '支持 OEM' };

  it('resolves the admin label per locale with an English fallback', () => {
    expect(adminTagLabel(labels, 'zh-CN')).toBe('支持 OEM');
    expect(adminTagLabel(labels, 'de-DE')).toBe('OEM available');
    expect(adminTagLabel({}, 'zh-CN')).toBe('');
  });

  it('never falls back to another language on the public side', () => {
    expect(publicTagLabel(labels, 'en-US')).toBe('OEM available');
    // Chinese-only data must not be shown as the English public label.
    expect(publicTagLabel({ 'zh-CN': '支持 OEM' }, 'en-US')).toBe('');
    expect(isPublicLabelMissing({ 'zh-CN': '支持 OEM' }, 'en-US')).toBe(true);
    expect(publicTagLabel({ 'en-US': '  OEM  ' }, 'en-US')).toBe('OEM');
  });

  it('reports which admin locales still have no label', () => {
    expect(missingLocales({ 'en-US': 'OEM' }, ['en-US', 'zh-CN'])).toEqual(['zh-CN']);
    expect(missingLocales({ 'en-US': 'OEM', 'zh-CN': '支持 OEM' }, ['en-US', 'zh-CN'])).toEqual([]);
  });
});

describe('delete protection', () => {
  it('blocks a tag that is still attached to products', () => {
    expect(() => assertTagDeletable(0)).not.toThrow();
    const error = (() => {
      try {
        assertTagDeletable(3);
      } catch (caught) {
        return caught as ApiError;
      }
      throw new Error('expected a conflict');
    })();
    expect(error.code).toBe('TAG_IN_USE');
    expect(error.getStatus()).toBe(409);
    expect(error.details).toEqual({ productCount: 3 });
  });
});

describe('concurrency', () => {
  it('accepts a matching version and rejects a stale one', () => {
    const current = new Date('2026-10-16T10:00:00.000Z');
    expect(() => assertTagNotModified(current, '2026-10-16T10:00:00.000Z')).not.toThrow();
    expect(() => assertTagNotModified(current, undefined)).not.toThrow();
    expect(codeOf(() => assertTagNotModified(current, '2026-10-16T09:00:00.000Z'))).toBe(
      'TAG_CONCURRENT_UPDATE',
    );
  });
});

describe('translation input', () => {
  it('trims, drops blanks and de-duplicates by locale', () => {
    expect(
      toTranslationRows([
        { locale: 'en-US', label: '  OEM  ' },
        { locale: 'zh-CN', label: '   ' },
        { locale: 'en-US', label: 'OEM available' },
      ]),
    ).toEqual([{ locale: 'en-US', label: 'OEM available' }]);
  });
});
