'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
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
  Toolbar,
  useToast,
  type DataTableColumn,
} from '@b2b/ui';
import { AdminApiError, adminApi } from '../lib/admin-api';
import { translateError } from '../lib/i18n';
import { useSession } from './session-provider';
import { useBreadcrumb } from './use-breadcrumb';

export interface FieldConfig {
  name: string;
  label: string;
  type: 'text' | 'number' | 'checkbox' | 'textarea' | 'select';
  /**
   * Multi-value picker (`string[]` in the form values).
   *
   * Used where a record references several stable codes rather than free text -
   * for example a product's tag codes (docs/23 §8.1). `options` may contain
   * entries that are no longer selectable: they are still rendered so an
   * existing association is never silently dropped on save.
   */
  multi?: boolean;
  options?: { value: string; label: string }[];
  required?: boolean;
  help?: string;
  unit?: string;
  /** Only shown and editable while creating a record. */
  createOnly?: boolean;
  placeholder?: string;
  /** Read-only control (used when the value set is fixed by the record). */
  disabled?: boolean;
  /**
   * Suggestions for a free-text field, rendered as a native `datalist`.
   *
   * Used for dictionary-backed values whose stored representation stays free
   * text (for example product packaging): the administrator keeps full control
   * while standard options come from the API (docs/20 §7.5).
   */
  suggestions?: string[];
}

export interface FilterConfig {
  name: string;
  label: string;
  type: 'text' | 'select' | 'date';
  options?: { value: string; label: string }[];
  placeholder?: string;
  /** Applied to the API query under this key (defaults to `name`). */
  queryKey?: string;
  narrow?: boolean;
}

export interface ResourcePageProps<T> {
  title: string;
  description?: string;
  breadcrumb?: { label: string; href?: string }[];
  listPath: string;
  itemPath?: (row: T) => string;
  /** Deletion endpoint when it differs from the update path. */
  deletePath?: (row: T) => string;
  columns: (helpers: { locale: string; reload: () => void; t: (key: string) => string }) => DataTableColumn<T>[];
  rowKey: (row: T) => string;
  fields?: FieldConfig[];
  filters?: FilterConfig[];
  toFormValues?: (row: T) => Record<string, unknown>;
  /** Transforms form values before POST/PATCH (for example to nest translations). */
  fromFormValues?: (values: Record<string, unknown>, mode: 'create' | 'edit') => Record<string, unknown>;
  createPath?: string;
  canCreate?: boolean;
  canDelete?: boolean;
  emptyAction?: ReactNode;
  extraActions?: (row: T, helpers: { reload: () => void }) => ReactNode;
  deleteWarning?: string;
  /** Extra always-on query parameters (for example a fixed status filter). */
  query?: Record<string, string | number | boolean | undefined>;
  onLoaded?: (payload: { data: T[]; total: number }) => void;
  /** Records open a detail drawer instead of (or in addition to) the edit form. */
  detail?: (row: T) => ReactNode;
}

