'use client';

import { adminApi } from './admin-api';

export interface ReferenceOption {
  id: string;
  code: string;
  label: string;
  value: string | null;
  enabled: boolean;
}

interface DictionaryOptionResponse {
  data: {
    type: { code: string; nameKey: string };
    locale: string;
    items: ReferenceOption[];
  };
}

// The same reference data is requested by the order list, the customer editor
// and the quotation calculator. Cache the promise per type/locale so opening a
// page does not fan out duplicate dictionary requests. A failed request is
// evicted so the UI can retry.
const optionCache = new Map<string, Promise<ReferenceOption[]>>();

/** Case-insensitive search by ISO code or localized label. */
export function filterReferenceOptions(
  options: ReferenceOption[],
  query: string,
): ReferenceOption[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return options;
  return options.filter(
    (option) =>
      option.code.toLowerCase().includes(normalized) ||
      option.label.toLowerCase().includes(normalized),
  );
}

export const referenceDataApi = {
  options(typeCode: string, locale: string): Promise<ReferenceOption[]> {
    const key = `${typeCode}:${locale}`;
    const cached = optionCache.get(key);
    if (cached) return cached;
    const request = adminApi
      .get<DictionaryOptionResponse>(`/admin/dictionary/options/${typeCode}`, { locale })
      .then((response) => response.data.items)
      .catch((error: unknown) => {
        optionCache.delete(key);
        throw error;
      });
    optionCache.set(key, request);
    return request;
  },
  clearCache(): void {
    optionCache.clear();
  },
};
