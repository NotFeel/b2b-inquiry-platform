'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { DictionaryItemSummary, DictionaryTypeSummary } from '@b2b/contracts';
import {
  Badge,
  Button,
  ConfirmDialog,
  DataTable,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingState,
  PageHeader,
  Select,
  useToast,
  type DataTableColumn,
} from '@b2b/ui';
import { AdminApiError } from '../../../../lib/admin-api';
import { dictionaryApi, type EnabledFilter } from '../../../../lib/dictionary-api';
import { lockReason, moveWithinItems, nextItemSortOrder } from '../../../../lib/dictionary-form';
import { invalidateDictionaryOptions } from '../../../../lib/dictionary-options';
import { translateError } from '../../../../lib/i18n';
import { useResource } from '../../../../lib/use-resource';
import { DictionaryItemDrawer } from '../../../../components/dictionary-item-drawer';
import { DictionaryTypeDrawer } from '../../../../components/dictionary-type-drawer';
import { useBreadcrumb } from '../../../../components/use-breadcrumb';
import { useSession } from '../../../../components/session-provider';

interface ItemsPayload {
  data: DictionaryItemSummary[];
  type: { id: string; code: string; nameKey: string; systemLocked: boolean } | null;
}

const ITEM_FILTERS = {
  keyword: '',
  enabled: 'all' as EnabledFilter,
};

/**
 * Two-level dictionary management (docs/20 §5).
 *
 * Master/detail on desktop (types left, items right), stacked navigation below
 * 1024px. The selected type lives in `?type=` so a refresh keeps the context;
 * lock and usage rules come from the API and are only explained here.
 */
