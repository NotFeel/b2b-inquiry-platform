'use client';

import { useCallback, useEffect, useState } from 'react';
import type { AuditLogRow } from '@b2b/contracts';
import {
  Button,
  CopyButton,
  DataTable,
  Drawer,
  Field,
  IdCell,
  Input,
  PageHeader,
  Pagination,
  Select,
  Toolbar,
  type DataTableColumn,
} from '@b2b/ui';
import { AdminApiError, adminApi } from '../../../../lib/admin-api';
import { auditActionLabel, translateError } from '../../../../lib/i18n';
import { useSession } from '../../../../components/session-provider';

// Audit log (docs/16 §5): explicit filters, human-readable event names with the
// technical code kept in the detail drawer, ellipsised ids with copy, and a
// detail view instead of a raw JSON dump inside the table.

const ACTION_OPTIONS = [
  'auth.login_succeeded',
  'auth.login_failed',
  'auth.logout',
  'auth.password_changed',
  'user.create',
  'user.update',
  'user.delete',
  'user.password_reset',
  'role.create',
  'role.update',
  'role.delete',
  'settings.update',
  'category.create',
  'category.update',
  'category.move',
  'category.delete',
  'product.create',
  'product.update',
  'product.publish',
  'product.unpublish',
  'product.delete',
  'file.upload',
  'file.delete',
  'ad.upsert',
  'ad.delete',
  'quote_template.create',
  'quote_template.status',
  'quote_export.create',
  'quote_export.delete_requested',
  // Historical records stay filterable; the feature no longer creates this action.
  'pdf.convert_requested',
  'pi.create',
  'pi.update',
  'pi.export',
  'pi.revision.create',
  'customer.create',
  'inquiry_activity.create',
];

interface FilterState {
  q: string;
  actor: string;
  action: string;
  from: string;
  to: string;
}

const EMPTY_FILTERS: FilterState = { q: '', actor: '', action: '', from: '', to: '' };

