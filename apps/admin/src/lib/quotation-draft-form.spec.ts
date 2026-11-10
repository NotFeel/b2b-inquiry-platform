import { describe, expect, it } from 'vitest';
import type { CalculatorInput, CalculatorProduct } from './quotation-order-api';
import {
  calculatorProductsById,
  quotationFeeDrafts,
  quotationItemDrafts,
} from './quotation-draft-form';

describe('quotation draft form hydration', () => {
  it('converts persisted calculator items and fees back into editable drafts', () => {
    const input = {
      items: [
        {
          productId: 'product-1',
          markupPercent: '18.5',
          cartonCount: 12,
          cartonLengthCm: '52.000',
          cartonWidthCm: null,
          cartonHeightCm: '31.25',
          cartonGrossWeightKg: '18.4',
        },
      ],
      fees: [
        {
          feeTypeCode: 'inspection',
          name: 'Inspection',
          amountCny: '125.50',
          notes: 'Third-party inspection',
        },
      ],
    } as CalculatorInput;

    expect(quotationItemDrafts(input)).toEqual([
      {
        productId: 'product-1',
        markupPercent: '18.5',
        cartonCount: '12',
        cartonLengthCm: '52.000',
        cartonWidthCm: '',
        cartonHeightCm: '31.25',
        cartonGrossWeightKg: '18.4',
      },
    ]);
    expect(quotationFeeDrafts(input)).toEqual([
      {
        feeTypeCode: 'inspection',
        name: 'Inspection',
        amountCny: '125.50',
        notes: 'Third-party inspection',
      },
    ]);
  });

  it('indexes exact calculator products for an edited draft', () => {
    const product = {
      id: 'product-1',
      sku: 'SKU-1',
      name: 'Product 1',
      imageUrl: null,
      imageAlt: 'Product 1',
      publishStatus: 'published',
      lifecycleStatus: 'available',
      costCny: '10.0000',
      packaging: {
        cartonLengthCm: null,
        cartonWidthCm: null,
        cartonHeightCm: null,
        cartonGrossWeightKg: null,
        unitsPerCarton: 24,
      },
    } satisfies CalculatorProduct;

    expect(calculatorProductsById([product])).toEqual({ 'product-1': product });
  });
});
