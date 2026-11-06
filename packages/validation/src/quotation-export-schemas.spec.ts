import { describe, expect, it } from 'vitest';
import {
  quotationExportPreviewSchema,
  quotationExportProductListQuerySchema,
  quotationExportSchema,
} from './admin-schemas';

const CATEGORY_ID = '11111111-1111-4111-8111-111111111111';
const PRODUCT_ID = '22222222-2222-4222-8222-222222222222';
const PRODUCT_ID_2 = '44444444-4444-4444-8444-444444444444';
const TEMPLATE_ID = '33333333-3333-4333-8333-333333333333';

const preview = {
  categoryId: CATEGORY_ID,
  includeDescendants: true,
  productIds: [PRODUCT_ID],
  markupPercent: '15',
  currencyCode: 'USD',
  exchangeRate: '0.1385',
};

describe('quotation export request schemas', () => {
  it('coerces query booleans and de-duplicates product ids deterministically', () => {
    expect(
      quotationExportProductListQuerySchema.parse({
        categoryId: CATEGORY_ID,
        includeDescendants: 'false',
      }),
    ).toMatchObject({ includeDescendants: false, search: '' });

    const parsed = quotationExportPreviewSchema.parse({
      ...preview,
      productIds: [PRODUCT_ID, PRODUCT_ID],
    });
    expect(parsed.productIds).toEqual([PRODUCT_ID]);
  });

  it('rejects empty and oversized selections', () => {
    expect(quotationExportPreviewSchema.safeParse({ ...preview, productIds: [] }).success).toBe(
      false,
    );
    expect(
      quotationExportPreviewSchema.safeParse({
        ...preview,
        productIds: Array.from(
          { length: 201 },
          (_, index) => `${String(index + 1).padStart(8, '0')}-0000-4000-8000-000000000000`,
        ),
      }).success,
    ).toBe(false);
  });

  it.each(['0', '-1', 'NaN', 'Infinity', '1e-2', '0.00000000001'])(
    'rejects an invalid exchange rate %s',
    (exchangeRate) => {
      expect(quotationExportPreviewSchema.safeParse({ ...preview, exchangeRate }).success).toBe(
        false,
      );
    },
  );

  it.each(['usd', ''])('rejects a malformed currency code: %s',
    (currencyCode) => {
      expect(quotationExportPreviewSchema.safeParse({ ...preview, currencyCode }).success).toBe(
        false,
      );
    },
  );

  it('accepts unique product markups and rejects unknown or duplicate product ids', () => {
    const valid = {
      ...preview,
      productIds: [PRODUCT_ID, PRODUCT_ID_2],
      productMarkups: [
        { productId: PRODUCT_ID, markupPercent: '15' },
        { productId: PRODUCT_ID_2, markupPercent: '18.25' },
      ],
    };
    expect(quotationExportPreviewSchema.safeParse(valid).success).toBe(true);
    expect(
      quotationExportPreviewSchema.safeParse({
        ...valid,
        productMarkups: [{ productId: TEMPLATE_ID, markupPercent: '15' }],
      }).success,
    ).toBe(false);
    expect(
      quotationExportPreviewSchema.safeParse({
        ...valid,
        productMarkups: [
          { productId: PRODUCT_ID, markupPercent: '15' },
          { productId: PRODUCT_ID, markupPercent: '20' },
        ],
      }).success,
    ).toBe(false);
  });

  it('rejects obsolete customer header fields', () => {
    const request = {
      templateId: TEMPLATE_ID,
      categoryId: CATEGORY_ID,
      includeDescendants: true,
      productIds: [PRODUCT_ID],
      pricing: {
        markupPercent: '15',
        productMarkups: [{ productId: PRODUCT_ID, markupPercent: '18' }],
        currencyCode: 'USD',
        exchangeRate: '0.1385',
      },
    };
    expect(quotationExportSchema.safeParse(request).success).toBe(true);
    expect(
      quotationExportSchema.safeParse({
        ...request,
        pricing: {
          ...request.pricing,
          productMarkups: [{ productId: TEMPLATE_ID, markupPercent: '18' }],
        },
      }).success,
    ).toBe(false);
    expect(quotationExportSchema.safeParse({ ...request, templateId: undefined }).success).toBe(
      false,
    );
    expect(quotationExportSchema.safeParse({ ...request, templateId: 'not-a-uuid' }).success).toBe(
      false,
    );
    expect(quotationExportSchema.safeParse({ ...request, header: {} }).success).toBe(false);
  });
});
