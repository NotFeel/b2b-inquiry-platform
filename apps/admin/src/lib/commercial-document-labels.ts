export type CommercialDocumentTranslate = (
  key: string,
  params?: Record<string, string | number>,
) => string;

/** Translate stable field keys while keeping template output labels as data. */
export function commercialDocumentFieldLabel(
  key: string,
  t: CommercialDocumentTranslate,
): string {
  if (key === 'items') {
    return t('commercialDocuments.editor.missingFields.items');
  }
  if (key.startsWith('items.')) {
    return t(`documentTemplates.columnNames.${key}`);
  }
  return t(`documentTemplates.fieldNames.${key}`);
}

export function commercialDocumentLocaleLabel(
  locale: string,
  t: CommercialDocumentTranslate,
): string {
  return t(`commercialDocuments.locales.${locale}`);
}
