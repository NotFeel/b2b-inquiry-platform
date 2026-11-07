import { describe, expect, it } from 'vitest';
import { quotationCalculationSchema, quotationPreviewSchema } from './admin-schemas';

const input = {
  title: 'Export order quote',
  currencyCode: 'USD',
  exchangeRate: '0.1234567890',
  exchangeRateDate: '2026-11-02',
  freightBillingMethod: 'CBM',
  freightCurrencyCode: 'CNY',
  cbmRatePerCbm: '1',
  kgRatePerKg: '1',
  volumetricDivisorItemId: '3f074cf0-c2a6-4ef9-850b-2e0b1c73e269',
  deliveryFeeCny: '0',
  items: [
    {
      productId: '0f5e5c7a-1793-4d04-a8ee-4f0c11c1bff5',
      quantity: '100.125',
      markupPercent: '20.0000',
      cartonCount: 1,
    },
  ],
  fees: [],
};

describe('quotation/order calculation input schema', () => {
  it('accepts string decimals with the documented 10 place manual exchange rate', () => {
    expect(quotationCalculationSchema.safeParse(input).success).toBe(true);
  });

  it.each(['1e-2', 'NaN', '-1', '0.1234567890123'])('rejects invalid decimal text %s', (value) => {
    expect(quotationCalculationSchema.safeParse({ ...input, exchangeRate: value }).success).toBe(
      false,
    );
  });

  it('strips client supplied cost and calculated amount fields', () => {
    const parsed = quotationCalculationSchema.parse({
      ...input,
      items: [{ ...input.items[0], costCny: '0.01', lineAmountCny: '0.01' }],
    });
    expect(parsed.items[0]).not.toHaveProperty('costCny');
    expect(parsed.items[0]).not.toHaveProperty('lineAmountCny');
  });

  it('allows preview without a title but still requires a title when saving', () => {
    const inputWithoutTitle = { ...input, title: '' };
    expect(quotationPreviewSchema.parse(inputWithoutTitle).title).toBe('Temporary calculation');
    expect(quotationCalculationSchema.safeParse(inputWithoutTitle).success).toBe(false);
  });
});
