'use client';

import type { ReactNode } from 'react';

export interface ToolbarProps {
  /** Filter controls, each wrapped in a Field by the caller. */
  children: ReactNode;
  actions?: ReactNode;
  summary?: ReactNode;
  activeFilters?: ReactNode;
}

/**
 * Shared filter toolbar. Filtering is submitted explicitly (Search button or
 * Enter) so the behaviour is identical on every admin list page (docs/16 §4.3).
 */
export function Toolbar({ children, actions, summary, activeFilters }: ToolbarProps) {
  return (
    <section className="toolbar" aria-label="filters">
      <div className="toolbar-fields">{children}</div>
      {actions ? <div className="toolbar-actions">{actions}</div> : null}
      {summary || activeFilters ? (
        <div className="toolbar-summary">
          <div>{summary}</div>
          {activeFilters ? <ul className="active-filters">{activeFilters}</ul> : null}
        </div>
      ) : null}
    </section>
  );
}
