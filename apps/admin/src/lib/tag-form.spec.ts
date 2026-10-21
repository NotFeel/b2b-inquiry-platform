import { describe, expect, it } from 'vitest';
import type { TagSummary } from '@b2b/contracts';
import {
  TAG_CODE_MAX,
  emptyTagForm,
  hasTagFormErrors,
  isTagFormDirty,
  mapTagFieldErrors,
  secondaryLabel,
  tagColorOptions,
  toTagFormValues,
  toTagPayload,
  validateTagForm,
  type TagFormValues,
} from './tag-form';
import { toTagSelectOptions } from './tag-options';

const LOCALES = ['zh-CN', 'en-US'] as const;

const tag = (overrides: Partial<TagSummary> = {}): TagSummary => ({
  id: 'tag-1',
  code: 'oem',
  label: '支持 OEM',
  colorToken: 'tag.info',
  enabled: true,
  labels: { 'en-US': 'OEM available', 'zh-CN': '支持 OEM' },
  productCount: 2,
  updatedAt: '2026-10-16T10:00:00.000Z',
  missingLocales: [],
  ...overrides,
});

const values = (overrides: Partial<TagFormValues> = {}): TagFormValues => ({
  ...emptyTagForm(),
  code: 'oem',
  colorToken: 'tag.info',
  labels: { 'en-US': 'OEM available', 'zh-CN': '支持 OEM' },
  ...overrides,
});

describe('seeding', () => {
  it('echoes every stored value, including a disabled state and missing labels', () => {
    const seeded = toTagFormValues(tag({ enabled: false, labels: { 'en-US': 'OEM' } }), LOCALES);
    expect(seeded).toMatchObject({ code: 'oem', colorToken: 'tag.info', enabled: false });
    expect(seeded.labels['zh-CN']).toBe('');
  });

  it('maps a missing token to the neutral option', () => {
    expect(toTagFormValues(tag({ colorToken: null }), LOCALES).colorToken).toBe('');
  });
});

describe('validation', () => {
  it('accepts a complete tag', () => {
    expect(hasTagFormErrors(validateTagForm(values(), 'create', LOCALES, 'en-US'))).toBe(false);
  });

  it('only validates the code while creating', () => {
    expect(validateTagForm(values({ code: '' }), 'create', LOCALES, 'en-US').code).toBe(
      'tags.errors.codeRequired',
    );
    expect(validateTagForm(values({ code: 'OEM Tag' }), 'create', LOCALES, 'en-US').code).toBe(
      'tags.errors.codeInvalid',
    );
    expect(
      validateTagForm(values({ code: 'a'.repeat(TAG_CODE_MAX + 1) }), 'create', LOCALES, 'en-US')
        .code,
    ).toBe('tags.errors.codeInvalid');
    expect(
      validateTagForm(values({ code: 'anything at all' }), 'edit', LOCALES, 'en-US').code,
    ).toBeUndefined();
  });

  it('requires the English label but leaves Chinese optional', () => {
    const missingEn = validateTagForm(
      values({ labels: { 'en-US': '   ', 'zh-CN': '支持 OEM' } }),
      'create',
      LOCALES,
      'en-US',
    );
    expect(missingEn.labels).toEqual({ 'en-US': 'tags.errors.labelRequired' });

    const noChinese = validateTagForm(
      values({ labels: { 'en-US': 'OEM' } }),
      'create',
      LOCALES,
      'en-US',
    );
    expect(hasTagFormErrors(noChinese)).toBe(false);
  });

  it('rejects an over-long label', () => {
    const long = validateTagForm(
      values({ labels: { 'en-US': 'x'.repeat(101) } }),
      'create',
      LOCALES,
      'en-US',
    );
    expect(long.labels).toEqual({ 'en-US': 'tags.errors.labelTooLong' });
  });
});

describe('dirty tracking', () => {
  it('ignores whitespace-only edits and detects real changes', () => {
    const initial = values();
    expect(isTagFormDirty(initial, initial)).toBe(false);
    expect(
      isTagFormDirty(
        values({ labels: { 'en-US': ' OEM available ', 'zh-CN': '支持 OEM' } }),
        initial,
      ),
    ).toBe(false);
    expect(
      isTagFormDirty(values({ labels: { 'en-US': 'OEM', 'zh-CN': '支持 OEM' } }), initial),
    ).toBe(true);
    expect(isTagFormDirty(values({ enabled: false }), initial)).toBe(true);
    expect(isTagFormDirty(values({ colorToken: 'tag.warning' }), initial)).toBe(true);
  });
});

describe('payload', () => {
  it('sends the code only on create and drops empty translations', () => {
    expect(toTagPayload(values(), 'create')).toEqual({
      code: 'oem',
      colorToken: 'tag.info',
      enabled: true,
      translations: [
        { locale: 'en-US', label: 'OEM available' },
        { locale: 'zh-CN', label: '支持 OEM' },
      ],
    });
    const edited = toTagPayload(values({ labels: { 'en-US': 'OEM', 'zh-CN': '' } }), 'edit');
    expect(edited.code).toBeUndefined();
    expect(edited.translations).toEqual([{ locale: 'en-US', label: 'OEM' }]);
  });

  it('sends null for "no style" instead of an empty string', () => {
    expect(toTagPayload(values({ colorToken: '' }), 'create').colorToken).toBeNull();
  });
});

describe('field error mapping', () => {
  it('routes a taken code and a missing English label onto their inputs', () => {
    expect(mapTagFieldErrors({ code: 'tag.code.taken' }, 'en-US').code).toBe(
      'tags.errors.codeTaken',
    );
    expect(mapTagFieldErrors({ 'translations.en-US': 'x' }, 'en-US').labels).toEqual({
      'en-US': 'tags.errors.labelRequired',
    });
    expect(mapTagFieldErrors(undefined, 'en-US')).toEqual({});
  });
});

describe('list labels', () => {
  it('shows the other admin language as the secondary line', () => {
    expect(secondaryLabel(tag(), 'zh-CN', 'en-US')).toBe('OEM available');
    expect(secondaryLabel(tag(), 'en-US', 'en-US')).toBe('支持 OEM');
    expect(secondaryLabel(tag({ labels: { 'en-US': 'OEM' } }), 'en-US', 'en-US')).toBeNull();
  });
});

describe('style picker', () => {
  it('offers "no style" plus exactly the whitelisted tokens', () => {
    const options = tagColorOptions((key) => key);
    expect(options[0]).toEqual({ value: '', label: 'tags.colorOptions.none' });
    expect(options.map((option) => option.value)).toEqual([
      '',
      'tag.neutral',
      'tag.brand',
      'tag.success',
      'tag.warning',
      'tag.info',
      'tag.danger',
    ]);
    expect(options.every((option) => !option.value.includes('#'))).toBe(true);
  });
});

describe('product tag options', () => {
  it('keeps disabled tags visible but not selectable', () => {
    const options = toTagSelectOptions(
      [
        tag(),
        tag({
          id: 'tag-2',
          code: 'legacy',
          label: 'Legacy',
          enabled: false,
          labels: { 'en-US': 'Legacy' },
        }),
      ],
      { disabledHint: 'DISABLED' },
    );
    expect(options[0]).toMatchObject({ value: 'oem', disabled: false });
    expect(options[1]).toMatchObject({ value: 'legacy', disabled: true, hint: 'legacy' });
    expect(options[1]?.label).toContain('DISABLED');
  });
});
