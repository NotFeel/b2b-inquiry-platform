import { describe, expect, it } from 'vitest';
import {
  EMPTY_ORDER_FILTERS,
  activeOrderFilterChips,
  clearOrderFilter,
  documentStatusLabel,
  documentStatusTone,
  formatOrderDate,
  formatOrderMoney,
  formatOrderQuantity,
  hasActiveOrderFilters,
  orderFiltersToQueryString,
  orderStatusLabel,
  readOrderListFilters,
  orderStatusTone,
} from './order-list';

const t = (key: string, params?: Record<string, string | number>) =>
  params ? `${key}:${JSON.stringify(params)}` : key;

describe('order list filters', () => {
  it('reports whether any filter is active', () => {
    expect(hasActiveOrderFilters(EMPTY_ORDER_FILTERS)).toBe(false);
    expect(hasActiveOrderFilters({ ...EMPTY_ORDER_FILTERS, hasCi: 'true' })).toBe(true);
    expect(hasActiveOrderFilters({ ...EMPTY_ORDER_FILTERS, q: '   ' })).toBe(false);
  });

  it('builds one chip per active filter and clears a single key', () => {
    const filters = {
      ...EMPTY_ORDER_FILTERS,
      q: 'ACME',
      status: 'CONFIRMED',
      currency: 'USD',
      hasPi: 'true',
    };
    const chips = activeOrderFilterChips(filters, t);
    expect(chips.map((chip) => chip.key)).toEqual(['q', 'status', 'currency', 'hasPi']);
    expect(chips.find((chip) => chip.key === 'status')?.value).toBe('CONFIRMED');
    const cleared = clearOrderFilter(filters, 'currency');
    expect(cleared.currency).toBe('');
    expect(cleared.q).toBe('ACME');
  });
});

describe('order URL filters', () => {
  it('reads only valid deep-link values', () => {
    const filters = readOrderListFilters(
      new URLSearchParams({
        q: '  ACME  ',
        status: 'DELETED',
        currency: 'usd',
        country: 'usa',
        from: '2026-11-01',
        to: 'not-a-date',
        hasPi: 'true',
        hasCi: 'maybe',
      }),
    );
    expect(filters).toEqual({
      q: 'ACME',
      status: '',
      currency: 'USD',
      country: '',
      from: '2026-11-01',
      to: '',
      hasPi: 'true',
      hasCi: '',
    });
  });

  it('serializes only active filters', () => {
    expect(
      orderFiltersToQueryString({
        ...EMPTY_ORDER_FILTERS,
        q: 'ACME',
        hasCi: 'false',
      }),
    ).toBe('q=ACME&hasCi=false');
    expect(orderFiltersToQueryString(EMPTY_ORDER_FILTERS)).toBe('');
  });
});

describe('order formatting', () => {
  it('formats money with its currency code and two decimals', () => {
    expect(formatOrderMoney('1250', 'USD', 'en-US')).toContain('1,250.00');
    expect(formatOrderMoney('1250', 'USD', 'en-US')).toContain('USD');
    expect(formatOrderMoney(null, 'USD', 'en-US')).toBe('—');
    expect(formatOrderMoney('not-a-number', 'USD', 'en-US')).toBe('—');
  });

  it('formats order dates in UTC so a date-only value never shifts a day', () => {
    expect(formatOrderDate('2026-11-07', 'en-US')).toMatch(/2026/);
    expect(formatOrderDate('2026-11-07', 'zh-CN')).toMatch(/2026/);
    expect(formatOrderDate(null, 'en-US')).toBe('—');
  });

  it('formats snapshot quantities without inventing decimals', () => {
    expect(formatOrderQuantity('528', 'en-US')).toBe('528');
    expect(formatOrderQuantity('0.5', 'en-US')).toBe('0.5');
    expect(formatOrderQuantity(null, 'en-US')).toBe('0');
  });
});

describe('order status presentation', () => {
  it('keeps Order and CommercialDocument statuses distinct', () => {
    expect(orderStatusTone('CONFIRMED')).toBe('success');
    expect(orderStatusTone('CANCELLED')).toBe('danger');
    expect(documentStatusTone('ISSUED')).toBe('success');
    expect(documentStatusTone('REVIEW')).toBe('warning');
    expect(documentStatusTone('CANCELLED')).toBe('danger');
  });

  it('falls back to the raw code when no translation exists', () => {
    expect(orderStatusLabel('CONFIRMED', t)).toBe('CONFIRMED');
    expect(documentStatusLabel('ISSUED', t)).toBe('ISSUED');
    expect(documentStatusLabel('UNKNOWN', t)).toBe('UNKNOWN');
  });
});
