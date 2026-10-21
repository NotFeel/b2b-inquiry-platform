'use client';

import { useCallback, useMemo, useState } from 'react';
import type {
  CredentialAdminDetail,
  CredentialAdminSummary,
  FactoryMediaAdminDetail,
  FactoryMediaAdminSummary,
  FactoryProcessStepAdminDetail,
  FactoryProcessStepAdminSummary,
  HomeSectionAdminDetail,
  PublishStatus,
} from '@b2b/contracts';
import {
  CREDENTIAL_PLACEMENTS,
  DICTIONARY_TYPES,
  FACTORY_MEDIA_PLACEMENTS,
  PUBLISH_STATUSES,
} from '@b2b/contracts';
import {
  Badge,
  Button,
  ConfirmDialog,
  DataTable,
  Drawer,
  Field,
  Input,
  MultiSelect,
  PageHeader,
  Pagination,
  Select,
  Textarea,
  useToast,
  type DataTableColumn,
} from '@b2b/ui';
import { AdminApiError } from '../lib/admin-api';
import {
  contentOpsApi,
  type CredentialPayload,
  type FactoryMediaPayload,
  type FactoryProcessPayload,
  type HomeSectionPayload,
} from '../lib/content-ops-api';
import { useDictionaryOptions } from '../lib/dictionary-options';
import { translateError } from '../lib/i18n';
import { useResource } from '../lib/use-resource';
import { useBreadcrumb } from './use-breadcrumb';
import { useSession } from './session-provider';
import { ContentAssetField } from './content-asset-field';

const PAGE_SIZE = 20;
const EN = 'en-US';
const ZH = 'zh-CN';

function statusLabel(t: (key: string) => string, status: PublishStatus): string {
  return t(`contentOps.statuses.${status}`);
}

function paginationLabels(
  t: (key: string, params?: Record<string, string | number>) => string,
  pagination: { page: number; pageSize: number; total: number },
) {
  const from = pagination.total === 0 ? 0 : (pagination.page - 1) * pagination.pageSize + 1;
  const to = Math.min(pagination.page * pagination.pageSize, pagination.total);
  return {
    previous: t('common.previous'),
    next: t('common.next'),
    rowsPerPage: t('common.rowsPerPage'),
    range: t('list.range', { from, to, total: pagination.total }),
  };
}

function placementLabel(t: (key: string) => string, placement: string): string {
  const key = `contentOps.placements.${placement}`;
  return t(key);
}

function contentStatusOptions(t: (key: string) => string) {
  return PUBLISH_STATUSES.map((value) => ({
    value,
    label: t(`contentOps.statuses.${value}`),
  }));
}

function TranslationFields({
  t,
  values,
  onChange,
  multiline = true,
}: {
  t: (key: string) => string;
  values: Record<string, { title: string; description?: string | null }>;
  onChange: (locale: string, patch: { title?: string; description?: string }) => void;
  multiline?: boolean;
}) {
  return (
    <div className="form-grid">
      {[EN, ZH].map((locale) => (
        <div className="stack-sm" key={locale}>
          <h3 className="field-label">
            {locale === EN ? t('contentOps.common.english') : t('contentOps.common.chinese')}
          </h3>
          <Field label={t('contentOps.factoryMedia.titleField')}>
            {({ inputId }) => (
              <Input
                inputId={inputId}
                value={values[locale]?.title ?? ''}
                onChange={(event) => onChange(locale, { title: event.target.value })}
              />
            )}
          </Field>
          <Field label={t('contentOps.factoryMedia.descriptionField')}>
            {({ inputId }) =>
              multiline ? (
                <Textarea
                  inputId={inputId}
                  value={values[locale]?.description ?? ''}
                  onChange={(event) => onChange(locale, { description: event.target.value })}
                />
              ) : (
                <Input
                  inputId={inputId}
                  value={values[locale]?.description ?? ''}
                  onChange={(event) => onChange(locale, { description: event.target.value })}
                />
              )
            }
          </Field>
        </div>
      ))}
    </div>
  );
}

interface MediaFormState {
  mediaType: 'image' | 'video';
  assetId: string | null;
  assetUrl: string | null;
  coverAssetId: string | null;
  coverAssetUrl: string | null;
  videoSourceType: 'upload' | 'external';
  videoUrl: string;
  sourceNote: string;
  adminNote: string;
  placements: string[];
  sortOrder: string;
  status: PublishStatus;
  translations: Record<string, { title: string; description: string; altText: string }>;
}

function emptyMediaForm(): MediaFormState {
  return {
    mediaType: 'image',
    assetId: null,
    assetUrl: null,
    coverAssetId: null,
    coverAssetUrl: null,
    videoSourceType: 'upload',
    videoUrl: '',
    sourceNote: '',
    adminNote: '',
    placements: [],
    sortOrder: '0',
    status: 'draft',
    translations: {
      [EN]: { title: '', description: '', altText: '' },
      [ZH]: { title: '', description: '', altText: '' },
    },
  };
}

function mediaFormFromDetail(detail: FactoryMediaAdminDetail): MediaFormState {
  return {
    mediaType: detail.mediaType,
    assetId: detail.assetId,
    assetUrl: detail.assetUrl,
    coverAssetId: detail.coverAssetId,
    coverAssetUrl: detail.coverAssetUrl,
    videoSourceType: detail.videoSourceType === 'external' ? 'external' : 'upload',
    videoUrl: detail.videoUrl ?? '',
    sourceNote: detail.sourceNote ?? '',
    adminNote: detail.adminNote ?? '',
    placements: detail.placements,
    sortOrder: String(detail.sortOrder),
    status: detail.status,
    translations: {
      [EN]: {
        title: detail.translations[EN]?.title ?? '',
        description: detail.translations[EN]?.description ?? '',
        altText: detail.translations[EN]?.altText ?? '',
      },
      [ZH]: {
        title: detail.translations[ZH]?.title ?? '',
        description: detail.translations[ZH]?.description ?? '',
        altText: detail.translations[ZH]?.altText ?? '',
      },
    },
  };
}

function mediaPayload(state: MediaFormState): FactoryMediaPayload {
  return {
    mediaType: state.mediaType,
    assetId: state.assetId,
    coverAssetId: state.coverAssetId,
    videoSourceType: state.mediaType === 'video' ? state.videoSourceType : null,
    videoUrl:
      state.mediaType === 'video' && state.videoSourceType === 'external'
        ? state.videoUrl.trim() || null
        : null,
    sourceNote: state.sourceNote.trim() || null,
    adminNote: state.adminNote.trim() || null,
    placements: state.placements,
    sortOrder: Number(state.sortOrder) || 0,
    status: state.status,
    translations: [EN, ZH].map((locale) => ({
      locale,
      title: state.translations[locale]?.title.trim() ?? '',
      description: state.translations[locale]?.description.trim() || null,
      altText: state.translations[locale]?.altText.trim() || null,
    })),
  };
}

