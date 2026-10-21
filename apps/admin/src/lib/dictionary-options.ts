'use client';

import { useCallback, useEffect, useState } from 'react';
import type { DictionaryOption, DictionaryOptionSet } from '@b2b/contracts';
import { AdminApiError } from './admin-api';
import { dictionaryApi } from './dictionary-api';
import { translateError } from './i18n';

// Shared option access for business forms (docs/20 §9.1).
//
// One module-level cache deduplicates identical requests across pages
// (`typeCode` + `locale` + `includeDisabled`) and short-lived repeat mounts, and
// `invalidateDictionaryOptions` clears it after a dictionary mutation so a
// renamed or disabled item cannot linger in a select (docs/20 §9.2).

const CACHE_TTL_MS = 30_000;

interface CacheEntry {
  at: number;
  result: Promise<DictionaryOptionSet>;
}

const cache = new Map<string, CacheEntry>();

function cacheKey(typeCode: string, locale: string, includeDisabled: boolean): string {
  return `${typeCode}|${locale}|${includeDisabled ? 'withDisabled' : 'enabledOnly'}`;
}

/** Clears cached options for one type, or for every type when omitted. */
export function invalidateDictionaryOptions(typeCode?: string): void {
  for (const key of [...cache.keys()]) {
    if (!typeCode || key.startsWith(`${typeCode}|`)) cache.delete(key);
  }
}

export function loadDictionaryOptions(
  typeCode: string,
  params: { locale: string; includeDisabled?: boolean },
): Promise<DictionaryOptionSet> {
  const key = cacheKey(typeCode, params.locale, Boolean(params.includeDisabled));
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.result;

  const result = dictionaryApi
    .options(typeCode, params)
    .catch((error: unknown) => {
      // A failed request must never be cached, otherwise a transient error would
      // keep an empty select for the whole TTL.
      cache.delete(key);
      throw error;
    });
  cache.set(key, { at: Date.now(), result });
  return result;
}

export interface DictionarySelectOption {
  value: string;
  label: string;
}

export interface UseDictionaryOptionsResult {
  /** Ready-to-render select options; `value` is the stable item code. */
  options: DictionarySelectOption[];
  items: DictionaryOption[];
  set: DictionaryOptionSet | null;
  loading: boolean;
  /** Translated, display-ready error message. */
  error: string | null;
  reload: () => void;
}

export interface UseDictionaryOptionsParams {
  locale: string;
  includeDisabled?: boolean;
  /**
   * Options rendered while loading or after a failure, so a select never loses
   * the record's current value (docs/20 §5.6, §11.1 DIC-007).
   */
  fallback?: DictionarySelectOption[];
  /** Skip the request entirely (for example when the form is closed). */
  enabled?: boolean;
}

export function useDictionaryOptions(
  typeCode: string,
  params: UseDictionaryOptionsParams,
): UseDictionaryOptionsResult {
  const { locale, includeDisabled = false, fallback, enabled = true } = params;
  const [set, setSet] = useState<DictionaryOptionSet | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => {
    invalidateDictionaryOptions(typeCode);
    setNonce((value) => value + 1);
  }, [typeCode]);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    loadDictionaryOptions(typeCode, { locale, includeDisabled })
      .then((result) => {
        if (cancelled) return;
        setSet(result);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setSet(null);
        setError(
          caught instanceof AdminApiError ? translateError(locale, caught.code) : 'errors.INTERNAL_ERROR',
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [typeCode, locale, includeDisabled, enabled, nonce]);

  const items = set?.items ?? [];
  const options: DictionarySelectOption[] =
    items.length > 0
      ? items.map((item) => ({ value: item.code, label: item.label }))
      : (fallback ?? []);

  return { options, items, set, loading, error, reload };
}

/**
 * Ensures a select can still show the value stored on a record whose option was
 * disabled or removed, without adding it back to the selectable list.
 */
export function withCurrentValue(
  options: DictionarySelectOption[],
  current: string | null | undefined,
  labelForCurrent: string,
): DictionarySelectOption[] {
  if (!current) return options;
  if (options.some((option) => option.value === current)) return options;
  return [{ value: current, label: labelForCurrent }, ...options];
}
