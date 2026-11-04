import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import {
  calculateQuotation,
  QuotationEngineError,
  type QuotationEngineInput,
} from './quotation-engine';

const base: QuotationEngineInput = {
  currencyCode: 'USD',
  exchangeRate: '0.1380',
  freightCurrencyCode: 'CNY',
  freightBillingMethod: 'KG',
  cbmRatePerCbm: '100',
  kgRatePerKg: '10',
  volumetricDivisor: 6000,
  deliveryFeeCny: '0',
  fees: [],
  requirePackaging: true,
  items: [
    {
      productId: 'p1',
      sku: 'A-1',
      productName: 'Item A',
      description: null,
      costCny: '5',
      quantity: '100',
      markupPercent: '20',
      cartonCount: 2,
      unitsPerCarton: 50,
      cartonLengthCm: '40',
      cartonWidthCm: '30',
      cartonHeightCm: '30',
      cartonGrossWeightKg: '8',
    },
    {
      productId: 'p2',
      sku: 'B-2',
      productName: 'Item B',
      description: null,
      costCny: '10',
      quantity: '10',
      markupPercent: '0',
      cartonCount: 1,
      unitsPerCarton: 10,
      cartonLengthCm: '30',
      cartonWidthCm: '20',
      cartonHeightCm: '20',
      cartonGrossWeightKg: '4',
    },
  ],
};

describe('quotation Decimal calculation engine', () => {
  it('calculates item prices, chargeable weight and freight allocation by gross weight', () => {
    const result = calculateQuotation(base);
    expect(result.items[0]?.unitSalePriceCny).toBe('6.00000000');
    expect(result.items[0]?.lineAmountCny).toBe('600.00000000');
    expect(result.totals.volumeWeightKg).toBe('14.000000000000');
    expect(result.totals.grossWeightKg).toBe('20.000000000000');
    expect(result.totals.chargeableWeightKg).toBe('20.000000000000');
    expect(result.freight.kgFreightAmount).toBe('200.00');
    expect(result.freight.orderTotalCbm).toBe('0.084000000000000');
    expect(result.totals.freightCny).toBe('200.00000000');
    expect(
      result.items
        .reduce((sum, item) => sum.plus(item.allocatedFreightCny), new Decimal(0))
        .toString(),
    ).toBe('200');
  });

  it('uses volume when greater and makes the final allocation absorb the tail', () => {
    const result = calculateQuotation({
      ...base,
      kgRatePerKg: '5',
      items: base.items.map((item) => ({ ...item, cartonGrossWeightKg: '0.1' })),
    });
    expect(result.totals.chargeableWeightKg).toBe('14.000000000000');
    expect(
      new Decimal(result.items[0]!.allocatedFreightCny)
        .plus(result.items[1]!.allocatedFreightCny)
        .toString(),
    ).toBe('70');
  });

  it('converts the grand total once and assigns foreign currency tail to the last component', () => {
    const result = calculateQuotation({
      ...base,
      exchangeRate: '0.1380001',
      items: [base.items[0]!],
    });
    expect(result.totals.totalAmountForeign).toBe('104.89');
    expect(result.fees[0]?.amountForeign).toBe('22.08');
    expect(result.items[0]?.lineAmountForeign).toBe('82.81');
  });

  it('rejects partial packaging, invalid rates and missing formal packaging', () => {
    expect(() =>
      calculateQuotation({ ...base, items: [{ ...base.items[0]!, cartonHeightCm: null }] }),
    ).toThrow(new QuotationEngineError('INVALID_PACKAGING', 'dimensions', 1));
    expect(() => calculateQuotation({ ...base, exchangeRate: '1e-2' })).toThrow(
      QuotationEngineError,
    );
    expect(() =>
      calculateQuotation({ ...base, items: [{ ...base.items[0]!, cartonCount: null }] }),
    ).toThrow(new QuotationEngineError('PACKAGING_REQUIRED', 'packaging', 1));
  });

  it('does not divide by zero for zero freight and zero weights', () => {
    const result = calculateQuotation({
      ...base,
      cbmRatePerCbm: '1',
      kgRatePerKg: '1',
      items: base.items.map((item) => ({
        ...item,
        cartonCount: 1,
        cartonGrossWeightKg: '0.000001',
        cartonLengthCm: '0.001',
        cartonWidthCm: '0.001',
        cartonHeightCm: '0.001',
      })),
    });
    expect(result.items.every((item) => item.allocatedFreightCny === '0.00000000')).toBe(true);
  });
});
