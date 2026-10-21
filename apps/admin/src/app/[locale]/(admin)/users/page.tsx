'use client';

import { useCallback, useMemo, useState } from 'react';
import type { AdminUserSummary } from '@b2b/contracts';
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
  Toolbar,
  useToast,
  type DataTableColumn,
} from '@b2b/ui';
import { AdminApiError } from '../../../../lib/admin-api';
import { translateError } from '../../../../lib/i18n';
import { roleDisplayName } from '../../../../lib/user-form';
import { usersApi } from '../../../../lib/users-api';
import { useResource } from '../../../../lib/use-resource';
import { useBreadcrumb } from '../../../../components/use-breadcrumb';
import { useAssignableRoles } from '../../../../components/use-assignable-roles';
import { useSession } from '../../../../components/session-provider';
import { UserFormDialog } from '../../../../components/user-form-dialog';

interface FilterState {
  q: string;
  status: '' | 'active' | 'disabled';
  roleId: string;
}

const EMPTY_FILTERS: FilterState = { q: '', status: '', roleId: '' };
const ROLE_TAG_LIMIT = 2;

/**
 * User management (docs/17).
 *
 * Lists accounts with localized role tags, exposes edit for authorized
 * operators, and keeps status/password changes as separate confirmed actions.
 * The create/edit dialog is shared and always assigns roles by id.
 */