export function FactoryMediaPage() {
  const { t, locale, can } = useSession();
  const toast = useToast();
  const breadcrumb = useBreadcrumb();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'all' | PublishStatus>('all');
  const [mediaType, setMediaType] = useState<'all' | 'image' | 'video'>('all');
  const [placement, setPlacement] = useState('all');
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<FactoryMediaAdminDetail | null>(null);
  const [form, setForm] = useState<MediaFormState>(emptyMediaForm);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<FactoryMediaAdminSummary | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loader = useCallback(
    () =>
      contentOpsApi.factoryMedia.list({
        locale,
        page,
        pageSize: PAGE_SIZE,
        q: q.trim() || undefined,
        publishStatus: status,
        mediaType,
        placement,
      }),
    [locale, page, q, status, mediaType, placement],
  );
  const resource = useResource(loader, [locale, page, q, status, mediaType, placement], locale);
  const rows = resource.data?.data ?? [];

  const openCreate = () => {
    setEditing(null);
    setForm(emptyMediaForm());
    setFormOpen(true);
  };

  const openEdit = async (id: string) => {
    try {
      const detail = await contentOpsApi.factoryMedia.get(id, locale);
      setEditing(detail);
      setForm(mediaFormFromDetail(detail));
      setFormOpen(true);
    } catch (caught) {
      toast.error(
        caught instanceof AdminApiError
          ? translateError(locale, caught.code)
          : t('contentOps.common.loadError'),
      );
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      if (editing) {
        await contentOpsApi.factoryMedia.update(editing.id, mediaPayload(form));
      } else {
        await contentOpsApi.factoryMedia.create(mediaPayload(form));
      }
      toast.success(t('contentOps.common.saved'));
      setFormOpen(false);
      resource.reload();
    } catch (caught) {
      toast.error(
        caught instanceof AdminApiError
          ? translateError(locale, caught.code)
          : t('contentOps.common.saveError'),
      );
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (row: FactoryMediaAdminSummary) => {
    try {
      await contentOpsApi.factoryMedia.setStatus(
        row.id,
        row.status === 'published' ? 'unpublished' : 'published',
      );
      resource.reload();
    } catch (caught) {
      toast.error(
        caught instanceof AdminApiError
          ? translateError(locale, caught.code)
          : t('contentOps.common.saveError'),
      );
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await contentOpsApi.factoryMedia.remove(deleteTarget.id);
      toast.success(t('contentOps.common.deleted'));
      setDeleteTarget(null);
      resource.reload();
    } catch (caught) {
      toast.error(
        caught instanceof AdminApiError
          ? translateError(locale, caught.code)
          : t('contentOps.common.saveError'),
      );
    } finally {
      setDeleting(false);
    }
  };

  const columns: DataTableColumn<FactoryMediaAdminSummary>[] = [
    {
      key: 'preview',
      header: t('contentOps.factoryMedia.columns.preview'),
      width: 90,
      render: (row) =>
        row.thumbnailUrl ? (
          <img className="content-op-thumb" src={row.thumbnailUrl} alt="" />
        ) : (
          <span className="content-op-thumb content-op-thumb-empty">
            {row.mediaType === 'video'
              ? t('contentOps.factoryMedia.video')
              : t('contentOps.factoryMedia.image')}
          </span>
        ),
    },
    {
      key: 'title',
      header: t('contentOps.factoryMedia.columns.title'),
      render: (row) => row.title,
    },
    {
      key: 'type',
      header: t('contentOps.factoryMedia.columns.type'),
      render: (row) => (
        <Badge tone={row.mediaType === 'video' ? 'warning' : 'info'}>
          {t(`contentOps.factoryMedia.${row.mediaType}`)}
        </Badge>
      ),
    },
    {
      key: 'placements',
      header: t('contentOps.factoryMedia.columns.placements'),
      render: (row) => (
        <span className="badge-stack">
          {row.placements.map((item) => (
            <Badge key={item} tone="neutral">
              {placementLabel(t, item)}
            </Badge>
          ))}
        </span>
      ),
    },
    {
      key: 'order',
      header: t('contentOps.factoryMedia.columns.order'),
      align: 'right',
      render: (row) => row.sortOrder,
    },
    {
      key: 'status',
      header: t('contentOps.common.status'),
      render: (row) => (
        <Badge tone={row.status === 'published' ? 'success' : 'neutral'}>
          {statusLabel(t, row.status)}
        </Badge>
      ),
    },
    {
      key: 'updated',
      header: t('contentOps.common.updated'),
      render: (row) => new Date(row.updatedAt).toLocaleString(locale),
    },
    {
      key: 'actions',
      header: t('contentOps.common.actions'),
      align: 'right',
      render: (row) => (
        <span className="data-table-actions">
          {can('content.factory-media.update') ? (
            <Button size="sm" variant="ghost" onClick={() => void openEdit(row.id)}>
              {t('contentOps.common.edit')}
            </Button>
          ) : null}
          {can('content.factory-media.publish') ? (
            <Button size="sm" variant="secondary" onClick={() => void toggleStatus(row)}>
              {row.status === 'published'
                ? t('contentOps.common.unpublish')
                : t('contentOps.common.publish')}
            </Button>
          ) : null}
          {can('content.factory-media.delete') ? (
            <Button size="sm" variant="danger" onClick={() => setDeleteTarget(row)}>
              {t('contentOps.common.delete')}
            </Button>
          ) : null}
        </span>
      ),
    },
  ];

  return (
    <div className="stack">
      <PageHeader
        breadcrumb={breadcrumb}
        title={t('contentOps.factoryMedia.title')}
        description={t('contentOps.factoryMedia.description')}
        actions={
          can('content.factory-media.create') ? (
            <Button onClick={openCreate}>{t('contentOps.common.create')}</Button>
          ) : null
        }
      />
      <div className="catalog-toolbar">
        <Field label={t('contentOps.common.search')}>
          {({ inputId }) => (
            <Input inputId={inputId} value={q} onChange={(event) => setQ(event.target.value)} />
          )}
        </Field>
        <Field label={t('contentOps.factoryMedia.mediaType')}>
          {({ inputId }) => (
            <Select
              inputId={inputId}
              value={mediaType}
              onChange={(event) => setMediaType(event.target.value as typeof mediaType)}
              options={[
                { value: 'all', label: t('contentOps.factoryMedia.typeAll') },
                { value: 'image', label: t('contentOps.factoryMedia.image') },
                { value: 'video', label: t('contentOps.factoryMedia.video') },
              ]}
            />
          )}
        </Field>
        <Field label={t('contentOps.factoryMedia.placements')}>
          {({ inputId }) => (
            <Select
              inputId={inputId}
              value={placement}
              onChange={(event) => setPlacement(event.target.value)}
              options={[
                { value: 'all', label: t('contentOps.factoryMedia.placementAll') },
                ...FACTORY_MEDIA_PLACEMENTS.map((value) => ({
                  value,
                  label: placementLabel(t, value),
                })),
              ]}
            />
          )}
        </Field>
        <Field label={t('contentOps.common.status')}>
          {({ inputId }) => (
            <Select
              inputId={inputId}
              value={status}
              onChange={(event) => setStatus(event.target.value as typeof status)}
              options={[
                { value: 'all', label: t('contentOps.common.statusAll') },
                ...contentStatusOptions(t),
              ]}
            />
          )}
        </Field>
        <Button variant="secondary" onClick={resource.reload}>
          {t('contentOps.common.apply')}
        </Button>
      </div>
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        loading={resource.loading}
        error={resource.error ? translateError(locale, resource.error) : null}
        labels={{
          empty: t('contentOps.common.empty'),
          loading: t('common.loading'),
          errorTitle: t('common.error'),
          retry: t('common.retry'),
        }}
        onRetry={resource.reload}
      />
      {resource.data?.pagination ? (
        <Pagination
          page={resource.data.pagination.page}
          pageSize={resource.data.pagination.pageSize}
          total={resource.data.pagination.total}
          totalPages={resource.data.pagination.totalPages}
          onPageChange={setPage}
          labels={paginationLabels(t, resource.data.pagination)}
        />
      ) : null}

      <Drawer
        open={formOpen}
        title={editing ? t('contentOps.common.edit') : t('contentOps.common.create')}
        onClose={() => setFormOpen(false)}
        closeLabel={t('common.close')}
      >
        <div className="stack">
          <div className="form-grid">
            <Field label={t('contentOps.factoryMedia.mediaType')}>
              {({ inputId }) => (
                <Select
                  inputId={inputId}
                  value={form.mediaType}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      mediaType: event.target.value as 'image' | 'video',
                    }))
                  }
                  options={[
                    { value: 'image', label: t('contentOps.factoryMedia.image') },
                    { value: 'video', label: t('contentOps.factoryMedia.video') },
                  ]}
                />
              )}
            </Field>
            <Field label={t('contentOps.common.status')}>
              {({ inputId }) => (
                <Select
                  inputId={inputId}
                  value={form.status}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      status: event.target.value as PublishStatus,
                    }))
                  }
                  options={contentStatusOptions(t)}
                />
              )}
            </Field>
            <Field label={t('contentOps.factoryMedia.asset')}>
              {() => (
                <ContentAssetField
                  purpose={
                    form.mediaType === 'video' ? 'factory-media-video' : 'factory-media-image'
                  }
                  accept={
                    form.mediaType === 'video'
                      ? 'video/mp4,video/webm'
                      : 'image/jpeg,image/png,image/webp'
                  }
                  mediaType={form.mediaType}
                  label={t('contentOps.factoryMedia.asset')}
                  assetId={form.assetId}
                  assetUrl={form.assetUrl}
                  onChange={(asset) =>
                    setForm((current) => ({
                      ...current,
                      assetId: asset?.id ?? null,
                      assetUrl: asset?.url ?? null,
                    }))
                  }
                />
              )}
            </Field>
            {form.mediaType === 'video' ? (
              <>
                <Field label={t('contentOps.factoryMedia.sourceType')}>
                  {({ inputId }) => (
                    <Select
                      inputId={inputId}
                      value={form.videoSourceType}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          videoSourceType: event.target.value as 'upload' | 'external',
                        }))
                      }
                      options={[
                        { value: 'upload', label: t('contentOps.factoryMedia.uploadSource') },
                        { value: 'external', label: t('contentOps.factoryMedia.externalSource') },
                      ]}
                    />
                  )}
                </Field>
                <Field label={t('contentOps.factoryMedia.videoUrl')}>
                  {({ inputId }) => (
                    <Input
                      inputId={inputId}
                      value={form.videoUrl}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, videoUrl: event.target.value }))
                      }
                    />
                  )}
                </Field>
                <Field label={t('contentOps.factoryMedia.cover')}>
                  {() => (
                    <ContentAssetField
                      purpose="factory-media-image"
                      accept="image/jpeg,image/png,image/webp"
                      assetId={form.coverAssetId}
                      assetUrl={form.coverAssetUrl}
                      label={t('contentOps.factoryMedia.cover')}
                      onChange={(asset) =>
                        setForm((current) => ({
                          ...current,
                          coverAssetId: asset?.id ?? null,
                          coverAssetUrl: asset?.url ?? null,
                        }))
                      }
                    />
                  )}
                </Field>
              </>
            ) : null}
          </div>
          <Field label={t('contentOps.factoryMedia.placements')}>
            {() => (
              <MultiSelect
                options={FACTORY_MEDIA_PLACEMENTS.map((value) => ({
                  value,
                  label: placementLabel(t, value),
                }))}
                value={form.placements}
                onChange={(next) => setForm((current) => ({ ...current, placements: next }))}
                placeholder={t('contentOps.factoryMedia.placements')}
                searchPlaceholder={t('contentOps.common.search')}
                emptyLabel={t('contentOps.common.none')}
                noMatchLabel={t('contentOps.common.empty')}
                loadingLabel={t('common.loading')}
                retryLabel={t('common.retry')}
                removeLabel={(value) => t('products.tags.remove', { label: value })}
              />
            )}
          </Field>
          <TranslationFields
            t={t}
            values={form.translations}
            onChange={(target, patch) =>
              setForm((current) => ({
                ...current,
                translations: {
                  ...current.translations,
                  [target]: { ...current.translations[target]!, ...patch },
                },
              }))
            }
          />
          <div className="form-grid">
            <Field label={t('contentOps.common.order')}>
              {({ inputId }) => (
                <Input
                  inputId={inputId}
                  type="number"
                  min={0}
                  value={form.sortOrder}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, sortOrder: event.target.value }))
                  }
                />
              )}
            </Field>
            <Field label={t('contentOps.factoryMedia.sourceNote')}>
              {({ inputId }) => (
                <Input
                  inputId={inputId}
                  value={form.sourceNote}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, sourceNote: event.target.value }))
                  }
                />
              )}
            </Field>
            <Field label={t('contentOps.factoryMedia.adminNote')}>
              {({ inputId }) => (
                <Textarea
                  inputId={inputId}
                  value={form.adminNote}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, adminNote: event.target.value }))
                  }
                />
              )}
            </Field>
          </div>
          <div className="row-tight">
            <Button onClick={() => void save()} loading={saving}>
              {t('common.save')}
            </Button>
            <Button variant="secondary" onClick={() => setFormOpen(false)}>
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      </Drawer>
      <ConfirmDialog
        open={deleteTarget !== null}
        title={t('contentOps.common.deleteTitle')}
        description={t('contentOps.common.deleteWarning')}
        confirmLabel={t('contentOps.common.delete')}
        cancelLabel={t('common.cancel')}
        destructive
        loading={deleting}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

