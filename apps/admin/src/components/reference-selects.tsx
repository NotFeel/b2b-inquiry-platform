'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Input, Select } from '@b2b/ui';
import {
  filterReferenceOptions,
  referenceDataApi,
  type ReferenceOption,
} from '../lib/reference-data-api';
import { useSession } from './session-provider';

interface UseReferenceOptionsResult {
  options: ReferenceOption[];
  loading: boolean;
  error: string | null;
}

/**
 * Loads one dictionary-backed option set. The request is cached by
 * `referenceDataApi`, so several selectors on one page share one call.
 */
export function useReferenceOptions(
  typeCode: 'country' | 'currency',
  locale: string,
  enabled = true,
): UseReferenceOptionsResult {
  const [options, setOptions] = useState<ReferenceOption[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      setOptions([]);
      setError(null);
      return undefined;
    }
    let active = true;
    setLoading(true);
    setError(null);
    void referenceDataApi
      .options(typeCode, locale)
      .then((items) => {
        if (!active) return;
        setOptions(items);
      })
      .catch(() => {
        if (!active) return;
        setOptions([]);
        setError(typeCode);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [enabled, locale, typeCode]);

  return { options, loading, error };
}

export interface CountrySelectProps {
  value: string;
  onChange: (value: string) => void;
  inputId?: string;
  describedBy?: string;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  ariaLabel?: string;
  allowClear?: boolean;
  /** Optional pre-loaded options (for tests or callers that already have them). */
  options?: ReferenceOption[];
}

/**
 * Searchable country/region selector backed by the `country` dictionary.
 *
 * The stored value is always the two-letter ISO code; localized labels never
 * become the business key. A historical code that no longer exists in the
 * dictionary is still displayed so editing an old order cannot silently erase
 * it, but it remains flagged as an unavailable option.
 */
export function CountrySelect({
  value,
  onChange,
  inputId,
  describedBy,
  placeholder,
  disabled,
  invalid,
  ariaLabel,
  allowClear = true,
  options: providedOptions,
}: CountrySelectProps) {
  const { t, locale } = useSession();
  const hook = useReferenceOptions('country', locale, providedOptions === undefined);
  const options = providedOptions ?? hook.options;
  const loading = providedOptions === undefined && hook.loading;
  const loadFailed = providedOptions === undefined && Boolean(hook.error);
  const listId = useId();
  const fallbackInputId = useId();
  const resolvedInputId = inputId ?? fallbackInputId;
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  const selected = options.find((option) => option.code === value) ?? null;
  const hasUnknownValue = Boolean(value) && !selected;
  const fallbackOption: ReferenceOption | null = hasUnknownValue
    ? { id: `unknown-${value}`, code: value, label: value, value: null, enabled: false }
    : null;
  const allOptions = fallbackOption ? [fallbackOption, ...options] : options;

  const filtered = useMemo(() => filterReferenceOptions(allOptions, query), [allOptions, query]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: MouseEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  useEffect(() => {
    if (open) setActiveIndex(0);
  }, [open, query]);

  const commit = (option: ReferenceOption | undefined) => {
    if (!option) return;
    onChange(option.code);
    setOpen(false);
    setQuery('');
    document.getElementById(resolvedInputId)?.focus();
  };

  const displayValue = open ? query : selected ? `${selected.label} (${selected.code})` : value;

  if (disabled) {
    return (
      <Input
        inputId={inputId}
        describedBy={describedBy}
        value={selected ? `${selected.label} (${selected.code})` : value}
        placeholder={placeholder}
        disabled
        readOnly
        aria-label={ariaLabel}
      />
    );
  }

  return (
    <div className="combobox" ref={wrapperRef} onClick={(event) => event.stopPropagation()}>
      <div className="combobox-control">
        <Input
          inputId={resolvedInputId}
          describedBy={describedBy}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            open && filtered[activeIndex] ? `${listId}-${filtered[activeIndex].code}` : undefined
          }
          aria-label={ariaLabel}
          aria-invalid={invalid || undefined}
          autoComplete="off"
          value={displayValue ?? ''}
          placeholder={
            loading ? t('common.loading') : (placeholder ?? t('countrySelect.placeholder'))
          }
          onFocus={(event) => {
            setOpen(true);
            setQuery(selected ? `${selected.label} (${selected.code})` : '');
            event.currentTarget.select();
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setOpen(true);
              setActiveIndex((current) => Math.min(current + 1, Math.max(0, filtered.length - 1)));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActiveIndex((current) => Math.max(current - 1, 0));
            } else if (event.key === 'Enter') {
              if (open) {
                event.preventDefault();
                commit(filtered[activeIndex]);
              }
            } else if (event.key === 'Escape') {
              if (open) {
                event.preventDefault();
                event.stopPropagation();
                setOpen(false);
                setQuery('');
              }
            } else if (event.key === 'Tab') {
              setOpen(false);
            }
          }}
        />
        {allowClear && value ? (
          <button
            type="button"
            className="combobox-clear"
            aria-label={t('countrySelect.clear')}
            onClick={() => {
              onChange('');
              setQuery('');
              setOpen(false);
            }}
          >
            ×
          </button>
        ) : null}
      </div>
      {open ? (
        <ul className="combobox-list" id={listId} role="listbox" aria-label={ariaLabel}>
          {loading ? (
            <li className="combobox-empty" role="status">
              {t('common.loading')}
            </li>
          ) : loadFailed ? (
            <li className="combobox-empty" role="alert">
              {t('countrySelect.loadFailed')}
            </li>
          ) : filtered.length === 0 ? (
            <li className="combobox-empty" role="status">
              {t('countrySelect.noResults')}
            </li>
          ) : (
            filtered.map((option, index) => (
              <li
                key={option.id}
                id={`${listId}-${option.code}`}
                role="option"
                aria-selected={option.code === value}
                className={[
                  'combobox-option',
                  option.code === value ? 'is-selected' : '',
                  index === activeIndex ? 'is-active' : '',
                  option.enabled ? '' : 'is-unavailable',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onMouseDown={(event) => {
                  event.preventDefault();
                  commit(option);
                }}
                onMouseEnter={() => setActiveIndex(index)}
              >
                <span>{option.label}</span>
                <span className="mono">{option.code}</span>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}

export interface CurrencySelectProps {
  value: string;
  onChange: (value: string) => void;
  options: { code: string; label: string }[];
  inputId?: string;
  describedBy?: string;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  ariaLabel?: string;
}

/** Currency selector. The value is the ISO-4217 code from the currency dictionary. */
export function CurrencySelect({
  value,
  onChange,
  options,
  inputId,
  describedBy,
  placeholder,
  disabled,
  invalid,
  ariaLabel,
}: CurrencySelectProps) {
  return (
    <Select
      inputId={inputId}
      describedBy={describedBy}
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      invalid={invalid}
      aria-label={ariaLabel}
      options={options.map((option) => ({ value: option.code, label: option.label }))}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}
