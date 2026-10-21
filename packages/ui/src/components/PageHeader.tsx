'use client';

import type { ReactNode } from 'react';
import { Breadcrumb, type BreadcrumbItem } from './Breadcrumb';

export interface PageHeaderProps {
  breadcrumb?: BreadcrumbItem[];
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** Optional secondary line, for example record counts or sync status. */
  meta?: ReactNode;
  linkComponent?: (item: BreadcrumbItem, children: ReactNode) => ReactNode;
}

// Fixed page header order: breadcrumb, H1, description, actions (docs/16 §4.3).
export function PageHeader({
  breadcrumb,
  title,
  description,
  actions,
  meta,
  linkComponent,
}: PageHeaderProps) {
  return (
    <header className="page-header">
      <div className="page-header-main">
        {breadcrumb && breadcrumb.length > 0 ? (
          <Breadcrumb items={breadcrumb} linkComponent={linkComponent} />
        ) : null}
        <h1 className="page-header-title">{title}</h1>
        {description ? <p className="page-header-description">{description}</p> : null}
        {meta ? <div className="meta-list">{meta}</div> : null}
      </div>
      {actions ? <div className="page-header-actions">{actions}</div> : null}
    </header>
  );
}
