'use client';

import { useCallback, useMemo, useState } from 'react';
import type { RoleSummary, RoleUserSummary } from '@b2b/contracts';
import {
  Badge,
  Button,
  ConfirmDialog,
  DataTable,
  Field,
  Input,
  PageHeader,
  Pagination,
  Select,
  Toolbar,
  useToast,
  type DataTableColumn,
} from '@b2b/ui';
import { AdminApiError } from '../../../../lib/admin-api';
import { translateError } from '../../../../lib/i18n';
import { rolesApi, type RoleTypeFilter } from '../../../../lib/roles-api';
import { useResource } from '../../../../lib/use-resource';
import { roleDisplayName } from '../../../../lib/user-form';
import { RoleFormDialog } from '../../../../components/role-form-dialog';
import { RolePermissionDrawer } from '../../../../components/role-permission-drawer';
import { useBreadcrumb } from '../../../../components/use-breadcrumb';
import { useSession } from '../../../../components/session-provider';

interface FilterState {
  keyword: string;
  type: RoleTypeFilter;
}

const EMPTY_FILTERS: FilterState = { keyword: '', type: 'all' };

/**
 * Roles & permissions (docs/18).
 *
 * Full lifecycle: search/filter, create, edit basic information, read and
 * configure the permission tree, and safe deletion. Every button reflects the
 * operator's own permissions, but the server re-checks each operation.
 */
