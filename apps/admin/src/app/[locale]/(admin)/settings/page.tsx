'use client';

import { useCallback, useMemo, useState } from 'react';
import type { GlobalSettingGroupSummary, GlobalSettingSummary } from '@b2b/contracts';
import { SETTING_GROUPS, SETTING_VALUE_TYPES } from '@b2b/contracts';
import {
  Badge,
  Button,
  ConfirmDialog,
  DataTable,
  Field,
  Input,
  Select,
  Toolbar,
  useToast,
  type DataTableColumn,
} from '@b2b/ui';
import { AdminApiError } from '../../../../lib/admin-api';
import { translateError } from '../../../../lib/i18n';
import { useResource } from '../../../../lib/use-resource';
import { settingsApi, type SettingListParams } from '../../../../lib/settings-api';
import { useSession } from '../../../../components/session-provider';
import { SettingFormModal } from '../../../../components/setting-form-modal';

// Settings centre (docs/21): category navigation, filters, typed editing and
// protected deletion. Every protection visible here is re-checked server-side.
export default function SettingsPage() {
  const { t, locale, can } = useSession();
  const toast = useToast();

  const [page, setPage] = useState(1);
  const [group, setGroup] = useState('all');
  const [staged, setStaged] = useState({ keyword: '', valueType: 'all' as string, visibility: 'all', source: 'all' });
  const [applied, setApplied] = useState(staged);

  const [editing, setEditing] = useState<{ mode: 'create' | 'edit'; setting: GlobalSettingSummary | null } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<GlobalSettingSummary | null>(null);
  const [deleting, setDeleting] = useState(false);

  const params: SettingListParams = {
    locale,
    page,
    pageSize: 20,
    groupCode: group,
    keyword: applied.keyword,
    valueType: applied.valueType,
    visibility: applied.visibility,
    source: applied.source,
  };

  const list = useResource(() => settingsApi.list(params), [JSON.stringify(params)], locale);
  const groups = useResource(() => settingsApi.groups(), [JSON.stringify(params)], locale);

  const rows = list.data?.data ?? [];
  const groupList: GlobalSettingGroupSummary[] = groups.data?.data ?? [];

  const reloadList = list.reload;
  const reloadGroups = groups.reload;
  const reload = useCallback(() => {
    reloadList();
    reloadGroups();
  }, [reloadList, reloadGroups]);

  const visibilityTone = (row: GlobalSettingSummary) =>
    row.isSecret ? 'warning' : row.isPublic ? 'success' : 'neutral';

  const columns: DataTableColumn<GlobalSettingSummary>[] = [
    {
      key: 'label',
      header: t('settings.columns.name'),

      render: (row) => (
        <span className="role-name">
          {/* Built-in rows return a translation key; custom rows carry their own
              label. Either way the technical key stays visible underneath. */}
          <span>{row.label.startsWith('settings.') ? t(row.label) : row.label}</span>
          <code className="mono faint small">{row.key}</code>
        </span>
      ),
    },
    {
      key: 'value',
      header: t('settings.columns.value'),
      render: (row) =>
        row.isSecret ? (
          <Badge tone="warning">{row.configured ? t('settings.configured') : t('settings.notConfigured')}</Badge>
        ) : row.valuePreview ? (
          <span className="truncate" title={row.valuePreview}>{row.valuePreview}</span>
        ) : (
          <span className="faint">{row.usingDefault ? t('settings.usingDefault') : '—'}</span>
        ),
    },
    { key: 'type', header: t('settings.columns.type'), width: 110, render: (row) => <span className="mono small">{row.valueType}</span> },
    {
      key: 'visibility',
      header: t('settings.columns.visibility'),
      width: 130,
      render: (row) => (
        <Badge tone={visibilityTone(row)}>
          {row.isSecret ? t('settings.visibility.secret') : row.isPublic ? t('settings.visibility.public') : t('settings.visibility.private')}
        </Badge>
      ),
    },
    {
      key: 'source',
      header: t('settings.columns.source'),
      width: 110,
      render: (row) => (row.isSystem ? t('settings.source.system') : t('settings.source.custom')),
    },
    { key: 'updated', header: t('list.updated'), width: 170, render: (row) => new Date(row.updatedAt).toLocaleString(locale) },
    {
      key: 'actions',
      header: t('common.actions'),
      align: 'right',
      width: 200,
      render: (row) => {
        const deleteBlocked = row.isSystem || !row.isDeletable;
        return (
          <div className="data-table-actions">
            {can('setting.update') && row.isEditable ? (
              <Button size="sm" variant="secondary" onClick={() => setEditing({ mode: 'edit', setting: row })}>
                {t('common.edit')}
              </Button>
            ) : null}
            {can('setting.delete') ? (
              <Button
                size="sm"
                variant="danger"
                disabled={deleteBlocked}
                title={deleteBlocked ? t('settings.deleteProtected') : undefined}
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

  const activeChips = useMemo(() => {
    const chips: { key: string; label: string }[] = [];
    if (applied.keyword.trim()) chips.push({ key: 'q', label: `${t('settings.filters.keyword')}: ${applied.keyword.trim()}` });
    if (applied.valueType !== 'all') chips.push({ key: 'type', label: `${t('settings.columns.type')}: ${applied.valueType}` });
    if (applied.visibility !== 'all') {
      chips.push({ key: 'visibility', label: `${t('settings.columns.visibility')}: ${t(`settings.visibility.${applied.visibility}`)}` });
    }
    if (applied.source !== 'all') {
      chips.push({ key: 'source', label: `${t('settings.columns.source')}: ${t(`settings.source.${applied.source}`)}` });
    }
    return chips;
  }, [applied, t]);

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await settingsApi.remove(deleteTarget.key);
      toast.success(t('settings.deleted'));
      setDeleteTarget(null);
      reload();
    } catch (caught) {
      toast.error(caught instanceof AdminApiError ? translateError(locale, caught.code) : t('errors.INTERNAL_ERROR'));
    } finally {
      setDeleting(false);
    }
  };

  const pagination = list.data?.pagination ?? { page: 1, pageSize: 20, total: 0, totalPages: 1 };

  return (
    <div className="stack">
      <header className="admin-page-header">
        <div>
          <h1 className="admin-page-title">{t('settings.title')}</h1>
          <p className="small muted">{t('settings.secretNotice')}</p>
        </div>
        {can('setting.create') ? (
          <Button onClick={() => setEditing({ mode: 'create', setting: null })}>{t('settings.create')}</Button>
        ) : null}
      </header>

      <div className="settings-layout">
        <nav className="settings-groups" aria-label={t('settings.groupsLabel')}>
          <button
            type="button"
            className="settings-group"
            data-selected={group === 'all' || undefined}
            aria-current={group === 'all' ? 'true' : undefined}
            onClick={() => {
              setGroup('all');
              setPage(1);
            }}
          >
            {t('settings.filters.allGroups')}
          </button>
          {groupList.map((item) => (
            <button
              key={item.code}
              type="button"
              className="settings-group"
              data-selected={group === item.code || undefined}
              aria-current={group === item.code ? 'true' : undefined}
              onClick={() => {
                setGroup(item.code);
                setPage(1);
              }}
            >
              <span>{t(item.labelKey)}</span>
              <span className="faint small">{item.count}</span>
            </button>
          ))}
        </nav>

        <section className="settings-detail">
          <Toolbar
            summary={t('list.summary', { total: pagination.total })}
            activeFilters={activeChips.length > 0 ? activeChips.map((chip) => <li key={chip.key} className="filter-chip">{chip.label}</li>) : undefined}
            actions={
              <>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setStaged({ keyword: '', valueType: 'all', visibility: 'all', source: 'all' });
                    setApplied({ keyword: '', valueType: 'all', visibility: 'all', source: 'all' });
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
            <Field label={t('settings.filters.keyword')}>
              {({ inputId, describedBy }) => (
                <Input
                  inputId={inputId}
                  describedBy={describedBy}
                  type="search"
                  value={staged.keyword}
                  placeholder={t('settings.filters.keywordPlaceholder')}
                  onChange={(event) => setStaged((current) => ({ ...current, keyword: event.target.value }))}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') setApplied(staged);
                  }}
                />
              )}
            </Field>
            <Field label={t('settings.columns.type')}>
              {({ inputId, describedBy }) => (
                <Select
                  inputId={inputId}
                  describedBy={describedBy}
                  value={staged.valueType}
                  options={[
                    { value: 'all', label: t('settings.filters.all') },
                    ...SETTING_VALUE_TYPES.map((type) => ({ value: type, label: type })),
                  ]}
                  onChange={(event) => setStaged((current) => ({ ...current, valueType: event.target.value }))}
                />
              )}
            </Field>
            <Field label={t('settings.columns.visibility')}>
              {({ inputId, describedBy }) => (
                <Select
                  inputId={inputId}
                  describedBy={describedBy}
                  value={staged.visibility}
                  options={[
                    { value: 'all', label: t('settings.filters.all') },
                    { value: 'public', label: t('settings.visibility.public') },
                    { value: 'private', label: t('settings.visibility.private') },
                    { value: 'secret', label: t('settings.visibility.secret') },
                  ]}
                  onChange={(event) => setStaged((current) => ({ ...current, visibility: event.target.value }))}
                />
              )}
            </Field>
            <Field label={t('settings.columns.source')}>
              {({ inputId, describedBy }) => (
                <Select
                  inputId={inputId}
                  describedBy={describedBy}
                  value={staged.source}
                  options={[
                    { value: 'all', label: t('settings.filters.all') },
                    { value: 'system', label: t('settings.source.system') },
                    { value: 'custom', label: t('settings.source.custom') },
                  ]}
                  onChange={(event) => setStaged((current) => ({ ...current, source: event.target.value }))}
                />
              )}
            </Field>
          </Toolbar>

          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(row) => row.key}
            loading={list.loading}
            error={list.error ? translateError(locale, list.error) : null}
            requestId={list.requestId}
            onRetry={reload}
            labels={{
              empty: t('settings.empty'),
              emptyDescription: t('settings.emptyHint'),
              loading: t('common.loading'),
              errorTitle: t('common.error'),
              retry: t('common.retry'),
              copy: t('list.copy'),
              copied: t('list.copied'),
            }}
          />

          {pagination.totalPages > 1 ? (
            <div className="row-between">
              <span className="faint small">{t('list.range', { from: (pagination.page - 1) * pagination.pageSize + 1, to: Math.min(pagination.page * pagination.pageSize, pagination.total), total: pagination.total })}</span>
              <span className="data-table-actions">
                <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
                  {t('common.previous')}
                </Button>
                <Button size="sm" variant="secondary" disabled={page >= pagination.totalPages} onClick={() => setPage((value) => value + 1)}>
                  {t('common.next')}
                </Button>
              </span>
            </div>
          ) : null}
        </section>
      </div>

      {editing ? (
        <SettingFormModal
          mode={editing.mode}
          setting={editing.setting}
          groupOptions={SETTING_GROUPS.map((code) => ({ value: code, label: t(`settings.groups.${code}`) }))}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      ) : null}

      <ConfirmDialog
        open={deleteTarget !== null}
        title={t('settings.deleteTitle')}
        description={deleteTarget ? t('settings.deleteConfirm', { key: deleteTarget.key }) : ''}
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
