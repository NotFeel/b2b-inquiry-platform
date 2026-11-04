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
  quantity: string;
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
    const quantity = decimal(source.quantity, 'quantity', lineNo);
    const cost = decimal(source.costCny, 'costCny', lineNo);
    const markup = decimal(source.markupPercent, 'markupPercent', lineNo);
    if (quantity.isZero()) throw new QuotationEngineError('INVALID_DECIMAL', 'quantity', lineNo);
    if (markup.gt(500)) throw new QuotationEngineError('INVALID_DECIMAL', 'markupPercent', lineNo);
    const unitSalePrice = cost
      .times(new Decimal(1).plus(markup.div(100)))
      .toDecimalPlaces(MONEY_SCALE, Decimal.ROUND_HALF_UP);
    const lineAmount = unitSalePrice
      .times(quantity)
      .toDecimalPlaces(MONEY_SCALE, Decimal.ROUND_HALF_UP);

    const dimensions = [source.cartonLengthCm, source.cartonWidthCm, source.cartonHeightCm];
    const hasAnyDimension = dimensions.some((value) => value !== null);
    const hasAllDimensions = dimensions.every((value) => value !== null);
    if (hasAnyDimension !== hasAllDimensions) {
      throw new QuotationEngineError('INVALID_PACKAGING', 'dimensions', lineNo);
    }

    const packagingRequested = input.requirePackaging;
    if (
      packagingRequested &&
      (!source.cartonCount || !source.cartonGrossWeightKg || !hasAllDimensions)
    ) {
      throw new QuotationEngineError('PACKAGING_REQUIRED', 'packaging', lineNo);
    }
    if (
      source.cartonCount !== null &&
      (!Number.isSafeInteger(source.cartonCount) ||
        source.cartonCount <= 0 ||
        source.cartonCount > 100_000)
    ) {
      throw new QuotationEngineError('INVALID_PACKAGING', 'cartonCount', lineNo);
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

    const cartonCount = source.cartonCount ?? 0;
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
      unitSalePriceForeign: fixed(unitSalePrice.times(exchangeRate), MONEY_SCALE),
      lineAmountForeign: '0.00',
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
    .toDecimalPlaces(CURRENCY_SCALE, Decimal.ROUND_HALF_UP);
  const kgFreightAmount = chargeableWeight
    .times(kgRate)
    .toDecimalPlaces(CURRENCY_SCALE, Decimal.ROUND_HALF_UP);
  const selectedFreightAmount =
    input.freightBillingMethod === 'CBM' ? cbmFreightAmount : kgFreightAmount;
  const selectedFreightForeign = selectedFreightAmount
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
  const totalAmountForeignExact = totalAmountCny.times(exchangeRate);
  const totalAmountForeign = totalAmountForeignExact.toDecimalPlaces(
    CURRENCY_SCALE,
    Decimal.ROUND_UP,
  );

  const components = [
    ...items.map((item) => ({ kind: 'item' as const, amountCny: item._lineAmount })),
    { kind: 'freight' as const, amountCny: freightCny },
    { kind: 'delivery' as const, amountCny: deliveryFeeCny },
    ...feeInputs.map((fee) => ({ kind: 'fee' as const, amountCny: fee.amount })),
  ];
  const freightIndex = components.findIndex((component) => component.kind === 'freight');
  const foreignAmounts = components.map(() => new Decimal(0));
  foreignAmounts[freightIndex] = selectedFreightForeign;
  const remainderCny = components.map((component, index) =>
    index === freightIndex ? new Decimal(0) : component.amountCny,
  );
  const remainderTotalCny = remainderCny.reduce((sum, amount) => sum.plus(amount), new Decimal(0));
  const remainingForeign = totalAmountForeign.minus(selectedFreightForeign);
  if (remainderTotalCny.isZero()) {
    foreignAmounts[freightIndex] = totalAmountForeign;
  } else {
    const nonFreightIndexes = components
      .map((_, index) => index)
      .filter((index) => index !== freightIndex);
    const allocated = allocate(
      remainingForeign,
      nonFreightIndexes.map((index) => remainderCny[index]!),
      CURRENCY_SCALE,
    );
    nonFreightIndexes.forEach((index, allocationIndex) => {
      foreignAmounts[index] = allocated[allocationIndex]!;
    });
  }

  let componentIndex = 0;
  items.forEach((item, index) => {
    item.lineAmountForeign = fixed(foreignAmounts[componentIndex]!, CURRENCY_SCALE);
    item.unitSalePriceForeign = fixed(
      foreignAmounts[componentIndex]!.div(decimal(item.quantity, 'quantity', item.lineNo)),
      MONEY_SCALE,
    );
    componentIndex += 1;
    item.allocatedFreightForeign = fixed(foreignFreightAllocations[index]!, CURRENCY_SCALE);
  });
  const freightForeign = fixed(foreignAmounts[componentIndex]!, CURRENCY_SCALE);
  componentIndex += 1;
  const deliveryForeign = fixed(foreignAmounts[componentIndex]!, CURRENCY_SCALE);
  componentIndex += 1;
  const fees = feeInputs.map((fee) => {
    const amountForeign = foreignAmounts[componentIndex]!;
    componentIndex += 1;
    return {
      typeCode: fee.typeCode,
      name: fee.name,
      amountCny: fixed(fee.amount, MONEY_SCALE),
      amountForeign: fixed(amountForeign, CURRENCY_SCALE),
      isFreight: false,
      notes: fee.notes,
    };
  });

  return {
    items: items.map(
      ({
        _lineAmount: _line,
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
      kgRatePerKg: fixed(kgRate, MONEY_SCALE),
      volumetricDivisor: input.volumetricDivisor,
      orderTotalVolumeWeightKg: fixed(totalVolumeWeight, WEIGHT_SCALE),
      orderTotalGrossWeightKg: fixed(totalGrossWeight, WEIGHT_SCALE),
      chargeableWeightKg: fixed(chargeableWeight, WEIGHT_SCALE),
      kgChargeableBasis,
      kgFreightAmount: fixed(kgFreightAmount, CURRENCY_SCALE),
      selectedFreightAmount: fixed(selectedFreightAmount, CURRENCY_SCALE),
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