interface ProcessFormState {
  assetId: string | null;
  assetUrl: string | null;
  sortOrder: string;
  status: PublishStatus;
  adminNote: string;
  translations: Record<string, { title: string; description: string }>;
}

function emptyProcessForm(): ProcessFormState {
  return {
    assetId: null,
    assetUrl: null,
    sortOrder: '0',
    status: 'draft',
    adminNote: '',
    translations: { [EN]: { title: '', description: '' }, [ZH]: { title: '', description: '' } },
  };
}

export function FactoryProcessPage() {
  const { t, locale, can } = useSession();
  const toast = useToast();
  const breadcrumb = useBreadcrumb();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<FactoryProcessStepAdminDetail | null>(null);
  const [form, setForm] = useState<ProcessFormState>(emptyProcessForm);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<FactoryProcessStepAdminSummary | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loader = useCallback(
    () =>
      contentOpsApi.factoryProcess.list({
        locale,
        page,
        pageSize: PAGE_SIZE,
        q: q.trim() || undefined,
      }),
    [locale, page, q],
  );
  const resource = useResource(loader, [locale, page, q], locale);
  const rows = resource.data?.data ?? [];

  const openCreate = () => {
    setEditing(null);
    setForm(emptyProcessForm());
    setFormOpen(true);
  };
  const openEdit = async (id: string) => {
    try {
      const detail = await contentOpsApi.factoryProcess.get(id, locale);
      setEditing(detail);
      setForm({
        assetId: detail.assetId,
        assetUrl: detail.assetUrl,
        sortOrder: String(detail.sortOrder),
        status: detail.status,
        adminNote: detail.adminNote ?? '',
        translations: {
          [EN]: {
            title: detail.translations[EN]?.title ?? '',
            description: detail.translations[EN]?.description ?? '',
          },
          [ZH]: {
            title: detail.translations[ZH]?.title ?? '',
            description: detail.translations[ZH]?.description ?? '',
          },
        },
      });
      setFormOpen(true);
    } catch (caught) {
      toast.error(
        caught instanceof AdminApiError
          ? translateError(locale, caught.code)
          : t('contentOps.common.loadError'),
      );
    }
  };
  const save = async () => {
    const payload: FactoryProcessPayload = {
      assetId: form.assetId,
      sortOrder: Number(form.sortOrder) || 0,
      status: form.status,
      adminNote: form.adminNote.trim() || null,
      translations: [EN, ZH].map((target) => ({
        locale: target,
        title: form.translations[target]?.title.trim() ?? '',
        description: form.translations[target]?.description.trim() || null,
      })),
    };
    setSaving(true);
    try {
      if (editing) await contentOpsApi.factoryProcess.update(editing.id, payload);
      else await contentOpsApi.factoryProcess.create(payload);
      toast.success(t('contentOps.common.saved'));
      setFormOpen(false);
      resource.reload();
    } catch (caught) {
      toast.error(
        caught instanceof AdminApiError
          ? translateError(locale, caught.code)
          : t('contentOps.common.saveError'),
      );
    } finally {
      setSaving(false);
    }
  };
  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await contentOpsApi.factoryProcess.remove(deleteTarget.id);
      setDeleteTarget(null);
      resource.reload();
    } catch (caught) {
      toast.error(
        caught instanceof AdminApiError
          ? translateError(locale, caught.code)
          : t('contentOps.common.saveError'),
      );
    } finally {
      setDeleting(false);
    }
  };
  const columns: DataTableColumn<FactoryProcessStepAdminSummary>[] = [
    {
      key: 'preview',
      header: t('contentOps.factoryProcess.columns.preview'),
      width: 90,
      render: (row) =>
        row.thumbnailUrl ? (
          <img className="content-op-thumb" src={row.thumbnailUrl} alt="" />
        ) : (
          <span className="content-op-thumb content-op-thumb-empty">—</span>
        ),
    },
    {
      key: 'title',
      header: t('contentOps.factoryProcess.columns.title'),
      render: (row) => row.title,
    },
    {
      key: 'order',
      header: t('contentOps.factoryProcess.columns.order'),
      align: 'right',
      render: (row) => row.sortOrder,
    },
    {
      key: 'status',
      header: t('contentOps.common.status'),
      render: (row) => (
        <Badge tone={row.status === 'published' ? 'success' : 'neutral'}>
          {statusLabel(t, row.status)}
        </Badge>
      ),
    },
    {
      key: 'updated',
      header: t('contentOps.common.updated'),
      render: (row) => new Date(row.updatedAt).toLocaleString(locale),
    },
    {
      key: 'actions',
      header: t('contentOps.common.actions'),
      align: 'right',
      render: (row) => (
        <span className="data-table-actions">
          {can('content.factory-process.update') ? (
            <Button size="sm" variant="ghost" onClick={() => void openEdit(row.id)}>
              {t('contentOps.common.edit')}
            </Button>
          ) : null}
          {can('content.factory-process.publish') ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                void contentOpsApi.factoryProcess
                  .setStatus(row.id, row.status === 'published' ? 'unpublished' : 'published')
                  .then(resource.reload)
                  .catch((caught: unknown) =>
                    toast.error(
                      caught instanceof AdminApiError
                        ? translateError(locale, caught.code)
                        : t('contentOps.common.saveError'),
                    ),
                  )
              }
            >
              {row.status === 'published'
                ? t('contentOps.common.unpublish')
                : t('contentOps.common.publish')}
            </Button>
          ) : null}
          {can('content.factory-process.delete') ? (
            <Button size="sm" variant="danger" onClick={() => setDeleteTarget(row)}>
              {t('contentOps.common.delete')}
            </Button>
          ) : null}
        </span>
      ),
    },
  ];

  return (
    <div className="stack">
      <PageHeader
        breadcrumb={breadcrumb}
        title={t('contentOps.factoryProcess.title')}
        description={t('contentOps.factoryProcess.description')}
        actions={
          can('content.factory-process.create') ? (
            <Button onClick={openCreate}>{t('contentOps.common.create')}</Button>
          ) : null
        }
      />
      <div className="catalog-toolbar">
        <Field label={t('contentOps.common.search')}>
          {({ inputId }) => (
            <Input inputId={inputId} value={q} onChange={(event) => setQ(event.target.value)} />
          )}
        </Field>
        <Button variant="secondary" onClick={resource.reload}>
          {t('contentOps.common.apply')}
        </Button>
      </div>
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        loading={resource.loading}
        error={resource.error ? translateError(locale, resource.error) : null}
        labels={{
          empty: t('contentOps.common.empty'),
          loading: t('common.loading'),
          errorTitle: t('common.error'),
          retry: t('common.retry'),
        }}
        onRetry={resource.reload}
      />
      {resource.data?.pagination ? (
        <Pagination
          page={resource.data.pagination.page}
          pageSize={resource.data.pagination.pageSize}
          total={resource.data.pagination.total}
          totalPages={resource.data.pagination.totalPages}
          onPageChange={setPage}
          labels={paginationLabels(t, resource.data.pagination)}
        />
      ) : null}
      <Drawer
        open={formOpen}
        title={editing ? t('contentOps.common.edit') : t('contentOps.common.create')}
        onClose={() => setFormOpen(false)}
        closeLabel={t('common.close')}
      >
        <div className="stack">
          <Field label={t('contentOps.factoryProcess.asset')}>
            {() => (
              <ContentAssetField
                purpose="factory-process-image"
                accept="image/jpeg,image/png,image/webp"
                assetId={form.assetId}
                assetUrl={form.assetUrl}
                label={t('contentOps.factoryProcess.asset')}
                onChange={(asset) =>
                  setForm((current) => ({
                    ...current,
                    assetId: asset?.id ?? null,
                    assetUrl: asset?.url ?? null,
                  }))
                }
              />
            )}
          </Field>
          <TranslationFields
            t={t}
            values={form.translations}
            onChange={(target, patch) =>
              setForm((current) => ({
                ...current,
                translations: {
                  ...current.translations,
                  [target]: { ...current.translations[target]!, ...patch },
                },
              }))
            }
          />
          <div className="form-grid">
            <Field label={t('contentOps.common.order')}>
              {({ inputId }) => (
                <Input
                  inputId={inputId}
                  type="number"
                  min={0}
                  value={form.sortOrder}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, sortOrder: event.target.value }))
                  }
                />
              )}
            </Field>
            <Field label={t('contentOps.common.status')}>
              {({ inputId }) => (
                <Select
                  inputId={inputId}
                  value={form.status}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      status: event.target.value as PublishStatus,
                    }))
                  }
                  options={contentStatusOptions(t)}
                />
              )}
            </Field>
            <Field label={t('contentOps.factoryProcess.adminNote')}>
              {({ inputId }) => (
                <Textarea
                  inputId={inputId}
                  value={form.adminNote}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, adminNote: event.target.value }))
                  }
                />
              )}
            </Field>
          </div>
          <div className="row-tight">
            <Button onClick={() => void save()} loading={saving}>
              {t('common.save')}
            </Button>
            <Button variant="secondary" onClick={() => setFormOpen(false)}>
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      </Drawer>
      <ConfirmDialog
        open={deleteTarget !== null}
        title={t('contentOps.common.deleteTitle')}
        description={t('contentOps.common.deleteWarning')}
        confirmLabel={t('contentOps.common.delete')}
        cancelLabel={t('common.cancel')}
        destructive
        loading={deleting}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

