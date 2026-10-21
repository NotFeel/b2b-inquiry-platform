'use client';

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import type { CategoryNode } from '@b2b/contracts';
import { Button } from '@b2b/ui';
import {
  categoryPickerRows,
  findNode,
  highlightParts,
  localizedName,
  pathLabel,
  pathOf,
} from '../lib/category-tree-state';
import { useSession } from './session-provider';

export type CategoryPickerMode = 'product' | 'filter';

export interface CategoryPickerProps {
  nodes: CategoryNode[];
  /** The only persisted value: a category UUID (or null in filter mode). */
  value: string | null;
  mode: CategoryPickerMode;
  onChange: (categoryId: string | null) => void;
  inputId?: string;
  describedBy?: string;
  invalid?: boolean;
  disabled?: boolean;
  loading?: boolean;
  errorLabel?: string | null;
  onRetry?: () => void;
  /**
   * Product detail's stored category path. It keeps the edit page readable
   * while the tree is still loading, and is never used as the submitted value.
   */
  fallbackLabel?: string | null;
}

interface PopoverPosition {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
}

/**
 * Compact, searchable category selector shared by the product editor and list
 * filter (docs/25 §3).
 *
 * The trigger is a normal form field; the tree only exists while the popover is
 * open. A row click selects the node (including parents with children), while
 * the separate chevron only expands or collapses it. The form value is always a
 * category UUID; labels, codes and slugs are display-only.
 */
