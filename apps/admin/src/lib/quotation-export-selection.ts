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
  selected: readonly string[],
  productIds: readonly string[],
  checked: boolean,
): string[] {
  if (!checked) {
    const removed = new Set(productIds);
    return selected.filter((productId) => !removed.has(productId));
  }

  const next = [...selected];
  const included = new Set(next);
  for (const productId of productIds) {
    if (included.has(productId)) continue;
    included.add(productId);
    next.push(productId);
  }
  return next;
}

/** Moves one selected product to the requested zero-based export position. */
export function moveQuotationSelection(
  selected: readonly string[],
  productId: string,
  targetIndex: number,
): string[] {
  const sourceIndex = selected.indexOf(productId);
  if (sourceIndex < 0) return [...selected];

  const next = [...selected];
  const boundedTarget = Math.max(0, Math.min(Math.trunc(targetIndex), next.length - 1));
  if (sourceIndex === boundedTarget) return next;

  const [moved] = next.splice(sourceIndex, 1);
  if (moved === undefined) return next;
  next.splice(boundedTarget, 0, moved);
  return next;
}

/** One-step keyboard/button reordering without relying on drag support. */
export function moveQuotationSelectionBy(
  selected: readonly string[],
  productId: string,
  offset: -1 | 1,
): string[] {
  const sourceIndex = selected.indexOf(productId);
  if (sourceIndex < 0) return [...selected];
  return moveQuotationSelection(selected, productId, sourceIndex + offset);
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