interface CredentialFormState {
  credentialTypeCode: string;
  issuer: string;
  credentialNumber: string;
  issuedAt: string;
  validFrom: string;
  validUntil: string;
  validityType: 'dated' | 'perpetual' | 'not_specified';
  showExpiredBadge: boolean;
  primaryAssetId: string | null;
  primaryAssetUrl: string | null;
  verificationUrl: string;
  placements: string[];
  sortOrder: string;
  status: PublishStatus;
  adminNote: string;
  translations: Record<string, { name: string; description: string; verificationLabel: string }>;
}

function emptyCredentialForm(typeCode = ''): CredentialFormState {
  return {
    credentialTypeCode: typeCode,
    issuer: '',
    credentialNumber: '',
    issuedAt: '',
    validFrom: '',
    validUntil: '',
    validityType: 'not_specified',
    showExpiredBadge: true,
    primaryAssetId: null,
    primaryAssetUrl: null,
    verificationUrl: '',
    placements: [],
    sortOrder: '0',
    status: 'draft',
    adminNote: '',
    translations: {
      [EN]: { name: '', description: '', verificationLabel: '' },
      [ZH]: { name: '', description: '', verificationLabel: '' },
    },
  };
}

export function CredentialsPage() {
  const { t, locale, can } = useSession();
  const toast = useToast();
  const breadcrumb = useBreadcrumb();
  const types = useDictionaryOptions(DICTIONARY_TYPES.credentialType, { locale });
  const [q, setQ] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [validityFilter, setValidityFilter] = useState<
    'all' | 'valid' | 'expiring' | 'expired' | 'no_expiry'
  >('all');
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CredentialAdminDetail | null>(null);
  const [form, setForm] = useState<CredentialFormState>(() => emptyCredentialForm());
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<CredentialAdminSummary | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loader = useCallback(
    () =>
      contentOpsApi.credentials.list({
        locale,
        page,
        pageSize: PAGE_SIZE,
        q: q.trim() || undefined,
        credentialType: typeFilter,
        validityStatus: validityFilter,
      }),
    [locale, page, q, typeFilter, validityFilter],
  );
  const resource = useResource(loader, [locale, page, q, typeFilter, validityFilter], locale);
  const rows = resource.data?.data ?? [];
  const typeOptions = types.options;

  const openCreate = () => {
    setEditing(null);
    setForm(emptyCredentialForm(typeOptions[0]?.value ?? ''));
    setFormOpen(true);
  };
  const openEdit = async (id: string) => {
    try {
      const detail = await contentOpsApi.credentials.get(id, locale);
      setEditing(detail);
      setForm({
        credentialTypeCode: detail.credentialTypeCode,
        issuer: detail.issuer ?? '',
        credentialNumber: detail.credentialNumber ?? '',
        issuedAt: detail.issuedAt ?? '',
        validFrom: detail.validFrom ?? '',
        validUntil: detail.validUntil ?? '',
        validityType: detail.validityType,
        showExpiredBadge: detail.showExpiredBadge,
        primaryAssetId: detail.primaryAssetId,
        primaryAssetUrl: detail.primaryAssetUrl,
        verificationUrl: detail.verificationUrl ?? '',
        placements: detail.placements,
        sortOrder: String(detail.sortOrder),
        status: detail.status,
        adminNote: detail.adminNote ?? '',
        translations: {
          [EN]: {
            name: detail.translations[EN]?.name ?? '',
            description: detail.translations[EN]?.description ?? '',
            verificationLabel: detail.translations[EN]?.verificationLabel ?? '',
          },
          [ZH]: {
            name: detail.translations[ZH]?.name ?? '',
            description: detail.translations[ZH]?.description ?? '',
            verificationLabel: detail.translations[ZH]?.verificationLabel ?? '',
          },
        },
      });
      setFormOpen(true);
    } catch (caught) {
      toast.error(
        caught instanceof AdminApiError
          ? translateError(locale, caught.code)
          : t('contentOps.common.loadError'),
      );
    }
  };
  const save = async () => {
    const payload: CredentialPayload = {
      credentialTypeCode: form.credentialTypeCode,
      issuer: form.issuer.trim() || null,
      credentialNumber: form.credentialNumber.trim() || null,
      issuedAt: form.issuedAt || null,
      validFrom: form.validFrom || null,
      validUntil: form.validUntil || null,
      validityType: form.validityType,
      showExpiredBadge: form.showExpiredBadge,
      primaryAssetId: form.primaryAssetId,
      additionalAssetIds: [],
      verificationUrl: form.verificationUrl.trim() || null,
      placements: form.placements,
      sortOrder: Number(form.sortOrder) || 0,
      status: form.status,
      adminNote: form.adminNote.trim() || null,
      translations: [EN, ZH].map((target) => ({
        locale: target,
        name: form.translations[target]?.name.trim() ?? '',
        description: form.translations[target]?.description.trim() || null,
        verificationLabel: form.translations[target]?.verificationLabel.trim() || null,
      })),
    };
    setSaving(true);
    try {
      if (editing) await contentOpsApi.credentials.update(editing.id, payload);
      else await contentOpsApi.credentials.create(payload);
      toast.success(t('contentOps.common.saved'));
      setFormOpen(false);
      resource.reload();
    } catch (caught) {
      toast.error(
        caught instanceof AdminApiError
          ? translateError(locale, caught.code)
          : t('contentOps.common.saveError'),
      );
    } finally {
      setSaving(false);
    }
  };
  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await contentOpsApi.credentials.remove(deleteTarget.id);
      setDeleteTarget(null);
      resource.reload();
    } catch (caught) {
      toast.error(
        caught instanceof AdminApiError
          ? translateError(locale, caught.code)
          : t('contentOps.common.saveError'),
      );
    } finally {
      setDeleting(false);
    }
  };
  const columns: DataTableColumn<CredentialAdminSummary>[] = [
    {
      key: 'preview',
      header: t('contentOps.credentials.columns.preview'),
      width: 90,
      render: (row) =>
        row.thumbnailUrl ? (
          <img className="content-op-thumb" src={row.thumbnailUrl} alt="" />
        ) : (
          <span className="content-op-thumb content-op-thumb-empty">—</span>
        ),
    },
    { key: 'name', header: t('contentOps.credentials.columns.name'), render: (row) => row.name },
    {
      key: 'type',
      header: t('contentOps.credentials.columns.type'),
      render: (row) =>
        typeOptions.find((option) => option.value === row.credentialTypeCode)?.label ??
        row.credentialTypeCode,
    },
    {
      key: 'issuer',
      header: t('contentOps.credentials.columns.issuer'),
      render: (row) => row.issuer ?? '—',
    },
    {
      key: 'validity',
      header: t('contentOps.credentials.columns.validity'),
      render: (row) =>
        row.validUntil
          ? `${row.validFrom ?? '—'} → ${row.validUntil}`
          : t(`contentOps.credentials.validityTypes.${row.validityType}`),
    },
    {
      key: 'status',
      header: t('contentOps.common.status'),
      render: (row) => (
        <Badge tone={row.status === 'published' ? 'success' : 'neutral'}>
          {statusLabel(t, row.status)}
        </Badge>
      ),
    },
    {
      key: 'updated',
      header: t('contentOps.common.updated'),
      render: (row) => new Date(row.updatedAt).toLocaleString(locale),
    },
    {
      key: 'actions',
      header: t('contentOps.common.actions'),
      align: 'right',
      render: (row) => (
        <span className="data-table-actions">
          {can('content.credentials.update') ? (
            <Button size="sm" variant="ghost" onClick={() => void openEdit(row.id)}>
              {t('contentOps.common.edit')}
            </Button>
          ) : null}
          {can('content.credentials.publish') ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                void contentOpsApi.credentials
                  .setStatus(row.id, row.status === 'published' ? 'unpublished' : 'published')
                  .then(resource.reload)
                  .catch((caught: unknown) =>
                    toast.error(
                      caught instanceof AdminApiError
                        ? translateError(locale, caught.code)
                        : t('contentOps.common.saveError'),
                    ),
                  )
              }
            >
              {row.status === 'published'
                ? t('contentOps.common.unpublish')
                : t('contentOps.common.publish')}
            </Button>
          ) : null}
          {can('content.credentials.delete') ? (
            <Button size="sm" variant="danger" onClick={() => setDeleteTarget(row)}>
              {t('contentOps.common.delete')}
            </Button>
          ) : null}
        </span>
      ),
    },
  ];

  return (
    <div className="stack">
      <PageHeader
        breadcrumb={breadcrumb}
        title={t('contentOps.credentials.title')}
        description={t('contentOps.credentials.description')}
        actions={
          can('content.credentials.create') ? (
            <Button onClick={openCreate}>{t('contentOps.common.create')}</Button>
          ) : null
        }
      />
      <div className="catalog-toolbar">
        <Field label={t('contentOps.common.search')}>
          {({ inputId }) => (
            <Input inputId={inputId} value={q} onChange={(event) => setQ(event.target.value)} />
          )}
        </Field>
        <Field label={t('contentOps.credentials.type')}>
          {({ inputId }) => (
            <Select
              inputId={inputId}
              value={typeFilter}
              onChange={(event) => setTypeFilter(event.target.value)}
              options={[
                { value: 'all', label: t('contentOps.credentials.typeAll') },
                ...typeOptions,
              ]}
            />
          )}
        </Field>
        <Field label={t('contentOps.credentials.validityType')}>
          {({ inputId }) => (
            <Select
              inputId={inputId}
              value={validityFilter}
              onChange={(event) => setValidityFilter(event.target.value as typeof validityFilter)}
              options={[
                { value: 'all', label: t('contentOps.credentials.validityAll') },
                { value: 'valid', label: t('contentOps.credentials.validityValid') },
                { value: 'expiring', label: t('contentOps.credentials.validityExpiring') },
                { value: 'expired', label: t('contentOps.credentials.validityExpired') },
                { value: 'no_expiry', label: t('contentOps.credentials.validityNoExpiry') },
              ]}
            />
          )}
        </Field>
        <Button variant="secondary" onClick={resource.reload}>
          {t('contentOps.common.apply')}
        </Button>
      </div>
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        loading={resource.loading}
        error={resource.error ? translateError(locale, resource.error) : null}
        labels={{
          empty: t('contentOps.common.empty'),
          loading: t('common.loading'),
          errorTitle: t('common.error'),
          retry: t('common.retry'),
        }}
        onRetry={resource.reload}
      />
      {resource.data?.pagination ? (
        <Pagination
          page={resource.data.pagination.page}
          pageSize={resource.data.pagination.pageSize}
          total={resource.data.pagination.total}
          totalPages={resource.data.pagination.totalPages}
          onPageChange={setPage}
          labels={paginationLabels(t, resource.data.pagination)}
        />
      ) : null}
      <Drawer
        open={formOpen}
        title={editing ? t('contentOps.common.edit') : t('contentOps.common.create')}
        onClose={() => setFormOpen(false)}
        closeLabel={t('common.close')}
      >
        <div className="stack">
          <div className="form-grid">
            <Field label={t('contentOps.credentials.type')}>
              {({ inputId }) => (
                <Select
                  inputId={inputId}
                  value={form.credentialTypeCode}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, credentialTypeCode: event.target.value }))
                  }
                  options={typeOptions}
                />
              )}
            </Field>
            <Field label={t('contentOps.common.status')}>
              {({ inputId }) => (
                <Select
                  inputId={inputId}
                  value={form.status}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      status: event.target.value as PublishStatus,
                    }))
                  }
                  options={contentStatusOptions(t)}
                />
              )}
            </Field>
            <Field label={t('contentOps.credentials.issuer')}>
              {({ inputId }) => (
                <Input
                  inputId={inputId}
                  value={form.issuer}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, issuer: event.target.value }))
                  }
                />
              )}
            </Field>
            <Field label={t('contentOps.credentials.number')}>
              {({ inputId }) => (
                <Input
                  inputId={inputId}
                  value={form.credentialNumber}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, credentialNumber: event.target.value }))
                  }
                />
              )}
            </Field>
          </div>
          <TranslationFields
            t={t}
            values={Object.fromEntries(
              Object.entries(form.translations).map(([key, value]) => [
                key,
                { title: value.name, description: value.description },
              ]),
            )}
            onChange={(target, patch) =>
              setForm((current) => ({
                ...current,
                translations: {
                  ...current.translations,
                  [target]: {
                    ...current.translations[target]!,
                    ...(patch.title !== undefined ? { name: patch.title } : {}),
                    ...(patch.description !== undefined
                      ? { description: patch.description ?? '' }
                      : {}),
                  },
                },
              }))
            }
          />
          <div className="form-grid">
            {[EN, ZH].map((target) => (
              <Field
                key={target}
                label={`${t('contentOps.credentials.verificationLabel')} (${target === EN ? t('contentOps.common.english') : t('contentOps.common.chinese')})`}
              >
                {({ inputId }) => (
                  <Input
                    inputId={inputId}
                    value={form.translations[target]?.verificationLabel ?? ''}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        translations: {
                          ...current.translations,
                          [target]: {
                            ...current.translations[target]!,
                            verificationLabel: event.target.value,
                          },
                        },
                      }))
                    }
                  />
                )}
              </Field>
            ))}
          </div>
          <div className="form-grid">
            <Field label={t('contentOps.credentials.validityType')}>
              {({ inputId }) => (
                <Select
                  inputId={inputId}
                  value={form.validityType}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      validityType: event.target.value as CredentialFormState['validityType'],
                    }))
                  }
                  options={['dated', 'perpetual', 'not_specified'].map((value) => ({
                    value,
                    label: t(`contentOps.credentials.validityTypes.${value}`),
                  }))}
                />
              )}
            </Field>
            <Field label={t('contentOps.credentials.issuedAt')}>
              {({ inputId }) => (
                <Input
                  inputId={inputId}
                  type="date"
                  value={form.issuedAt}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, issuedAt: event.target.value }))
                  }
                />
              )}
            </Field>
            <Field label={t('contentOps.credentials.validFrom')}>
              {({ inputId }) => (
                <Input
                  inputId={inputId}
                  type="date"
                  value={form.validFrom}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, validFrom: event.target.value }))
                  }
                />
              )}
            </Field>
            <Field label={t('contentOps.credentials.validUntil')}>
              {({ inputId }) => (
                <Input
                  inputId={inputId}
                  type="date"
                  value={form.validUntil}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, validUntil: event.target.value }))
                  }
                />
              )}
            </Field>
            <Field label={t('contentOps.credentials.verificationUrl')}>
              {({ inputId }) => (
                <Input
                  inputId={inputId}
                  value={form.verificationUrl}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, verificationUrl: event.target.value }))
                  }
                />
              )}
            </Field>
            <Field label={t('contentOps.common.order')}>
              {({ inputId }) => (
                <Input
                  inputId={inputId}
                  type="number"
                  min={0}
                  value={form.sortOrder}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, sortOrder: event.target.value }))
                  }
                />
              )}
            </Field>
            <Field label={t('contentOps.credentials.showExpiredBadge')}>
              {() => (
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={form.showExpiredBadge}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        showExpiredBadge: event.target.checked,
                      }))
                    }
                  />
                  <span>{t('contentOps.credentials.showExpiredBadge')}</span>
                </label>
              )}
            </Field>
          </div>
          <Field label={t('contentOps.credentials.primaryAsset')}>
            {() => (
              <ContentAssetField
                purpose="credential-document"
                accept="application/pdf,image/jpeg,image/png,image/webp"
                mediaType="document"
                assetId={form.primaryAssetId}
                assetUrl={form.primaryAssetUrl}
                label={t('contentOps.credentials.primaryAsset')}
                onChange={(asset) =>
                  setForm((current) => ({
                    ...current,
                    primaryAssetId: asset?.id ?? null,
                    primaryAssetUrl: asset?.url ?? null,
                  }))
                }
              />
            )}
          </Field>
          <Field label={t('contentOps.credentials.placements')}>
            {() => (
              <MultiSelect
                options={CREDENTIAL_PLACEMENTS.map((value) => ({
                  value,
                  label: placementLabel(t, value),
                }))}
                value={form.placements}
                onChange={(next) => setForm((current) => ({ ...current, placements: next }))}
                placeholder={t('contentOps.credentials.placements')}
                searchPlaceholder={t('contentOps.common.search')}
                emptyLabel={t('contentOps.common.none')}
                noMatchLabel={t('contentOps.common.empty')}
                loadingLabel={t('common.loading')}
                retryLabel={t('common.retry')}
                removeLabel={(value) => t('products.tags.remove', { label: value })}
              />
            )}
          </Field>
          <Field label={t('contentOps.credentials.adminNote')}>
            {({ inputId }) => (
              <Textarea
                inputId={inputId}
                value={form.adminNote}
                onChange={(event) =>
                  setForm((current) => ({ ...current, adminNote: event.target.value }))
                }
              />
            )}
          </Field>
          <div className="row-tight">
            <Button onClick={() => void save()} loading={saving}>
              {t('common.save')}
            </Button>
            <Button variant="secondary" onClick={() => setFormOpen(false)}>
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      </Drawer>
      <ConfirmDialog
        open={deleteTarget !== null}
        title={t('contentOps.common.deleteTitle')}
        description={t('contentOps.common.deleteWarning')}
        confirmLabel={t('contentOps.common.delete')}
        cancelLabel={t('common.cancel')}
        destructive
        loading={deleting}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

