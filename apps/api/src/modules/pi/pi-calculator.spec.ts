import { describe, expect, it } from 'vitest';
import { ApiError } from '../../common/errors/api-error';
import { calculatePiTotals, currencyScale, formatPiAmount } from './pi-calculator';

describe('calculatePiTotals', () => {
  it('recomputes line amounts and totals with decimal arithmetic', () => {
    const result = calculatePiTotals({
      currency: 'USD',
      lines: [
        { sku: 'A', quantity: '1000', unitPrice: '0.285' },
        { sku: 'B', quantity: '2.5', unitPrice: '12.4', discountAmount: '1.00' },
      ],
      freightAmount: '25',
    });
    expect(result.lines[0]?.lineAmount).toBe('285');
    expect(result.lines[1]?.lineAmount).toBe('30');
    expect(result.subtotal).toBe('315');
    expect(result.totalAmount).toBe('340');
  });

  it('rounds once at the currency scale (JPY has none)', () => {
    const result = calculatePiTotals({
      currency: 'JPY',
      lines: [{ sku: 'A', quantity: '3', unitPrice: '10.4' }],
    });
    expect(currencyScale('JPY')).toBe(0);
    expect(result.totalAmount).toBe('31');
    expect(formatPiAmount(result.totalAmount, 0)).toBe('31');
  });

  it('rejects a line discount larger than the line amount', () => {
    expect(() =>
      calculatePiTotals({
        currency: 'USD',
        lines: [{ sku: 'A', quantity: '1', unitPrice: '10', discountAmount: '11' }],
      }),
    ).toThrow(ApiError);
  });

  it('rejects zero quantity', () => {
    expect(() =>
      calculatePiTotals({
        currency: 'USD',
        lines: [{ sku: 'A', quantity: '0', unitPrice: '10' }],
      }),
    ).toThrow(ApiError);
  });

  it('ignores client-supplied totals because they are not part of the input', () => {
    // A hostile payload would add totalAmount here; the calculator never reads it.
    const hostile = {
      currency: 'USD',
      lines: [{ sku: 'A', quantity: '2', unitPrice: '5' }],
      totalAmount: '1',
    } as unknown as Parameters<typeof calculatePiTotals>[0];
    const result = calculatePiTotals(hostile);
    expect(result.totalAmount).toBe('10');
  });
});
