import Decimal from 'decimal.js';

const MONEY_SCALE = 8;
const CURRENCY_SCALE = 2;
const WEIGHT_SCALE = 12;
const CBM_SCALE = 15;

export type FreightBillingMethod = 'CBM' | 'KG';
export type KgChargeableBasis = 'VOLUME_WEIGHT' | 'GROSS_WEIGHT';

export type QuotationEngineItemInput = {
  productId: string;
  sku: string;
  productName: string;
  description: string | null;
  costCny: string;
  /** Legacy internal callers may still send this; calculation ignores it. */
  quantity?: string;
  markupPercent: string;
  cartonCount: number | null;
  unitsPerCarton: number | null;
  cartonLengthCm: string | null;
  cartonWidthCm: string | null;
  cartonHeightCm: string | null;
  cartonGrossWeightKg: string | null;
};

export type QuotationEngineInput = {
  currencyCode: string;
  exchangeRate: string;
  freightCurrencyCode: 'CNY';
  freightBillingMethod: FreightBillingMethod;
  cbmRatePerCbm: string;
  kgRatePerKg: string;
  volumetricDivisor: number;
  deliveryFeeCny: string;
  fees: { typeCode: string; name: string; amountCny: string; notes: string | null }[];
  items: QuotationEngineItemInput[];
  requirePackaging: boolean;
};

export class QuotationEngineError extends Error {
  constructor(
    readonly code:
      | 'INVALID_DECIMAL'
      | 'INVALID_RATE'
      | 'INVALID_PACKAGING'
      | 'PACKAGING_REQUIRED'
      | 'INVALID_FREIGHT_CURRENCY'
      | 'INVALID_DIVISOR'
      | 'FREIGHT_ALLOCATION_UNAVAILABLE',
    readonly field?: string,
    readonly lineNo?: number,
  ) {
    super(code);
    this.name = 'QuotationEngineError';
  }
}

function decimal(value: string, field: string, lineNo?: number): Decimal {
  if (!/^\d+(?:\.\d+)?$/.test(value)) {
    throw new QuotationEngineError('INVALID_DECIMAL', field, lineNo);
  }
  const parsed = new Decimal(value);
  if (!parsed.isFinite() || parsed.isNegative()) {
    throw new QuotationEngineError('INVALID_DECIMAL', field, lineNo);
  }
  return parsed;
}

function fixed(
  value: Decimal,
  scale: number,
  rounding: Decimal.Rounding = Decimal.ROUND_HALF_UP,
): string {
  return value.toDecimalPlaces(scale, rounding).toFixed(scale);
}

function allocate(total: Decimal, weights: Decimal[], scale: number): Decimal[] {
  if (weights.length === 0) return [];
  const weightTotal = weights.reduce((sum, weight) => sum.plus(weight), new Decimal(0));
  if (weightTotal.isZero()) {
    if (total.isZero()) return weights.map(() => new Decimal(0));
    throw new QuotationEngineError('FREIGHT_ALLOCATION_UNAVAILABLE', 'freightAllocation');
  }

  let allocated = new Decimal(0);
  return weights.map((weight, index) => {
    if (index === weights.length - 1) return total.minus(allocated);
    const amount = total
      .times(weight)
      .div(weightTotal)
      .toDecimalPlaces(scale, Decimal.ROUND_HALF_UP);
    allocated = allocated.plus(amount);
    return amount;
  });
}