export function CategoryPicker({
  nodes,
  value,
  mode,
  onChange,
  inputId,
  describedBy,
  invalid = false,
  disabled = false,
  loading = false,
  errorLabel = null,
  onRetry,
  fallbackLabel = null,
}: CategoryPickerProps) {
  const { t, locale } = useSession();
  const dialogTitleId = useId();
  const searchId = useId();
  const treeId = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(new Set());
  const [collapsedIds, setCollapsedIds] = useState<ReadonlySet<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [position, setPosition] = useState<PopoverPosition | null>(null);

  const selectedNode = value ? findNode(nodes, value) : null;
  const selectedPath = value ? pathLabel(nodes, value, locale) : null;
  const displayLabel =
    selectedPath ??
    fallbackLabel ??
    (value ? t('products.categoryPicker.valueLoading') : t('products.categoryPicker.placeholder'));
  const placeholderActive = value === null;

  const rows = useMemo(
    () => categoryPickerRows(nodes, { term, expandedIds, collapsedIds }),
    [nodes, term, expandedIds, collapsedIds],
  );
  const selectableRows = useMemo(() => rows.filter((row) => row.node.enabled), [rows]);
  const activeRow = rows.find((row) => row.node.id === activeId) ?? null;

  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    setPosition(null);
    if (restoreFocus) {
      requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
    }
  }, []);

  const select = useCallback(
    (categoryId: string | null) => {
      onChange(categoryId);
      close();
    },
    [close, onChange],
  );

  const openPicker = () => {
    const rootIds = nodes.filter((node) => node.children.length > 0).map((node) => node.id);
    const ancestorIds = value
      ? pathOf(nodes, value)
          .slice(0, -1)
          .map((node) => node.id)
      : [];
    setTerm('');
    setExpandedIds(new Set([...rootIds, ...ancestorIds]));
    setCollapsedIds(new Set());
    setActiveId(value ?? null);
    setOpen(true);
  };

  useLayoutEffect(() => {
    if (!open) return undefined;
    const updatePosition = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const width = Math.min(480, Math.max(rect.width, 320), viewportWidth - 24);
      const left = Math.max(12, Math.min(rect.left, viewportWidth - width - 12));
      const spaceBelow = viewportHeight - rect.bottom - 12;
      const spaceAbove = rect.top - 12;
      const placeAbove = spaceBelow < 280 && spaceAbove > spaceBelow;
      const maxHeight = Math.min(480, Math.max(220, placeAbove ? spaceAbove : spaceBelow));
      setPosition({
        top: placeAbove ? Math.max(12, rect.top - maxHeight - 8) : rect.bottom + 8,
        left,
        width,
        maxHeight,
      });
    };
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const frame = requestAnimationFrame(() => searchRef.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (rows.some((row) => row.node.id === activeId)) return;
    setActiveId(selectableRows[0]?.node.id ?? null);
  }, [activeId, open, rows, selectableRows]);

  const toggleExpanded = (id: string, currentlyExpanded: boolean) => {
    setCollapsedIds((current) => {
      const next = new Set(current);
      if (currentlyExpanded) next.add(id);
      else next.delete(id);
      return next;
    });
    setExpandedIds((current) => {
      const next = new Set(current);
      if (currentlyExpanded) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const moveActive = (direction: 1 | -1) => {
    if (selectableRows.length === 0) return;
    const index = selectableRows.findIndex((row) => row.node.id === activeId);
    const nextIndex =
      index < 0
        ? direction > 0
          ? 0
          : selectableRows.length - 1
        : (index + direction + selectableRows.length) % selectableRows.length;
    setActiveId(selectableRows[nextIndex]?.node.id ?? null);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === 'Tab') {
      const focusable = Array.from(
        (event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>(
          'input:not([disabled]), button:not([disabled]), [tabindex="0"]',
        ),
      ).filter((element) => element.offsetParent !== null);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveActive(1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveActive(-1);
      return;
    }
    if (event.key === 'Home' && selectableRows.length > 0) {
      event.preventDefault();
      setActiveId(selectableRows[0]?.node.id ?? null);
      return;
    }
    if (event.key === 'End' && selectableRows.length > 0) {
      event.preventDefault();
      setActiveId(selectableRows[selectableRows.length - 1]?.node.id ?? null);
      return;
    }
    if (event.key === 'ArrowRight' && activeRow?.hasChildren && !activeRow.expanded) {
      event.preventDefault();
      toggleExpanded(activeRow.node.id, false);
      return;
    }
    if (event.key === 'ArrowLeft' && activeRow?.hasChildren && activeRow.expanded) {
      event.preventDefault();
      toggleExpanded(activeRow.node.id, true);
      return;
    }
    if (event.key === 'Enter' && activeRow?.node.enabled) {
      event.preventDefault();
      select(activeRow.node.id);
    }
  };

  const popoverStyle = position
    ? ({
        '--category-picker-top': `${position.top}px`,
        '--category-picker-left': `${position.left}px`,
        '--category-picker-width': `${position.width}px`,
        '--category-picker-max-height': `${position.maxHeight}px`,
      } as CSSProperties)
    : undefined;

  return (
    <div className="category-picker">
      <button
        ref={triggerRef}
        type="button"
        id={inputId}
        className="category-picker-trigger"
        data-testid="category-picker-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        aria-label={`${t('products.categoryPicker.open')}: ${displayLabel}`}
        disabled={disabled}
        onClick={() => (open ? close() : openPicker())}
      >
        <span
          className={
            placeholderActive
              ? 'category-picker-value category-picker-placeholder'
              : 'category-picker-value'
          }
        >
          {displayLabel}
        </span>
        {selectedNode && !selectedNode.enabled ? (
          <span className="category-picker-disabled-badge">
            {t('products.categoryPicker.disabled')}
          </span>
        ) : null}
        <span className="category-picker-chevron" aria-hidden="true">
          ▾
        </span>
      </button>
      {mode === 'filter' && value ? (
        <button
          type="button"
          className="category-picker-clear"
          aria-label={t('products.categoryPicker.clear')}
          onClick={() => onChange(null)}
        >
          ×
        </button>
      ) : null}

      {open && position
        ? createPortal(
            <>
              <div
                className="category-picker-backdrop"
                data-testid="category-picker-backdrop"
                onMouseDown={(event) => {
                  if (event.target === event.currentTarget) close();
                }}
              />
              <div
                className="category-picker-popover"
                style={popoverStyle}
                role="dialog"
                aria-modal="true"
                aria-labelledby={dialogTitleId}
                onKeyDown={handleKeyDown}
              >
                <div className="category-picker-head">
                  <div className="category-picker-title-row">
                    <h2 id={dialogTitleId} className="category-picker-title">
                      {t('products.categoryPicker.title')}
                    </h2>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={t('common.close')}
                      onClick={() => close()}
                    >
                      ×
                    </button>
                  </div>
                  <input
                    ref={searchRef}
                    id={searchId}
                    className="input"
                    type="search"
                    role="combobox"
                    aria-autocomplete="list"
                    aria-expanded="true"
                    aria-controls={treeId}
                    aria-activedescendant={activeId ? rowId(treeId, activeId) : undefined}
                    placeholder={t('products.categoryPicker.search')}
                    value={term}
                    onChange={(event) => setTerm(event.target.value)}
                  />
                </div>

                <div className="category-picker-body">
                  {mode === 'filter' ? (
                    <button
                      type="button"
                      className={
                        value === null
                          ? 'category-picker-all category-picker-all--selected'
                          : 'category-picker-all'
                      }
                      aria-pressed={value === null}
                      onClick={() => select(null)}
                    >
                      {t('products.filters.categoryAll')}
                    </button>
                  ) : null}

                  <div id={treeId} role="tree" aria-label={t('products.categoryPicker.tree')}>
                    {loading ? (
                      <p className="category-picker-state">
                        {t('products.categoryPicker.loading')}
                      </p>
                    ) : errorLabel ? (
                      <div className="category-picker-state category-picker-error">
                        <span>{errorLabel}</span>
                        {onRetry ? (
                          <Button size="sm" variant="secondary" onClick={onRetry}>
                            {t('common.retry')}
                          </Button>
                        ) : null}
                      </div>
                    ) : rows.length === 0 ? (
                      <p className="category-picker-state">
                        {term.trim().length > 0
                          ? t('products.categoryPicker.noResults')
                          : t('products.categoryPicker.empty')}
                      </p>
                    ) : (
                      rows.map((row) => {
                        const { node, depth, hasChildren, expanded } = row;
                        const selected = value === node.id;
                        const rowDisabled = !node.enabled;
                        return (
                          <div
                            key={node.id}
                            id={rowId(treeId, node.id)}
                            role="treeitem"
                            aria-level={depth + 1}
                            aria-selected={selected}
                            aria-expanded={hasChildren ? expanded : undefined}
                            aria-disabled={rowDisabled || undefined}
                            data-testid={`category-option-${node.id}`}
                            data-disabled={rowDisabled || undefined}
                            data-active={activeId === node.id || undefined}
                            tabIndex={activeId === node.id ? 0 : -1}
                            className="category-picker-row"
                            style={{ paddingLeft: `calc(var(--space-2) + ${depth * 18}px)` }}
                            onFocus={() => setActiveId(node.id)}
                            onClick={() => {
                              setActiveId(node.id);
                              if (!rowDisabled) select(node.id);
                            }}
                          >
                            {hasChildren ? (
                              <button
                                type="button"
                                className="category-picker-toggle"
                                aria-label={
                                  expanded
                                    ? t('products.categoryPicker.collapse', { name: node.name })
                                    : t('products.categoryPicker.expand', { name: node.name })
                                }
                                onClick={(event) => {
                                  event.stopPropagation();
                                  toggleExpanded(node.id, expanded);
                                }}
                              >
                                {expanded ? '▾' : '▸'}
                              </button>
                            ) : (
                              <span className="category-picker-toggle" aria-hidden="true" />
                            )}
                            <span className="category-picker-radio" aria-hidden="true" />
                            <span className="category-picker-label">
                              {highlightParts(localizedName(node, locale), term).map(
                                (part, index) =>
                                  part.match ? (
                                    <mark key={`${part.text}-${index}`}>{part.text}</mark>
                                  ) : (
                                    <span key={`${part.text}-${index}`}>{part.text}</span>
                                  ),
                              )}
                            </span>
                            <span className="category-picker-code">{node.code}</span>
                            {rowDisabled ? (
                              <span className="category-picker-disabled-badge">
                                {t('products.categoryPicker.disabled')}
                              </span>
                            ) : null}
                            {selected ? (
                              <span className="category-picker-check" aria-hidden="true">
                                ✓
                              </span>
                            ) : null}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                <div className="category-picker-footer">
                  <span className="category-picker-selected">
                    {selectedPath
                      ? t('products.categoryPicker.selected', { path: selectedPath })
                      : t('products.categoryPicker.none')}
                  </span>
                  <span className="category-picker-hint">
                    {t('products.categoryPicker.keyboardHint')}
                  </span>
                </div>
              </div>
            </>,
            document.body,
          )
        : null}
    </div>
  );
}

function rowId(treeId: string, categoryId: string): string {
  return `${treeId}-${categoryId}`;
}
