'use client';

import { useCallback, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { TagSummary } from '@b2b/contracts';
import {
  Badge,
  Button,
  ConfirmDialog,
  CopyButton,
  DataTable,
  Field,
  Input,
  PageHeader,
  Pagination,
  Select,
  TagBadge,
  Toolbar,
  useToast,
  type DataTableColumn,
} from '@b2b/ui';
import { AdminApiError } from '../../../../lib/admin-api';
import { tagsApi, type TagStatusFilter, type TagUsageFilter } from '../../../../lib/tags-api';
import { secondaryLabel } from '../../../../lib/tag-form';
import { TagFormDrawer } from '../../../../components/tag-form-drawer';
import { useBreadcrumb } from '../../../../components/use-breadcrumb';
import { useResource } from '../../../../lib/use-resource';
import { useSession } from '../../../../components/session-provider';
import { translateError } from '../../../../lib/i18n';

const ENGLISH_LOCALE = 'en-US';
const PAGE_SIZE = 20;

interface FilterState {
  q: string;
  status: TagStatusFilter;
  usage: TagUsageFilter;
}

const EMPTY_FILTERS: FilterState = { q: '', status: 'all', usage: 'all' };

/** Filters live in the URL so a refresh or a shared link keeps them (docs/23 §6.1). */
function readFilters(params: URLSearchParams): FilterState {
  const read = <T extends string>(key: string, allowed: readonly T[], fallback: T): T => {
    const value = params.get(key);
    return value && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
  };
  return {
    q: params.get('q') ?? '',
    status: read('status', ['all', 'enabled', 'disabled'] as const, 'all'),
    usage: read('usage', ['all', 'used', 'unused'] as const, 'all'),
  };
}

function toQueryString(filters: FilterState): string {
  const params = new URLSearchParams();
  if (filters.q.trim()) params.set('q', filters.q.trim());
  if (filters.status !== 'all') params.set('status', filters.status);
  if (filters.usage !== 'all') params.set('usage', filters.usage);
  return params.toString();
}

/**
 * Tag management (docs/23).
 *
 * The list is server-filtered and paginated, the create/edit form is one shared
 * drawer, and every structural rule - duplicate code, required English label,
 * whitelisted style token, delete protection - is enforced by the API as well.
 */
export default function TagsPage() {
  const { t, locale, can } = useSession();
  const toast = useToast();
  const breadcrumb = useBreadcrumb();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [staged, setStaged] = useState<FilterState>(() => readFilters(searchParams));
  const [applied, setApplied] = useState<FilterState>(() => readFilters(searchParams));
  const [page, setPage] = useState(1);

  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<'create' | 'edit'>('create');
  const [formTag, setFormTag] = useState<TagSummary | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<TagSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const canCreate = can('tag.create');
  const canUpdate = can('tag.update');
  const canDelete = can('tag.delete');

  const loader = useCallback(
    () =>
      tagsApi.list({
        locale,
        page,
        pageSize: PAGE_SIZE,
        ...(applied.q.trim() ? { q: applied.q.trim() } : {}),
        status: applied.status,
        usage: applied.usage,
      }),
    [locale, page, applied],
  );
  const resource = useResource(loader, [page, applied, locale], locale);

  const syncUrl = (filters: FilterState) => {
    const query = toQueryString(filters);
    router.replace(query.length > 0 ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  const applyFilters = (next: FilterState) => {
    setStaged(next);
    setApplied(next);
    setPage(1);
    syncUrl(next);
  };

  const openCreate = () => {
    setFormMode('create');
    setFormTag(null);
    setFormOpen(true);
  };

  const openEdit = (tag: TagSummary) => {
    setFormMode('edit');
    setFormTag(tag);
    setFormOpen(true);
  };

  const toggleStatus = async (tag: TagSummary) => {
    setBusyId(tag.id);
    try {
      await tagsApi.setStatus(tag.id, !tag.enabled);
      toast.success(tag.enabled ? t('tags.disableSuccess') : t('tags.enableSuccess'));
      resource.reload();
    } catch (caught) {
      toast.error(
        caught instanceof AdminApiError
          ? translateError(locale, caught.code)
          : t('errors.INTERNAL_ERROR'),
      );
    } finally {
      setBusyId(null);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await tagsApi.remove(deleteTarget.id);
      toast.success(t('tags.deleteSuccess'));
      setDeleteTarget(null);
      resource.reload();
    } catch (caught) {
      toast.error(
        caught instanceof AdminApiError
          ? translateError(locale, caught.code)
          : t('errors.INTERNAL_ERROR'),
      );
      // The list may already show a newer product count: refresh so the dialog
      // explains the conflict with current numbers.
      resource.reload();
    } finally {
      setDeleting(false);
    }
  };

  const columns: DataTableColumn<TagSummary>[] = [
    {
      key: 'label',
      header: t('tags.columns.tag'),
      render: (row) => (
        <span className="tag-cell">
          <TagBadge label={row.label} colorToken={row.colorToken} title={row.code} />
        </span>
      ),
    },
    {
      key: 'code',
      header: t('tags.columns.code'),
      render: (row) => (
        <span className="tag-code-cell">
          <span className="mono">{row.code}</span>
          <CopyButton value={row.code} label={t('list.copy')} copiedLabel={t('list.copied')} />
        </span>
      ),
    },
    {
      key: 'names',
      header: t('tags.columns.names'),
      render: (row) => {
        const secondary = secondaryLabel(row, locale, ENGLISH_LOCALE);
        return (
          <span className="tag-names">
            <span>{row.label}</span>
            {secondary ? <span className="muted small">{secondary}</span> : null}
            {row.missingLocales.includes('zh-CN') ? (
              <span className="tag-missing">{t('tags.missingZh')}</span>
            ) : null}
          </span>
        );
      },
    },
    {
      key: 'style',
      header: t('tags.columns.style'),
      render: (row) => (
        <span className="mono small">{row.colorToken ?? t('tags.colorOptions.none')}</span>
      ),
    },
    {
      key: 'productCount',
      header: t('tags.columns.productCount'),
      align: 'right',
      render: (row) => <span className="mono">{row.productCount}</span>,
    },
    {
      key: 'state',
      header: t('tags.columns.state'),
      render: (row) => (
        <Badge tone={row.enabled ? 'success' : 'neutral'}>
          {row.enabled ? t('tags.statusOptions.enabled') : t('tags.statusOptions.disabled')}
        </Badge>
      ),
    },
    {
      key: 'updatedAt',
      header: t('tags.columns.updatedAt'),
      render: (row) => (
        <span className="muted small">{formatTimestamp(row.updatedAt, locale)}</span>
      ),
    },
    {
      key: 'actions',
      header: t('common.actions'),
      align: 'right',
      render: (row) => {
        const blocked = row.productCount > 0;
        return (
          <div className="data-table-actions">
            {canUpdate ? (
              <Button size="sm" variant="ghost" onClick={() => openEdit(row)}>
                {t('common.edit')}
              </Button>
            ) : null}
            {canUpdate ? (
              <Button
                size="sm"
                variant="secondary"
                loading={busyId === row.id}
                onClick={() => void toggleStatus(row)}
              >
                {row.enabled ? t('tags.disable') : t('tags.enable')}
              </Button>
            ) : null}
            {canDelete ? (
              <Button
                size="sm"
                variant="danger"
                disabled={blocked}
                title={blocked ? t('tags.deleteBlocked', { count: row.productCount }) : undefined}
                onClick={() => setDeleteTarget(row)}
              >
                {t('common.delete')}
              </Button>
            ) : null}
          </div>
        );
      },
    },
  ];

  const hasFilters =
    applied.q.trim().length > 0 || applied.status !== 'all' || applied.usage !== 'all';
  const rows = resource.data?.data ?? [];
  const pagination = resource.data?.pagination;

  return (
    <div className="stack">
      <PageHeader
        breadcrumb={breadcrumb}
        title={t('tags.title')}
        description={t('tags.description')}
        actions={
          <>
            <Button variant="secondary" onClick={resource.reload} loading={resource.loading}>
              {t('tags.refresh')}
            </Button>
            {canCreate ? <Button onClick={openCreate}>{t('tags.create')}</Button> : null}
          </>
        }
      />

      <Toolbar
        summary={t('tags.summary', { count: pagination?.total ?? 0 })}
        activeFilters={
          hasFilters
            ? [
                ...(applied.q.trim()
                  ? [{ key: 'q', label: `${t('tags.filters.q')}: ${applied.q.trim()}` }]
                  : []),
                ...(applied.status !== 'all'
                  ? [
                      {
                        key: 'status',
                        label: `${t('tags.filters.status')}: ${
                          applied.status === 'enabled'
                            ? t('tags.statusOptions.enabled')
                            : t('tags.statusOptions.disabled')
                        }`,
                      },
                    ]
                  : []),
                ...(applied.usage !== 'all'
                  ? [
                      {
                        key: 'usage',
                        label: `${t('tags.filters.usage')}: ${
                          applied.usage === 'used'
                            ? t('tags.filters.used')
                            : t('tags.filters.unused')
                        }`,
                      },
                    ]
                  : []),
              ].map((chip) => (
                <li key={chip.key} className="filter-chip">
                  {chip.label}
                </li>
              ))
            : undefined
        }
        actions={
          <>
            <Button variant="secondary" onClick={() => applyFilters(EMPTY_FILTERS)}>
              {t('list.reset')}
            </Button>
            <Button onClick={() => applyFilters(staged)}>{t('list.apply')}</Button>
          </>
        }
      >
        <Field label={t('tags.filters.q')}>
          {({ inputId, describedBy }) => (
            <Input
              inputId={inputId}
              describedBy={describedBy}
              type="search"
              value={staged.q}
              placeholder={t('tags.filters.qPlaceholder')}
              onChange={(event) => setStaged((current) => ({ ...current, q: event.target.value }))}
              onKeyDown={(event) => {
                if (event.key === 'Enter') applyFilters(staged);
              }}
            />
          )}
        </Field>
        <Field label={t('tags.filters.status')}>
          {({ inputId, describedBy }) => (
            <Select
              inputId={inputId}
              describedBy={describedBy}
              value={staged.status}
              options={[
                { value: 'all', label: t('tags.filters.statusAll') },
                { value: 'enabled', label: t('tags.statusOptions.enabled') },
                { value: 'disabled', label: t('tags.statusOptions.disabled') },
              ]}
              onChange={(event) =>
                setStaged((current) => ({
                  ...current,
                  status: event.target.value as TagStatusFilter,
                }))
              }
            />
          )}
        </Field>
        <Field label={t('tags.filters.usage')}>
          {({ inputId, describedBy }) => (
            <Select
              inputId={inputId}
              describedBy={describedBy}
              value={staged.usage}
              options={[
                { value: 'all', label: t('tags.filters.usageAll') },
                { value: 'used', label: t('tags.filters.used') },
                { value: 'unused', label: t('tags.filters.unused') },
              ]}
              onChange={(event) =>
                setStaged((current) => ({
                  ...current,
                  usage: event.target.value as TagUsageFilter,
                }))
              }
            />
          )}
        </Field>
      </Toolbar>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        labels={{
          empty: hasFilters ? t('list.noResults') : t('tags.empty'),
          emptyDescription: hasFilters ? t('list.noResultsHint') : t('tags.emptyHint'),
          loading: t('common.loading'),
          errorTitle: t('common.error'),
          retry: t('common.retry'),
          copy: t('list.copy'),
          copied: t('list.copied'),
        }}
        loading={resource.loading}
        error={resource.error ? translateError(locale, resource.error) : null}
        requestId={resource.requestId}
        onRetry={resource.reload}
        emptyAction={
          canCreate ? <Button onClick={openCreate}>{t('tags.create')}</Button> : undefined
        }
        emptySecondaryAction={
          hasFilters ? (
            <Button variant="secondary" onClick={() => applyFilters(EMPTY_FILTERS)}>
              {t('list.clearFilters')}
            </Button>
          ) : undefined
        }
      />

      {pagination && pagination.totalPages > 1 ? (
        <Pagination
          page={pagination.page}
          pageSize={pagination.pageSize}
          total={pagination.total}
          totalPages={pagination.totalPages}
          onPageChange={setPage}
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
      ) : null}

      <TagFormDrawer
        open={formOpen}
        mode={formMode}
        tag={formTag}
        onClose={() => setFormOpen(false)}
        onSaved={() => resource.reload()}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        title={t('tags.deleteTitle')}
        description={
          deleteTarget
            ? deleteTarget.productCount > 0
              ? `${t('tags.deleteConfirm', { name: deleteTarget.label, code: deleteTarget.code })} ${t('tags.deleteBlocked', { count: deleteTarget.productCount })}`
              : t('tags.deleteConfirm', { name: deleteTarget.label, code: deleteTarget.code })
            : ''
        }
        confirmLabel={t('common.yesDelete')}
        cancelLabel={t('common.cancel')}
        destructive
        loading={deleting}
        confirmDisabled={deleteTarget !== null && deleteTarget.productCount > 0}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

/** Locale-aware timestamp; rendered client-side so server and client agree. */
function formatTimestamp(value: string, locale: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