export function calculateQuotation(input: QuotationEngineInput) {
  if (input.freightCurrencyCode !== 'CNY') {
    throw new QuotationEngineError('INVALID_FREIGHT_CURRENCY', 'freightCurrencyCode');
  }
  if (!Number.isSafeInteger(input.volumetricDivisor) || input.volumetricDivisor <= 0) {
    throw new QuotationEngineError('INVALID_DIVISOR', 'volumetricDivisor');
  }

  const exchangeRate = decimal(input.exchangeRate, 'exchangeRate');
  const cbmRate = decimal(input.cbmRatePerCbm, 'cbmRatePerCbm');
  const kgRate = decimal(input.kgRatePerKg, 'kgRatePerKg');
  const deliveryFeeCny = decimal(input.deliveryFeeCny, 'deliveryFeeCny');
  if (exchangeRate.isZero()) throw new QuotationEngineError('INVALID_RATE', 'exchangeRate');
  if (cbmRate.isZero()) throw new QuotationEngineError('INVALID_RATE', 'cbmRatePerCbm');
  if (kgRate.isZero()) throw new QuotationEngineError('INVALID_RATE', 'kgRatePerKg');

  const items = input.items.map((source, index) => {
    const lineNo = index + 1;
    const cost = decimal(source.costCny, 'costCny', lineNo);
    const markup = decimal(source.markupPercent, 'markupPercent', lineNo);
    if (markup.gt(500)) throw new QuotationEngineError('INVALID_DECIMAL', 'markupPercent', lineNo);

    if (source.cartonCount === null) {
      throw new QuotationEngineError('PACKAGING_REQUIRED', 'packaging', lineNo);
    }
    if (
      !Number.isSafeInteger(source.cartonCount) ||
      source.cartonCount <= 0 ||
      source.cartonCount > 100_000
    ) {
      throw new QuotationEngineError('INVALID_PACKAGING', 'cartonCount', lineNo);
    }
    if (source.unitsPerCarton === null) {
      throw new QuotationEngineError('PACKAGING_REQUIRED', 'unitsPerCarton', lineNo);
    }
    if (
      !Number.isSafeInteger(source.unitsPerCarton) ||
      source.unitsPerCarton <= 0 ||
      source.unitsPerCarton > 1_000_000
    ) {
      throw new QuotationEngineError('INVALID_PACKAGING', 'unitsPerCarton', lineNo);
    }
    const quantity = new Decimal(source.cartonCount).times(source.unitsPerCarton);

    const unitSalePrice = cost
      .times(new Decimal(1).plus(markup.div(100)))
      .toDecimalPlaces(MONEY_SCALE, Decimal.ROUND_HALF_UP);
    const lineAmount = unitSalePrice
      .times(quantity)
      .toDecimalPlaces(MONEY_SCALE, Decimal.ROUND_HALF_UP);
    const unitSalePriceForeign = unitSalePrice
      .times(exchangeRate)
      .toDecimalPlaces(CURRENCY_SCALE, Decimal.ROUND_CEIL);
    const lineAmountForeign = unitSalePriceForeign
      .times(quantity)
      .toDecimalPlaces(CURRENCY_SCALE, Decimal.ROUND_HALF_UP);

    const dimensions = [source.cartonLengthCm, source.cartonWidthCm, source.cartonHeightCm];
    const hasAnyDimension = dimensions.some((value) => value !== null);
    const hasAllDimensions = dimensions.every((value) => value !== null);
    if (hasAnyDimension !== hasAllDimensions) {
      throw new QuotationEngineError('INVALID_PACKAGING', 'dimensions', lineNo);
    }

    const packagingRequested = input.requirePackaging;
    if (packagingRequested && (!source.cartonGrossWeightKg || !hasAllDimensions)) {
      throw new QuotationEngineError('PACKAGING_REQUIRED', 'packaging', lineNo);
    }

    const dimensionsDecimal = hasAllDimensions
      ? dimensions.map((value) => decimal(value!, 'dimensions', lineNo))
      : null;
    if (dimensionsDecimal?.some((value) => value.isZero())) {
      throw new QuotationEngineError('INVALID_PACKAGING', 'dimensions', lineNo);
    }
    const cartonWeight =
      source.cartonGrossWeightKg === null
        ? new Decimal(0)
        : decimal(source.cartonGrossWeightKg, 'cartonGrossWeightKg', lineNo);
    if (packagingRequested && cartonWeight.isZero()) {
      throw new QuotationEngineError('PACKAGING_REQUIRED', 'cartonGrossWeightKg', lineNo);
    }

    const cartonCount = source.cartonCount;
    const cartonVolume = dimensionsDecimal
      ? dimensionsDecimal[0]!
          .times(dimensionsDecimal[1]!)
          .times(dimensionsDecimal[2]!)
          .div(1_000_000)
      : new Decimal(0);
    const totalCbm = cartonVolume.times(cartonCount);
    const cartonVolumeWeight = dimensionsDecimal
      ? dimensionsDecimal[0]!
          .times(dimensionsDecimal[1]!)
          .times(dimensionsDecimal[2]!)
          .div(input.volumetricDivisor)
      : new Decimal(0);
    const totalVolumeWeight = cartonVolumeWeight.times(cartonCount);
    const totalGrossWeight = cartonWeight.times(cartonCount);

    return {
      lineNo,
      productId: source.productId,
      sku: source.sku,
      productName: source.productName,
      description: source.description,
      costCny: fixed(cost, 4),
      markupPercent: fixed(markup, 4),
      quantity: fixed(quantity, 3),
      unitSalePriceCny: fixed(unitSalePrice, MONEY_SCALE),
      lineAmountCny: fixed(lineAmount, MONEY_SCALE),
      cartonCount: source.cartonCount,
      unitsPerCarton: source.unitsPerCarton,
      cartonLengthCm: dimensions[0],
      cartonWidthCm: dimensions[1],
      cartonHeightCm: dimensions[2],
      cartonGrossWeightKg: source.cartonGrossWeightKg,
      cartonVolumeCbm: fixed(cartonVolume, CBM_SCALE),
      cartonVolumeWeightKg: fixed(cartonVolumeWeight, WEIGHT_SCALE),
      totalCbm: fixed(totalCbm, CBM_SCALE),
      totalVolumeWeightKg: fixed(totalVolumeWeight, WEIGHT_SCALE),
      totalGrossWeightKg: fixed(totalGrossWeight, WEIGHT_SCALE),
      freightAllocationBasis: '0',
      allocatedFreightCny: '0.00000000',
      allocatedFreightForeign: '0.00',
      unitSalePriceForeign: fixed(unitSalePriceForeign, CURRENCY_SCALE),
      lineAmountForeign: fixed(lineAmountForeign, CURRENCY_SCALE),
      packaging: {
        cartonCount: source.cartonCount,
        unitsPerCarton: source.unitsPerCarton,
        cartonLengthCm: source.cartonLengthCm,
        cartonWidthCm: source.cartonWidthCm,
        cartonHeightCm: source.cartonHeightCm,
        cartonGrossWeightKg: source.cartonGrossWeightKg,
        cartonVolumeCbm: fixed(cartonVolume, CBM_SCALE),
        cartonVolumeWeightKg: fixed(cartonVolumeWeight, WEIGHT_SCALE),
        totalCbm: fixed(totalCbm, CBM_SCALE),
        volumetricDivisor: input.volumetricDivisor,
      },
      _lineAmount: lineAmount,
      _lineAmountForeign: lineAmountForeign,
      _totalCbm: totalCbm,
      _totalVolumeWeight: totalVolumeWeight,
      _totalGrossWeight: totalGrossWeight,
    };
  });

  const totalCbm = items.reduce((sum, item) => sum.plus(item._totalCbm), new Decimal(0));
  const totalVolumeWeight = items.reduce(
    (sum, item) => sum.plus(item._totalVolumeWeight),
    new Decimal(0),
  );
  const totalGrossWeight = items.reduce(
    (sum, item) => sum.plus(item._totalGrossWeight),
    new Decimal(0),
  );
  const kgChargeableBasis: KgChargeableBasis = totalVolumeWeight.gte(totalGrossWeight)
    ? 'VOLUME_WEIGHT'
    : 'GROSS_WEIGHT';
  const chargeableWeight = Decimal.max(totalVolumeWeight, totalGrossWeight);
  const cbmFreightAmount = totalCbm
    .times(cbmRate)
    .toDecimalPlaces(CURRENCY_SCALE, Decimal.ROUND_CEIL);
  const kgFreightAmount = chargeableWeight
    .times(kgRate)
    .toDecimalPlaces(CURRENCY_SCALE, Decimal.ROUND_HALF_UP);
  const cbmFreightAmountForeign = cbmFreightAmount
    .times(exchangeRate)
    .toDecimalPlaces(CURRENCY_SCALE, Decimal.ROUND_CEIL);
  const kgFreightAmountForeign = kgFreightAmount
    .times(exchangeRate)
    .toDecimalPlaces(CURRENCY_SCALE, Decimal.ROUND_HALF_UP);
  const selectedFreightAmount =
    input.freightBillingMethod === 'CBM' ? cbmFreightAmount : kgFreightAmount;
  const selectedFreightForeign =
    input.freightBillingMethod === 'CBM'
      ? cbmFreightAmountForeign
      : selectedFreightAmount
          .times(exchangeRate)
          .toDecimalPlaces(CURRENCY_SCALE, Decimal.ROUND_HALF_UP);
  const freightCny = selectedFreightAmount.toDecimalPlaces(MONEY_SCALE, Decimal.ROUND_HALF_UP);

  const allocationWeights = items.map((item) => {
    if (input.freightBillingMethod === 'CBM') return item._totalCbm;
    return kgChargeableBasis === 'VOLUME_WEIGHT' ? item._totalVolumeWeight : item._totalGrossWeight;
  });
  const foreignFreightAllocations = allocate(
    selectedFreightForeign,
    allocationWeights,
    CURRENCY_SCALE,
  );
  const cnyFreightAllocations = allocate(freightCny, allocationWeights, MONEY_SCALE);

  items.forEach((item, index) => {
    item.freightAllocationBasis = fixed(allocationWeights[index]!, CBM_SCALE);
    item.allocatedFreightCny = fixed(cnyFreightAllocations[index]!, MONEY_SCALE);
    item.allocatedFreightForeign = fixed(foreignFreightAllocations[index]!, CURRENCY_SCALE);
  });

  const subtotalCny = items.reduce((sum, item) => sum.plus(item._lineAmount), new Decimal(0));
  const feeInputs = input.fees.map((fee) => ({
    ...fee,
    amount: decimal(fee.amountCny, 'amountCny'),
  }));
  const otherFeesCny = feeInputs.reduce((sum, fee) => sum.plus(fee.amount), new Decimal(0));
  const totalAmountCny = subtotalCny.plus(freightCny).plus(deliveryFeeCny).plus(otherFeesCny);
  const nonFreightCny = deliveryFeeCny.plus(otherFeesCny);
  const nonFreightForeignExact = nonFreightCny.times(exchangeRate);
  const nonFreightForeign = nonFreightForeignExact.toDecimalPlaces(
    CURRENCY_SCALE,
    Decimal.ROUND_CEIL,
  );
  const nonFreightForeignAllocations = allocate(
    nonFreightForeign,
    [deliveryFeeCny, ...feeInputs.map((fee) => fee.amount)],
    CURRENCY_SCALE,
  );
  const deliveryForeign = fixed(nonFreightForeignAllocations[0] ?? new Decimal(0), CURRENCY_SCALE);
  const fees = feeInputs.map((fee, index) => {
    const amountForeign = nonFreightForeignAllocations[index + 1] ?? new Decimal(0);
    return {
      typeCode: fee.typeCode,
      name: fee.name,
      amountCny: fixed(fee.amount, MONEY_SCALE),
      amountForeign: fixed(amountForeign, CURRENCY_SCALE),
      isFreight: false,
      notes: fee.notes,
    };
  });
  const subtotalForeign = items.reduce(
    (sum, item) => sum.plus(item._lineAmountForeign),
    new Decimal(0),
  );
  const totalAmountForeignExact = subtotalForeign
    .plus(selectedFreightAmount.times(exchangeRate))
    .plus(nonFreightForeignExact);
  const totalAmountForeign = subtotalForeign.plus(selectedFreightForeign).plus(nonFreightForeign);
  items.forEach((item, index) => {
    item.allocatedFreightForeign = fixed(foreignFreightAllocations[index]!, CURRENCY_SCALE);
  });
  const freightForeign = fixed(selectedFreightForeign, CURRENCY_SCALE);

  return {
    items: items.map(
      ({
        _lineAmount: _line,
        _lineAmountForeign: _lineForeign,
        _totalCbm: _cbm,
        _totalVolumeWeight: _volume,
        _totalGrossWeight: _gross,
        ...item
      }) => item,
    ),
    fees: [
      {
        typeCode: 'freight',
        name: 'Freight',
        amountCny: fixed(freightCny, MONEY_SCALE),
        amountForeign: freightForeign,
        isFreight: true,
        notes: null,
      },
      {
        typeCode: 'delivery',
        name: 'Delivery',
        amountCny: fixed(deliveryFeeCny, MONEY_SCALE),
        amountForeign: deliveryForeign,
        isFreight: false,
        notes: null,
      },
      ...fees,
    ],
    freight: {
      freightBillingMethod: input.freightBillingMethod,
      freightCurrencyCode: input.freightCurrencyCode,
      cbmRatePerCbm: fixed(cbmRate, MONEY_SCALE),
      orderTotalCbm: fixed(totalCbm, CBM_SCALE),
      cbmFreightAmount: fixed(cbmFreightAmount, CURRENCY_SCALE),
      cbmFreightAmountForeign: fixed(cbmFreightAmountForeign, CURRENCY_SCALE),
      kgRatePerKg: fixed(kgRate, MONEY_SCALE),
      volumetricDivisor: input.volumetricDivisor,
      orderTotalVolumeWeightKg: fixed(totalVolumeWeight, WEIGHT_SCALE),
      orderTotalGrossWeightKg: fixed(totalGrossWeight, WEIGHT_SCALE),
      chargeableWeightKg: fixed(chargeableWeight, WEIGHT_SCALE),
      kgChargeableBasis,
      kgFreightAmount: fixed(kgFreightAmount, CURRENCY_SCALE),
      kgFreightAmountForeign: fixed(kgFreightAmountForeign, CURRENCY_SCALE),
      selectedFreightAmount: fixed(selectedFreightAmount, CURRENCY_SCALE),
      selectedFreightAmountForeign: freightForeign,
      allocationSnapshot: items.map((item) => ({
        lineNo: item.lineNo,
        basis: item.freightAllocationBasis,
        allocatedFreightAmount: item.allocatedFreightCny,
        allocatedFreightCny: item.allocatedFreightCny,
        allocatedFreightForeign: item.allocatedFreightForeign,
      })),
    },
    totals: {
      subtotalCny: fixed(subtotalCny, MONEY_SCALE),
      freightCny: fixed(freightCny, MONEY_SCALE),
      deliveryFeeCny: fixed(deliveryFeeCny, MONEY_SCALE),
      otherFeesCny: fixed(otherFeesCny, MONEY_SCALE),
      totalAmountCny: fixed(totalAmountCny, MONEY_SCALE),
      totalAmountForeignExact: fixed(totalAmountForeignExact, 12),
      totalAmountForeign: fixed(totalAmountForeign, CURRENCY_SCALE, Decimal.ROUND_UP),
      orderTotalCbm: fixed(totalCbm, CBM_SCALE),
      volumeWeightKg: fixed(totalVolumeWeight, WEIGHT_SCALE),
      grossWeightKg: fixed(totalGrossWeight, WEIGHT_SCALE),
      chargeableWeightKg: fixed(chargeableWeight, WEIGHT_SCALE),
      selectedFreightAmount: fixed(selectedFreightAmount, CURRENCY_SCALE),
    },
  };
}
