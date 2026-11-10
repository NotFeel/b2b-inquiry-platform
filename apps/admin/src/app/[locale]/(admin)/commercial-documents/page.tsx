'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Badge,
  Button,
  ConfirmDialog,
  Field,
  Input,
  PageHeader,
  Pagination,
  Select,
  useToast,
} from '@b2b/ui';
import { isCommercialDocumentDownloadable } from '@b2b/contracts';
import type { PaginatedResponse } from '../../../../lib/admin-api';
import { AdminApiError } from '../../../../lib/admin-api';
import { commercialDocumentsApi } from '../../../../lib/commercial-documents-api';
import type { CommercialDocumentSummary } from '../../../../lib/commercial-documents-api';
import { localeHref, translateError } from '../../../../lib/i18n';
import { useBreadcrumb } from '../../../../components/use-breadcrumb';
import { useSession } from '../../../../components/session-provider';

function statusTone(status: string): 'neutral' | 'success' | 'warning' | 'danger' {
  switch (status) {
    case 'ISSUED':
      return 'success';
    case 'REVIEW':
      return 'warning';
    case 'CANCELLED':
      return 'danger';
    default:
      return 'neutral';
  }
}

export default function CommercialDocumentsPage() {
  const { t, can, locale } = useSession();
  const breadcrumb = useBreadcrumb();
  const toast = useToast();
  const router = useRouter();

  const [rows, setRows] = useState<CommercialDocumentSummary[]>([]);
  const [pagination, setPagination] = useState<PaginatedResponse<CommercialDocumentSummary>['pagination']>({
    page: 1,
    pageSize: 20,
    total: 0,
    totalPages: 1,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [filters, setFilters] = useState({
    q: '',
    type: 'all',
    status: 'all',
    from: '',
    to: '',
  });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [downloadBusy, setDownloadBusy] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<CommercialDocumentSummary | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setRequestId(null);
    try {
      const result = await commercialDocumentsApi.documents({
        page,
        pageSize,
        type: filters.type,
        status: filters.status,
        ...(filters.q ? { q: filters.q } : {}),
        ...(filters.from ? { from: filters.from } : {}),
        ...(filters.to ? { to: filters.to } : {}),
      });
      setRows(result.data);
      setPagination(result.pagination);
    } catch (cause) {
      setError(
        cause instanceof AdminApiError
          ? translateError(locale, cause.code)
          : t('errors.INTERNAL_ERROR'),
      );
      setRequestId(cause instanceof AdminApiError ? (cause.requestId ?? null) : null);
    } finally {
      setLoading(false);
    }
  }, [filters, locale, page, pageSize, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const download = async (row: CommercialDocumentSummary) => {
    if (!row.hasPdf) {
      toast.error(t('commercialDocuments.renderStatus.none'));
      return;
    }
    setDownloadBusy(row.id);
    try {
      const file = await commercialDocumentsApi.downloadDocument(
        row.id,
        `${row.documentNo}-R${row.revisionNo}.pdf`,
      );
      const url = URL.createObjectURL(file.blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = file.filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (cause) {
      toast.error(
        cause instanceof AdminApiError
          ? translateError(locale, cause.code)
          : t('errors.INTERNAL_ERROR'),
      );
    } finally {
      setDownloadBusy('');
    }
  };

  const removeDocument = async () => {
    if (!deleteTarget || !can('commercial_document.delete')) return;
    setDeleteBusy(true);
    try {
      await commercialDocumentsApi.deleteDocument(deleteTarget.id);
      const lastRowOnPage = rows.length === 1;
      setDeleteTarget(null);
      toast.success(t('commercialDocuments.actions.deleted'));
      if (lastRowOnPage && page > 1) {
        setPage((current) => Math.max(1, current - 1));
      } else {
        await load();
      }
    } catch (cause) {
      toast.error(
        cause instanceof AdminApiError
          ? translateError(locale, cause.code)
          : t('errors.INTERNAL_ERROR'),
      );
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <div className="stack">
      <PageHeader
        breadcrumb={breadcrumb}
        title={t('commercialDocuments.title')}
        description={t('commercialDocuments.description')}
        actions={
          <div className="row-actions">
            <Button variant="secondary" loading={loading} onClick={() => void load()}>
              {t('commercialDocuments.actions.refresh')}
            </Button>
            {can('commercial_document.create') && can('order.read') ? (
              <Button onClick={() => router.push(localeHref(locale, '/orders'))}>
                {t('commercialDocuments.actions.new')}
              </Button>
            ) : null}
          </div>
        }
      />

      {error ? (
        <div className="alert alert-error" role="alert">
          {error}
          {requestId ? <span className="mono"> · {requestId}</span> : null}
        </div>
      ) : null}

      <section className="panel stack-sm">
        <div className="form-grid">
          <Field label={t('commercialDocuments.filters.search')}>
            {({ inputId, describedBy }) => (
              <Input
                inputId={inputId}
                describedBy={describedBy}
                value={filters.q}
                onChange={(event) => {
                  setPage(1);
                  setFilters((current) => ({ ...current, q: event.target.value }));
                }}
                maxLength={120}
              />
            )}
          </Field>
          <Field label={t('commercialDocuments.filters.type')}>
            {({ inputId, describedBy }) => (
              <Select
                inputId={inputId}
                describedBy={describedBy}
                value={filters.type}
                options={[
                  { value: 'all', label: t('commercialDocuments.types.all') },
                  { value: 'PI', label: t('commercialDocuments.types.PI') },
                  { value: 'CI', label: t('commercialDocuments.types.CI') },
                ]}
                onChange={(event) => {
                  setPage(1);
                  setFilters((current) => ({ ...current, type: event.target.value }));
                }}
              />
            )}
          </Field>
          <Field label={t('commercialDocuments.filters.status')}>
            {({ inputId, describedBy }) => (
              <Select
                inputId={inputId}
                describedBy={describedBy}
                value={filters.status}
                options={[
                  { value: 'all', label: t('commercialDocuments.statuses.all') },
                  { value: 'DRAFT', label: t('commercialDocuments.statuses.DRAFT') },
                  { value: 'REVIEW', label: t('commercialDocuments.statuses.REVIEW') },
                  { value: 'ISSUED', label: t('commercialDocuments.statuses.ISSUED') },
                  { value: 'SUPERSEDED', label: t('commercialDocuments.statuses.SUPERSEDED') },
                  { value: 'CANCELLED', label: t('commercialDocuments.statuses.CANCELLED') },
                ]}
                onChange={(event) => {
                  setPage(1);
                  setFilters((current) => ({ ...current, status: event.target.value }));
                }}
              />
            )}
          </Field>
          <Field label={t('commercialDocuments.filters.from')}>
            {({ inputId, describedBy }) => (
              <Input
                inputId={inputId}
                describedBy={describedBy}
                type="date"
                value={filters.from}
                onChange={(event) => {
                  setPage(1);
                  setFilters((current) => ({ ...current, from: event.target.value }));
                }}
              />
            )}
          </Field>
          <Field label={t('commercialDocuments.filters.to')}>
            {({ inputId, describedBy }) => (
              <Input
                inputId={inputId}
                describedBy={describedBy}
                type="date"
                value={filters.to}
                onChange={(event) => {
                  setPage(1);
                  setFilters((current) => ({ ...current, to: event.target.value }));
                }}
              />
            )}
          </Field>
        </div>
      </section>

      <section className="panel table-scroll" aria-live="polite">
        {loading ? (
          <p>{t('common.loading')}</p>
        ) : rows.length === 0 ? (
          <p>{t('common.empty')}</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>{t('commercialDocuments.columns.documentNo')}</th>
                <th>{t('commercialDocuments.columns.type')}</th>
                <th>{t('commercialDocuments.columns.revision')}</th>
                <th>{t('commercialDocuments.columns.order')}</th>
                <th>{t('commercialDocuments.columns.buyer')}</th>
                <th>{t('commercialDocuments.columns.currency')}</th>
                <th>{t('commercialDocuments.columns.total')}</th>
                <th>{t('commercialDocuments.columns.issueDate')}</th>
                <th>{t('commercialDocuments.columns.status')}</th>
                <th>{t('commercialDocuments.columns.template')}</th>
                <th>{t('commercialDocuments.columns.render')}</th>
                <th>{t('commercialDocuments.columns.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="mono">
                    <button
                      type="button"
                      className="link-button"
                      onClick={() =>
                        router.push(localeHref(locale, `/commercial-documents/${row.id}`))
                      }
                    >
                      {row.documentNo}
                    </button>
                  </td>
                  <td>{t(`commercialDocuments.types.${row.type}`)}</td>
                  <td>R{row.revisionNo}</td>
                  <td className="mono">{row.orderNo ?? '—'}</td>
                  <td>{row.buyerName ?? '—'}</td>
                  <td>{row.currency}</td>
                  <td className="mono">{row.totalAmount}</td>
                  <td>{row.issueDate ?? '—'}</td>
                  <td>
                    <Badge tone={statusTone(row.status)}>
                      {t(`commercialDocuments.statuses.${row.status}`)}
                    </Badge>
                  </td>
                  <td>
                    {row.templateName ?? '—'}
                    {row.templateVersion ? ` v${row.templateVersion}` : ''}
                  </td>
                  <td>
                    <Badge
                      tone={
                        row.renderStatus === 'FAILED'
                          ? 'danger'
                          : row.renderStatus === 'SUCCEEDED'
                            ? 'success'
                            : 'neutral'
                      }
                    >
                      {row.renderStatus
                        ? t(`commercialDocuments.renderStatus.${row.renderStatus}`)
                        : t('commercialDocuments.renderStatus.none')}
                    </Badge>
                  </td>
                  <td>
                    <div className="row-actions">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          router.push(localeHref(locale, `/commercial-documents/${row.id}`))
                        }
                      >
                        {t('commercialDocuments.actions.open')}
                      </Button>
                      {can('commercial_document.download') ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          loading={downloadBusy === row.id}
                          disabled={
                            !row.hasPdf ||
                            !isCommercialDocumentDownloadable(row.status) ||
                            Boolean(downloadBusy)
                          }
                          onClick={() => void download(row)}
                        >
                          {t('commercialDocuments.actions.download')}
                        </Button>
                      ) : null}
                      {row.status === 'DRAFT' && can('commercial_document.delete') ? (
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => setDeleteTarget(row)}
                        >
                          {t('commercialDocuments.actions.delete')}
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <Pagination
          page={pagination.page}
          pageSize={pagination.pageSize}
          total={pagination.total}
          totalPages={pagination.totalPages}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPage(1);
            setPageSize(size);
          }}
          labels={{
            previous: t('common.previous'),
            next: t('common.next'),
            rowsPerPage: t('common.rowsPerPage'),
            range: t('list.range', {
              from: (pagination.page - 1) * pagination.pageSize + 1,
              to: Math.min(pagination.page * pagination.pageSize, pagination.total),
              total: pagination.total,
            }),
          }}
        />
      </section>

      <ConfirmDialog
        open={deleteTarget !== null}
        title={t('commercialDocuments.actions.deleteTitle')}
        description={
          deleteTarget ? (
            <div className="stack-sm">
              <p>
                {t('commercialDocuments.actions.deleteConfirm', {
                  documentNo: deleteTarget.documentNo,
                  revision: deleteTarget.revisionNo,
                })}
              </p>
              <p className="muted">{t('commercialDocuments.actions.deleteImpact')}</p>
            </div>
          ) : null
        }
        confirmLabel={t('commercialDocuments.actions.delete')}
        cancelLabel={t('common.cancel')}
        destructive
        loading={deleteBusy}
        onConfirm={() => void removeDocument()}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
