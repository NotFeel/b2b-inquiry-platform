'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  DICTIONARY_TYPES,
  PRODUCT_LIFECYCLE_STATUSES,
  PUBLISH_STATUSES,
  type CategoryNode,
  type ProductAdminSummary,
} from '@b2b/contracts';
import {
  Badge,
  Button,
  ConfirmDialog,
  CopyButton,
  DataTable,
  Field,
  LIFECYCLE_STATUS_TONES,
  Input,
  PageHeader,
  Pagination,
  PUBLISH_STATUS_TONES,
  Select,
  StatusTag,
  Toolbar,
  useToast,
  type DataTableColumn,
} from '@b2b/ui';
import { AdminApiError } from '../../../../lib/admin-api';
import { categoriesApi } from '../../../../lib/categories-api';
import { pathLabel } from '../../../../lib/category-tree-state';
import { useDictionaryOptions } from '../../../../lib/dictionary-options';
import { localeHref, translateError } from '../../../../lib/i18n';
import { productsApi, type ImageFilter } from '../../../../lib/products-api';
import { useTagIdSelectOptions } from '../../../../lib/tag-options';
import { useResource } from '../../../../lib/use-resource';
import { CategoryPicker } from '../../../../components/category-picker';
import { useBreadcrumb } from '../../../../components/use-breadcrumb';
import { useSession } from '../../../../components/session-provider';

const PAGE_SIZE = 20;
const ALL = 'all';

interface FilterState {
  q: string;
  categoryId: string;
  includeDescendants: boolean;
  publishStatus: string;
  lifecycleStatus: string;
  hasImages: ImageFilter;
  tagId: string;
  sort: string;
}

const EMPTY_FILTERS: FilterState = {
  q: '',
  categoryId: '',
  includeDescendants: true,
  publishStatus: ALL,
  lifecycleStatus: ALL,
  hasImages: 'all',
  tagId: ALL,
  sort: 'updated_at:desc',
};

/** Filters live in the URL so a refresh or a shared link keeps them (docs/24 §3.1). */
function readFilters(params: URLSearchParams): FilterState {
  const read = (key: string, allowed: readonly string[], fallback: string): string => {
    const value = params.get(key);
    return value && allowed.includes(value) ? value : fallback;
  };
  return {
    q: params.get('q') ?? '',
    categoryId: params.get('categoryId') ?? '',
    includeDescendants: params.get('includeDescendants') !== 'false',
    publishStatus: read('publishStatus', PUBLISH_STATUSES, ALL),
    lifecycleStatus: read('lifecycleStatus', PRODUCT_LIFECYCLE_STATUSES, ALL),
    hasImages: read('hasImages', ['all', 'with', 'without'], 'all') as ImageFilter,
    tagId: params.get('tagId') ?? ALL,
    sort: read(
      'sort',
      ['updated_at:desc', 'updated_at:asc', 'sku:asc', 'sku:desc'],
      'updated_at:desc',
    ),
  };
}

function toQueryString(filters: FilterState): string {
  const params = new URLSearchParams();
  if (filters.q.trim()) params.set('q', filters.q.trim());
  if (filters.categoryId) params.set('categoryId', filters.categoryId);
  if (filters.categoryId && !filters.includeDescendants) {
    params.set('includeDescendants', 'false');
  }
  if (filters.publishStatus !== ALL) params.set('publishStatus', filters.publishStatus);
  if (filters.lifecycleStatus !== ALL) params.set('lifecycleStatus', filters.lifecycleStatus);
  if (filters.hasImages !== 'all') params.set('hasImages', filters.hasImages);
  if (filters.tagId !== ALL) params.set('tagId', filters.tagId);
  if (filters.sort !== 'updated_at:desc') params.set('sort', filters.sort);
  return params.toString();
}

/**
 * Product list (docs/24 §3.1).
 *
 * Filters, sorting and pagination are server-side; the table shows the cover
 * thumbnail, the category path (never a UUID), both statuses as separate badges
 * and the usable image count. The internal CNY price is deliberately absent -
 * the list is not a pricing screen (docs/24 §10).
 */
