export interface CreateDocumentTemplateSelection {
  versionId: string;
  locale: string;
}

/**
 * A create action is only valid when the resolved prefill, the visible
 * selection, and the completed request all refer to the same template version
 * and locale.
 */
export function isCreateDocumentPrefillCurrent(input: {
  resolvedTemplate: CreateDocumentTemplateSelection | null;
  selectedTemplateVersionId: string;
  selectedLocale: string;
  loading: boolean;
}): boolean {
  return Boolean(
    input.resolvedTemplate &&
    !input.loading &&
    input.resolvedTemplate.versionId === input.selectedTemplateVersionId &&
    input.resolvedTemplate.locale === input.selectedLocale,
  );
}

export function preserveValidBankAccount(
  currentAccountId: string,
  bankAccounts: Array<{ id: string }>,
  resolvedDefaultAccountId: string | null,
): string {
  return currentAccountId && bankAccounts.some((account) => account.id === currentAccountId)
    ? currentAccountId
    : (resolvedDefaultAccountId ?? '');
}
