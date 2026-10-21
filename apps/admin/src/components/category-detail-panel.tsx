'use client';

import type { CategoryDetail, CategoryNode } from '@b2b/contracts';
import {
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  ErrorState,
  LoadingState,
  type DataTableColumn,
} from '@b2b/ui';

export interface CategoryDetailPanelProps {
  detail: CategoryDetail | null;
  loading: boolean;
  /** Translated error text for the detail request (already localised). */
  error: string | null;
  requestId: string | null;
  onRetry: () => void;
  /** Name resolution for the API translations, keyed by admin locale. */
  locale: string;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  canMove: (node: CategoryNode, direction: 'up' | 'down') => boolean;
  busyId: string | null;
  onEdit: () => void;
  onAddChild: () => void;
  onDelete: () => void;
  onReorderChild: (node: CategoryNode, direction: 'up' | 'down') => void;
  onSelectNode: (id: string) => void;
  labels: CategoryDetailLabels;
}

/** Copy the panel needs, passed in so the panel itself holds no literals. */
export interface CategoryDetailLabels {
  empty: string;
  emptyHint: string;
  emptyAction: string;
  loading: string;
  errorTitle: string;
  retry: string;
  path: string;
  code: string;
  slug: string;
  parent: string;
  sortOrder: string;
  updatedAt: string;
  enabled: string;
  disabled: string;
  visible: string;
  hidden: string;
  directProducts: string;
  totalProducts: string;
  childrenTitle: string;
  childrenEmpty: string;
  childrenEmptyHint: string;
  addChild: string;
  edit: string;
  remove: string;
  moveUp: (name: string) => string;
  moveDown: (name: string) => string;
  deleteBlocked: string;
  columns: {
    name: string;
    code: string;
    slug: string;
    products: string;
    state: string;
    actions: string;
  };
  table: { loading: string; empty: string; errorTitle: string; retry: string };
}

function localizedName(node: CategoryNode, locale: string): string {
  return node.names[locale] ?? node.names['en-US'] ?? node.code;
}

/**
 * Right-hand panel of the category workbench (docs/22 §2.5).
 *
 * Direct and rolled-up product counts are rendered as two separate figures with
 * explicit labels: collapsing them into one number is what made the old page
 * mislead administrators about where products actually live.
 */
