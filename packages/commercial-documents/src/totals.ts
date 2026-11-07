import Decimal from 'decimal.js';

// Document totals are recomputed on the server with Decimal. Browser-submitted
// totals are ignored (docs/41 §10).
Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

/**
 * Commercial documents follow the order's currency display policy: target
 * currency amounts use the currency minor unit, except JPY/KRW which have no
 * minor unit. Keep this map aligned with the quotation/PI calculator.
 */
export const DOCUMENT_CURRENCY_SCALE: Record<string, number> = {
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

export function documentCurrencyScale(currency: string): number {
  return DOCUMENT_CURRENCY_SCALE[currency.toUpperCase()] ?? 2;
}

export interface DocumentItemMathInput {
  lineNo?: number;
  sku?: string;
  quantity: string;
  unitPrice: string;
  discountAmount?: string;
  currency?: string;
}

export interface DocumentItemMathResult {
  lineNo: number;
  quantity: string;
  unitPrice: string;
  discountAmount: string;
  lineAmount: string;
}

export interface DocumentTotalsInput {
  currency: string;
  items: DocumentItemMathInput[];
  discountAmount?: string;
  freightAmount?: string;
  insuranceAmount?: string;
  otherCharges?: string;
}

export interface DocumentTotalsResult {
  currency: string;
  scale: number;
  items: DocumentItemMathResult[];
  subtotal: string;
  discountAmount: string;
  freightAmount: string;
  insuranceAmount: string;
  otherCharges: string;
  totalAmount: string;
}

export class DocumentCalculationError extends Error {
  constructor(
    readonly field: string,
    message: string,
  ) {
    super(message);
    this.name = 'DocumentCalculationError';
  }
}

function decimal(value: string | undefined, field: string): Decimal {
  if (value === undefined || value === null || value === '') return new Decimal(0);
  let parsed: Decimal;
  try {
    parsed = new Decimal(value);
  } catch {
    throw new DocumentCalculationError(field, `Invalid decimal value for ${field}.`);
  }
  if (!parsed.isFinite()) {
    throw new DocumentCalculationError(field, `Invalid decimal value for ${field}.`);
  }
  return parsed;
}

/**
 * Recomputes every line and the document total. Each charge is added exactly
 * once, in a fixed order: subtotal - discount + freight + insurance + other.
 */
export function calculateDocumentTotals(input: DocumentTotalsInput): DocumentTotalsResult {
  const currency = input.currency.toUpperCase();
  const scale = documentCurrencyScale(currency);
  if (input.items.length === 0) {
    throw new DocumentCalculationError('items', 'A commercial document needs at least one item.');
  }
  const items: DocumentItemMathResult[] = [];
  let subtotal = new Decimal(0);

  input.items.forEach((item, index) => {
    if (item.currency && item.currency.toUpperCase() !== currency) {
      throw new DocumentCalculationError(
        `items[${index}].currency`,
        'Every item currency must match the document currency.',
      );
    }
    const quantity = decimal(item.quantity, `items[${index}].quantity`);
    const unitPrice = decimal(item.unitPrice, `items[${index}].unitPrice`);
    const lineDiscount = decimal(item.discountAmount, `items[${index}].discountAmount`);
    if (quantity.lte(0)) {
      throw new DocumentCalculationError(
        `items[${index}].quantity`,
        'Quantity must be greater than zero.',
      );
    }
    if (unitPrice.lt(0) || lineDiscount.lt(0)) {
      throw new DocumentCalculationError(
        `items[${index}].unitPrice`,
        'Item prices and discounts cannot be negative.',
      );
    }
    const gross = quantity.times(unitPrice);
    if (lineDiscount.gt(gross)) {
      throw new DocumentCalculationError(
        `items[${index}].discountAmount`,
        'A line discount cannot exceed its line amount.',
      );
    }
    const lineAmount = gross.minus(lineDiscount).toDecimalPlaces(scale, Decimal.ROUND_HALF_UP);
    subtotal = subtotal.plus(lineAmount);
    items.push({
      lineNo: item.lineNo ?? index + 1,
      quantity: quantity.toString(),
      unitPrice: unitPrice.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4),
      discountAmount: lineDiscount.toDecimalPlaces(scale, Decimal.ROUND_HALF_UP).toFixed(scale),
      lineAmount: lineAmount.toFixed(scale),
    });
  });

  const charges = {
    discount: decimal(input.discountAmount, 'discountAmount'),
    freight: decimal(input.freightAmount, 'freightAmount'),
    insurance: decimal(input.insuranceAmount, 'insuranceAmount'),
    other: decimal(input.otherCharges, 'otherCharges'),
  };
  for (const [field, value] of Object.entries(charges)) {
    if (value.lt(0)) {
      throw new DocumentCalculationError(field, 'Charges cannot be negative.');
    }
  }

  const roundedSubtotal = subtotal.toDecimalPlaces(scale, Decimal.ROUND_HALF_UP);
  const total = roundedSubtotal
    .minus(charges.discount)
    .plus(charges.freight)
    .plus(charges.insurance)
    .plus(charges.other)
    .toDecimalPlaces(scale, Decimal.ROUND_HALF_UP);
  if (total.lt(0)) {
    throw new DocumentCalculationError(
      'totalAmount',
      'The discount exceeds the document total.',
    );
  }

  const round = (value: Decimal) => value.toDecimalPlaces(scale, Decimal.ROUND_HALF_UP).toFixed(scale);
  return {
    currency,
    scale,
    items,
    subtotal: round(roundedSubtotal),
    discountAmount: round(charges.discount),
    freightAmount: round(charges.freight),
    insuranceAmount: round(charges.insurance),
    otherCharges: round(charges.other),
    totalAmount: total.toFixed(scale),
  };
}

export function formatDocumentAmount(amount: string | number | undefined, scale = 2): string {
  if (amount === undefined || amount === null || amount === '') return '';
  try {
    return new Decimal(amount).toFixed(scale);
  } catch {
    return String(amount);
  }
}
