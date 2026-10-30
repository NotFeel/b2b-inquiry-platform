import { QUOTATION_EXPORT_CURRENCIES, type QuotationExportCurrency } from '@b2b/contracts';
import Decimal from 'decimal.js';

Decimal.set({ precision: 40, rounding: Decimal.ROUND_CEIL });

const PLAIN_DECIMAL = /^\d+(?:\.\d+)?$/;

export type QuotationCalculationErrorCode =
  | 'INVALID_COST'
  | 'INVALID_MARKUP'
  | 'INVALID_EXCHANGE_RATE'
  | 'INVALID_CURRENCY'
  | 'CNY_RATE_MUST_BE_ONE';

export class QuotationCalculationError extends Error {
  constructor(
    readonly code: QuotationCalculationErrorCode,
    readonly field: string,
  ) {
    super(code);
    this.name = 'QuotationCalculationError';
  }
}

export interface QuotationUnitPriceInput {
  costCny: string;
  markupPercent: string;
  exchangeRate: string;
}

function parsePlainDecimal(value: string, field: string): Decimal {
  if (!PLAIN_DECIMAL.test(value)) {
    throw new QuotationCalculationError(
      field === 'costCny'
        ? 'INVALID_COST'
        : field === 'markupPercent'
          ? 'INVALID_MARKUP'
          : 'INVALID_EXCHANGE_RATE',
      field,
    );
  }
  try {
    const parsed = new Decimal(value);
    if (!parsed.isFinite()) throw new Error('not finite');
    return parsed;
  } catch {
    throw new QuotationCalculationError(
      field === 'costCny'
        ? 'INVALID_COST'
        : field === 'markupPercent'
          ? 'INVALID_MARKUP'
          : 'INVALID_EXCHANGE_RATE',
      field,
    );
  }
}

export function assertQuotationCurrency(
  currencyCode: string,
): asserts currencyCode is QuotationExportCurrency {
  if (!(QUOTATION_EXPORT_CURRENCIES as readonly string[]).includes(currencyCode)) {
    throw new QuotationCalculationError('INVALID_CURRENCY', 'currencyCode');
  }
}

/**
 * Applies the fixed direction `1 CNY = X target currency` and rounds only the
 * final amount upward to two decimals. Every supported currency, including JPY,
 * uses two decimals in this quotation format (docs/36 §4).
 */
export function calculateQuotationUnitPrice(input: QuotationUnitPriceInput): string {
  const cost = parsePlainDecimal(input.costCny, 'costCny');
  const markup = parsePlainDecimal(input.markupPercent, 'markupPercent');
  const rate = parsePlainDecimal(input.exchangeRate, 'exchangeRate');

  if (cost.lte(0) || cost.decimalPlaces() > 14 || cost.gt('1000000000000000')) {
    throw new QuotationCalculationError('INVALID_COST', 'costCny');
  }
  if (markup.lt(0) || markup.gt(500) || markup.decimalPlaces() > 2) {
    throw new QuotationCalculationError('INVALID_MARKUP', 'markupPercent');
  }
  if (rate.lte(0) || rate.decimalPlaces() > 10 || rate.gt('1000000000000')) {
    throw new QuotationCalculationError('INVALID_EXCHANGE_RATE', 'exchangeRate');
  }

  return cost
    .times(new Decimal(1).plus(markup.dividedBy(100)))
    .times(rate)
    .toDecimalPlaces(2, Decimal.ROUND_CEIL)
    .toFixed(2);
}

export function assertQuotationExchangeRate(currencyCode: string, exchangeRate: string): void {
  assertQuotationCurrency(currencyCode);
  const rate = parsePlainDecimal(exchangeRate, 'exchangeRate');
  if (rate.lte(0) || rate.decimalPlaces() > 10) {
    throw new QuotationCalculationError('INVALID_EXCHANGE_RATE', 'exchangeRate');
  }
  if (currencyCode === 'CNY' && !rate.equals(1)) {
    throw new QuotationCalculationError('CNY_RATE_MUST_BE_ONE', 'exchangeRate');
  }
}
