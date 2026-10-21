'use client';

import type { ReactNode } from 'react';

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

export interface BreadcrumbProps {
  items: BreadcrumbItem[];
  linkComponent?: (item: BreadcrumbItem, children: ReactNode) => ReactNode;
}

export function Breadcrumb({ items, linkComponent }: BreadcrumbProps) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="breadcrumb">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          const content = item.href && !isLast ? item.href : item.label;
          return (
            <li key={`${item.label}-${index}`} aria-current={isLast ? 'page' : undefined}>
              {!isLast && item.href && linkComponent ? linkComponent(item, item.label) : content}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
