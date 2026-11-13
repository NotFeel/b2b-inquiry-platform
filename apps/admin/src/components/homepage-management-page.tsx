'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  CategoryNode,
  HomepageCollectionSummary,
  HomepageDisplayConfigSummary,
} from '@b2b/contracts';
import {
  Badge,
  Button,
  ConfirmDialog,
  DataTable,
  ErrorState,
  Field,
  Input,
  LoadingState,
  PageHeader,
  useToast,
  type DataTableColumn,
} from '@b2b/ui';
import { AdminApiError } from '../lib/admin-api';
import { categoriesApi } from '../lib/categories-api';
import { parseHomepageDisplayTotal, type HomepageConfigFormValues } from '../lib/homepage-form';
import { homepageManagementApi } from '../lib/homepage-management-api';
import { translateError } from '../lib/i18n';
import { setAdminFormDirty } from '../lib/unsaved-form';
import { useResource } from '../lib/use-resource';
import { HomepageCollectionDrawer } from './homepage-collection-drawer';
import { useBreadcrumb } from './use-breadcrumb';
import { useSession } from './session-provider';

interface HomepageWorkspaceData {
  config: HomepageDisplayConfigSummary;
  collections: HomepageCollectionSummary[];
  categories: CategoryNode[];
}

const QUICK_TOTALS = [6, 12, 18, 24, 36, 48, 60, 120, 600] as const;

/** Admin Homepage management entry point (docs/45 stage E). */
export function HomepageManagementPage() {
  const { t, can } = useSession();
  const breadcrumb = useBreadcrumb();

  if (!can('homepage.read')) {
    return (
      <div className="stack">
        <PageHeader
          breadcrumb={breadcrumb}
          title={t('homepage.title')}
          description={t('homepage.description')}
        />
        <div className="notice notice-warning" role="alert">
          {t('homepage.permissions.readRequired')}
        </div>
      </div>
    );
  }

  return <HomepageWorkspace />;
}

