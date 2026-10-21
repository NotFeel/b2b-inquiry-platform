'use client';

import type { ReactNode } from 'react';

export interface CardProps {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}

export function Card({ title, actions, children, footer, className }: CardProps) {
  return (
    <section className={['card', className].filter(Boolean).join(' ')}>
      {title || actions ? (
        <header className="card-header">
          {typeof title === 'string' ? <h3>{title}</h3> : title}
          {actions ? <div className="row">{actions}</div> : null}
        </header>
      ) : null}
      <div className="card-body">{children}</div>
      {footer ? <footer className="card-footer">{footer}</footer> : null}
    </section>
  );
}

export interface StatCardProps {
  label: string;
  value: string;
  hint?: string;
}

export function StatCard({ label, value, hint }: StatCardProps) {
  return (
    <div className="stat-card">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {hint ? <span className="field-help">{hint}</span> : null}
    </div>
  );
}
