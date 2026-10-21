'use client';

import type { ReactNode } from 'react';

export interface TabItem {
  id: string;
  label: string;
  badge?: string;
}

export interface TabsProps {
  items: TabItem[];
  activeId: string;
  onChange: (id: string) => void;
  ariaLabel: string;
}

export function Tabs({ items, activeId, onChange, ariaLabel }: TabsProps) {
  return (
    <div className="tabs" role="tablist" aria-label={ariaLabel}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          id={`tab-${item.id}`}
          aria-selected={item.id === activeId}
          aria-controls={`panel-${item.id}`}
          className="tab"
          onClick={() => onChange(item.id)}
          onKeyDown={(event) => {
            const index = items.findIndex((candidate) => candidate.id === item.id);
            if (event.key === 'ArrowRight') {
              const next = items[(index + 1) % items.length];
              if (next) onChange(next.id);
            }
            if (event.key === 'ArrowLeft') {
              const previous = items[(index - 1 + items.length) % items.length];
              if (previous) onChange(previous.id);
            }
          }}
        >
          {item.label}
          {item.badge ? <span className="badge badge-neutral" style={{ marginLeft: 6 }}>{item.badge}</span> : null}
        </button>
      ))}
    </div>
  );
}

export interface TabPanelProps {
  id: string;
  activeId: string;
  children: ReactNode;
}

export function TabPanel({ id, activeId, children }: TabPanelProps) {
  if (id !== activeId) return null;
  return (
    <div role="tabpanel" id={`panel-${id}`} aria-labelledby={`tab-${id}`} tabIndex={0}>
      {children}
    </div>
  );
}