export default function RolesPage() {
  const { t, locale, can } = useSession();
  const toast = useToast();
  const breadcrumb = useBreadcrumb();

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [staged, setStaged] = useState<FilterState>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<FilterState>(EMPTY_FILTERS);

  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<'create' | 'edit'>('create');
  const [formTarget, setFormTarget] = useState<RoleSummary | null>(null);

  const [permissionTarget, setPermissionTarget] = useState<RoleSummary | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<RoleSummary | null>(null);
  const [deleteUsers, setDeleteUsers] = useState<RoleUserSummary[]>([]);
  const [deleteUsersLoading, setDeleteUsersLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const canCreate = can('role.create');
  const canUpdate = can('role.update');
  const canDelete = can('role.delete');
  const canReadPermissions = can('role.permissions.read');
  const canUpdatePermissions = can('role.permissions.update');

  const load = useCallback(
    () =>
      rolesApi.list({
        page,
        pageSize,
        keyword: applied.keyword || undefined,
        type: applied.type,
      }),
    [page, pageSize, applied],
  );

  const { data, loading, error, requestId, reload } = useResource(load, [page, pageSize, applied], locale);

  const rows = data?.data ?? [];
  const pagination = data?.pagination ?? { page: 1, pageSize, total: 0, totalPages: 1 };

  const openCreate = () => {
    setFormMode('create');
    setFormTarget(null);
    setFormOpen(true);
  };

  const openEdit = (role: RoleSummary) => {
    setFormMode('edit');
    setFormTarget(role);
    setFormOpen(true);
  };

  const openDelete = async (role: RoleSummary) => {
    setDeleteTarget(role);
    setDeleteUsers([]);
    setDeleteUsersLoading(true);
    try {
      // The impact list is loaded before confirming so the dialog can explain
      // exactly which accounts block the deletion (docs/18 §2.2).
      setDeleteUsers(await rolesApi.users(role.id));
    } catch (caught) {
      toast.error(
        caught instanceof AdminApiError ? translateError(locale, caught.code) : t('errors.INTERNAL_ERROR'),
      );
    } finally {
      setDeleteUsersLoading(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await rolesApi.remove(deleteTarget.id);
      toast.success(t('roles.deleteSuccess'));
      setDeleteTarget(null);
      setDeleteUsers([]);
      reload();
    } catch (caught) {
      toast.error(
        caught instanceof AdminApiError ? translateError(locale, caught.code) : t('errors.INTERNAL_ERROR'),
      );
    } finally {
      setDeleting(false);
    }
  };

  const activeChips = useMemo(
    () =>
      Object.entries(applied)
        .filter(([, value]) => value.length > 0 && value !== 'all')
        .map(([key, value]) => ({
          key,
          label:
            key === 'type'
              ? `${t('roles.typeLabel')}: ${value === 'system' ? t('roles.typeSystem') : t('roles.typeCustom')}`
              : `${t('roles.keyword')}: ${value}`,
        })),
    [applied, t],
  );

  const columns: DataTableColumn<RoleSummary>[] = [
    {
      key: 'code',
      header: t('roles.code'),
      width: 180,
      render: (row) => <span className="mono">{row.code}</span>,
    },
    {
      key: 'name',
      header: t('roles.nameZh'),
      render: (row) => (
        <span className="role-name">
          <span>{roleDisplayName(row, locale, t)}</span>
          {row.description ? <span className="faint small">{row.description}</span> : null}
        </span>
      ),
    },
    {
      key: 'type',
      header: t('roles.typeLabel'),
      width: 120,
      render: (row) => (
        <Badge tone={row.isSystem ? 'neutral' : 'brand'}>
          {row.isSystem ? t('roles.systemBadge') : t('roles.customBadge')}
        </Badge>
      ),
    },
    { key: 'users', header: t('roles.userCount'), width: 90, render: (row) => row.userCount },
    {
      key: 'permissions',
      header: t('roles.permissionCount'),
      width: 90,
      render: (row) => row.permissionCount,
    },
    {
      key: 'updatedAt',
      header: t('list.updated'),
      width: 170,
      render: (row) => new Date(row.updatedAt).toLocaleString(locale),
    },
    {
      key: 'actions',
      header: t('common.actions'),
      align: 'right',
      render: (row) => (
        <div className="data-table-actions">
          {canReadPermissions ? (
            <Button size="sm" variant="secondary" onClick={() => setPermissionTarget(row)}>
              {canUpdatePermissions && !row.isSystem
                ? t('roles.configurePermissions')
                : t('roles.viewPermissions')}
            </Button>
          ) : null}
          {canUpdate && !row.isSystem ? (
            <Button size="sm" variant="ghost" onClick={() => openEdit(row)}>
              {t('roles.edit')}
            </Button>
          ) : null}
          {canDelete && !row.isSystem ? (
            <Button size="sm" variant="danger" onClick={() => void openDelete(row)}>
              {t('roles.deleteRole')}
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  const total = pagination.total;
  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(page * pageSize, total);
  const hasFilters = activeChips.length > 0;
  const deleteBlocked = deleteUsers.length > 0;

  return (
    <div className="stack">
      <PageHeader
        breadcrumb={breadcrumb}
        title={t('roles.title')}
        description={t('roles.description')}
        actions={canCreate ? <Button onClick={openCreate}>{t('roles.create')}</Button> : null}
      />

      <Toolbar
        summary={t('list.summary', { total })}
        activeFilters={hasFilters ? activeChips.map((chip) => <li key={chip.key} className="filter-chip">{chip.label}</li>) : undefined}
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
                setApplied({ ...staged, keyword: staged.keyword.trim() });
                setPage(1);
              }}
            >
              {t('list.apply')}
            </Button>
          </>
        }
      >
        <Field label={t('roles.keyword')}>
          {({ inputId, describedBy }) => (
            <Input
              inputId={inputId}
              describedBy={describedBy}
              type="search"
              value={staged.keyword}
              placeholder={t('roles.keywordPlaceholder')}
              onChange={(event) => setStaged((current) => ({ ...current, keyword: event.target.value }))}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  setApplied({ ...staged, keyword: staged.keyword.trim() });
                  setPage(1);
                }
              }}
            />
          )}
        </Field>
        <Field label={t('roles.typeLabel')}>
          {({ inputId, describedBy }) => (
            <Select
              inputId={inputId}
              describedBy={describedBy}
              value={staged.type}
              options={[
                { value: 'all', label: t('roles.typeAll') },
                { value: 'system', label: t('roles.typeSystem') },
                { value: 'custom', label: t('roles.typeCustom') },
              ]}
              onChange={(event) =>
                setStaged((current) => ({ ...current, type: event.target.value as RoleTypeFilter }))
              }
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
        onRetry={reload}
        labels={{
          empty: hasFilters ? t('list.noResults') : t('list.empty'),
          emptyDescription: hasFilters ? t('list.noResultsHint') : undefined,
          loading: t('common.loading'),
          errorTitle: t('common.error'),
          retry: t('common.retry'),
          copy: t('list.copy'),
          copied: t('list.copied'),
        }}
        emptyAction={canCreate ? <Button onClick={openCreate}>{t('roles.create')}</Button> : undefined}
        emptySecondaryAction={
          hasFilters ? (
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
      />

      <Pagination
        page={pagination.page}
        pageSize={pagination.pageSize}
        total={total}
        totalPages={pagination.totalPages}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        labels={{
          previous: t('common.previous'),
          next: t('common.next'),
          rowsPerPage: t('common.rowsPerPage'),
          range: t('list.range', { from: rangeStart, to: rangeEnd, total }),
        }}
      />

      <RoleFormDialog
        open={formOpen}
        mode={formMode}
        role={formTarget}
        onClose={() => setFormOpen(false)}
        onSaved={() => {
          setPage(1);
          reload();
        }}
      />

      <RolePermissionDrawer
        open={permissionTarget !== null}
        role={permissionTarget}
        canEdit={canUpdatePermissions}
        onClose={() => setPermissionTarget(null)}
        onSaved={() => reload()}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        title={t('roles.deleteRole')}
        description={
          deleteTarget
            ? [
                t('roles.deleteConfirm', {
                  name: roleDisplayName(deleteTarget, locale, t),
                  code: deleteTarget.code,
                }),
                deleteBlocked
                  ? t('roles.deleteBlocked', { count: deleteUsers.length })
                  : deleteUsersLoading
                    ? t('common.loading')
                    : t('roles.deleteImpact'),
                deleteBlocked
                  ? `${t('roles.deleteUsersTitle')}: ${deleteUsers.map((user) => user.username).join(', ')}`
                  : '',
              ]
                .filter((line) => line.length > 0)
                .join(' ')
            : ''
        }
        confirmLabel={t('common.yesDelete')}
        cancelLabel={t('common.cancel')}
        destructive
        loading={deleting}
        confirmDisabled={deleteBlocked || deleteUsersLoading}
        onConfirm={() => void confirmDelete()}
        onCancel={() => {
          setDeleteTarget(null);
          setDeleteUsers([]);
        }}
      />
    </div>
  );
}