export default function UsersPage() {
  const { t, locale, can } = useSession();
  const toast = useToast();
  const breadcrumb = useBreadcrumb();

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [staged, setStaged] = useState<FilterState>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<FilterState>(EMPTY_FILTERS);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<'create' | 'edit'>('create');
  const [editTarget, setEditTarget] = useState<AdminUserSummary | null>(null);

  const [resetTarget, setResetTarget] = useState<AdminUserSummary | null>(null);
  const [statusTarget, setStatusTarget] = useState<AdminUserSummary | null>(null);
  const [generatedPassword, setGeneratedPassword] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canAssignRoles = can('user.role.assign');

  // Role options are shared by the filter and the dialog so both resolve the
  // same ids and localized names.
  const rolesState = useAssignableRoles(locale, true);

  const load = useCallback(
    () =>
      usersApi.list({
        page,
        pageSize,
        q: applied.q || undefined,
        status: applied.status || undefined,
        roleId: applied.roleId || undefined,
      }),
    [page, pageSize, applied],
  );

  const { data, loading, error, requestId, reload } = useResource(load, [page, pageSize, applied], locale);

  const rolesById = useMemo(
    () => new Map(rolesState.roles.map((role) => [role.id, role])),
    [rolesState.roles],
  );
  const roleFilterOptions = useMemo(
    () =>
      rolesState.roles.map((role) => ({
        value: role.id,
        label: roleDisplayName(role, locale, t),
      })),
    [rolesState.roles, t, locale],
  );

  const openCreate = () => {
    setDialogMode('create');
    setEditTarget(null);
    setDialogOpen(true);
  };

  const openEdit = (user: AdminUserSummary) => {
    setDialogMode('edit');
    setEditTarget(user);
    setDialogOpen(true);
  };

  const onSaved = async (
    saved: AdminUserSummary,
    password: string | null,
    mode: 'create' | 'edit',
  ) => {
    setGeneratedPassword(password);
    setPage(1);
    reload();
    void saved;
    void mode;
  };

  const confirmResetPassword = async () => {
    if (!resetTarget) return;
    setBusy(true);
    try {
      const result = await usersApi.resetPassword(resetTarget.id);
      setGeneratedPassword(result.generatedPassword);
      toast.success(t('users.resetPasswordSuccess'));
      setResetTarget(null);
    } catch (caught) {
      toast.error(caught instanceof AdminApiError ? translateError(locale, caught.code) : t('errors.INTERNAL_ERROR'));
    } finally {
      setBusy(false);
    }
  };

  const confirmStatusChange = async () => {
    if (!statusTarget) return;
    setBusy(true);
    const nextStatus = statusTarget.status === 'active' ? 'disabled' : 'active';
    try {
      await usersApi.setStatus(statusTarget.id, nextStatus, statusTarget.updatedAt);
      toast.success(t('users.statusUpdated'));
      setStatusTarget(null);
      reload();
    } catch (caught) {
      toast.error(caught instanceof AdminApiError ? translateError(locale, caught.code) : t('errors.INTERNAL_ERROR'));
    } finally {
      setBusy(false);
    }
  };

  const columns: DataTableColumn<AdminUserSummary>[] = [
    {
      key: 'username',
      header: t('users.loginAccount'),
      width: 190,
      render: (row) => <span className="mono">{row.username}</span>,
    },
    { key: 'displayName', header: t('users.displayName'), render: (row) => row.displayName },
    {
      key: 'status',
      header: t('users.statusLabel'),
      width: 110,
      render: (row) => (
        <Badge tone={row.status === 'active' ? 'success' : 'neutral'}>
          {row.status === 'active' ? t('users.statusActive') : t('users.statusDisabled')}
        </Badge>
      ),
    },
    {
      key: 'roles',
      header: t('users.roles'),
      render: (row) => {
        // Custom roles resolve through their stored names; seeded roles through
        // the i18n dictionary (docs/18 §2.4).
        const labels = row.roles.map((role) => roleDisplayName(role, locale, t));
        const visible = labels.slice(0, ROLE_TAG_LIMIT);
        const hidden = labels.slice(ROLE_TAG_LIMIT);
        return (
          <span className="badge-stack" title={labels.join(', ')}>
            {visible.map((label) => (
              <span key={label} className="badge badge-brand">
                {label}
              </span>
            ))}
            {hidden.length > 0 ? (
              <span className="badge badge-neutral">{t('users.moreRoles', { count: hidden.length })}</span>
            ) : null}
            {labels.length === 0 ? <span className="faint small">{t('common.none')}</span> : null}
          </span>
        );
      },
    },
    {
      key: 'lastLogin',
      header: t('system.lastLogin'),
      width: 170,
      render: (row) => (row.lastLoginAt ? new Date(row.lastLoginAt).toLocaleString(locale) : '-'),
    },
    {
      key: 'actions',
      header: t('common.actions'),
      align: 'right',
      render: (row) => (
        <div className="data-table-actions">
          {can('user.update') ? (
            <Button size="sm" variant="secondary" onClick={() => openEdit(row)}>
              {t('users.edit')}
            </Button>
          ) : null}
          {can('user.update') ? (
            <Button size="sm" variant="ghost" onClick={() => setResetTarget(row)}>
              {t('system.resetPassword')}
            </Button>
          ) : null}
          {can('user.update') ? (
            <Button
              size="sm"
              variant={row.status === 'active' ? 'danger' : 'secondary'}
              onClick={() => setStatusTarget(row)}
            >
              {row.status === 'active' ? t('system.disable') : t('system.enable')}
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  const activeChips = Object.entries(applied)
    .filter(([, value]) => value.length > 0)
    .map(([key, value]) => ({
      key,
      label:
        key === 'status'
          ? `${t('users.statusLabel')}: ${value === 'active' ? t('users.statusActive') : t('users.statusDisabled')}`
          : key === 'roleId'
            ? `${t('users.roles')}: ${roleDisplayName(
                rolesById.get(value) ?? { code: value, nameKey: null },
                locale,
                t,
              )}`
            : `${t('users.keyword')}: ${value}`,
    }));

  const total = data?.pagination.total ?? 0;
  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(page * pageSize, total);

  return (
    <div className="stack">
      <PageHeader
        breadcrumb={breadcrumb}
        title={t('users.title')}
        description={t('users.description')}
        actions={
          can('user.create') && canAssignRoles ? <Button onClick={openCreate}>{t('users.create')}</Button> : null
        }
      />

      {generatedPassword ? (
        <div className="notice notice-warning row-between" role="status">
          <span>
            {t('users.generatedPassword')}: <span className="mono">{generatedPassword}</span>
          </span>
          <span className="row-tight">
            <CopyButton
              value={generatedPassword}
              label={t('list.copy')}
              copiedLabel={t('list.copied')}
            />
            <Button size="sm" variant="ghost" onClick={() => setGeneratedPassword(null)}>
              {t('common.close')}
            </Button>
          </span>
        </div>
      ) : null}

      <Toolbar
        summary={t('list.summary', { total })}
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
        <Field label={t('users.keyword')}>
          {({ inputId, describedBy }) => (
            <Input
              inputId={inputId}
              describedBy={describedBy}
              type="search"
              value={staged.q}
              placeholder={t('users.keywordPlaceholder')}
              onChange={(event) => setStaged((current) => ({ ...current, q: event.target.value }))}
            />
          )}
        </Field>
        <Field label={t('users.statusLabel')}>
          {({ inputId, describedBy }) => (
            <Select
              inputId={inputId}
              describedBy={describedBy}
              value={staged.status}
              placeholder={t('common.all')}
              options={[
                { value: 'active', label: t('users.statusActive') },
                { value: 'disabled', label: t('users.statusDisabled') },
              ]}
              onChange={(event) =>
                setStaged((current) => ({
                  ...current,
                  status: event.target.value as FilterState['status'],
                }))
              }
            />
          )}
        </Field>
        <Field
          label={t('users.roles')}
          help={rolesState.error ? t('users.rolesLoadFailed') : undefined}
          error={rolesState.error ? t('users.rolesLoadFailed') : undefined}
        >
          {({ inputId, describedBy }) => (
            <Select
              inputId={inputId}
              describedBy={describedBy}
              value={staged.roleId}
              placeholder={t('common.all')}
              options={roleFilterOptions}
              disabled={rolesState.loading || Boolean(rolesState.error)}
              onChange={(event) => setStaged((current) => ({ ...current, roleId: event.target.value }))}
            />
          )}
        </Field>
      </Toolbar>

      <DataTable
        columns={columns}
        rows={data?.data ?? []}
        rowKey={(row) => row.id}
        loading={loading}
        error={error ? translateError(locale, error) : null}
        requestId={requestId}
        onRetry={reload}
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
          empty: activeChips.length > 0 ? t('list.noResults') : t('common.empty'),
          emptyDescription: activeChips.length > 0 ? t('list.noResultsHint') : t('system.noRegistration'),
          loading: t('common.loading'),
          errorTitle: t('common.error'),
          retry: t('common.retry'),
          copy: t('list.copy'),
          copied: t('list.copied'),
        }}
      />

      <Pagination
        page={data?.pagination.page ?? page}
        pageSize={data?.pagination.pageSize ?? pageSize}
        total={total}
        totalPages={data?.pagination.totalPages ?? 1}
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

      <UserFormDialog
        open={dialogOpen}
        mode={dialogMode}
        user={editTarget}
        locale={locale}
        onClose={() => setDialogOpen(false)}
        onSaved={(saved, password, mode) => void onSaved(saved, password, mode)}
      />

      <ConfirmDialog
        open={resetTarget !== null}
        title={t('system.resetPassword')}
        description={t('users.resetPasswordConfirm', { name: resetTarget?.username ?? '' })}
        confirmLabel={t('common.confirm')}
        cancelLabel={t('common.cancel')}
        loading={busy}
        onConfirm={() => void confirmResetPassword()}
        onCancel={() => setResetTarget(null)}
      />

      <ConfirmDialog
        open={statusTarget !== null}
        title={statusTarget?.status === 'active' ? t('system.disable') : t('system.enable')}
        description={t('users.statusConfirm', { name: statusTarget?.username ?? '' })}
        confirmLabel={t('common.confirm')}
        cancelLabel={t('common.cancel')}
        destructive={statusTarget?.status === 'active'}
        loading={busy}
        onConfirm={() => void confirmStatusChange()}
        onCancel={() => setStatusTarget(null)}
      />
    </div>
  );
}
