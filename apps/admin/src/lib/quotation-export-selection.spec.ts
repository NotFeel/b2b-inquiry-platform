import { describe, expect, it } from 'vitest';
import type { QuotationExportProduct, QuotationExportTemplateOption } from '@b2b/contracts';
import {
  filterQuotationProducts,
  quotationIssueTranslationKey,
  selectQuotationTemplate,
  setQuotationSelection,
} from './quotation-export-selection';

function product(overrides: Partial<QuotationExportProduct>): QuotationExportProduct {
  return {
    id: 'product-1',
    sku: 'SKU-001',
    englishName: 'Steel gate',
    categoryPath: 'Outdoor / Gates',
    thumbnailUrl: null,
    hasCost: true,
    costCny: null,
    hasOriginalImage: true,
    cartonQuantity: 4,
    cartonDimensions: '40 × 30 × 30 cm',
    cartonGrossWeightKg: '12.500',
    eligibilityCodes: [],
    ...overrides,
  };
}

describe('filterQuotationProducts', () => {
  const products = [
    product({ id: 'p1', sku: 'GATE-001', englishName: 'Steel gate' }),
    product({ id: 'p2', sku: 'TOY-002', englishName: 'Squishy toy', categoryPath: 'Toys' }),
  ];

  it('matches SKU, English name and category path case-insensitively', () => {
    expect(filterQuotationProducts(products, 'toy-002').map((item) => item.id)).toEqual(['p2']);
    expect(filterQuotationProducts(products, 'STEEL').map((item) => item.id)).toEqual(['p1']);
    expect(filterQuotationProducts(products, 'outdoor').map((item) => item.id)).toEqual(['p1']);
  });

  it('returns every product for an empty search without mutating the source', () => {
    const result = filterQuotationProducts(products, '   ');
    expect(result).toEqual(products);
    expect(result).not.toBe(products);
  });
});

describe('setQuotationSelection', () => {
  it('adds and removes only the requested ids while retaining hidden selections', () => {
    const selected = new Set(['hidden-product', 'visible-product']);
    const added = setQuotationSelection(selected, ['second-visible'], true);
    expect([...selected]).toEqual(['hidden-product', 'visible-product']);
    expect([...added].sort()).toEqual(['hidden-product', 'second-visible', 'visible-product']);

    const removed = setQuotationSelection(added, ['visible-product'], false);
    expect([...removed].sort()).toEqual(['hidden-product', 'second-visible']);
  });
});

describe('quotationIssueTranslationKey', () => {
  it('maps known codes and collapses unknown server codes to a safe fallback', () => {
    expect(quotationIssueTranslationKey('MISSING_COST')).toBe(
      'quotationExport.issues.MISSING_COST',
    );
    expect(quotationIssueTranslationKey('SERVER_ADDED_CODE')).toBe(
      'quotationExport.issues.UNKNOWN',
    );
  });
});

describe('selectQuotationTemplate', () => {
  const templates: QuotationExportTemplateOption[] = [
    {
      id: 'template-1',
      name: 'B2B Quotation Template',
      version: 2,
      fileName: 'B2B_Quotation_Template.xlsx',
      sheetName: 'Quotation',
      status: 'active',
    },
    {
      id: 'template-2',
      name: 'Secondary Template',
      version: 1,
      fileName: 'Secondary.xlsx',
      sheetName: 'Quotation',
      status: 'active',
    },
  ];

  it('chooses the first available template when no prior selection exists', () => {
    expect(selectQuotationTemplate(templates, null)).toBe('template-1');
  });

  it('preserves a still-available selection across refreshes', () => {
    expect(selectQuotationTemplate(templates, 'template-2')).toBe('template-2');
  });

  it('replaces a stale selection and returns null when no template is available', () => {
    expect(selectQuotationTemplate(templates, 'removed-template')).toBe('template-1');
    expect(selectQuotationTemplate([], 'template-1')).toBeNull();
  });
});