export default function DictionaryPage() {
  const { t, locale, can } = useSession();
  const toast = useToast();
  const breadcrumb = useBreadcrumb();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [typeKeyword, setTypeKeyword] = useState('');
  const [typeEnabled, setTypeEnabled] = useState<EnabledFilter>('all');
  const [itemStaged, setItemStaged] = useState(ITEM_FILTERS);
  const [itemApplied, setItemApplied] = useState(ITEM_FILTERS);
  const [itemsNonce, setItemsNonce] = useState(0);
  const [busyItemId, setBusyItemId] = useState<string | null>(null);

  const [typeDrawer, setTypeDrawer] = useState<{
    open: boolean;
    mode: 'create' | 'edit';
    target: DictionaryTypeSummary | null;
  }>({ open: false, mode: 'create', target: null });
  const [itemDrawer, setItemDrawer] = useState<{
    open: boolean;
    mode: 'create' | 'edit';
    target: DictionaryItemSummary | null;
  }>({ open: false, mode: 'create', target: null });
  const [deleteTypeTarget, setDeleteTypeTarget] = useState<DictionaryTypeSummary | null>(null);
  const [deleteItemTarget, setDeleteItemTarget] = useState<DictionaryItemSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const autoSelected = useRef(false);

  const selectedCode = searchParams.get('type');

  const typesResource = useResource(() => dictionaryApi.listTypes({ pageSize: 100 }), [], locale);
  const types = useMemo(() => typesResource.data?.data ?? [], [typesResource.data]);
  const selectedType = useMemo(
    () => types.find((type) => type.code === selectedCode) ?? null,
    [types, selectedCode],
  );

  const loadItems = useCallback(async (): Promise<ItemsPayload> => {
    if (!selectedCode) return { data: [], type: null };
    return dictionaryApi.listItems(selectedCode, {
      locale,
      enabled: itemApplied.enabled,
      keyword: itemApplied.keyword.trim() || undefined,
    });
  }, [selectedCode, locale, itemApplied]);

  const itemsResource = useResource(loadItems, [loadItems, itemsNonce], locale);
  const items = itemsResource.data?.data ?? [];
  const typeBehaviourLocked = itemsResource.data?.type?.systemLocked ?? selectedType?.systemLocked ?? false;

  const selectType = useCallback(
    (code: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (code) params.set('type', code);
      else params.delete('type');
      const query = params.toString();
      router.replace(query.length > 0 ? `${pathname}?${query}` : pathname, { scroll: false });
      setItemStaged(ITEM_FILTERS);
      setItemApplied(ITEM_FILTERS);
    },
    [pathname, router, searchParams],
  );

  // Keep the URL pointing at a type that actually exists, and pick a default
  // type only on the first load: an automatic re-selection would immediately
  // undo the "back to types" action in the stacked (mobile) layout.
  useEffect(() => {
    if (types.length === 0) return;
    if (selectedCode && !types.some((type) => type.code === selectedCode)) {
      selectType(null);
      return;
    }
    if (autoSelected.current) return;
    autoSelected.current = true;
    if (!selectedCode) selectType(types[0]!.code);
  }, [types, selectedCode, selectType]);

  const visibleTypes = useMemo(() => {
    const needle = typeKeyword.trim().toLowerCase();
    return types.filter((type) => {
      if (typeEnabled === 'true' && !type.enabled) return false;
      if (typeEnabled === 'false' && type.enabled) return false;
      if (!needle) return true;
      return (
        type.code.toLowerCase().includes(needle) ||
        type.nameKey.toLowerCase().includes(needle) ||
        (type.description ?? '').toLowerCase().includes(needle) ||
        t(type.nameKey).toLowerCase().includes(needle)
      );
    });
  }, [types, typeKeyword, typeEnabled, t]);

  const reloadItems = useCallback(() => setItemsNonce((value) => value + 1), []);

  const afterMutation = () => {
    invalidateDictionaryOptions();
    typesResource.reload();
    reloadItems();
  };

  const toggleItem = async (item: DictionaryItemSummary) => {
    setBusyItemId(item.id);
    try {
      await dictionaryApi.updateItem(item.id, {
        enabled: !item.enabled,
        expectedUpdatedAt: item.updatedAt,
      });
      invalidateDictionaryOptions(item.typeCode);
      toast.success(item.enabled ? t('dictionary.itemDisabled') : t('dictionary.itemEnabled'));
      reloadItems();
    } catch (caught) {
      toast.error(
        caught instanceof AdminApiError ? translateError(locale, caught.code) : t('errors.INTERNAL_ERROR'),
      );
    } finally {
      setBusyItemId(null);
    }
  };

  const moveItem = async (item: DictionaryItemSummary, direction: 'up' | 'down') => {
    const orderedIds = moveWithinItems(items, item.id, direction);
    if (!orderedIds || !selectedCode) return;
    setBusyItemId(item.id);
    try {
      await dictionaryApi.reorderItems(selectedCode, orderedIds);
      invalidateDictionaryOptions(selectedCode);
      reloadItems();
    } catch (caught) {
      toast.error(
        caught instanceof AdminApiError ? translateError(locale, caught.code) : t('errors.INTERNAL_ERROR'),
      );
      reloadItems();
    } finally {
      setBusyItemId(null);
    }
  };

  const confirmDeleteItem = async () => {
    if (!deleteItemTarget) return;
    setDeleting(true);
    try {
      await dictionaryApi.removeItem(deleteItemTarget.id);
      invalidateDictionaryOptions(deleteItemTarget.typeCode);
      toast.success(t('dictionary.itemDeleted'));
      setDeleteItemTarget(null);
      afterMutation();
    } catch (caught) {
      toast.error(
        caught instanceof AdminApiError ? translateError(locale, caught.code) : t('errors.INTERNAL_ERROR'),
      );
    } finally {
      setDeleting(false);
    }
  };

  const confirmDeleteType = async () => {
    if (!deleteTypeTarget) return;
    setDeleting(true);
    try {
      const code = deleteTypeTarget.code;
      await dictionaryApi.removeType(deleteTypeTarget.id);
      invalidateDictionaryOptions(code);
      toast.success(t('dictionary.typeDeleted'));
      setDeleteTypeTarget(null);
      if (selectedCode === code) selectType(null);
      afterMutation();
    } catch (caught) {
      toast.error(
        caught instanceof AdminApiError ? translateError(locale, caught.code) : t('errors.INTERNAL_ERROR'),
      );
    } finally {
      setDeleting(false);
    }
  };

  const canUpdate = can('dictionary.update');

  const itemColumns: DataTableColumn<DictionaryItemSummary>[] = [
    {
      key: 'code',
      header: t('dictionary.columns.code'),
      width: 150,
      render: (row) => <span className="mono">{row.code}</span>,
    },
    {
      key: 'zh',
      header: t('dictionary.columns.labelZh'),
      render: (row) => row.labels['zh-CN'] ?? <span className="faint">{t('dictionary.missingLabel')}</span>,
    },
    {
      key: 'en',
      header: t('dictionary.columns.labelEn'),
      render: (row) => row.labels['en-US'] ?? <span className="faint">{t('dictionary.missingLabel')}</span>,
    },
    {
      key: 'value',
      header: t('dictionary.columns.value'),
      render: (row) =>
        row.value ? (
          <span className="truncate" title={row.value}>
            {row.value}
          </span>
        ) : (
          <span className="faint">—</span>
        ),
    },
    {
      key: 'sort',
      header: t('dictionary.columns.sortOrder'),
      width: 120,
      render: (row) => (
        <span className="menu-sort">
          <span className="mono">{row.sortOrder}</span>
          <Button
            size="sm"
            variant="ghost"
            aria-label={t('dictionary.moveUp', { name: row.code })}
            disabled={!canUpdate || busyItemId === row.id || moveWithinItems(items, row.id, 'up') === null}
            onClick={() => void moveItem(row, 'up')}
          >
            ↑
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label={t('dictionary.moveDown', { name: row.code })}
            disabled={!canUpdate || busyItemId === row.id || moveWithinItems(items, row.id, 'down') === null}
            onClick={() => void moveItem(row, 'down')}
          >
            ↓
          </Button>
        </span>
      ),
    },
    {
      key: 'state',
      header: t('dictionary.columns.state'),
      width: 170,
      render: (row) => (
        <span className="badge-stack">
          <Badge tone={row.enabled ? 'success' : 'neutral'}>
            {row.enabled ? t('dictionary.itemEnabledState') : t('dictionary.itemDisabledState')}
          </Badge>
          {row.systemLocked ? <Badge tone="info">{t('dictionary.locked.badge')}</Badge> : null}
        </span>
      ),
    },
    {
      key: 'usage',
      header: t('dictionary.columns.usage'),
      width: 110,
      render: (row) =>
        (row.usageCount ?? 0) > 0 ? (
          <Badge tone="warning">{t('dictionary.usageCount', { count: row.usageCount ?? 0 })}</Badge>
        ) : (
          <span className="faint">{t('dictionary.usageNone')}</span>
        ),
    },
    {
      key: 'actions',
      header: t('common.actions'),
      align: 'right',
      width: 250,
      render: (row) => {
        const deleteBlock = lockReason(
          { systemLocked: row.systemLocked, usageCount: row.usageCount, behaviourLockedType: typeBehaviourLocked },
          'delete-item',
          t,
        );
        const disableBlock = lockReason({ systemLocked: row.systemLocked }, 'disable-item', t);
        return (
          <div className="data-table-actions">
            {canUpdate ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setItemDrawer({ open: true, mode: 'edit', target: row })}
              >
                {t('common.edit')}
              </Button>
            ) : null}
            {canUpdate ? (
              <Button
                size="sm"
                variant="secondary"
                disabled={(row.enabled && disableBlock !== null) || busyItemId === row.id}
                title={(row.enabled ? disableBlock : null) ?? undefined}
                onClick={() => void toggleItem(row)}
              >
                {row.enabled ? t('dictionary.disable') : t('dictionary.enable')}
              </Button>
            ) : null}
            {canUpdate ? (
              <Button
                size="sm"
                variant="danger"
                disabled={deleteBlock !== null}
                title={deleteBlock ?? undefined}
                onClick={() => setDeleteItemTarget(row)}
              >
                {t('common.delete')}
              </Button>
            ) : null}
          </div>
        );
      },
    },
  ];

  const typeFacts = (type: DictionaryTypeSummary) => ({
    systemLocked: type.systemLocked,
    itemCount: type.itemCount,
    behaviourLockedType: type.systemLocked,
  });

  const typeListBody = () => {
    if (typesResource.loading && types.length === 0) {
      return <LoadingState label={t('common.loading')} rows={4} />;
    }
    if (typesResource.error) {
      return (
        <ErrorState
          title={t('dictionary.typesLoadFailed')}
          description={translateError(locale, typesResource.error)}
          retryLabel={t('common.retry')}
          onRetry={typesResource.reload}
        />
      );
    }
    if (visibleTypes.length === 0) {
      return (
        <EmptyState
          title={types.length === 0 ? t('dictionary.emptyTypes') : t('list.noResults')}
          description={types.length === 0 ? t('dictionary.emptyTypesHint') : t('list.noResultsHint')}
          variant="search"
        />
      );
    }
    return (
      <ul className="dictionary-type-list">
        {visibleTypes.map((type) => (
          <li key={type.id}>
            <button
              type="button"
              className="dictionary-type-item"
              data-selected={type.code === selectedCode || undefined}
              aria-current={type.code === selectedCode ? 'true' : undefined}
              onClick={() => selectType(type.code)}
            >
              <span className="dictionary-type-name">
                {t(type.nameKey)}
                {type.systemLocked ? <Badge tone="info">{t('dictionary.locked.badge')}</Badge> : null}
                {!type.enabled ? <Badge tone="neutral">{t('dictionary.typeDisabled')}</Badge> : null}
              </span>
              <code className="mono dictionary-type-code">{type.code}</code>
              <span className="faint small">
                {t('dictionary.itemCount', { count: type.itemCount, enabled: type.enabledItemCount })}
              </span>
            </button>
          </li>
        ))}
      </ul>
    );
  };

  return (
    <div className="stack">
      <PageHeader
        breadcrumb={breadcrumb}
        title={t('dictionary.title')}
        description={t('dictionary.description')}
        actions={
          canUpdate ? (
            <Button onClick={() => setTypeDrawer({ open: true, mode: 'create', target: null })}>
              {t('dictionary.newType')}
            </Button>
          ) : null
        }
      />

      <div className="dictionary-layout" data-selected={selectedCode ? 'true' : 'false'}>
        <section className="dictionary-master" aria-label={t('dictionary.typeList')}>
          <div className="dictionary-master-toolbar">
            <Field label={t('dictionary.typeSearch')}>
              {({ inputId }) => (
                <Input
                  inputId={inputId}
                  type="search"
                  value={typeKeyword}
                  placeholder={t('dictionary.typeSearchPlaceholder')}
                  onChange={(event) => setTypeKeyword(event.target.value)}
                />
              )}
            </Field>
            <Field label={t('dictionary.filters.enabled')}>
              {({ inputId }) => (
                <Select
                  inputId={inputId}
                  value={typeEnabled}
                  options={[
                    { value: 'all', label: t('dictionary.filters.all') },
                    { value: 'true', label: t('dictionary.typeEnabledOption') },
                    { value: 'false', label: t('dictionary.typeDisabled') },
                  ]}
                  onChange={(event) => setTypeEnabled(event.target.value as EnabledFilter)}
                />
              )}
            </Field>
          </div>
          {typeListBody()}
        </section>

        <section className="dictionary-detail" aria-label={t('dictionary.itemList')}>
          {selectedType ? (
            <>
              <div className="dictionary-detail-header">
                <div className="dictionary-detail-title">
                  <Button size="sm" variant="ghost" className="dictionary-back" onClick={() => selectType(null)}>
                    ← {t('dictionary.backToTypes')}
                  </Button>
                  <h2>{t(selectedType.nameKey)}</h2>
                  <code className="mono">{selectedType.code}</code>
                  {selectedType.systemLocked ? <Badge tone="info">{t('dictionary.locked.badge')}</Badge> : null}
                </div>
                {selectedType.description ? <p className="faint">{selectedType.description}</p> : null}
                {selectedType.systemLocked ? (
                  <div className="notice">{t('dictionary.locked.typeNotice')}</div>
                ) : null}
                <div className="dictionary-detail-actions">
                  {canUpdate ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setTypeDrawer({ open: true, mode: 'edit', target: selectedType })}
                    >
                      {t('dictionary.editType')}
                    </Button>
                  ) : null}
                  {canUpdate ? (
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={lockReason(typeFacts(selectedType), 'delete-type', t) !== null}
                      title={lockReason(typeFacts(selectedType), 'delete-type', t) ?? undefined}
                      onClick={() => setDeleteTypeTarget(selectedType)}
                    >
                      {t('dictionary.deleteType')}
                    </Button>
                  ) : null}
                  {canUpdate ? (
                    <Button
                      size="sm"
                      disabled={lockReason(typeFacts(selectedType), 'add-item', t) !== null}
                      title={lockReason(typeFacts(selectedType), 'add-item', t) ?? undefined}
                      onClick={() => setItemDrawer({ open: true, mode: 'create', target: null })}
                    >
                      {t('dictionary.newItem')}
                    </Button>
                  ) : null}
                </div>
              </div>

              <div className="dictionary-item-toolbar">
                <Field label={t('dictionary.itemSearch')}>
                  {({ inputId }) => (
                    <Input
                      inputId={inputId}
                      type="search"
                      value={itemStaged.keyword}
                      placeholder={t('dictionary.itemSearchPlaceholder')}
                      onChange={(event) =>
                        setItemStaged((current) => ({ ...current, keyword: event.target.value }))
                      }
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') setItemApplied(itemStaged);
                      }}
                    />
                  )}
                </Field>
                <Field label={t('dictionary.filters.enabled')}>
                  {({ inputId }) => (
                    <Select
                      inputId={inputId}
                      value={itemStaged.enabled}
                      options={[
                        { value: 'all', label: t('dictionary.filters.all') },
                        { value: 'true', label: t('dictionary.itemEnabledState') },
                        { value: 'false', label: t('dictionary.itemDisabledState') },
                      ]}
                      onChange={(event) =>
                        setItemStaged((current) => ({
                          ...current,
                          enabled: event.target.value as EnabledFilter,
                        }))
                      }
                    />
                  )}
                </Field>
                <div className="dictionary-item-toolbar-actions">
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setItemStaged(ITEM_FILTERS);
                      setItemApplied(ITEM_FILTERS);
                    }}
                  >
                    {t('list.reset')}
                  </Button>
                  <Button onClick={() => setItemApplied(itemStaged)}>{t('list.apply')}</Button>
                </div>
              </div>

              <DataTable
                columns={itemColumns}
                rows={items}
                rowKey={(row) => row.id}
                loading={itemsResource.loading}
                error={itemsResource.error ? translateError(locale, itemsResource.error) : null}
                requestId={itemsResource.requestId}
                onRetry={reloadItems}
                labels={{
                  empty: t('dictionary.emptyItems'),
                  emptyDescription: t('dictionary.emptyItemsHint'),
                  loading: t('common.loading'),
                  errorTitle: t('common.error'),
                  retry: t('common.retry'),
                  copy: t('list.copy'),
                  copied: t('list.copied'),
                }}
              />
            </>
          ) : (
            <EmptyState
              title={t('dictionary.selectType')}
              description={t('dictionary.selectTypeHint')}
              variant="search"
            />
          )}
        </section>
      </div>

      <DictionaryTypeDrawer
        open={typeDrawer.open}
        mode={typeDrawer.mode}
        type={typeDrawer.target}
        onClose={() => setTypeDrawer((current) => ({ ...current, open: false }))}
        onSaved={() => afterMutation()}
      />

      <DictionaryItemDrawer
        open={itemDrawer.open}
        mode={itemDrawer.mode}
        typeCode={selectedType?.code ?? ''}
        typeLabel={selectedType ? t(selectedType.nameKey) : ''}
        item={itemDrawer.target}
        suggestedSortOrder={itemDrawer.target ? itemDrawer.target.sortOrder : nextItemSortOrder(items)}
        onClose={() => setItemDrawer((current) => ({ ...current, open: false }))}
        onSaved={() => afterMutation()}
      />

      <ConfirmDialog
        open={deleteItemTarget !== null}
        title={t('dictionary.deleteItem')}
        description={
          deleteItemTarget
            ? t('dictionary.deleteItemConfirm', {
                code: deleteItemTarget.code,
                type: selectedType ? t(selectedType.nameKey) : deleteItemTarget.typeCode,
              })
            : ''
        }
        confirmLabel={t('common.yesDelete')}
        cancelLabel={t('common.cancel')}
        destructive
        loading={deleting}
        onConfirm={() => void confirmDeleteItem()}
        onCancel={() => setDeleteItemTarget(null)}
      />

      <ConfirmDialog
        open={deleteTypeTarget !== null}
        title={t('dictionary.deleteType')}
        description={
          deleteTypeTarget ? t('dictionary.deleteTypeConfirm', { code: deleteTypeTarget.code }) : ''
        }
        confirmLabel={t('common.yesDelete')}
        cancelLabel={t('common.cancel')}
        destructive
        loading={deleting}
        onConfirm={() => void confirmDeleteType()}
        onCancel={() => setDeleteTypeTarget(null)}
      />
    </div>
  );
}