export default function AuditLogsPage() {
  const { t, locale } = useSession();
  const [rows, setRows] = useState<AuditLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [staged, setStaged] = useState<FilterState>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<FilterState>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 20, total: 0, totalPages: 1 });
  const [detailRow, setDetailRow] = useState<AuditLogRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await adminApi.list<AuditLogRow>('/admin/audit-logs', {
        page,
        pageSize,
        sortOrder: 'desc',
        ...(applied.q ? { q: applied.q } : {}),
        ...(applied.actor ? { actorId: applied.actor } : {}),
        ...(applied.action ? { action: applied.action } : {}),
        ...(applied.from ? { from: new Date(applied.from).toISOString() } : {}),
        ...(applied.to ? { to: new Date(`${applied.to}T23:59:59`).toISOString() } : {}),
      });
      setRows(result.data);
      setPagination(result.pagination);
      setError(null);
      setRequestId(null);
    } catch (caught) {
      setError(caught instanceof AdminApiError ? caught.code : 'INTERNAL_ERROR');
      setRequestId(caught instanceof AdminApiError ? caught.requestId ?? null : null);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, applied]);

  useEffect(() => {
    void load();
  }, [load]);

  const activeChips = Object.entries(applied)
    .filter(([, value]) => value.length > 0)
    .map(([key, value]) => ({
      key,
      label: key === 'action' ? auditActionLabel(locale, value) : `${key}: ${value}`,
    }));

  const columns: DataTableColumn<AuditLogRow>[] = [
    {
      key: 'createdAt',
      header: t('audit.columns.time'),
      width: 180,
      render: (row) => new Date(row.createdAt).toLocaleString(locale),
    },
    {
      key: 'actor',
      header: t('audit.columns.actor'),
      width: 160,
      render: (row) =>
        row.actorName ?? <span className="badge badge-neutral">{t('list.systemActor')}</span>,
    },
    {
      key: 'action',
      header: t('audit.columns.action'),
      width: 240,
      render: (row) => (
        <span className="stack-xs">
          <span className="cell-primary">{auditActionLabel(locale, row.action)}</span>
          <span className="cell-sub mono">{row.action}</span>
        </span>
      ),
    },
    {
      key: 'entity',
      header: t('audit.columns.entity'),
      width: 260,
      render: (row) =>
        row.entityId ? (
          <IdCell
            value={row.entityId}
            prefix={row.entityType}
            copyLabel={t('list.copy')}
            copiedLabel={t('list.copied')}
          />
        ) : (
          <span className="muted small">{row.entityType}</span>
        ),
    },
    {
      key: 'requestId',
      header: t('audit.columns.requestId'),
      width: 200,
      render: (row) =>
        row.requestId ? (
          <IdCell
            value={row.requestId}
            copyLabel={t('list.copy')}
            copiedLabel={t('list.copied')}
            maxWidth={180}
          />
        ) : (
          <span className="faint">—</span>
        ),
    },
    {
      key: 'detail',
      header: t('audit.columns.detail'),
      align: 'right',
      render: (row) => (
        <Button size="sm" variant="secondary" onClick={() => setDetailRow(row)}>
          {t('list.detail')}
        </Button>
      ),
    },
  ];

  const rangeStart = pagination.total === 0 ? 0 : (pagination.page - 1) * pagination.pageSize + 1;
  const rangeEnd = Math.min(pagination.page * pagination.pageSize, pagination.total);

  return (
    <div className="stack">
      <PageHeader
        breadcrumb={[{ label: t('nav.system') }, { label: t('audit.title') }]}
        title={t('audit.title')}
        description={t('audit.description')}
        meta={<span>{t('audit.timezoneNote')}</span>}
      />

      <Toolbar
        summary={t('list.summary', { total: pagination.total })}
        activeFilters={
          activeChips.length > 0
            ? activeChips.map((chip) => (
                <li key={chip.key} className="filter-chip">
                  {chip.label}
                </li>
              ))
            : undefined
        }
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setStaged(EMPTY_FILTERS);
                setApplied(EMPTY_FILTERS);
                setPage(1);
              }}
            >
              {t('list.reset')}
            </Button>
            <Button
              onClick={() => {
                setApplied(staged);
                setPage(1);
              }}
            >
              {t('list.apply')}
            </Button>
          </>
        }
      >
        <Field label={t('audit.filters.keyword')}>
          {({ inputId, describedBy }) => (
            <Input
              inputId={inputId}
              describedBy={describedBy}
              type="search"
              value={staged.q}
              placeholder="requestId / entity ID / action"
              onChange={(event) => setStaged((current) => ({ ...current, q: event.target.value }))}
            />
          )}
        </Field>
        <Field label={t('audit.filters.actor')}>
          {({ inputId, describedBy }) => (
            <Input
              inputId={inputId}
              describedBy={describedBy}
              value={staged.actor}
              placeholder="admin"
              onChange={(event) => setStaged((current) => ({ ...current, actor: event.target.value }))}
            />
          )}
        </Field>
        <Field label={t('audit.filters.action')}>
          {({ inputId, describedBy }) => (
            <Select
              inputId={inputId}
              describedBy={describedBy}
              value={staged.action}
              placeholder={t('audit.filters.allActions')}
              options={ACTION_OPTIONS.map((code) => ({ value: code, label: auditActionLabel(locale, code) }))}
              onChange={(event) => setStaged((current) => ({ ...current, action: event.target.value }))}
            />
          )}
        </Field>
        <Field label={t('audit.filters.from')}>
          {({ inputId, describedBy }) => (
            <Input
              inputId={inputId}
              describedBy={describedBy}
              type="date"
              value={staged.from}
              onChange={(event) => setStaged((current) => ({ ...current, from: event.target.value }))}
            />
          )}
        </Field>
        <Field label={t('audit.filters.to')}>
          {({ inputId, describedBy }) => (
            <Input
              inputId={inputId}
              describedBy={describedBy}
              type="date"
              value={staged.to}
              onChange={(event) => setStaged((current) => ({ ...current, to: event.target.value }))}
            />
          )}
        </Field>
      </Toolbar>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        loading={loading}
        error={error ? translateError(locale, error) : null}
        requestId={requestId}
        onRetry={() => void load()}
        onRowClick={(row) => setDetailRow(row)}
        emptySecondaryAction={
          activeChips.length > 0 ? (
            <Button
              variant="secondary"
              onClick={() => {
                setStaged(EMPTY_FILTERS);
                setApplied(EMPTY_FILTERS);
                setPage(1);
              }}
            >
              {t('list.clearFilters')}
            </Button>
          ) : undefined
        }
        labels={{
          empty: activeChips.length > 0 ? t('audit.empty') : t('list.empty'),
          emptyDescription: activeChips.length > 0 ? t('audit.emptyHint') : undefined,
          loading: t('common.loading'),
          errorTitle: t('common.error'),
          retry: t('common.retry'),
          copy: t('list.copy'),
          copied: t('list.copied'),
        }}
      />

      <Pagination
        page={pagination.page}
        pageSize={pagination.pageSize}
        total={pagination.total}
        totalPages={pagination.totalPages}
        onPageChange={(next) => setPage(next)}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        labels={{
          previous: t('common.previous'),
          next: t('common.next'),
          rowsPerPage: t('common.rowsPerPage'),
          range: t('list.range', { from: rangeStart, to: rangeEnd, total: pagination.total }),
        }}
      />

      <Drawer
        open={detailRow !== null}
        title={t('audit.detail.title')}
        onClose={() => setDetailRow(null)}
        closeLabel={t('common.close')}
      >
        {detailRow ? (
          <div className="stack">
            <dl className="definition-list">
              <dt>{t('audit.detail.time')}</dt>
              <dd>{new Date(detailRow.createdAt).toLocaleString(locale)}</dd>
              <dt>{t('audit.detail.actor')}</dt>
              <dd>{detailRow.actorName ?? t('list.systemActor')}</dd>
              <dt>{t('audit.detail.actionName')}</dt>
              <dd>{auditActionLabel(locale, detailRow.action)}</dd>
              <dt>{t('audit.detail.actionCode')}</dt>
              <dd className="row-tight">
                <code className="mono">{detailRow.action}</code>
                <CopyButton
                  value={detailRow.action}
                  label={t('list.copy')}
                  copiedLabel={t('list.copied')}
                  size={14}
                />
              </dd>
              <dt>{t('audit.detail.entityType')}</dt>
              <dd>{detailRow.entityType}</dd>
              <dt>{t('audit.detail.entityId')}</dt>
              <dd>
                {detailRow.entityId ? (
                  <IdCell
                    value={detailRow.entityId}
                    copyLabel={t('list.copy')}
                    copiedLabel={t('list.copied')}
                    maxWidth={280}
                  />
                ) : (
                  '—'
                )}
              </dd>
              <dt>{t('audit.detail.requestId')}</dt>
              <dd>
                {detailRow.requestId ? (
                  <IdCell
                    value={detailRow.requestId}
                    copyLabel={t('list.copy')}
                    copiedLabel={t('list.copied')}
                    maxWidth={280}
                  />
                ) : (
                  '—'
                )}
              </dd>
            </dl>
            <div>
              <h3 style={{ fontSize: 'var(--text-base)', marginBottom: 'var(--space-2)' }}>
                {t('audit.detail.metadata')}
              </h3>
              {detailRow.metadata ? (
                <pre className="detail-json">{JSON.stringify(detailRow.metadata, null, 2)}</pre>
              ) : (
                <p className="muted small">{t('audit.detail.noMetadata')}</p>
              )}
            </div>
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}
