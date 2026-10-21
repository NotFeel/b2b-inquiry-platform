'use client';

import type { ReactNode } from 'react';
import { Button } from './Button';
import { CopyButton } from './CopyButton';
import { IconAlert, IconInfo, IconSearch } from './icons';

export interface EmptyStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
  /** Secondary action slot, for example "clear filters". */
  secondaryAction?: ReactNode;
  variant?: 'default' | 'search' | 'info';
}

export function EmptyState({
  title,
  description,
  action,
  secondaryAction,
  variant = 'default',
}: EmptyStateProps) {
  const Icon = variant === 'search' ? IconSearch : IconInfo;
  return (
    <div className="state-block" role="status">
      <span className="state-icon">
        <Icon size={22} />
      </span>
      <strong>{title}</strong>
      {description ? <span>{description}</span> : null}
      {action || secondaryAction ? (
        <div className="state-actions">
          {action}
          {secondaryAction}
        </div>
      ) : null}
    </div>
  );
}

export interface LoadingStateProps {
  label: string;
  rows?: number;
}

export function LoadingState({ label, rows = 4 }: LoadingStateProps) {
  return (
    <div className="stack-sm" role="status" aria-live="polite">
      <span className="visually-hidden">{label}</span>
      {Array.from({ length: rows }).map((_, index) => (
        <span
          key={index}
          className="skeleton"
          style={{ height: 16, width: index === rows - 1 ? '62%' : '100%' }}
        />
      ))}
    </div>
  );
}

export interface ErrorStateProps {
  title: string;
  description?: string;
  retryLabel?: string;
  onRetry?: () => void;
  requestId?: string | null;
  copyLabel?: string;
  copiedLabel?: string;
}

export function ErrorState({
  title,
  description,
  retryLabel,
  onRetry,
  requestId,
  copyLabel = 'Copy',
  copiedLabel = 'Copied',
}: ErrorStateProps) {
  return (
    <div className="state-block state-error" role="alert">
      <span className="state-icon">
        <IconAlert size={22} />
      </span>
      <strong>{title}</strong>
      {description ? <span>{description}</span> : null}
      {requestId ? (
        <span className="row-tight small mono">
          requestId: {requestId}
          <CopyButton value={requestId} label={copyLabel} copiedLabel={copiedLabel} />
        </span>
      ) : null}
      {onRetry ? (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          {retryLabel ?? 'Retry'}
        </Button>
      ) : null}
    </div>
  );
}

export interface SkeletonProps {
  height?: number;
  width?: string | number;
  className?: string;
}

export function Skeleton({ height = 16, width = '100%', className }: SkeletonProps) {
  return (
    <span
      className={['skeleton', className].filter(Boolean).join(' ')}
      style={{ height, width }}
      aria-hidden="true"
    />
  );
}
