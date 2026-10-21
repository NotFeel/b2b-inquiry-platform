'use client';

import { IconChevronRight } from './icons';

export interface PaginationLabels {
  previous: string;
  next: string;
  rowsPerPage: string;
  /** Fully rendered summary, for example `1–20 of 126`. */
  range: string;
  first?: string;
  last?: string;
}

export interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  pageSizeOptions?: number[];
  labels: PaginationLabels;
}

export function Pagination({
  page,
  pageSize,
  total: _total,
  totalPages,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [20, 50, 100],
  labels,
}: PaginationProps) {
  const lastPage = Math.max(1, totalPages);
  const disablePrev = page <= 1;
  const disableNext = page >= lastPage;

  return (
    <nav className="pagination" aria-label="pagination">
      <span className="pagination-range" aria-live="polite">
        {labels.range}
      </span>
      <div className="pagination-controls">
        {onPageSizeChange ? (
          <div className="pagination-page-size">
            <label className="field-help" htmlFor="page-size-select">
              {labels.rowsPerPage}
            </label>
            <select
              id="page-size-select"
              className="select"
              value={pageSize}
              onChange={(event) => onPageSizeChange(Number(event.target.value))}
            >
              {pageSizeOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={disablePrev}
        >
          {labels.previous}
        </button>
        <span className="pagination-status nowrap">
          {page} / {lastPage}
        </span>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => onPageChange(Math.min(lastPage, page + 1))}
          disabled={disableNext}
        >
          {labels.next}
          <IconChevronRight size={14} />
        </button>
      </div>
    </nav>
  );
}
