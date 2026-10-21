'use client';

import { useEffect, useState } from 'react';
import type { TagSummary } from '@b2b/contracts';
import { tagsApi } from './tags-api';

// Tag options for the product editor (docs/23 §8.1).
//
// Module-level cache with a short TTL, mirroring the dictionary options helper:
// the picker is read on every product form open, and a rename or disable must not
// linger. `invalidateTagOptions` is called after any tag mutation so a change is
// visible on the next form open without a page reload.

const CACHE_TTL_MS = 30_000;
const MAX_OPTIONS = 100;

interface CacheEntry {
  at: number;
  result: Promise<TagSummary[]>;
}

const cache = new Map<string, CacheEntry>();

export function invalidateTagOptions(): void {
  cache.clear();
}

export function loadTagOptions(locale: string): Promise<TagSummary[]> {
  const cached = cache.get(locale);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.result;

  const result = tagsApi
    .list({ locale, page: 1, pageSize: MAX_OPTIONS, status: 'all', usage: 'all' })
    .then((response) => response.data)
    .catch((error: unknown) => {
      // A failed request must never be cached, or a transient error would keep
      // an empty picker for the whole TTL.
      cache.delete(locale);
      throw error;
    });
  cache.set(locale, { at: Date.now(), result });
  return result;
}

export interface TagSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
  hint?: string;
}

/**
 * Options for the product tag picker.
 *
 * Disabled tags stay in the list but are marked and not selectable: a product
 * that already carries one keeps showing it (so saving another field cannot
 * silently drop the association), while a *new* association with a disabled tag
 * is impossible.
 */
export function toTagSelectOptions(
  tags: TagSummary[],
  options: { disabledHint: string },
): TagSelectOption[] {
  return tags.map((tag) => {
    const label = tag.label;
    return {
      value: tag.code,
      label: tag.enabled ? label : `${label} · ${options.disabledHint}`,
      disabled: !tag.enabled,
      hint: tag.code,
    };
  });
}

export interface TagOptionsState {
  options: TagSelectOption[];
  loading: boolean;
  error: string | null;
}

/**
 * Options keyed by tag id, for forms that submit structured references
 * (docs/24 §3.3 E: `tagIds`, never comma-separated text or a name lookup).
 *
 * Disabled tags stay listed and marked so an existing association is visible and
 * cannot be dropped by accident, while a new one cannot be created.
 */
export function toTagIdSelectOptions(
  tags: TagSummary[],
  options: { disabledHint: string },
): TagSelectOption[] {
  return tags.map((tag) => ({
    value: tag.id,
    label: tag.enabled ? tag.label : `${tag.label} · ${options.disabledHint}`,
    disabled: !tag.enabled,
    hint: tag.code,
  }));
}

export function useTagIdSelectOptions(locale: string, disabledHint: string): TagOptionsState {
  const [state, setState] = useState<TagOptionsState>({ options: [], loading: true, error: null });

  useEffect(() => {
    let cancelled = false;
    setState((current) => ({ ...current, loading: true }));
    loadTagOptions(locale)
      .then((tags) => {
        if (cancelled) return;
        setState({
          options: toTagIdSelectOptions(tags, { disabledHint }),
          loading: false,
          error: null,
        });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({
          options: [],
          loading: false,
          error: error instanceof Error ? error.message : 'ERROR',
        });
      });
    return () => {
      cancelled = true;
    };
  }, [locale, disabledHint]);

  return state;
}

export function useTagSelectOptions(locale: string, disabledHint: string): TagOptionsState {
  const [state, setState] = useState<TagOptionsState>({ options: [], loading: true, error: null });

  useEffect(() => {
    let cancelled = false;
    setState((current) => ({ ...current, loading: true }));
    loadTagOptions(locale)
      .then((tags) => {
        if (cancelled) return;
        setState({
          options: toTagSelectOptions(tags, { disabledHint }),
          loading: false,
          error: null,
        });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({
          options: [],
          loading: false,
          error: error instanceof Error ? error.message : 'ERROR',
        });
      });
    return () => {
      cancelled = true;
    };
  }, [locale, disabledHint]);

  return state;
}
