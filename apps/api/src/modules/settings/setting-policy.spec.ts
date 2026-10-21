import { describe, expect, it } from 'vitest';
import { ApiError } from '../../common/errors/api-error';
import {
  assertGroupAndTypeAreValid,
  assertMetadataChangeIsAllowed,
  assertRevisionMatches,
  assertSettingIsDeletable,
  assertSettingIsEditable,
  assertTypeChangeIsLossless,
  assertVisibilityIsConsistent,
  normalizeSettingValue,
  valuePreview,
  type SettingRowRef,
} from './setting-policy';

const SYSTEM_ROW: SettingRowRef = {
  key: 'site.companyName',
  isPublic: true,
  isSecret: false,
  isSystem: true,
  isEditable: true,
  isDeletable: false,
  valueType: 'string',
  revision: 1,
};

const CUSTOM_ROW: SettingRowRef = {
  key: 'custom.reportFooter',
  isPublic: false,
  isSecret: false,
  isSystem: false,
  isEditable: true,
  isDeletable: true,
  valueType: 'string',
  revision: 3,
};

/** Mirrors the WhatsApp normaliser the service injects. */
const normalizeWhatsApp = (raw: string | null): string | null => {
  if (!raw) return null;
  const digits = raw.replace(/[^\d]/g, '');
  return digits.length >= 8 ? digits : null;
};

function codeOf(action: () => void): string {
  try {
    action();
  } catch (error) {
    return (error as ApiError).code;
  }
  throw new Error('expected the guard to throw');
}

describe('group and type validation', () => {
  it('accepts the documented groups and value types', () => {
    expect(() => assertGroupAndTypeAreValid('site_profile', 'string')).not.toThrow();
    expect(() => assertGroupAndTypeAreValid('custom', 'json')).not.toThrow();
  });

  it('rejects an unknown group or type with a 400 value error', () => {
    for (const [group, type] of [
      ['not_a_group', 'string'],
      ['custom', 'not_a_type'],
    ] as const) {
      try {
        assertGroupAndTypeAreValid(group, type);
        throw new Error('expected the guard to throw');
      } catch (error) {
        expect((error as ApiError).code).toBe('SETTING_VALUE_INVALID');
        expect((error as ApiError).getStatus()).toBe(400);
      }
    }
  });
});

describe('visibility policy', () => {
  it('allows public, private and secret combinations but never public+secret', () => {
    expect(() => assertVisibilityIsConsistent(true, false)).not.toThrow();
    expect(() => assertVisibilityIsConsistent(false, true)).not.toThrow();
    expect(() => assertVisibilityIsConsistent(false, false)).not.toThrow();
    try {
      assertVisibilityIsConsistent(true, true);
      throw new Error('expected the guard to throw');
    } catch (error) {
      expect((error as ApiError).code).toBe('SETTING_PUBLIC_SECRET_CONFLICT');
      expect((error as ApiError).getStatus()).toBe(409);
    }
  });
});

describe('metadata protection', () => {
  it('refuses to change the group or type of a system setting', () => {
    expect(codeOf(() => assertMetadataChangeIsAllowed(SYSTEM_ROW, { groupCode: 'seo' }))).toBe(
      'SETTING_SYSTEM_LOCKED',
    );
    expect(codeOf(() => assertMetadataChangeIsAllowed(SYSTEM_ROW, { valueType: 'number' }))).toBe(
      'SETTING_SYSTEM_LOCKED',
    );
    expect(() => assertMetadataChangeIsAllowed(SYSTEM_ROW, { isSecret: true })).not.toThrow();
  });

  it('allows metadata changes on a custom setting', () => {
    expect(() =>
      assertMetadataChangeIsAllowed(CUSTOM_ROW, { groupCode: 'seo', valueType: 'number' }),
    ).not.toThrow();
  });

  it('never unlocks a secret through the ordinary update flow', () => {
    expect(
      codeOf(() =>
        assertMetadataChangeIsAllowed({ ...CUSTOM_ROW, isSecret: true }, { isSecret: false }),
      ),
    ).toBe('SETTING_SYSTEM_LOCKED');
  });

  it('refuses to edit a setting flagged as not editable', () => {
    expect(codeOf(() => assertSettingIsEditable({ ...CUSTOM_ROW, isEditable: false }))).toBe(
      'SETTING_SYSTEM_LOCKED',
    );
    expect(() => assertSettingIsEditable(CUSTOM_ROW)).not.toThrow();
  });
});

describe('deletion protection', () => {
  it('refuses a system setting or one that code still reads', () => {
    expect(codeOf(() => assertSettingIsDeletable(SYSTEM_ROW, true))).toBe('SETTING_IN_USE');
    expect(codeOf(() => assertSettingIsDeletable(CUSTOM_ROW, true))).toBe('SETTING_IN_USE');
    expect(codeOf(() => assertSettingIsDeletable({ ...CUSTOM_ROW, isDeletable: false }, false))).toBe(
      'SETTING_SYSTEM_LOCKED',
    );
  });

  it('allows deleting an unreferenced custom setting', () => {
    expect(() => assertSettingIsDeletable(CUSTOM_ROW, false)).not.toThrow();
  });
});

