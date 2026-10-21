import { describe, expect, it } from 'vitest';
import type { DictionaryItemSummary, DictionaryTypeSummary } from '@b2b/contracts';
import {
  EMPTY_TYPE_FORM,
  emptyItemForm,
  hasItemFormErrors,
  hasTypeFormErrors,
  isItemFormDirty,
  isTypeFormDirty,
  lockReason,
  moveWithinItems,
  nextItemSortOrder,
  toItemFormValues,
  toItemPayload,
  toTypeFormValues,
  toTypePayload,
  validateItemForm,
  validateTypeForm,
  type DictionaryItemFormValues,
  type DictionaryTypeFormValues,
} from './dictionary-form';

const LOCALES = ['zh-CN', 'en-US'] as const;

const TYPE: DictionaryTypeSummary = {
  id: 't1',
  code: 'payment_terms',
  nameKey: 'dictionary.payment_terms',
  description: 'Payment options for PIs',
  systemLocked: false,
  enabled: true,
  itemCount: 2,
  enabledItemCount: 2,
  updatedAt: '2026-10-16T10:00:00.000Z',
};

const item = (overrides: Partial<DictionaryItemSummary> = {}): DictionaryItemSummary => ({
  id: 'i1',
  typeCode: 'payment_terms',
  code: 'tt-30',
  value: 'T/T 30% deposit, 70% before shipment',
  sortOrder: 10,
  enabled: true,
  systemLocked: false,
  labels: { 'zh-CN': 'T/T 30% 定金', 'en-US': 'T/T 30% deposit' },
  updatedAt: '2026-10-16T10:00:00.000Z',
  ...overrides,
});

const validType: DictionaryTypeFormValues = {
  code: 'payment_terms',
  nameKey: 'dictionary.payment_terms',
  description: '',
  enabled: true,
};

const validItem: DictionaryItemFormValues = {
  code: 'lc-at-sight',
  value: 'L/C at sight',
  sortOrder: '20',
  enabled: true,
  labels: { 'zh-CN': '即期信用证', 'en-US': 'L/C at sight' },
};

describe('type form', () => {
  it('requires a code on create and validates its shape', () => {
    expect(validateTypeForm(EMPTY_TYPE_FORM, 'create').code).toBe('dictionary.errors.codeRequired');
    expect(validateTypeForm(EMPTY_TYPE_FORM, 'create').nameKey).toBe('dictionary.errors.nameKeyRequired');
    for (const code of ['Payment', 'pay ment', '-pay', 'x'.repeat(101)]) {
      expect(validateTypeForm({ ...validType, code }, 'create').code).toBe('dictionary.errors.codeInvalid');
    }
    expect(hasTypeFormErrors(validateTypeForm(validType, 'create'))).toBe(false);
  });

  it('requires the name key to look like an i18n key and keeps it read-only on edit', () => {
    expect(validateTypeForm({ ...validType, nameKey: 'Payment Terms' }, 'create').nameKey).toBe(
      'dictionary.errors.nameKeyInvalid',
    );
    expect(hasTypeFormErrors(validateTypeForm({ ...validType, code: 'Payment' }, 'edit'))).toBe(false);
  });

  it('seeds, diffs and serialises', () => {
    const values = toTypeFormValues(TYPE);
    expect(values).toEqual({
      code: 'payment_terms',
      nameKey: 'dictionary.payment_terms',
      description: 'Payment options for PIs',
      enabled: true,
    });
    expect(isTypeFormDirty(values, values)).toBe(false);
    expect(isTypeFormDirty({ ...values, enabled: false }, values)).toBe(true);
    expect(toTypePayload(values, 'edit')).toEqual({
      nameKey: 'dictionary.payment_terms',
      description: 'Payment options for PIs',
      enabled: true,
    });
    expect(toTypePayload({ ...validType, description: '' }, 'create')).toMatchObject({
      code: 'payment_terms',
      description: null,
    });
  });
});