// Shared list screen used by every back-office CRUD module.
//
// Implements the fixed template from docs/16 §4.3: breadcrumb, H1 with a short
// description, explicit filter toolbar, table with loading/empty/error states,
// pagination with a range, and Drawer-based editing that becomes a modal on
// small screens.
export function ResourcePage<T extends object>({
  title,
  description,
  breadcrumb,
  listPath,
  itemPath,
  deletePath,
  columns,
  rowKey,
  fields,
  filters,
  toFormValues,
  fromFormValues,
  createPath,
  canCreate = false,
  canDelete = false,
  emptyAction,
  extraActions,
  deleteWarning,
  query,
  onLoaded,
  detail,
}: ResourcePageProps<T>) {
  const { t, locale } = useSession();
  const derivedBreadcrumb = useBreadcrumb();
  const toast = useToast();
  const [rows, setRows] = useState<T[]>([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 20, total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<T | null>(null);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<T | null>(null);
  const [detailRow, setDetailRow] = useState<T | null>(null);
  // Filters are staged and only applied on submit, so every page behaves the
  // same way (docs/16 §4.3).
  const [filterValues, setFilterValues] = useState<Record<string, string>>({});
  const [appliedFilters, setAppliedFilters] = useState<Record<string, string>>({});

  const queryKey = JSON.stringify(query ?? {});
  const appliedKey = JSON.stringify(appliedFilters);
  const onLoadedRef = useRef(onLoaded);
  onLoadedRef.current = onLoaded;

  const load = useCallback(
    async (targetPage: number, targetPageSize: number) => {
      setLoading(true);
      try {
        const applied = JSON.parse(appliedKey) as Record<string, string>;
        const result = (await adminApi.list<T>(listPath, {
          ...(JSON.parse(queryKey) as Record<string, string | number | boolean>),
          ...applied,
          page: targetPage,
          pageSize: targetPageSize,
        })) as unknown as {
          data: T[];
          pagination?: { page: number; pageSize: number; total: number; totalPages: number };
        };
        const items = Array.isArray(result.data) ? result.data : [];
        const meta = result.pagination ?? {
          page: 1,
          pageSize: items.length,
          total: items.length,
          totalPages: 1,
        };
        setRows(items);
        setPagination(meta);
        setError(null);
        setRequestId(null);
        onLoadedRef.current?.({ data: items, total: meta.total });
      } catch (caught) {
        setError(caught instanceof AdminApiError ? caught.code : 'INTERNAL_ERROR');
        setRequestId(caught instanceof AdminApiError ? caught.requestId ?? null : null);
      } finally {
        setLoading(false);
      }
    },
    [listPath, queryKey, appliedKey],
  );

  useEffect(() => {
    void load(page, pageSize);
  }, [load, page, pageSize]);

  const reload = useCallback(() => void load(page, pageSize), [load, page, pageSize]);

  const openCreate = () => {
    setEditing(null);
    setValues(
      Object.fromEntries(
        (fields ?? []).map((field) => [
          field.name,
          field.type === 'checkbox' ? false : field.type === 'select' && field.multi ? [] : '',
        ]),
      ),
    );
    setFormError(null);
    setFormOpen(true);
  };

  const openEdit = (row: T) => {
    setEditing(row);
    setValues(toFormValues ? toFormValues(row) : { ...(row as Record<string, unknown>) });
    setFormError(null);
    setFormOpen(true);
  };

  const submit = async () => {
    setSaving(true);
    setFormError(null);
    try {
      const payload = fromFormValues ? fromFormValues(values, editing ? 'edit' : 'create') : values;
      if (editing && itemPath) {
        await adminApi.patch(itemPath(editing), payload);
      } else if (createPath) {
        await adminApi.post(createPath, payload);
      }
      toast.success(t('common.saved'));
      setFormOpen(false);
      reload();
    } catch (caught) {
      setFormError(
        caught instanceof AdminApiError ? translateError(locale, caught.code) : t('errors.INTERNAL_ERROR'),
      );
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    const targetPath = pendingDelete ? (deletePath ?? itemPath)?.(pendingDelete) : undefined;
    if (!pendingDelete || !targetPath) return;
    setSaving(true);
    try {
      await adminApi.delete(targetPath);
      toast.success(t('common.saved'));
      setPendingDelete(null);
      reload();
    } catch (caught) {
      toast.error(
        caught instanceof AdminApiError ? translateError(locale, caught.code) : t('errors.INTERNAL_ERROR'),
      );
    } finally {
      setSaving(false);
    }
  };

  const tableColumns = columns({ locale, reload, t: (key) => t(key) });
  const allColumns = useMemo<DataTableColumn<T>[]>(() => {
    const showActions = Boolean(fields || extraActions || canDelete || detail);
    if (!showActions) return tableColumns;
    return [
      ...tableColumns,
      {
        key: 'actions',
        header: t('common.actions'),
        align: 'right',
        render: (row: T) => (
          <div className="data-table-actions">
            {extraActions?.(row, { reload })}
            {detail ? (
              <Button size="sm" variant="ghost" onClick={() => setDetailRow(row)}>
                {t('list.detail')}
              </Button>
            ) : null}
            {fields && itemPath ? (
              <Button size="sm" variant="secondary" onClick={() => openEdit(row)}>
                {t('common.edit')}
              </Button>
            ) : null}
            {canDelete && (deletePath ?? itemPath) ? (
              <Button size="sm" variant="danger" onClick={() => setPendingDelete(row)}>
                {t('common.delete')}
              </Button>
            ) : null}
          </div>
        ),
      },
    ];
    // Columns depend on helper closures that change per render; the memo keys on their identity instead.
  }, [tableColumns, fields, extraActions, canDelete, itemPath, deletePath, detail, reload, t]);

  const activeFilterChips = Object.entries(appliedFilters)
    .filter(([, value]) => value.length > 0)
    .map(([key, value]) => {
      const filter = (filters ?? []).find((candidate) => candidate.name === key);
      const option = filter?.options?.find((candidate) => candidate.value === value);
      return { key, label: `${filter?.label ?? key}: ${option?.label ?? value}` };
    });

  const hasFilters = Boolean(filters && filters.length > 0);
  const rangeStart = pagination.total === 0 ? 0 : (pagination.page - 1) * pagination.pageSize + 1;
  const rangeEnd = Math.min(pagination.page * pagination.pageSize, pagination.total);

  const renderFormControl = (field: FieldConfig, inputId: string, describedBy: string | undefined) => {
    if (field.type === 'checkbox') {
      return (
        <input
          id={inputId}
          type="checkbox"
          checked={Boolean(values[field.name])}
          aria-describedby={describedBy}
          onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.checked }))}
        />
      );
    }
    if (field.type === 'select') {
      // Multi-value variant: the value is a `string[]` of stable codes. Options
      // that are no longer offered (for example a disabled tag) are still passed
      // in by the caller, so an existing association survives a save (docs/23 §8.1).
      if (field.multi) {
        return (
          <MultiSelect
            inputId={inputId}
            describedBy={describedBy}
            value={Array.isArray(values[field.name]) ? (values[field.name] as string[]) : []}
            options={field.options ?? []}
            onChange={(next) => setValues((current) => ({ ...current, [field.name]: next }))}
            placeholder={field.placeholder ?? t('common.select')}
            searchPlaceholder={t('common.search')}
            emptyLabel={t('common.empty')}
            noMatchLabel={t('common.noResults')}
            loadingLabel={t('common.loading')}
            retryLabel={t('common.retry')}
            removeLabel={(label) => `${t('common.remove')} ${label}`}
            disabled={field.disabled}
          />
        );
      }
      return (
        <Select
          inputId={inputId}
          describedBy={describedBy}
          value={String(values[field.name] ?? '')}
          options={field.options ?? []}
          onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))}
        />
      );
    }
    if (field.type === 'textarea') {
      return (
        <Textarea
          inputId={inputId}
          describedBy={describedBy}
          value={String(values[field.name] ?? '')}
          placeholder={field.placeholder}
          onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))}
        />
      );
    }
    const hasSuggestions = Boolean(field.suggestions && field.suggestions.length > 0);
    const input = (
      <Input
        inputId={inputId}
        describedBy={describedBy}
        type={field.type === 'number' ? 'number' : 'text'}
        unit={field.unit}
        list={hasSuggestions ? `${inputId}-suggestions` : undefined}
        value={String(values[field.name] ?? '')}
        placeholder={field.placeholder}
        onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))}
      />
    );
    if (!hasSuggestions) return input;
    return (
      <>
        {input}
        <datalist id={`${inputId}-suggestions`}>
          {(field.suggestions ?? []).map((suggestion) => (
            <option key={suggestion} value={suggestion} />
          ))}
        </datalist>
      </>
    );
  };

  const formBody = (
    <div className="grid-form">
      {(fields ?? [])
        .filter((field) => !(field.createOnly && editing))
        .map((field) => (
          <Field
            key={field.name}
            label={field.label}
            required={field.required}
            help={field.help}
            error={formError ?? undefined}
          >
            {({ inputId, describedBy }) => renderFormControl(field, inputId, describedBy)}
          </Field>
        ))}
    </div>
  );

  const formFooter = (
    <>
      <Button variant="secondary" onClick={() => setFormOpen(false)} disabled={saving}>
        {t('common.cancel')}
      </Button>
      <Button loading={saving} onClick={() => void submit()}>
        {t('common.save')}
      </Button>
    </>
  );

  return (
    <div className="stack">
      <PageHeader
        breadcrumb={breadcrumb ?? derivedBreadcrumb}
        title={title}
        description={description}
        actions={
          canCreate && fields && createPath ? <Button onClick={openCreate}>{t('common.create')}</Button> : null
        }
      />

      {hasFilters ? (
        <Toolbar
          summary={t('list.summary', { total: pagination.total })}
          activeFilters={
            activeFilterChips.length > 0
              ? activeFilterChips.map((chip) => (
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
                  setFilterValues({});
                  setAppliedFilters({});
                  setPage(1);
                }}
              >
                {t('list.reset')}
              </Button>
              <Button
                onClick={() => {
                  setAppliedFilters(filterValues);
                  setPage(1);
                }}
              >
                {t('list.apply')}
              </Button>
            </>
          }
        >
          {(filters ?? []).map((filter) => (
            <Field key={filter.name} label={filter.label}>
              {({ inputId, describedBy }) =>
                filter.type === 'select' ? (
                  <Select
                    inputId={inputId}
                    describedBy={describedBy}
                    value={filterValues[filter.name] ?? ''}
                    placeholder={filter.placeholder}
                    options={filter.options ?? []}
                    onChange={(event) =>
                      setFilterValues((current) => ({ ...current, [filter.name]: event.target.value }))
                    }
                  />
                ) : (
                  <Input
                    inputId={inputId}
                    describedBy={describedBy}
                    type={filter.type === 'date' ? 'date' : 'search'}
                    value={filterValues[filter.name] ?? ''}
                    placeholder={filter.placeholder}
                    onChange={(event) =>
                      setFilterValues((current) => ({ ...current, [filter.name]: event.target.value }))
                    }
                  />
                )
              }
            </Field>
          ))}
        </Toolbar>
      ) : null}

      <DataTable
        columns={allColumns}
        rows={rows}
        rowKey={rowKey}
        loading={loading}
        error={error ? translateError(locale, error) : null}
        requestId={requestId}
        onRetry={reload}
        emptyAction={emptyAction}
        emptySecondaryAction={
          hasFilters && activeFilterChips.length > 0 ? (
            <Button
              variant="secondary"
              onClick={() => {
                setFilterValues({});
                setAppliedFilters({});
                setPage(1);
              }}
            >
              {t('list.clearFilters')}
            </Button>
          ) : undefined
        }
        labels={{
          empty: activeFilterChips.length > 0 ? t('list.noResults') : t('list.empty'),
          emptyDescription: activeFilterChips.length > 0 ? t('list.noResultsHint') : undefined,
          loading: t('common.loading'),
          errorTitle: t('common.error'),
          retry: t('common.retry'),
          copy: t('list.copy'),
          copied: t('list.copied'),
        }}
        onRowClick={detail ? (row) => setDetailRow(row) : undefined}
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

      {fields ? (
        // The drawer spans the full viewport width below 768px, so one form
        // implementation serves both desktop and mobile.
        <Drawer
          open={formOpen}
          title={editing ? `${t('common.edit')} · ${title}` : `${t('common.create')} · ${title}`}
          onClose={() => setFormOpen(false)}
          closeLabel={t('common.close')}
          footer={formFooter}
        >
          {formBody}
        </Drawer>
      ) : null}

      {detail ? (
        <Drawer
          open={detailRow !== null}
          title={t('list.detail')}
          onClose={() => setDetailRow(null)}
          closeLabel={t('common.close')}
        >
          {detailRow ? detail(detailRow) : null}
        </Drawer>
      ) : null}

      <ConfirmDialog
        open={pendingDelete !== null}
        title={t('common.delete')}
        description={deleteWarning ?? t('common.confirm')}
        confirmLabel={t('common.yesDelete')}
        cancelLabel={t('common.cancel')}
        destructive
        loading={saving}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
