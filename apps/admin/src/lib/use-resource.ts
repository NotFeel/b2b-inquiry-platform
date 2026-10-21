'use client';

import { useCallback, useEffect, useState } from 'react';
import { AdminApiError, adminApi, type PaginatedResponse } from './admin-api';
import { translateError } from './i18n';

export interface ResourceState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  requestId: string | null;
  reload: () => void;
}

// Small data hook: every admin screen shows loading, error (with requestId) and
// empty states instead of a silent blank page (docs/06 §6).
export function useResource<T>(
  loader: () => Promise<T>,
  deps: unknown[],
  locale: string,
): ResourceState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loader()
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setError(null);
        setRequestId(null);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        if (caught instanceof AdminApiError) {
          setError(caught.code);
          setRequestId(caught.requestId ?? null);
        } else {
          setError('INTERNAL_ERROR');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // Reloads are driven by the dependency list the caller passes in.
  }, [...deps, nonce, locale]);

  return { data, loading, error, requestId, reload };
}

export function usePagedResource<T>(
  path: string,
  query: Record<string, string | number | boolean | undefined>,
  locale: string,
) {
  return useResource<PaginatedResponse<T>>(
    () => adminApi.list<T>(path, query),
    [path, JSON.stringify(query)],
    locale,
  );
}

export function errorText(locale: string, code: string | null): string | null {
  return code ? translateError(locale, code) : null;
}