export function HomeSectionsPage() {
  const { t, locale, can } = useSession();
  const toast = useToast();
  const breadcrumb = useBreadcrumb();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<HomeSectionAdminDetail | null>(null);
  const [form, setForm] = useState<{
    enabled: boolean;
    displayLimit: string;
    sortOrder: string;
    itemIds: string[];
    ctaUrl: string;
    adminNote: string;
    translations: Record<string, { title: string; description: string; ctaLabel: string }>;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const resource = useResource(() => contentOpsApi.homeSections.list(), [locale], locale);
  const media = useResource(
    () =>
      contentOpsApi.factoryMedia.list({
        locale,
        page: 1,
        pageSize: 100,
        publishStatus: 'published',
      }),
    [locale],
    locale,
  );
  const credentials = useResource(
    () =>
      contentOpsApi.credentials.list({
        locale,
        page: 1,
        pageSize: 100,
        publishStatus: 'published',
      }),
    [locale],
    locale,
  );

  const openEdit = (section: HomeSectionAdminDetail) => {
    setEditing(section);
    setForm({
      enabled: section.enabled,
      displayLimit: String(section.displayLimit),
      sortOrder: String(section.sortOrder),
      itemIds: section.itemIds,
      ctaUrl: section.ctaUrl ?? '',
      adminNote: section.adminNote ?? '',
      translations: {
        [EN]: {
          title: section.translations[EN]?.title ?? '',
          description: section.translations[EN]?.description ?? '',
          ctaLabel: section.translations[EN]?.ctaLabel ?? '',
        },
        [ZH]: {
          title: section.translations[ZH]?.title ?? '',
          description: section.translations[ZH]?.description ?? '',
          ctaLabel: section.translations[ZH]?.ctaLabel ?? '',
        },
      },
    });
    setFormOpen(true);
  };

  const itemOptions = useMemo(() => {
    if (editing?.code === 'home.factory-preview') {
      return (media.data?.data ?? []).map((row) => ({ value: row.id, label: row.title }));
    }
    if (editing?.code === 'home.quality-preview') {
      return (credentials.data?.data ?? []).map((row) => ({ value: row.id, label: row.name }));
    }
    return [];
  }, [editing, media.data, credentials.data]);

  const save = async () => {
    if (!editing || !form) return;
    const payload: HomeSectionPayload = {
      enabled: form.enabled,
      displayLimit: Number(form.displayLimit) || 4,
      sortOrder: Number(form.sortOrder) || 0,
      itemIds: form.itemIds,
      ctaUrl: form.ctaUrl.trim() || null,
      adminNote: form.adminNote.trim() || null,
      translations: [EN, ZH].map((target) => ({
        locale: target,
        title: form.translations[target]?.title.trim() ?? '',
        description: form.translations[target]?.description.trim() || null,
        ctaLabel: form.translations[target]?.ctaLabel.trim() || null,
      })),
    };
    setSaving(true);
    try {
      await contentOpsApi.homeSections.update(editing.code, payload);
      toast.success(t('contentOps.common.saved'));
      setFormOpen(false);
      resource.reload();
    } catch (caught) {
      toast.error(
        caught instanceof AdminApiError
          ? translateError(locale, caught.code)
          : t('contentOps.common.saveError'),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="stack">
      <PageHeader
        breadcrumb={breadcrumb}
        title={t('contentOps.homeSections.title')}
        description={t('contentOps.homeSections.description')}
      />
      {resource.loading ? (
        <div className="state-block">{t('common.loading')}</div>
      ) : resource.error ? (
        <div className="state-block">{translateError(locale, resource.error)}</div>
      ) : (
        <div className="stack">
          {(resource.data ?? []).map((section) => (
            <div className="panel row-between" key={section.id}>
              <div>
                <strong>
                  {section.code === 'home.factory-preview'
                    ? t('contentOps.homeSections.factoryTitle')
                    : t('contentOps.homeSections.qualityTitle')}
                </strong>
                <div className="muted small">{section.translations[EN]?.title ?? section.code}</div>
              </div>
              <div className="row-tight">
                <Badge tone={section.enabled ? 'success' : 'neutral'}>
                  {section.enabled
                    ? t('contentOps.common.publish')
                    : t('contentOps.common.unpublish')}
                </Badge>
                {can('content.home-sections.update') ? (
                  <Button size="sm" variant="secondary" onClick={() => openEdit(section)}>
                    {t('contentOps.common.edit')}
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
      <Drawer
        open={formOpen}
        title={editing ? t('contentOps.common.edit') : t('contentOps.common.create')}
        onClose={() => setFormOpen(false)}
        closeLabel={t('common.close')}
      >
        {form ? (
          <div className="stack">
            <div className="form-grid">
              <Field label={t('contentOps.homeSections.enabled')}>
                {() => (
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={form.enabled}
                      onChange={(event) => setForm({ ...form, enabled: event.target.checked })}
                    />
                    <span>{t('contentOps.homeSections.enabled')}</span>
                  </label>
                )}
              </Field>
              <Field label={t('contentOps.homeSections.displayLimit')}>
                {({ inputId }) => (
                  <Input
                    inputId={inputId}
                    type="number"
                    min={1}
                    max={24}
                    value={form.displayLimit}
                    onChange={(event) => setForm({ ...form, displayLimit: event.target.value })}
                  />
                )}
              </Field>
              <Field label={t('contentOps.common.order')}>
                {({ inputId }) => (
                  <Input
                    inputId={inputId}
                    type="number"
                    min={0}
                    value={form.sortOrder}
                    onChange={(event) => setForm({ ...form, sortOrder: event.target.value })}
                  />
                )}
              </Field>
              <Field label={t('contentOps.homeSections.ctaUrl')}>
                {({ inputId }) => (
                  <Input
                    inputId={inputId}
                    value={form.ctaUrl}
                    onChange={(event) => setForm({ ...form, ctaUrl: event.target.value })}
                  />
                )}
              </Field>
            </div>
            <Field label={t('contentOps.homeSections.items')}>
              {() => (
                <MultiSelect
                  options={itemOptions}
                  value={form.itemIds}
                  onChange={(next) => setForm({ ...form, itemIds: next })}
                  placeholder={t('contentOps.homeSections.items')}
                  searchPlaceholder={t('contentOps.common.search')}
                  emptyLabel={t('contentOps.common.none')}
                  noMatchLabel={t('contentOps.common.empty')}
                  loadingLabel={t('common.loading')}
                  retryLabel={t('common.retry')}
                  removeLabel={(value) => t('products.tags.remove', { label: value })}
                />
              )}
            </Field>
            <div className="form-grid">
              {[EN, ZH].map((target) => (
                <div className="stack-sm" key={target}>
                  <h3 className="field-label">
                    {target === EN
                      ? t('contentOps.common.english')
                      : t('contentOps.common.chinese')}
                  </h3>
                  <Field label={t('contentOps.homeSections.titleField')}>
                    {({ inputId }) => (
                      <Input
                        inputId={inputId}
                        value={form.translations[target]?.title ?? ''}
                        onChange={(event) =>
                          setForm({
                            ...form,
                            translations: {
                              ...form.translations,
                              [target]: {
                                ...form.translations[target]!,
                                title: event.target.value,
                              },
                            },
                          })
                        }
                      />
                    )}
                  </Field>
                  <Field label={t('contentOps.homeSections.descriptionField')}>
                    {({ inputId }) => (
                      <Textarea
                        inputId={inputId}
                        value={form.translations[target]?.description ?? ''}
                        onChange={(event) =>
                          setForm({
                            ...form,
                            translations: {
                              ...form.translations,
                              [target]: {
                                ...form.translations[target]!,
                                description: event.target.value,
                              },
                            },
                          })
                        }
                      />
                    )}
                  </Field>
                  <Field label={t('contentOps.homeSections.ctaLabel')}>
                    {({ inputId }) => (
                      <Input
                        inputId={inputId}
                        value={form.translations[target]?.ctaLabel ?? ''}
                        onChange={(event) =>
                          setForm({
                            ...form,
                            translations: {
                              ...form.translations,
                              [target]: {
                                ...form.translations[target]!,
                                ctaLabel: event.target.value,
                              },
                            },
                          })
                        }
                      />
                    )}
                  </Field>
                </div>
              ))}
            </div>
            <Field label={t('contentOps.homeSections.adminNote')}>
              {({ inputId }) => (
                <Textarea
                  inputId={inputId}
                  value={form.adminNote}
                  onChange={(event) => setForm({ ...form, adminNote: event.target.value })}
                />
              )}
            </Field>
            <div className="row-tight">
              <Button onClick={() => void save()} loading={saving}>
                {t('common.save')}
              </Button>
              <Button variant="secondary" onClick={() => setFormOpen(false)}>
                {t('common.cancel')}
              </Button>
            </div>
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}