export function CategoryDetailPanel({
  detail,
  loading,
  error,
  requestId,
  onRetry,
  locale,
  canCreate,
  canUpdate,
  canDelete,
  canMove,
  busyId,
  onEdit,
  onAddChild,
  onDelete,
  onReorderChild,
  onSelectNode,
  labels,
}: CategoryDetailPanelProps) {
  const columns: DataTableColumn<CategoryNode>[] = [
    {
      key: 'name',
      header: labels.columns.name,
      render: (row) => (
        <button
          type="button"
          className="link-button"
          onClick={() => onSelectNode(row.id)}
          title={row.slug}
        >
          {localizedName(row, locale)}
        </button>
      ),
    },
    {
      key: 'code',
      header: labels.columns.code,
      render: (row) => <span className="mono">{row.code}</span>,
    },
    {
      key: 'slug',
      header: labels.columns.slug,
      render: (row) => <span className="mono">{row.slug}</span>,
    },
    {
      key: 'products',
      header: labels.columns.products,
      align: 'right',
      render: (row) => (
        <span className="mono">
          {row.productCount} / {row.totalProductCount}
        </span>
      ),
    },
    {
      key: 'state',
      header: labels.columns.state,
      render: (row) => (
        <span className="badge-stack">
          <Badge tone={row.enabled ? 'success' : 'neutral'}>
            {row.enabled ? labels.enabled : labels.disabled}
          </Badge>
          <Badge tone={row.visible ? 'info' : 'warning'}>
            {row.visible ? labels.visible : labels.hidden}
          </Badge>
        </span>
      ),
    },
    {
      key: 'actions',
      header: labels.columns.actions,
      align: 'right',
      render: (row) => (
        <div className="data-table-actions category-row-actions">
          <Button
            size="sm"
            variant="ghost"
            aria-label={labels.moveUp(localizedName(row, locale))}
            disabled={!canMove(row, 'up') || busyId === row.id}
            onClick={() => onReorderChild(row, 'up')}
          >
            ↑
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label={labels.moveDown(localizedName(row, locale))}
            disabled={!canMove(row, 'down') || busyId === row.id}
            onClick={() => onReorderChild(row, 'down')}
          >
            ↓
          </Button>
        </div>
      ),
    },
  ];

  if (loading && !detail) {
    return (
      <Card className="workbench-detail">
        <LoadingState label={labels.loading} rows={4} />
      </Card>
    );
  }

  if (error && !detail) {
    return (
      <Card className="workbench-detail">
        <ErrorState
          title={labels.errorTitle}
          description={error}
          requestId={requestId}
          onRetry={onRetry}
          retryLabel={labels.retry}
        />
      </Card>
    );
  }

  if (!detail) {
    return (
      <Card className="workbench-detail">
        <EmptyState
          title={labels.empty}
          description={labels.emptyHint}
          action={
            canCreate ? (
              <Button onClick={onAddChild} variant="secondary">
                {labels.emptyAction}
              </Button>
            ) : undefined
          }
        />
      </Card>
    );
  }

  const deleteBlocked = detail.children.length > 0 || detail.productCount > 0;

  return (
    <Card className="workbench-detail">
      <header className="workbench-detail-head">
        <div className="workbench-detail-title">
          <h2>{detail.names[locale] ?? detail.names['en-US'] ?? detail.code}</h2>
          <nav aria-label={labels.path}>
            <ol className="breadcrumb">
              {detail.path.map((entry, index) => (
                <li
                  key={entry.id}
                  aria-current={index === detail.path.length - 1 ? 'page' : undefined}
                >
                  {entry.name}
                </li>
              ))}
            </ol>
          </nav>
          <span className="badge-stack">
            <Badge tone={detail.enabled ? 'success' : 'neutral'}>
              {detail.enabled ? labels.enabled : labels.disabled}
            </Badge>
            <Badge tone={detail.visible ? 'info' : 'warning'}>
              {detail.visible ? labels.visible : labels.hidden}
            </Badge>
          </span>
        </div>
        <div className="workbench-detail-actions">
          {canCreate ? (
            <Button variant="secondary" onClick={onAddChild}>
              {labels.addChild}
            </Button>
          ) : null}
          {canUpdate ? <Button onClick={onEdit}>{labels.edit}</Button> : null}
          {canDelete ? (
            <Button
              variant="danger"
              onClick={onDelete}
              disabled={deleteBlocked}
              title={deleteBlocked ? labels.deleteBlocked : undefined}
            >
              {labels.remove}
            </Button>
          ) : null}
        </div>
      </header>

      <dl className="meta-grid">
        <div>
          <dt>{labels.code}</dt>
          <dd className="mono">{detail.code}</dd>
        </div>
        <div>
          <dt>{labels.slug}</dt>
          <dd className="mono">{detail.slug}</dd>
        </div>
        <div>
          <dt>{labels.parent}</dt>
          <dd>{detail.parentName ?? '—'}</dd>
        </div>
        <div>
          <dt>{labels.sortOrder}</dt>
          <dd className="mono">{detail.sortOrder}</dd>
        </div>
        <div>
          <dt>{labels.directProducts}</dt>
          <dd className="mono">{detail.productCount}</dd>
        </div>
        <div>
          <dt>{labels.totalProducts}</dt>
          <dd className="mono">{detail.totalProductCount}</dd>
        </div>
        <div>
          <dt>{labels.updatedAt}</dt>
          <dd>{formatTimestamp(detail.updatedAt, locale)}</dd>
        </div>
      </dl>

      <section className="workbench-children">
        <div className="workbench-children-head">
          <h3>{`${labels.childrenTitle} (${detail.children.length})`}</h3>
          {canCreate ? (
            <Button size="sm" variant="secondary" onClick={onAddChild}>
              {labels.addChild}
            </Button>
          ) : null}
        </div>
        <DataTable
          columns={columns}
          rows={detail.children}
          rowKey={(row) => row.id}
          labels={labels.table}
          emptyAction={
            canCreate ? (
              <Button size="sm" onClick={onAddChild}>
                {labels.addChild}
              </Button>
            ) : undefined
          }
        />
      </section>
    </Card>
  );
}

/** Locale-aware timestamp; rendered client-side so server and client agree. */
function formatTimestamp(value: string, locale: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