describe('optimistic concurrency', () => {
  it('accepts a missing or matching revision', () => {
    expect(() => assertRevisionMatches(undefined, 3)).not.toThrow();
    expect(() => assertRevisionMatches(3, 3)).not.toThrow();
  });

  it('reports a stale editor as SETTING_REVISION_CONFLICT', () => {
    try {
      assertRevisionMatches(2, 3);
      throw new Error('expected the guard to throw');
    } catch (error) {
      expect((error as ApiError).code).toBe('SETTING_REVISION_CONFLICT');
      expect((error as ApiError).getStatus()).toBe(409);
    }
  });
});

describe('value normalisation per type', () => {
  const normalize = (valueType: string, value: unknown, key = 'custom.x', options?: unknown) =>
    normalizeSettingValue(key, valueType, value, options, normalizeWhatsApp).value;

  it('handles number, boolean and text', () => {
    expect(normalize('number', '42')).toBe(42);
    expect(normalize('boolean', 'true')).toBe(true);
    expect(normalize('boolean', false)).toBe(false);
    expect(normalize('text', '  hello  ')).toBe('hello');
    expect(normalize('string', '')).toBeNull();
  });

  it('rejects a non-numeric number instead of coercing it', () => {
    expect(codeOf(() => normalize('number', 'abc'))).toBe('SETTING_VALUE_INVALID');
  });

  it('validates email and url shapes', () => {
    expect(normalize('email', 'sales@example.com')).toBe('sales@example.com');
    expect(codeOf(() => normalize('email', 'not-an-email'))).toBe('SETTING_VALUE_INVALID');
    expect(normalize('url', 'https://example.com/x')).toBe('https://example.com/x');
    expect(codeOf(() => normalize('url', 'javascript:alert(1)'))).toBe('SETTING_VALUE_INVALID');
  });

  it('accepts a display phone but normalises the WhatsApp number to digits', () => {
    expect(normalize('phone', '+86 138 0000 0000')).toBe('+86 138 0000 0000');
    expect(normalize('phone', '+86 138 0000 0000', 'site.whatsappNumber')).toBe('8613800000000');
    expect(codeOf(() => normalize('phone', '123', 'site.whatsappNumber'))).toBe('SETTING_VALUE_INVALID');
  });

  it('restricts select values to the declared options', () => {
    expect(normalize('select', 'zh-CN', 'custom.locale', ['en-US', 'zh-CN'])).toBe('zh-CN');
    expect(codeOf(() => normalize('select', 'fr-FR', 'custom.locale', ['en-US', 'zh-CN']))).toBe(
      'SETTING_VALUE_INVALID',
    );
  });

  it('parses comma separated lists and structured object lists', () => {
    expect(normalize('stringList', 'a, b ,c')).toEqual(['a', 'b', 'c']);
    expect(normalize('stringList', ['x', 'y'])).toEqual(['x', 'y']);
    expect(normalize('objectList', [{ label: 'Docs', url: 'https://example.com' }, { label: '' }])).toEqual([
      { label: 'Docs', url: 'https://example.com' },
    ]);
  });

  it('parses JSON only when it is valid and keeps objects as-is', () => {
    expect(normalize('json', '{"a":1}')).toEqual({ a: 1 });
    expect(normalize('json', { b: 2 })).toEqual({ b: 2 });
    expect(codeOf(() => normalize('json', '{oops'))).toBe('SETTING_VALUE_INVALID');
  });
});

describe('value preview', () => {
  it('never exposes long or structured values verbatim', () => {
    expect(valuePreview('short')).toBe('short');
    expect(valuePreview('x'.repeat(100))).toHaveLength(78);
    expect(valuePreview(true)).toBe('true');
    expect(valuePreview(20)).toBe('20');
    expect(valuePreview([1, 2, 3])).toBe('3 item(s)');
    expect(valuePreview({ a: 1 })).toBe('JSON');
    expect(valuePreview(null)).toBeNull();
  });
});

describe('type changes', () => {
  it('allows a lossless change', () => {
    expect(() =>
      assertTypeChangeIsLossless('string', 'hello', (type, value) =>
        normalizeSettingValue('custom.x', type, value, undefined, normalizeWhatsApp),
      ),
    ).not.toThrow();
    expect(() =>
      assertTypeChangeIsLossless('json', { a: 1 }, () => undefined),
    ).not.toThrow();
  });

  it('refuses a change that cannot represent the stored value', () => {
    try {
      assertTypeChangeIsLossless('number', 'not-a-number', (type, value) =>
        normalizeSettingValue('custom.x', type, value, undefined, normalizeWhatsApp),
      );
      throw new Error('expected the guard to throw');
    } catch (error) {
      expect((error as ApiError).code).toBe('SETTING_VALUE_INVALID');
      expect((error as ApiError).getStatus()).toBe(400);
    }
  });
});