export default function ProductsPage() {
  const { t, locale, can } = useSession();
  const toast = useToast();
  const breadcrumb = useBreadcrumb();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [staged, setStaged] = useState<FilterState>(() => readFilters(searchParams));
  const [applied, setApplied] = useState<FilterState>(() => readFilters(searchParams));
  const [page, setPage] = useState(1);
  const [categoryNodes, setCategoryNodes] = useState<CategoryNode[]>([]);
  const [categoryLoading, setCategoryLoading] = useState(false);
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProductAdminSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const canCreate = can('product.create');
  const canUpdate = can('product.update');
  const canPublish = can('product.publish');
  const canDelete = can('product.delete');
  const canSeeCost = can('product.cost.read');

  const publish = useDictionaryOptions(DICTIONARY_TYPES.productPublishStatus, {
    locale,
    fallback: PUBLISH_STATUSES.map((code) => ({ value: code, label: code })),
  });
  const lifecycle = useDictionaryOptions(DICTIONARY_TYPES.productLifecycle, {
    locale,
    fallback: PRODUCT_LIFECYCLE_STATUSES.map((code) => ({ value: code, label: code })),
  });
  const tags = useTagIdSelectOptions(locale, t('tags.statusOptions.disabled'));

  const loader = useCallback(() => {
    const [sortBy, sortOrder] = applied.sort.split(':');
    return productsApi.list({
      ...(applied.q.trim() ? { q: applied.q.trim() } : {}),
      ...(applied.categoryId ? { categoryId: applied.categoryId } : {}),
      includeDescendants: applied.includeDescendants,
      ...(applied.publishStatus !== ALL
        ? { publishStatus: applied.publishStatus as (typeof PUBLISH_STATUSES)[number] }
        : {}),
      ...(applied.lifecycleStatus !== ALL ? { lifecycleStatus: applied.lifecycleStatus } : {}),
      hasImages: applied.hasImages,
      ...(applied.tagId !== ALL ? { tagId: applied.tagId } : {}),
      sortBy: (sortBy ?? 'updated_at') as 'updated_at' | 'sku',
      sortOrder: (sortOrder ?? 'desc') as 'asc' | 'desc',
      page,
      pageSize: PAGE_SIZE,
    });
  }, [applied, page]);
  const resource = useResource(loader, [applied, page, locale], locale);

  const loadCategoryTree = useCallback(async () => {
    if (!can('category.read')) return;
    setCategoryLoading(true);
    try {
      const tree = await categoriesApi.tree({ locale });
      setCategoryNodes(tree);
      setCategoryError(null);
    } catch (caught) {
      setCategoryError(
        caught instanceof AdminApiError
          ? translateError(locale, caught.code)
          : t('errors.INTERNAL_ERROR'),
      );
    } finally {
      setCategoryLoading(false);
    }
  }, [can, locale, t]);

  useEffect(() => {
    void loadCategoryTree();
  }, [loadCategoryTree]);

  // A deep link from the editor (`?delete=<id>`) opens the confirmation for the
  // record it names, instead of the operator having to find it again.
  useEffect(() => {
    const target = searchParams.get('delete');
    const rows = resource.data?.data ?? [];
    if (!target || rows.length === 0) return;
    const match = rows.find((row) => row.id === target);
    if (match && canDelete) setDeleteTarget(match);
  }, [searchParams, resource.data, canDelete]);

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

  const togglePublish = async (row: ProductAdminSummary) => {
    setBusyId(row.id);
    try {
      const next = row.publishStatus === 'published' ? 'unpublished' : 'published';
      await productsApi.setPublishStatus(row.id, next);
      toast.success(next === 'published' ? t('products.published') : t('products.unpublished'));
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
      const accepted = await productsApi.remove(deleteTarget.id);
      // 202: the physical removal is queued. The list only refreshes once the
      // task is reported as finished, so a "deleted" row never lingers as if the
      // files were already gone.
      toast.info(t('products.deletePending', { count: accepted.imageOperations }));
      const operation = await pollOperation(accepted.operationId);
      if (operation === 'SUCCEEDED') {
        toast.success(t('products.deleteDone'));
      } else {
        toast.error(t('products.deleteStillPending'));
      }
      setDeleteTarget(null);
      resource.reload();
    } catch (caught) {
      toast.error(
        caught instanceof AdminApiError
          ? translateError(locale, caught.code)
          : t('errors.INTERNAL_ERROR'),
      );
      resource.reload();
    } finally {
      setDeleting(false);
    }
  };

  const columns: DataTableColumn<ProductAdminSummary>[] = [
    {
      key: 'image',
      header: t('products.columns.image'),
      width: 72,
      render: (row) =>
        row.coverImageUrl ? (
          // A plain <img> is intentional: the file is already served from the
          // storage/CDN origin, so the Next image optimizer would only add a
          // second cache layer in front of an admin-only thumbnail.
          <img
            className="product-thumb"
            src={row.coverImageUrl}
            alt={row.coverImageAlt ?? row.name}
            width={48}
            height={48}
            loading="lazy"
          />
        ) : (
          <span className="product-thumb product-thumb-empty" aria-hidden="true">
            {t('products.noImageShort')}
          </span>
        ),
    },
    {
      key: 'sku',
      header: t('products.fields.sku'),
      render: (row) => (
        <span className="cell-inline">
          <span className="mono">{row.sku}</span>
          <CopyButton value={row.sku} label={t('list.copy')} copiedLabel={t('list.copied')} />
        </span>
      ),
    },
    {
      key: 'name',
      header: t('products.fields.name'),
      truncate: true,
      render: (row) => (
        <span className="cell-primary">
          <span>{row.name}</span>
          {row.nameZh ? <span className="cell-sub">{row.nameZh}</span> : null}
        </span>
      ),
    },
    ...(canSeeCost
      ? [
          {
            key: 'price',
            header: t('products.columns.price'),
            align: 'right' as const,
            render: (row: ProductAdminSummary) =>
              row.priceVisible && row.priceCny !== null ? (
                <span className="mono">{formatPrice(row.priceCny)}</span>
              ) : (
                <span className="muted small">{t('products.priceNotSet')}</span>
              ),
          },
        ]
      : []),
    {
      key: 'category',
      header: t('products.fields.category'),
      truncate: true,
      render: (row) =>
        row.categoryPath ? (
          row.categoryPath
        ) : (
          <span className="muted small">{t('products.noCategory')}</span>
        ),
    },
    {
      key: 'publishStatus',
      header: t('products.fields.publishStatus'),
      render: (row) => (
        <StatusTag
          value={row.publishStatus}
          label={row.publishStatus}
          toneMap={PUBLISH_STATUS_TONES}
        />
      ),
    },
    {
      key: 'lifecycleStatus',
      header: t('products.fields.lifecycleStatus'),
      render: (row) => (
        <StatusTag
          value={row.lifecycleStatus}
          label={row.lifecycleStatus}
          toneMap={LIFECYCLE_STATUS_TONES}
        />
      ),
    },
    {
      key: 'flags',
      header: t('common.status'),
      render: (row) => (
        <span className="badge-stack">
          {row.tagCodes.includes('featured') ? <Badge tone="brand">featured</Badge> : null}
          {row.tagCodes.includes('new-arrival') ? <Badge tone="info">new</Badge> : null}
          {row.tagCodes.includes('preorder') ? (
            <Badge tone="warning">{t('products.preOrderHome')}</Badge>
          ) : null}
        </span>
      ),
    },
    {
      key: 'images',
      header: t('products.fields.images'),
      align: 'right',
      render: (row) => (
        <span className="cell-inline">
          <span className="mono">{row.imageCount}</span>
          {row.pendingImageDeletes > 0 ? (
            <Badge tone="warning">
              {t('products.images.pendingCount', { count: row.pendingImageDeletes })}
            </Badge>
          ) : null}
          {row.imageCount === 0 ? <Badge tone="danger">{t('products.missingImages')}</Badge> : null}
        </span>
      ),
    },
    {
      key: 'updatedAt',
      header: t('products.columns.updatedAt'),
      render: (row) => (
        <span className="muted small">{formatTimestamp(row.updatedAt, locale)}</span>
      ),
    },
    {
      key: 'actions',
      header: t('common.actions'),
      align: 'right',
      render: (row) => (
        <span className="data-table-actions">
          {canUpdate ? (
            <Link
              className="btn btn-ghost btn-sm"
              href={localeHref(locale, `/products/${row.id}/edit`)}
            >
              {t('common.edit')}
            </Link>
          ) : null}
          {canPublish ? (
            <Button
              size="sm"
              variant="secondary"
              loading={busyId === row.id}
              onClick={() => void togglePublish(row)}
            >
              {row.publishStatus === 'published' ? t('products.unpublish') : t('products.publish')}
            </Button>
          ) : null}
          {canDelete ? (
            <Button
              size="sm"
              variant="danger"
              disabled={row.publishStatus === 'published'}
              title={
                row.publishStatus === 'published'
                  ? t('products.deleteRequiresUnpublish')
                  : undefined
              }
              onClick={() => setDeleteTarget(row)}
            >
              {t('common.delete')}
            </Button>
          ) : null}
        </span>
      ),
    },
  ];

  const hasFilters =
    applied.q.trim().length > 0 ||
    applied.categoryId !== '' ||
    !applied.includeDescendants ||
    applied.publishStatus !== ALL ||
    applied.lifecycleStatus !== ALL ||
    applied.hasImages !== 'all' ||
    applied.tagId !== ALL;
  const rows = resource.data?.data ?? [];
  const pagination = resource.data?.pagination;

  return (
    <div className="stack">
      <PageHeader
        breadcrumb={breadcrumb}
        title={t('products.title')}
        description={t('products.description')}
        actions={
          <>
            <Button variant="secondary" onClick={resource.reload} loading={resource.loading}>
              {t('products.refresh')}
            </Button>
            {canCreate ? (
              <Link className="btn btn-md" href={localeHref(locale, '/products/new')}>
                {t('products.create')}
              </Link>
            ) : null}
          </>
        }
      />

      <Toolbar
        summary={t('products.summary', { count: pagination?.total ?? 0 })}
        activeFilters={
          hasFilters
            ? [
                ...(applied.q.trim()
                  ? [{ key: 'q', label: `${t('products.filters.q')}: ${applied.q.trim()}` }]
                  : []),
                ...(applied.categoryId
                  ? [
                      {
                        key: 'category',
                        label: `${t('products.filters.category')}: ${
                          pathLabel(categoryNodes, applied.categoryId, locale) ??
                          t('products.filters.categoryApplied')
                        } · ${
                          applied.includeDescendants
                            ? t('products.filters.withDescendants')
                            : t('products.filters.onlyThisCategory')
                        }`,
                      },
                    ]
                  : []),
                ...(applied.publishStatus !== ALL
                  ? [
                      {
                        key: 'publish',
                        label: `${t('products.fields.publishStatus')}: ${applied.publishStatus}`,
                      },
                    ]
                  : []),
                ...(applied.lifecycleStatus !== ALL
                  ? [
                      {
                        key: 'lifecycle',
                        label: `${t('products.fields.lifecycleStatus')}: ${applied.lifecycleStatus}`,
                      },
                    ]
                  : []),
                ...(applied.hasImages !== 'all'
                  ? [
                      {
                        key: 'images',
                        label:
                          applied.hasImages === 'with'
                            ? t('products.filters.withImages')
                            : t('products.filters.withoutImages'),
                      },
                    ]
                  : []),
                ...(applied.tagId !== ALL
                  ? [{ key: 'tag', label: t('products.filters.tagApplied') }]
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
        <Field label={t('products.filters.q')}>
          {({ inputId, describedBy }) => (
            <Input
              inputId={inputId}
              describedBy={describedBy}
              type="search"
              value={staged.q}
              placeholder={t('products.filters.qPlaceholder')}
              onChange={(event) => setStaged((current) => ({ ...current, q: event.target.value }))}
              onKeyDown={(event) => {
                if (event.key === 'Enter') applyFilters(staged);
              }}
            />
          )}
        </Field>
        <Field label={t('products.filters.category')}>
          {() => (
            <CategoryPicker
              mode="filter"
              nodes={categoryNodes}
              value={staged.categoryId === '' ? null : staged.categoryId}
              loading={categoryLoading}
              errorLabel={categoryError}
              onRetry={() => void loadCategoryTree()}
              onChange={(id) =>
                setStaged((current) => ({
                  ...current,
                  categoryId: id ?? '',
                  includeDescendants: id ? current.includeDescendants : true,
                }))
              }
            />
          )}
        </Field>
        <Field label={t('products.filters.scope')} help={t('products.filters.scopeHelp')}>
          {({ inputId, describedBy }) => (
            <label className="checkbox-label" htmlFor={inputId}>
              <input
                id={inputId}
                type="checkbox"
                aria-describedby={describedBy}
                disabled={!staged.categoryId}
                checked={staged.includeDescendants}
                onChange={(event) =>
                  setStaged((current) => ({
                    ...current,
                    includeDescendants: event.target.checked,
                  }))
                }
              />
              <span>{t('products.filters.includeDescendants')}</span>
            </label>
          )}
        </Field>
        <Field label={t('products.fields.publishStatus')}>
          {({ inputId, describedBy }) => (
            <Select
              inputId={inputId}
              describedBy={describedBy}
              value={staged.publishStatus}
              options={[{ value: ALL, label: t('products.filters.statusAll') }, ...publish.options]}
              onChange={(event) =>
                setStaged((current) => ({ ...current, publishStatus: event.target.value }))
              }
            />
          )}
        </Field>
        <Field label={t('products.fields.lifecycleStatus')}>
          {({ inputId, describedBy }) => (
            <Select
              inputId={inputId}
              describedBy={describedBy}
              value={staged.lifecycleStatus}
              options={[
                { value: ALL, label: t('products.filters.statusAll') },
                ...lifecycle.options,
              ]}
              onChange={(event) =>
                setStaged((current) => ({ ...current, lifecycleStatus: event.target.value }))
              }
            />
          )}
        </Field>
        <Field label={t('products.filters.images')}>
          {({ inputId, describedBy }) => (
            <Select
              inputId={inputId}
              describedBy={describedBy}
              value={staged.hasImages}
              options={[
                { value: 'all', label: t('products.filters.imagesAll') },
                { value: 'with', label: t('products.filters.withImages') },
                { value: 'without', label: t('products.filters.withoutImages') },
              ]}
              onChange={(event) =>
                setStaged((current) => ({
                  ...current,
                  hasImages: event.target.value as ImageFilter,
                }))
              }
            />
          )}
        </Field>
        <Field label={t('products.fields.tags')}>
          {({ inputId, describedBy }) => (
            <Select
              inputId={inputId}
              describedBy={describedBy}
              value={staged.tagId}
              options={[{ value: ALL, label: t('products.filters.tagsAll') }, ...tags.options]}
              onChange={(event) =>
                setStaged((current) => ({ ...current, tagId: event.target.value }))
              }
            />
          )}
        </Field>
        <Field label={t('products.filters.sort')}>
          {({ inputId, describedBy }) => (
            <Select
              inputId={inputId}
              describedBy={describedBy}
              value={staged.sort}
              options={[
                { value: 'updated_at:desc', label: t('products.filters.sortUpdatedDesc') },
                { value: 'updated_at:asc', label: t('products.filters.sortUpdatedAsc') },
                { value: 'sku:asc', label: t('products.filters.sortSkuAsc') },
                { value: 'sku:desc', label: t('products.filters.sortSkuDesc') },
              ]}
              onChange={(event) =>
                setStaged((current) => ({ ...current, sort: event.target.value }))
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
          empty: hasFilters ? t('list.noResults') : t('products.empty'),
          emptyDescription: hasFilters ? t('list.noResultsHint') : t('products.emptyHint'),
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
          canCreate ? (
            <Link className="btn btn-md" href={localeHref(locale, '/products/new')}>
              {t('products.create')}
            </Link>
          ) : undefined
        }
        emptySecondaryAction={
          hasFilters ? (
            <Button variant="secondary" onClick={() => applyFilters(EMPTY_FILTERS)}>
              {t('list.clearFilters')}
            </Button>
          ) : undefined
        }
      />

      {pagination ? (
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
              from: pagination.total === 0 ? 0 : (pagination.page - 1) * pagination.pageSize + 1,
              to: Math.min(pagination.page * pagination.pageSize, pagination.total),
              total: pagination.total,
            }),
          }}
        />
      ) : null}

      <ConfirmDialog
        open={deleteTarget !== null}
        title={t('products.deleteTitle')}
        description={t('products.deleteWarning')}
        confirmLabel={t('products.deleteConfirm')}
        cancelLabel={t('common.cancel')}
        destructive
        loading={deleting}
        confirmDisabled={deleteTarget?.publishStatus === 'published'}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

/**
 * Polls a delete task to completion.
 *
 * The API answers 202 with a task, not with "deleted": the UI must ask until the
 * worker confirms the object is gone, instead of assuming the file disappeared
 * when the request returned.
 */
async function pollOperation(
  operationId: string,
  attempts = 120,
): Promise<'SUCCEEDED' | 'FAILED' | 'PENDING'> {
  for (let index = 0; index < attempts; index += 1) {
    const operation = await productsApi.fileOperation(operationId).catch(() => null);
    if (!operation) return 'PENDING';
    if (operation.status === 'SUCCEEDED') return 'SUCCEEDED';
    if (operation.status === 'FAILED') return 'FAILED';
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return 'PENDING';
}

/** Locale-aware timestamp; rendered client-side so server and client agree. */
function formatTimestamp(value: string, locale: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

/** Internal price is CNY (Decimal(18,4)); rendered with a stable, explicit unit. */
function formatPrice(value: string): string {
  const number = Number(value);
  if (!Number.isFinite(number)) return `CNY ${value}`;
  return `CNY ${number.toFixed(2)}`;
}