function HomepageWorkspace() {
  const { t, locale, can } = useSession();
  const toast = useToast();
  const breadcrumb = useBreadcrumb();
  const canReadCategories = can('category.read');
  const canReadProducts = can('product.read');
  const canCreate = can('homepage.collection.create');
  const canUpdate = can('homepage.collection.update');
  const canDelete = can('homepage.collection.delete');

  const loader = useCallback(async (): Promise<HomepageWorkspaceData> => {
    const [config, collections, categories] = await Promise.all([
      homepageManagementApi.getConfig(),
      homepageManagementApi.listCollections(locale),
      canReadCategories ? categoriesApi.tree({ locale, status: 'all' }) : Promise.resolve([]),
    ]);
    return { config, collections, categories };
  }, [locale, canReadCategories]);
  const resource = useResource(loader, [locale, canReadCategories], locale);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeCollectionId, setActiveCollectionId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<HomepageCollectionSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [sorting, setSorting] = useState(false);
  const [configDirty, setConfigDirty] = useState(false);
  const [drawerDirty, setDrawerDirty] = useState(false);

  const collections = resource.data?.collections ?? [];
  const hasUnsavedDraft = configDirty || drawerDirty;

  useEffect(() => {
    setAdminFormDirty(hasUnsavedDraft);
    return () => setAdminFormDirty(false);
  }, [hasUnsavedDraft]);

  useEffect(() => {
    if (!hasUnsavedDraft) return undefined;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasUnsavedDraft]);

  const openCreate = () => {
    setActiveCollectionId(null);
    setDrawerOpen(true);
  };

  const openEdit = (id: string) => {
    setActiveCollectionId(id);
    setDrawerOpen(true);
  };

  const toggleCollection = async (row: HomepageCollectionSummary) => {
    setBusyId(row.id);
    try {
      await homepageManagementApi.updateCollection(row.id, {
        enabled: !row.enabled,
        expectedUpdatedAt: row.updatedAt,
      });
      toast.success(
        row.enabled ? t('homepage.collection.disabled') : t('homepage.collection.enabled'),
      );
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

  const moveCollection = async (row: HomepageCollectionSummary, direction: 'up' | 'down') => {
    const index = collections.findIndex((item) => item.id === row.id);
    const target = direction === 'up' ? index - 1 : index + 1;
    if (index < 0 || target < 0 || target >= collections.length) return;
    const next = [...collections];
    const [moved] = next.splice(index, 1);
    if (!moved) return;
    next.splice(target, 0, moved);
    setSorting(true);
    try {
      await homepageManagementApi.sortCollections(next.map((item) => item.id));
      toast.success(t('homepage.collection.reordered'));
      resource.reload();
    } catch (caught) {
      toast.error(
        caught instanceof AdminApiError
          ? translateError(locale, caught.code)
          : t('errors.INTERNAL_ERROR'),
      );
    } finally {
      setSorting(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await homepageManagementApi.removeCollection(deleteTarget.id);
      toast.success(t('homepage.collection.deleted'));
      setDeleteTarget(null);
      resource.reload();
    } catch (caught) {
      toast.error(
        caught instanceof AdminApiError
          ? translateError(locale, caught.code)
          : t('errors.INTERNAL_ERROR'),
      );
    } finally {
      setDeleting(false);
    }
  };

  const columns = useMemo<DataTableColumn<HomepageCollectionSummary>[]>(
    () => [
      {
        key: 'order',
        header: t('homepage.collection.columns.order'),
        width: 112,
        render: (row) => {
          const index = collections.findIndex((item) => item.id === row.id);
          return (
            <div className="data-table-actions homepage-order-actions">
              <Button
                size="sm"
                variant="ghost"
                aria-label={t('homepage.collection.moveUp', { title: row.title })}
                disabled={!canUpdate || sorting || index <= 0}
                onClick={() => void moveCollection(row, 'up')}
              >
                ↑
              </Button>
              <span className="mono small">{index + 1}</span>
              <Button
                size="sm"
                variant="ghost"
                aria-label={t('homepage.collection.moveDown', { title: row.title })}
                disabled={!canUpdate || sorting || index === collections.length - 1}
                onClick={() => void moveCollection(row, 'down')}
              >
                ↓
              </Button>
            </div>
          );
        },
      },
      {
        key: 'title',
        header: t('homepage.collection.columns.title'),
        render: (row) => (
          <span className="stack-xs">
            <strong>{row.title}</strong>
            {row.subtitle ? <span className="muted small">{row.subtitle}</span> : null}
            {!row.translations.some((entry) => entry.locale === 'zh-CN') ? (
              <span className="small homepage-missing-translation">
                {t('homepage.collection.missingChinese')}
              </span>
            ) : null}
          </span>
        ),
      },
      {
        key: 'category',
        header: t('homepage.collection.columns.category'),
        render: (row) => (
          <span className="stack-xs">
            <span>{row.categoryName}</span>
            <span className="mono small">{row.categoryCode}</span>
            <span className="badge-stack">
              <Badge tone="neutral">
                {row.categoryVisible
                  ? t('homepage.category.visible')
                  : t('homepage.category.hidden')}
              </Badge>
              <Badge tone={row.categoryEnabled ? 'success' : 'warning'}>
                {row.categoryEnabled
                  ? t('homepage.category.enabled')
                  : t('homepage.category.disabled')}
              </Badge>
            </span>
          </span>
        ),
      },
      {
        key: 'products',
        header: t('homepage.collection.columns.products'),
        render: (row) => (
          <span className="mono">
            {row.selectedProductCount} / {row.productLimit}
          </span>
        ),
      },
      {
        key: 'state',
        header: t('homepage.collection.columns.state'),
        render: (row) => (
          <Badge tone={row.enabled ? 'success' : 'neutral'}>
            {row.enabled
              ? t('homepage.collection.statusEnabled')
              : t('homepage.collection.statusDisabled')}
          </Badge>
        ),
      },
      {
        key: 'updatedAt',
        header: t('homepage.collection.columns.updatedAt'),
        render: (row) => (
          <span className="muted small">{formatTimestamp(row.updatedAt, locale)}</span>
        ),
      },
      {
        key: 'actions',
        header: t('common.actions'),
        align: 'right',
        render: (row) => (
          <div className="data-table-actions">
            {canUpdate ? (
              <Button size="sm" variant="ghost" onClick={() => openEdit(row.id)}>
                {t('common.edit')}
              </Button>
            ) : null}
            {canUpdate ? (
              <Button
                size="sm"
                variant="secondary"
                loading={busyId === row.id}
                onClick={() => void toggleCollection(row)}
              >
                {row.enabled ? t('homepage.collection.disable') : t('homepage.collection.enable')}
              </Button>
            ) : null}
            {canDelete ? (
              <Button size="sm" variant="danger" onClick={() => setDeleteTarget(row)}>
                {t('common.delete')}
              </Button>
            ) : null}
          </div>
        ),
      },
    ],
    [collections, canDelete, canUpdate, busyId, sorting, locale, t],
  );

  return (
    <div className="stack">
      <PageHeader
        breadcrumb={breadcrumb}
        title={t('homepage.title')}
        description={t('homepage.description')}
        actions={
          <>
            <Button variant="secondary" loading={resource.loading} onClick={resource.reload}>
              {t('homepage.refresh')}
            </Button>
            {canCreate ? (
              <Button onClick={openCreate}>{t('homepage.collection.create')}</Button>
            ) : null}
          </>
        }
      />

      {resource.loading && !resource.data ? (
        <div className="panel">
          <LoadingState label={t('homepage.loading')} rows={6} />
        </div>
      ) : resource.error ? (
        <div className="panel">
          <ErrorState
            title={t('homepage.loadErrorTitle')}
            description={translateError(locale, resource.error)}
            retryLabel={t('common.retry')}
            onRetry={resource.reload}
            requestId={resource.requestId}
            copyLabel={t('list.copy')}
            copiedLabel={t('list.copied')}
          />
        </div>
      ) : resource.data ? (
        <>
          {!canReadCategories || !canReadProducts ? (
            <div className="notice notice-warning" role="alert">
              {!canReadCategories ? t('homepage.permissions.categoryRequired') : null}{' '}
              {!canReadProducts ? t('homepage.permissions.productRequired') : null}
            </div>
          ) : null}

          <HomepageConfigPanel
            config={resource.data.config}
            onSaved={resource.reload}
            onDirtyChange={setConfigDirty}
          />

          <section className="panel stack" aria-labelledby="homepage-collections-heading">
            <div className="row-between">
              <div>
                <h2 id="homepage-collections-heading" className="section-title">
                  {t('homepage.collection.title')}
                </h2>
                <p className="muted">{t('homepage.collection.description')}</p>
              </div>
              <span className="muted small">
                {t('homepage.collection.count', { count: collections.length })}
              </span>
            </div>
            <DataTable
              columns={columns}
              rows={collections}
              rowKey={(row) => row.id}
              labels={{
                empty: t('homepage.collection.empty'),
                emptyDescription: t('homepage.collection.emptyHint'),
                loading: t('common.loading'),
                errorTitle: t('common.error'),
                retry: t('common.retry'),
                copy: t('list.copy'),
                copied: t('list.copied'),
              }}
              loading={resource.loading}
              emptyAction={
                canCreate ? (
                  <Button onClick={openCreate}>{t('homepage.collection.create')}</Button>
                ) : undefined
              }
            />
          </section>
        </>
      ) : null}

      <HomepageCollectionDrawer
        open={drawerOpen}
        collectionId={activeCollectionId}
        categories={resource.data?.categories ?? []}
        categoryLoading={resource.loading}
        categoryError={resource.error}
        nextSortOrder={nextCollectionSortOrder(collections)}
        onRetryCategories={resource.reload}
        onClose={() => setDrawerOpen(false)}
        onSaved={resource.reload}
        onCreated={(id) => {
          resource.reload();
          setActiveCollectionId(id);
        }}
        onDirtyChange={setDrawerDirty}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        title={t('homepage.collection.deleteTitle')}
        description={t('homepage.collection.deleteConfirm', {
          title: deleteTarget?.title ?? '',
        })}
        confirmLabel={t('common.yesDelete')}
        cancelLabel={t('common.cancel')}
        destructive
        loading={deleting}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

function HomepageConfigPanel({
  config,
  onSaved,
  onDirtyChange,
}: {
  config: HomepageDisplayConfigSummary;
  onSaved: () => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const { t, locale, can } = useSession();
  const toast = useToast();
  const canUpdate = can('homepage.config.update');
  const [values, setValues] = useState<HomepageConfigFormValues>({
    newArrivalsLimit: String(config.newArrivalsLimit),
    enabled: config.enabled,
  });
  const [expectedUpdatedAt, setExpectedUpdatedAt] = useState(config.updatedAt);
  const [savedAt, setSavedAt] = useState(config.updatedAt);
  const [error, setError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const initialValues = useMemo(
    () => ({ newArrivalsLimit: String(config.newArrivalsLimit), enabled: config.enabled }),
    [config.newArrivalsLimit, config.enabled],
  );
  const dirty = JSON.stringify(values) !== JSON.stringify(initialValues);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  useEffect(() => {
    // A collection write can reload the page resource while this form has an
    // unsaved draft. Never replace that draft merely because the request
    // finished; the administrator must save or explicitly reload first.
    if (dirtyRef.current) return;
    setValues({ newArrivalsLimit: String(config.newArrivalsLimit), enabled: config.enabled });
    setExpectedUpdatedAt(config.updatedAt);
    setSavedAt(config.updatedAt);
  }, [config.newArrivalsLimit, config.enabled, config.updatedAt]);

  const submit = async () => {
    const parsed = parseHomepageDisplayTotal(values.newArrivalsLimit);
    if (parsed.value === null) {
      setError(parsed.error);
      return;
    }
    setError(null);
    setServerError(null);
    setBusy(true);
    try {
      const updated = await homepageManagementApi.updateConfig({
        newArrivalsLimit: parsed.value,
        enabled: values.enabled,
        expectedUpdatedAt,
      });
      setValues({ newArrivalsLimit: String(updated.newArrivalsLimit), enabled: updated.enabled });
      setExpectedUpdatedAt(updated.updatedAt);
      setSavedAt(updated.updatedAt);
      toast.success(t('homepage.config.saved'));
      onSaved();
    } catch (caught) {
      setServerError(
        caught instanceof AdminApiError
          ? translateError(locale, caught.code)
          : t('errors.INTERNAL_ERROR'),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel stack" aria-labelledby="homepage-config-heading">
      <div className="row-between">
        <div>
          <h2 id="homepage-config-heading" className="section-title">
            {t('homepage.config.title')}
          </h2>
          <p className="muted">{t('homepage.config.description')}</p>
        </div>
        <span className="muted small">
          {t('homepage.config.savedAt', { time: formatTimestamp(savedAt, locale) })}
        </span>
      </div>

      <div className="notice">{t('homepage.config.batchExplanation')}</div>

      <div className="form-grid">
        <Field
          label={t('homepage.config.newArrivalsLimit')}
          required
          help={t('homepage.config.newArrivalsLimitHelp')}
          error={error ? t(error) : undefined}
        >
          {({ inputId, describedBy }) => (
            <>
              <Input
                inputId={inputId}
                describedBy={describedBy}
                type="number"
                inputMode="numeric"
                min={6}
                step={6}
                value={values.newArrivalsLimit}
                disabled={!canUpdate || busy}
                invalid={Boolean(error)}
                onChange={(event) => {
                  setValues((current) => ({
                    ...current,
                    newArrivalsLimit: event.target.value,
                  }));
                  setError(null);
                }}
              />
              <div className="homepage-quick-values" aria-label={t('homepage.config.quickValues')}>
                {QUICK_TOTALS.map((total) => (
                  <Button
                    key={total}
                    size="sm"
                    variant="ghost"
                    disabled={!canUpdate || busy}
                    onClick={() => {
                      setValues((current) => ({
                        ...current,
                        newArrivalsLimit: String(total),
                      }));
                      setError(null);
                    }}
                  >
                    {total}
                  </Button>
                ))}
              </div>
            </>
          )}
        </Field>

        <div className="stack-sm">
          <label className="checkbox-row" htmlFor="homepage-enabled">
            <input
              id="homepage-enabled"
              type="checkbox"
              checked={values.enabled}
              disabled={!canUpdate || busy}
              onChange={(event) =>
                setValues((current) => ({ ...current, enabled: event.target.checked }))
              }
            />
            <span className="checkbox-label">
              {t('homepage.config.enabled')}
              <span className="field-help">{t('homepage.config.enabledHelp')}</span>
            </span>
          </label>
          <span className="field-help">{t('homepage.config.databaseRangeHelp')}</span>
        </div>
      </div>

      {serverError ? (
        <div className="notice notice-danger" role="alert">
          {serverError}
        </div>
      ) : null}

      {canUpdate ? (
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <Button loading={busy} onClick={() => void submit()}>
            {t('homepage.config.save')}
          </Button>
        </div>
      ) : (
        <div className="notice notice-warning">{t('homepage.permissions.configReadOnly')}</div>
      )}
    </section>
  );
}

function nextCollectionSortOrder(collections: HomepageCollectionSummary[]): number {
  return collections.length === 0
    ? 10
    : Math.max(...collections.map((collection) => collection.sortOrder)) + 10;
}

function formatTimestamp(value: string, locale: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