describe('item form', () => {
  it('requires a code, both labels and a valid order on create', () => {
    const errors = validateItemForm(emptyItemForm(10), 'create', LOCALES);
    expect(errors.code).toBe('dictionary.errors.codeRequired');
    expect(errors.labels).toEqual({
      'zh-CN': 'dictionary.errors.labelRequired',
      'en-US': 'dictionary.errors.labelRequired',
    });
    expect(hasItemFormErrors(errors)).toBe(true);
    expect(hasItemFormErrors(validateItemForm(validItem, 'create', LOCALES))).toBe(false);
  });

  it('rejects an over-long value, a bad sort order and an over-long label', () => {
    expect(validateItemForm({ ...validItem, value: 'x'.repeat(241) }, 'create', LOCALES).value).toBe(
      'dictionary.errors.valueTooLong',
    );
    for (const sortOrder of ['', '2.5', '-1', '10001']) {
      expect(validateItemForm({ ...validItem, sortOrder }, 'create', LOCALES).sortOrder).toBe(
        'dictionary.errors.sortOrder',
      );
    }
    expect(
      validateItemForm(
        { ...validItem, labels: { 'zh-CN': 'x'.repeat(161), 'en-US': 'ok' } },
        'create',
        LOCALES,
      ).labels,
    ).toEqual({ 'zh-CN': 'dictionary.errors.labelTooLong' });
  });

  it('seeds, diffs and serialises, keeping the code only on create', () => {
    const values = toItemFormValues(item(), LOCALES);
    expect(values).toMatchObject({
      code: 'tt-30',
      value: 'T/T 30% deposit, 70% before shipment',
      sortOrder: '10',
      labels: { 'zh-CN': 'T/T 30% 定金', 'en-US': 'T/T 30% deposit' },
    });
    expect(isItemFormDirty(values, values)).toBe(false);
    expect(isItemFormDirty({ ...values, enabled: false }, values)).toBe(true);
    expect(isItemFormDirty({ ...values, labels: { ...values.labels, 'en-US': 'Edited' } }, values)).toBe(true);
    expect(toItemPayload(values, 'edit')).toEqual({
      value: 'T/T 30% deposit, 70% before shipment',
      sortOrder: 10,
      enabled: true,
      labels: { 'zh-CN': 'T/T 30% 定金', 'en-US': 'T/T 30% deposit' },
    });
    expect(toItemPayload(values, 'create')).toMatchObject({ code: 'tt-30' });
  });

  it('suggests the next sort order', () => {
    expect(nextItemSortOrder([])).toBe(10);
    expect(nextItemSortOrder([item({ sortOrder: 10 }), item({ id: 'i2', sortOrder: 20 })])).toBe(30);
  });
});

describe('protection reasons', () => {
  const translate = (key: string) => key;

  it('blocks delete and disable for locked entries', () => {
    expect(lockReason({ systemLocked: true }, 'delete-item', translate)).toBe('dictionary.locked.delete');
    expect(lockReason({ systemLocked: true }, 'disable-item', translate)).toBe('dictionary.locked.disable');
  });

  it('blocks item changes on behaviour-driving types', () => {
    expect(
      lockReason({ systemLocked: false, behaviourLockedType: true }, 'add-item', translate),
    ).toBe('dictionary.locked.behaviourType');
    expect(
      lockReason({ systemLocked: false, behaviourLockedType: true }, 'disable-item', translate),
    ).toBeNull();
  });

  it('blocks deleting a type with items or a referenced item', () => {
    expect(lockReason({ systemLocked: false, itemCount: 3 }, 'delete-type', translate)).toBe(
      'dictionary.locked.hasItems',
    );
    expect(lockReason({ systemLocked: false, usageCount: 2 }, 'delete-item', translate)).toBe(
      'dictionary.locked.inUse',
    );
    expect(lockReason({ systemLocked: false, itemCount: 0, usageCount: 0 }, 'delete-type', translate)).toBeNull();
  });
});

describe('sibling order', () => {
  it('moves an item within its type and stops at the ends', () => {
    const items = [
      item({ id: 'a', sortOrder: 10, code: 'a' }),
      item({ id: 'b', sortOrder: 20, code: 'b' }),
      item({ id: 'c', sortOrder: 30, code: 'c' }),
    ];
    expect(moveWithinItems(items, 'b', 'up')).toEqual(['b', 'a', 'c']);
    expect(moveWithinItems(items, 'b', 'down')).toEqual(['a', 'c', 'b']);
    expect(moveWithinItems(items, 'a', 'up')).toBeNull();
    expect(moveWithinItems(items, 'c', 'down')).toBeNull();
    expect(moveWithinItems(items, 'ghost', 'up')).toBeNull();
  });
});
