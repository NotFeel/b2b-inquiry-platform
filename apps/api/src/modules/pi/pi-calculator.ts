import { ERROR_CODES } from '@b2b/contracts';
import Decimal from 'decimal.js';
import { ApiError } from '../../common/errors/api-error';

// Money is computed with Decimal only. Quantities and prices keep their own
// scale, and totals are rounded once, half-up, at the currency scale
// (docs/08 §5.2).
Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

export const CURRENCY_SCALE: Record<string, number> = {
  USD: 2,
  EUR: 2,
  GBP: 2,
  CNY: 2,
  JPY: 0,
  AUD: 2,
  CAD: 2,
  AED: 2,
  SGD: 2,
  HKD: 2,
  KRW: 0,
};

export interface PiLineInput {
  sku: string;
  quantity: string;
  unitPrice: string;
  discountAmount?: string;
}

export interface PiLineResult {
  sku: string;
  quantity: string;
  unitPrice: string;
  discountAmount: string;
  lineAmount: string;
}

export interface PiTotalsInput {
  currency: string;
  lines: PiLineInput[];
  discountAmount?: string;
  freightAmount?: string;
  insuranceAmount?: string;
  otherCharges?: string;
}

export interface PiTotalsResult {
  currency: string;
  scale: number;
  lines: PiLineResult[];
  subtotal: string;
  discountAmount: string;
  freightAmount: string;
  insuranceAmount: string;
  otherCharges: string;
  totalAmount: string;
}

export function currencyScale(currency: string): number {
  return CURRENCY_SCALE[currency.toUpperCase()] ?? 2;
}

function toDecimal(value: string | number | undefined | null, field: string): Decimal {
  try {
    const decimal = new Decimal(value ?? 0);
    if (!decimal.isFinite()) throw new Error('not finite');
    return decimal;
  } catch {
    throw ApiError.validation(`Invalid numeric value for ${field}.`, { [field]: 'validation.decimal.invalid' });
  }
}

/**
 * Recomputes every line and the document total on the server. Client-supplied
 * totals are never trusted (docs/01 §3.12, docs/08 §5.2).
 */
export function calculatePiTotals(input: PiTotalsInput): PiTotalsResult {
  const scale = currencyScale(input.currency);
  const lines: PiLineResult[] = [];
  let subtotal = new Decimal(0);

  input.lines.forEach((line, index) => {
    const quantity = toDecimal(line.quantity, `items[${index}].quantity`);
    const unitPrice = toDecimal(line.unitPrice, `items[${index}].unitPrice`);
    const lineDiscount = toDecimal(line.discountAmount ?? '0', `items[${index}].discountAmount`);
    if (quantity.lte(0)) {
      throw ApiError.validation('Quantity must be greater than zero.', {
        [`items[${index}].quantity`]: 'validation.decimal.negative',
      });
    }
    if (unitPrice.lt(0) || lineDiscount.lt(0)) {
      throw ApiError.validation('Amounts cannot be negative.', {
        [`items[${index}].unitPrice`]: 'validation.decimal.negative',
      });
    }
    const gross = quantity.times(unitPrice);
    if (lineDiscount.gt(gross)) {
      throw ApiError.validation('A line discount cannot exceed the line amount.', {
        [`items[${index}].discountAmount`]: 'validation.pi.discountExceedsLine',
      });
    }
    const lineAmount = gross.minus(lineDiscount).toDecimalPlaces(scale, Decimal.ROUND_HALF_UP);
    subtotal = subtotal.plus(lineAmount);
    lines.push({
      sku: line.sku,
      quantity: quantity.toString(),
      unitPrice: unitPrice.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toString(),
      discountAmount: lineDiscount.toDecimalPlaces(scale, Decimal.ROUND_HALF_UP).toString(),
      lineAmount: lineAmount.toString(),
    });
  });

  const documentDiscount = toDecimal(input.discountAmount ?? '0', 'discountAmount');
  const freight = toDecimal(input.freightAmount ?? '0', 'freightAmount');
  const insurance = toDecimal(input.insuranceAmount ?? '0', 'insuranceAmount');
  const other = toDecimal(input.otherCharges ?? '0', 'otherCharges');
  for (const [field, value] of Object.entries({ documentDiscount, freight, insurance, other })) {
    if (value.lt(0)) {
      throw ApiError.validation('Amounts cannot be negative.', { [field]: 'validation.decimal.negative' });
    }
  }

  const roundedSubtotal = subtotal.toDecimalPlaces(scale, Decimal.ROUND_HALF_UP);
  const total = roundedSubtotal
    .minus(documentDiscount)
    .plus(freight)
    .plus(insurance)
    .plus(other)
    .toDecimalPlaces(scale, Decimal.ROUND_HALF_UP);

  if (total.lt(0)) {
    throw new ApiError(ERROR_CODES.piCurrencyMismatch, 'The discount exceeds the document total.');
  }

  return {
    currency: input.currency.toUpperCase(),
    scale,
    lines,
    subtotal: roundedSubtotal.toString(),
    discountAmount: documentDiscount.toDecimalPlaces(scale, Decimal.ROUND_HALF_UP).toString(),
    freightAmount: freight.toDecimalPlaces(scale, Decimal.ROUND_HALF_UP).toString(),
    insuranceAmount: insurance.toDecimalPlaces(scale, Decimal.ROUND_HALF_UP).toString(),
    otherCharges: other.toDecimalPlaces(scale, Decimal.ROUND_HALF_UP).toString(),
    totalAmount: total.toString(),
  };
}

export function formatPiAmount(amount: string, scale: number): string {
  return new Decimal(amount).toFixed(scale);
}
