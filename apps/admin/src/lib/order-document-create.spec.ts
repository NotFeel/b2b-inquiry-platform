import { describe, expect, it } from 'vitest';
import { isCreateDocumentPrefillCurrent, preserveValidBankAccount } from './order-document-create';

describe('order document creation selection', () => {
  it('accepts only the completed prefill for the visible template and locale', () => {
    expect(
      isCreateDocumentPrefillCurrent({
        resolvedTemplate: { versionId: 'version-b', locale: 'en-US' },
        selectedTemplateVersionId: 'version-b',
        selectedLocale: 'en-US',
        loading: false,
      }),
    ).toBe(true);
    expect(
      isCreateDocumentPrefillCurrent({
        resolvedTemplate: { versionId: 'version-a', locale: 'en-US' },
        selectedTemplateVersionId: 'version-b',
        selectedLocale: 'en-US',
        loading: false,
      }),
    ).toBe(false);
    expect(
      isCreateDocumentPrefillCurrent({
        resolvedTemplate: { versionId: 'version-b', locale: 'en-US' },
        selectedTemplateVersionId: 'version-b',
        selectedLocale: 'en-US',
        loading: true,
      }),
    ).toBe(false);
  });

  it('preserves a manually selected bank account only while it remains available', () => {
    expect(preserveValidBankAccount('bank-2', [{ id: 'bank-1' }, { id: 'bank-2' }], 'bank-1')).toBe(
      'bank-2',
    );
    expect(preserveValidBankAccount('bank-old', [{ id: 'bank-1' }], 'bank-1')).toBe('bank-1');
  });
});
