'use client';

import type { ReactNode } from 'react';
import { CopyButton } from './CopyButton';
import { EmptyState, ErrorState, LoadingState } from './states';
import { IconChevronDown } from './icons';

export interface DataTableColumn<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  sortable?: boolean;
  align?: 'left' | 'right';
  width?: string | number;
  /** Long text: single line with ellipsis and a title tooltip. */
  truncate?: boolean;
}

export interface DataTableLabels {
  empty: string;
  emptyDescription?: string;
  loading: string;
  errorTitle: string;
  retry: string;
  copy?: string;
  copied?: string;
  caption?: string;
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  labels: DataTableLabels;
  loading?: boolean;
  loadingRows?: number;
  error?: string | null;
  onRetry?: () => void;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  onSortChange?: (key: string) => void;
  emptyAction?: ReactNode;
  emptySecondaryAction?: ReactNode;
  requestId?: string | null;
  /** Opens a detail drawer from the whole row. */
  onRowClick?: (row: T) => void;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  labels,
  loading = false,
  loadingRows = 6,
  error = null,
  onRetry,
  sortBy,
  sortOrder,
  onSortChange,
  emptyAction,
  emptySecondaryAction,
  requestId,
  onRowClick,
}: DataTableProps<T>) {
  if (loading && rows.length === 0) {
    return (
      <div className="table-wrap" style={{ padding: 'var(--space-4)' }}>
        <LoadingState label={labels.loading} rows={loadingRows} />
      </div>
    );
  }

  if (error && rows.length === 0) {
    return (
      <div className="table-wrap">
        <ErrorState
          title={labels.errorTitle}
          description={error}
          retryLabel={labels.retry}
          onRetry={onRetry}
          requestId={requestId}
          copyLabel={labels.copy}
          copiedLabel={labels.copied}
        />
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="table-wrap">
        <EmptyState
          title={labels.empty}
          description={labels.emptyDescription}
          action={emptyAction}
          secondaryAction={emptySecondaryAction}
          variant="search"
        />
      </div>
    );
  }

  return (
    <div className="table-wrap">
      <table className={['data-table', onRowClick ? 'data-table-clickable' : ''].filter(Boolean).join(' ')}>
        {labels.caption ? <caption>{labels.caption}</caption> : null}
        <thead>
          <tr>
            {columns.map((column) => {
              const isSorted = sortBy === column.key;
              return (
                <th
                  key={column.key}
                  scope="col"
                  style={{ width: column.width, textAlign: column.align ?? 'left' }}
                  aria-sort={isSorted ? (sortOrder === 'asc' ? 'ascending' : 'descending') : undefined}
                >
                  {column.sortable && onSortChange ? (
                    <button
                      type="button"
                      className="data-table-sort"
                      onClick={() => onSortChange(column.key)}
                    >
                      {column.header}
                      <IconChevronDown
                        size={14}
                        style={{
                          transform: isSorted && sortOrder === 'asc' ? 'rotate(180deg)' : undefined,
                          opacity: isSorted ? 1 : 0.35,
                        }}
                      />
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              onKeyDown={
                onRowClick
                  ? (event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        onRowClick(row);
                      }
                    }
                  : undefined
              }
            >
              {columns.map((column) => {
                const content = column.render(row);
                return (
                  <td key={column.key} style={{ textAlign: column.align ?? 'left' }}>
                    {column.truncate ? (
                      <span className="truncate" title={typeof content === 'string' ? content : undefined}>
                        {content}
                      </span>
                    ) : (
                      content
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export interface IdCellProps {
  value: string;
  copyLabel: string;
  copiedLabel: string;
  /** Prefix kept visible, for example an entity type. */
  prefix?: string | null;
  maxWidth?: number;
}

/**
 * Technical identifiers stay on one line with an ellipsis and an explicit copy
 * action, so long UUIDs never stretch the table (docs/16 §5.2).
 */
export function IdCell({ value, copyLabel, copiedLabel, prefix, maxWidth = 220 }: IdCellProps) {
  const display = value.length > 14 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value;
  return (
    <span className="id-cell" style={{ maxWidth }}>
      <code title={value}>
        {prefix ? `${prefix} · ` : ''}
        {display}
      </code>
      <CopyButton value={value} label={copyLabel} copiedLabel={copiedLabel} size={14} />
    </span>
  );
}
