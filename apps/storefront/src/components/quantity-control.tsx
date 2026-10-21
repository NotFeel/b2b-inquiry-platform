'use client';

import {
  MAX_INQUIRY_QUANTITY,
  normalizeQuantity,
} from '../lib/inquiry';

interface Props {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  label: string;
  decreaseLabel: string;
  increaseLabel: string;
}

/** Accessible quantity stepper shared by the product detail and inquiry list. */
export function QuantityControl({
  value,
  onChange,
  min = 1,
  max = MAX_INQUIRY_QUANTITY,
  label,
  decreaseLabel,
  increaseLabel,
}: Props) {
  return (
    <div className="quantity-control">
      <button
        type="button"
        className="quantity-button"
        aria-label={decreaseLabel}
        disabled={value <= min}
        onClick={() => onChange(normalizeQuantity(value - 1, min, max))}
      >
        −
      </button>
      <input
        className="quantity-input"
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={1}
        value={value}
        aria-label={label}
        onChange={(event) => onChange(normalizeQuantity(Number(event.target.value), min, max))}
      />
      <button
        type="button"
        className="quantity-button"
        aria-label={increaseLabel}
        disabled={value >= max}
        onClick={() => onChange(normalizeQuantity(value + 1, min, max))}
      >
        +
      </button>
    </div>
  );
}
