import type { CalculatorInput, CalculatorProduct } from './quotation-order-api';

export type QuotationItemDraft = {
  productId: string;
  markupPercent: string;
  cartonCount: string;
  cartonLengthCm: string;
  cartonWidthCm: string;
  cartonHeightCm: string;
  cartonGrossWeightKg: string;
};

export type QuotationFeeDraft = {
  feeTypeCode: string;
  name: string;
  amountCny: string;
  notes?: string | null;
};

export function quotationItemDrafts(input: CalculatorInput): QuotationItemDraft[] {
  return input.items.map((item) => ({
    productId: item.productId,
    markupPercent: item.markupPercent,
    cartonCount: item.cartonCount > 0 ? String(item.cartonCount) : '',
    cartonLengthCm: item.cartonLengthCm ?? '',
    cartonWidthCm: item.cartonWidthCm ?? '',
    cartonHeightCm: item.cartonHeightCm ?? '',
    cartonGrossWeightKg: item.cartonGrossWeightKg ?? '',
  }));
}

export function quotationFeeDrafts(input: CalculatorInput): QuotationFeeDraft[] {
  return input.fees.map((fee) => ({
    feeTypeCode: fee.feeTypeCode,
    name: fee.name,
    amountCny: fee.amountCny,
    notes: fee.notes ?? null,
  }));
}

export function calculatorProductsById(
  products: CalculatorProduct[],
): Record<string, CalculatorProduct> {
  return Object.fromEntries(products.map((product) => [product.id, product]));
}
