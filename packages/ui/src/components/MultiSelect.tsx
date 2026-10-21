'use client';

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Button } from './Button';
import { IconCheck, IconChevronDown, IconClose, IconSearch } from './icons';
import { LoadingState } from './states';

export interface MultiSelectOption {
  value: string;
  label: string;
  /** Secondary line under the label, for example a machine code. */
  hint?: string | null;
  /** Explanation shown when the option cannot be selected. */
  disabledReason?: string | null;
  disabled?: boolean;
}

export interface MultiSelectProps {
  options: MultiSelectOption[];
  value: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  searchPlaceholder: string;
  emptyLabel: string;
  noMatchLabel: string;
  loading?: boolean;
  loadingLabel: string;
  error?: string | null;
  onRetry?: () => void;
  retryLabel: string;
  removeLabel: (label: string) => string;
  disabled?: boolean;
  invalid?: boolean;
  inputId?: string;
  describedBy?: string;
}

/**
 * Searchable multi-select used for role assignment (docs/17 §3.3).
 *
 * Values can only come from a server-provided option list: when that list fails
 * to load the component shows an error with retry and never degrades into a
 * free-text input. Keyboard support covers Arrow keys, Enter, Escape and
 * Backspace; every option exposes an accessible name and a selected state.
 */
export function MultiSelect({
  options,
  value,
  onChange,
  placeholder,
  searchPlaceholder,
  emptyLabel,
  noMatchLabel,
  loading = false,
  loadingLabel,
  error = null,
  onRetry,
  retryLabel,
  removeLabel,
  disabled = false,
  invalid = false,
  inputId,
  describedBy,
}: MultiSelectProps) {
  const generatedId = useId();
  const controlId = inputId ?? `multiselect-${generatedId}`;
  const listboxId = `${controlId}-listbox`;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const byValue = useMemo(() => new Map(options.map((option) => [option.value, option])), [options]);
  const selectedOptions = value
    .map((item) => byValue.get(item))
    .filter((option): option is MultiSelectOption => option !== undefined);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return options;
    return options.filter(
      (option) => option.label.toLowerCase().includes(term) || option.value.toLowerCase().includes(term),
    );
  }, [options, query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, open]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  const toggleOption = (optionValue: string) => {
    const option = byValue.get(optionValue);
    if (!option || option.disabled) return;
    if (value.includes(optionValue)) {
      onChange(value.filter((item) => item !== optionValue));
    } else {
      onChange([...value, optionValue]);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      if (open) {
        event.stopPropagation();
        setOpen(false);
      }
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      if (filtered.length === 0) return;
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex((current) => (current + delta + filtered.length) % filtered.length);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      const option = filtered[activeIndex];
      if (option) toggleOption(option.value);
      return;
    }
    if (event.key === 'Backspace' && query.length === 0 && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  };

  const activeOption = filtered[activeIndex];

  return (
    <div className="multi-select" ref={containerRef}>
      <div
        className="multi-select-control"
        data-open={open}
        data-invalid={invalid}
        data-disabled={disabled}
        onClick={() => {
          if (disabled) return;
          setOpen(true);
          inputRef.current?.focus();
        }}
      >
        {selectedOptions.length > 0 ? (
          <ul className="multi-select-tags">
            {selectedOptions.map((option) => (
              <li key={option.value} className="multi-select-tag">
                <span className="truncate">{option.label}</span>
                <button
                  type="button"
                  className="multi-select-tag-remove"
                  aria-label={removeLabel(option.label)}
                  disabled={disabled}
                  onClick={(event) => {
                    event.stopPropagation();
                    onChange(value.filter((item) => item !== option.value));
                    inputRef.current?.focus();
                  }}
                >
                  <IconClose size={13} />
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <span className="multi-select-search">
          <IconSearch size={15} />
          <input
            ref={inputRef}
            id={controlId}
            className="multi-select-input"
            role="combobox"
            aria-expanded={open}
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={open && activeOption ? `${listboxId}-${activeOption.value}` : undefined}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            autoComplete="off"
            disabled={disabled || loading || Boolean(error)}
            placeholder={selectedOptions.length === 0 ? placeholder : searchPlaceholder}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
          />
        </span>

        <button
          type="button"
          className="multi-select-toggle"
          tabIndex={-1}
          aria-hidden="true"
          disabled={disabled}
          onClick={(event) => {
            event.stopPropagation();
            setOpen((current) => !current);
            inputRef.current?.focus();
          }}
        >
          <IconChevronDown size={16} />
        </button>
      </div>

      {open ? (
        <div className="multi-select-popover">
          {loading ? (
            <div className="multi-select-state">
              <LoadingState label={loadingLabel} rows={2} />
            </div>
          ) : error ? (
            <div className="multi-select-state multi-select-error" role="alert">
              <span>{error}</span>
              {onRetry ? (
                <Button size="sm" variant="secondary" onClick={onRetry}>
                  {retryLabel}
                </Button>
              ) : null}
            </div>
          ) : options.length === 0 ? (
            <div className="multi-select-state">{emptyLabel}</div>
          ) : filtered.length === 0 ? (
            <div className="multi-select-state">{noMatchLabel}</div>
          ) : (
            <ul className="multi-select-list" role="listbox" id={listboxId} aria-multiselectable="true">
              {filtered.map((option, index) => {
                const selected = value.includes(option.value);
                return (
                  <li
                    key={option.value}
                    id={`${listboxId}-${option.value}`}
                    role="option"
                    aria-selected={selected}
                    aria-disabled={option.disabled || undefined}
                    className="multi-select-option"
                    data-active={index === activeIndex}
                    data-selected={selected}
                    data-disabled={option.disabled || undefined}
                    title={option.disabledReason ?? undefined}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => toggleOption(option.value)}
                  >
                    <span className="multi-select-option-check" aria-hidden="true">
                      {selected ? <IconCheck size={15} /> : null}
                    </span>
                    <span className="multi-select-option-text">
                      <span className="multi-select-option-label">{option.label}</span>
                      {option.hint ? <span className="multi-select-option-hint">{option.hint}</span> : null}
                      {option.disabled && option.disabledReason ? (
                        <span className="multi-select-option-hint">{option.disabledReason}</span>
                      ) : null}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
