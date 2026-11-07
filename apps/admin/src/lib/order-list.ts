// Pure list helpers for the orders page (docs/43 §3).
//
// Filter chips, money/date formatting and status presentation live here so the
// page stays focused on data loading and dialogs, and so the rules can be
// unit-tested without a browser.

export interface OrderListFilters {
  q: string;
  status: string;
  currency: string;
  country: string;
  from: string;
  to: string;
  hasPi: string;
  hasCi: string;
}

export type OrderFilterKey = keyof OrderListFilters;

export const EMPTY_ORDER_FILTERS: OrderListFilters = {
  q: '',
  status: '',
  currency: '',
  country: '',
  from: '',
  to: '',
  hasPi: '',
  hasCi: '',
};

export interface OrderFilterChip {
  key: OrderFilterKey;
  label: string;
  value: string;
}

type Translate = (key: string, params?: Record<string, string | number>) => string;

const ORDER_STATUSES = ['CONFIRMED', 'CANCELLED'] as const;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Filters live in the URL so a refresh or shared link keeps them. */
export function readOrderListFilters(params: URLSearchParams): OrderListFilters {
  const status = params.get('status') ?? '';
  const currency = (params.get('currency') ?? '').toUpperCase();
  const country = (params.get('country') ?? '').toUpperCase();
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const bool = (key: string) => {
    const value = params.get(key);
    return value === 'true' || value === 'false' ? value : '';
  };
  return {
    q: (params.get('q') ?? '').trim().slice(0, 120),
    status: (ORDER_STATUSES as readonly string[]).includes(status) ? status : '',
    currency: /^[A-Z]{3}$/.test(currency) ? currency : '',
    country: /^[A-Z]{2}$/.test(country) ? country : '',
    from: DATE_ONLY.test(from) ? from : '',
    to: DATE_ONLY.test(to) ? to : '',
    hasPi: bool('hasPi'),
    hasCi: bool('hasCi'),
  };
}

export function orderFiltersToQueryString(filters: OrderListFilters): string {
  const params = new URLSearchParams();
  if (filters.q.trim()) params.set('q', filters.q.trim());
  if (filters.status) params.set('status', filters.status);
  if (filters.currency) params.set('currency', filters.currency);
  if (filters.country) params.set('country', filters.country);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  if (filters.hasPi) params.set('hasPi', filters.hasPi);
  if (filters.hasCi) params.set('hasCi', filters.hasCi);
  return params.toString();
}

export function hasActiveOrderFilters(filters: OrderListFilters): boolean {
  return (Object.keys(filters) as OrderFilterKey[]).some((key) => filters[key].trim().length > 0);
}

export function activeOrderFilterChips(
  filters: OrderListFilters,
  t: Translate,
): OrderFilterChip[] {
  const chips: OrderFilterChip[] = [];
  if (filters.q.trim()) {
    chips.push({ key: 'q', label: t('commercialDocuments.orders.search'), value: filters.q.trim() });
  }
  if (filters.status) {
    chips.push({
      key: 'status',
      label: t('commercialDocuments.orders.status'),
      value: orderStatusLabel(filters.status, t),
    });
  }
  if (filters.currency) {
    chips.push({ key: 'currency', label: t('commercialDocuments.orders.currency'), value: filters.currency });
  }
  if (filters.country) {
    chips.push({ key: 'country', label: t('commercialDocuments.orders.country'), value: filters.country });
  }
  if (filters.from) {
    chips.push({ key: 'from', label: t('commercialDocuments.orders.from'), value: filters.from });
  }
  if (filters.to) {
    chips.push({ key: 'to', label: t('commercialDocuments.orders.to'), value: filters.to });
  }
  if (filters.hasPi) {
    chips.push({
      key: 'hasPi',
      label: t('commercialDocuments.orders.hasPi'),
      value: t(filters.hasPi === 'true' ? 'commercialDocuments.orders.yes' : 'commercialDocuments.orders.no'),
    });
  }
  if (filters.hasCi) {
    chips.push({
      key: 'hasCi',
      label: t('commercialDocuments.orders.hasCi'),
      value: t(filters.hasCi === 'true' ? 'commercialDocuments.orders.yes' : 'commercialDocuments.orders.no'),
    });
  }
  return chips;
}

export function clearOrderFilter(
  filters: OrderListFilters,
  key: OrderFilterKey,
): OrderListFilters {
  return { ...filters, [key]: '' };
}

export function orderStatusLabel(status: string, t: Translate): string {
  const key = `commercialDocuments.orderStatuses.${status.toLowerCase()}`;
  const label = t(key);
  return label === key ? status : label;
}

export function orderStatusTone(status: string): 'success' | 'danger' | 'neutral' {
  if (status === 'CONFIRMED') return 'success';
  if (status === 'CANCELLED') return 'danger';
  return 'neutral';
}

export function documentStatusTone(status: string): 'success' | 'danger' | 'warning' | 'neutral' {
  switch (status) {
    case 'ISSUED':
      return 'success';
    case 'CANCELLED':
      return 'danger';
    case 'REVIEW':
      return 'warning';
    default:
      return 'neutral';
  }
}

export function documentStatusLabel(status: string, t: Translate): string {
  const key = `commercialDocuments.statuses.${status}`;
  const label = t(key);
  return label === key ? status : label;
}

/**
 * Foreign-currency amounts are stored as decimal strings. Display two decimals
 * consistently with the order/quotation policy and always render the currency
 * code, never an unlabeled number.
 */
export function formatOrderMoney(amount: string | null | undefined, currency: string, locale: string): string {
  if (!amount || amount.trim().length === 0) return '—';
  const numeric = Number(amount);
  if (!Number.isFinite(numeric)) return '—';
  try {
    return new Intl.NumberFormat(locale === 'zh-CN' ? 'zh-CN' : 'en-US', {
      style: 'currency',
      currency: currency.toUpperCase(),
      currencyDisplay: 'code',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(numeric);
  } catch {
    return `${amount} ${currency}`;
  }
}

export function formatOrderDate(value: string | null | undefined, locale: string): string {
  if (!value) return '—';
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return value;
  try {
    return new Intl.DateTimeFormat(locale === 'zh-CN' ? 'zh-CN' : 'en-US', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      timeZone: 'UTC',
    }).format(date);
  } catch {
    return value;
  }
}

export function formatOrderQuantity(value: string | null | undefined, locale: string): string {
  if (!value) return '0';
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return value;
  return new Intl.NumberFormat(locale === 'zh-CN' ? 'zh-CN' : 'en-US', {
    maximumFractionDigits: 3,
  }).format(numeric);
}
