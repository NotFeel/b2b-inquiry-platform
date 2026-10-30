import type { QuotationExportProduct, QuotationExportTemplateOption } from '@b2b/contracts';

/** Keeps a valid selection across refreshes and otherwise chooses the first active template. */
export function selectQuotationTemplate(
  templates: readonly QuotationExportTemplateOption[],
  currentId: string | null,
): string | null {
  if (currentId && templates.some((template) => template.id === currentId)) return currentId;
  return templates[0]?.id ?? null;
}

/** Search is local because the API already caps one quotation at 200 products. */
export function filterQuotationProducts(
  products: readonly QuotationExportProduct[],
  search: string,
): QuotationExportProduct[] {
  const term = search.trim().toLocaleLowerCase();
  if (!term) return [...products];
  return products.filter((product) =>
    [product.sku, product.englishName ?? '', product.categoryPath ?? ''].some((value) =>
      value.toLocaleLowerCase().includes(term),
    ),
  );
}

export function setQuotationSelection(
  selected: ReadonlySet<string>,
  productIds: readonly string[],
  checked: boolean,
): Set<string> {
  const next = new Set(selected);
  for (const productId of productIds) {
    if (checked) next.add(productId);
    else next.delete(productId);
  }
  return next;
}

export function quotationIssueTranslationKey(code: string): string {
  const known = new Set([
    'PRODUCT_NOT_EXPORTABLE',
    'MISSING_COST',
    'MISSING_ENGLISH_NAME',
    'MISSING_PRIMARY_IMAGE',
    'IMAGE_NOT_READY',
    'INVALID_CARTON_QUANTITY',
    'INVALID_CARTON_DIMENSIONS',
    'INVALID_CARTON_WEIGHT',
    'PRODUCT_NOT_FOUND',
    'PRODUCT_NOT_IN_CATEGORY',
    'TOO_MANY_PRODUCTS',
    'CATEGORY_NOT_FOUND',
  ]);
  return `quotationExport.issues.${known.has(code) ? code : 'UNKNOWN'}`;
}
