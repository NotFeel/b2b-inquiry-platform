import { describe, expect, it } from 'vitest';
import {
  QuotationCalculationError,
  assertQuotationExchangeRate,
  calculateQuotationUnitPrice,
} from './quotation-calculator';

describe('calculateQuotationUnitPrice', () => {
  it.each([
    ['4.25120405', '0', '1', '4.26'],
    ['4.35', '0', '1', '4.35'],
    ['0.051021', '0', '1', '0.06'],
    ['100', '15', '0.1385', '15.93'],
    ['100', '0', '0.1385', '13.85'],
    ['100', '15', '1', '115.00'],
    ['0.000001', '0', '1', '0.01'],
  ])('calculates cost=%s markup=%s rate=%s', (costCny, markupPercent, exchangeRate, expected) => {
    expect(calculateQuotationUnitPrice({ costCny, markupPercent, exchangeRate })).toBe(expected);
  });

  it.each(['0', '-1', 'NaN', 'Infinity', '1e2', '1.123456789012345'])(
    'rejects invalid cost %s',
    (costCny) => {
      expect(() =>
        calculateQuotationUnitPrice({ costCny, markupPercent: '15', exchangeRate: '1' }),
      ).toThrow(QuotationCalculationError);
    },
  );

  it.each(['-0.01', '500.01', '1.234', 'NaN', 'Infinity', '1e1'])(
    'rejects invalid markup %s',
    (markupPercent) => {
      expect(() =>
        calculateQuotationUnitPrice({ costCny: '1', markupPercent, exchangeRate: '1' }),
      ).toThrow(QuotationCalculationError);
    },
  );

  it.each(['0', '-1', 'NaN', 'Infinity', '1e-2', '0.00000000001'])(
    'rejects invalid exchange rate %s',
    (exchangeRate) => {
      expect(() =>
        calculateQuotationUnitPrice({ costCny: '1', markupPercent: '15', exchangeRate }),
      ).toThrow(QuotationCalculationError);
    },
  );
});

describe('assertQuotationExchangeRate', () => {
  it('allows a valid non-CNY rate', () => {
    expect(() => assertQuotationExchangeRate('USD', '0.1385')).not.toThrow();
  });

  it('requires CNY to use exactly one', () => {
    expect(() => assertQuotationExchangeRate('CNY', '1')).not.toThrow();
    expect(() => assertQuotationExchangeRate('CNY', '1.01')).toThrow(
      new QuotationCalculationError('CNY_RATE_MUST_BE_ONE', 'exchangeRate'),
    );
  });

  it('rejects a currency outside the server allow-list', () => {
    expect(() => assertQuotationExchangeRate('BTC', '1')).toThrow(QuotationCalculationError);
  });
});
