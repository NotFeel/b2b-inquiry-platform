'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { PROTECTED_MENU_CODES, type MenuNode } from '@b2b/contracts';
import {
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  DataTable,
  Field,
  IconChevronDown,
  IconChevronRight,
  Input,
  MenuIcon,
  PageHeader,
  Select,
  Toolbar,
  useToast,
  type DataTableColumn,
} from '@b2b/ui';
import { AdminApiError } from '../../../../lib/admin-api';
import { translateError } from '../../../../lib/i18n';
import {
  allNodeIds,
  countNodes,
  flattenTree,
  moveWithinSiblings,
  type FlatMenuRow,
} from '../../../../lib/menu-tree-state';
import { menusApi, type MenuStatusFilter, type MenuTypeFilter, type MenuVisibilityFilter } from '../../../../lib/menus-api';
import { useResource } from '../../../../lib/use-resource';
import { MenuFormDrawer } from '../../../../components/menu-form-drawer';
import { useBreadcrumb } from '../../../../components/use-breadcrumb';
import { useSession } from '../../../../components/session-provider';

interface FilterState {
  q: string;
  type: MenuTypeFilter;
  status: MenuStatusFilter;
  visibility: MenuVisibilityFilter;
  rootOnly: boolean;
}

const EMPTY_FILTERS: FilterState = {
  q: '',
  type: 'all',
  status: 'all',
  visibility: 'all',
  rootOnly: false,
};

/** Filters live in the URL so a refresh (or a shared link) keeps them (docs/19 §2.2). */
function readFilters(params: URLSearchParams): FilterState {
  const read = <T extends string>(key: string, allowed: readonly T[], fallback: T): T => {
    const value = params.get(key);
    return value && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
  };
  return {
    q: params.get('q') ?? '',
    type: read('type', ['all', 'group', 'page', 'external'] as const, 'all'),
    status: read('status', ['all', 'enabled', 'disabled'] as const, 'all'),
    visibility: read('visibility', ['all', 'visible', 'hidden'] as const, 'all'),
    rootOnly: params.get('rootOnly') === 'true',
  };
}

function toQueryString(filters: FilterState): string {
  const params = new URLSearchParams();
  if (filters.q.trim()) params.set('q', filters.q.trim());
  if (filters.type !== 'all') params.set('type', filters.type);
  if (filters.status !== 'all') params.set('status', filters.status);
  if (filters.visibility !== 'all') params.set('visibility', filters.visibility);
  if (filters.rootOnly) params.set('rootOnly', 'true');
  return params.toString();
}

/**
 * Menu management (docs/19).
 *
 * The tree comes from the API (never hardcoded), create/edit share one drawer,
 * and every structural rule - cycles, route conflicts, icon and permission
 * validation, protected deletion - is enforced server-side as well.
 */
export default function MenusPage() {
  const { t, locale, can } = useSession();
  const toast = useToast();
  const breadcrumb = useBreadcrumb();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [staged, setStaged] = useState<FilterState>(() => readFilters(searchParams));
  const [applied, setApplied] = useState<FilterState>(() => readFilters(searchParams));
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const seededExpansion = useRef(false);

  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<'create' | 'edit'>('create');
  const [formNode, setFormNode] = useState<MenuNode | null>(null);
  const [formParentId, setFormParentId] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<MenuNode | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const canCreate = can('menu.create');
  const canUpdate = can('menu.update');
  const canDelete = can('menu.delete');

  const load = useCallback(
    () =>
      menusApi.tree({
        locale,
        q: applied.q.trim() || undefined,
        type: applied.type,
        status: applied.status,
        visibility: applied.visibility,
        rootOnly: applied.rootOnly,
      }),
    [locale, applied],
  );

  const { data, loading, error, requestId, reload } = useResource(load, [applied, locale], locale);
  const tree = useMemo(() => data ?? [], [data]);

  // Expand every parent on the first load of a filter set; later reloads keep
  // whatever the administrator expanded or collapsed.
  useEffect(() => {
    if (seededExpansion.current || tree.length === 0) return;
    seededExpansion.current = true;
    setExpanded(new Set(allNodeIds(tree)));
  }, [tree]);

  const rows = useMemo(() => flattenTree(tree, expanded), [tree, expanded]);

  const applyFilters = (next: FilterState) => {
    setStaged(next);
    setApplied(next);
    seededExpansion.current = false;
    const query = toQueryString(next);
    router.replace(query.length > 0 ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  const toggleExpand = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const openCreate = (parentId: string | null) => {
    setFormMode('create');
    setFormNode(null);
    setFormParentId(parentId);
    setFormOpen(true);
  };

  const openEdit = (node: MenuNode) => {
    setFormMode('edit');
    setFormNode(node);
    setFormParentId(node.parentId);
    setFormOpen(true);
  };

  const move = async (node: MenuNode, direction: 'up' | 'down') => {
    const orderedIds = moveWithinSiblings(tree, node.parentId, node.id, direction);
    if (!orderedIds) return;
    setBusyId(node.id);
    try {
      await menusApi.reorder({ parentId: node.parentId, orderedIds });
      toast.success(t('menus.reorderSuccess'));
      reload();
    } catch (caught) {
      // The server kept the previous order; reload to restore the real one.
      toast.error(
        caught instanceof AdminApiError ? translateError(locale, caught.code) : t('errors.INTERNAL_ERROR'),
      );
      reload();
    } finally {
      setBusyId(null);
    }
  };

  const canMove = (node: MenuNode, direction: 'up' | 'down') =>
    canUpdate && moveWithinSiblings(tree, node.parentId, node.id, direction) !== null;

  const deletionBlock = (node: MenuNode): string | null => {
    if (node.children.length > 0) return t('menus.deleteHasChildren', { count: node.children.length });
    if (PROTECTED_MENU_CODES.includes(node.code)) return t('menus.deleteProtected');
    return null;
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await menusApi.remove(deleteTarget.id);
      toast.success(t('menus.deleteSuccess'));
      setDeleteTarget(null);
      reload();
    } catch (caught) {
      toast.error(
        caught instanceof AdminApiError ? translateError(locale, caught.code) : t('errors.INTERNAL_ERROR'),
      );
    } finally {
      setDeleting(false);
    }
  };

  const activeChips = useMemo(() => {
    const chips: { key: string; label: string }[] = [];
    if (applied.q.trim()) chips.push({ key: 'q', label: `${t('menus.filters.q')}: ${applied.q.trim()}` });
    if (applied.type !== 'all') {
      chips.push({ key: 'type', label: `${t('menus.filters.type')}: ${t(`menus.types.${applied.type}`)}` });
    }
    if (applied.status !== 'all') {
      chips.push({
        key: 'status',
        label: `${t('menus.filters.status')}: ${t(`menus.statusOptions.${applied.status}`)}`,
      });
    }
    if (applied.visibility !== 'all') {
      chips.push({
        key: 'visibility',
        label: `${t('menus.filters.visibility')}: ${t(`menus.visibilityOptions.${applied.visibility}`)}`,
      });
    }
    if (applied.rootOnly) chips.push({ key: 'rootOnly', label: t('menus.filters.rootOnlyChip') });
    return chips;
  }, [applied, t]);

  const columns: DataTableColumn<FlatMenuRow>[] = [
    {
      key: 'label',
      header: t('menus.columns.label'),
      width: 320,
      render: (row) => (
        <span className="menu-cell" style={{ paddingLeft: `${row.depth * 20}px` }}>
          {row.hasChildren ? (
            <button
              type="button"
              className="menu-cell-toggle"
              aria-label={expanded.has(row.node.id) ? t('menus.collapse') : t('menus.expand')}
              aria-expanded={expanded.has(row.node.id)}
              onClick={() => toggleExpand(row.node.id)}
            >
              {expanded.has(row.node.id) ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
            </button>
          ) : (
            <span className="menu-cell-toggle" aria-hidden="true" />
          )}
          <MenuIcon name={row.node.icon} />
          <span className="menu-cell-text">
            <span className={row.hasChildren ? 'menu-cell-parent' : undefined}>{row.node.label}</span>
            <code className="mono menu-cell-code">{row.node.code}</code>
          </span>
        </span>
      ),
    },
    {
      key: 'type',
      header: t('menus.columns.type'),
      width: 100,
      render: (row) => (
        <Badge tone={row.node.external ? 'info' : row.node.route === null ? 'neutral' : 'brand'}>
          {row.node.external ? t('menus.types.external') : row.node.route === null ? t('menus.types.group') : t('menus.types.page')}
        </Badge>
      ),
    },
    {
      key: 'route',
      header: t('menus.columns.route'),
      width: 200,
      render: (row) =>
        row.node.route ? (
          <span className="truncate mono" title={row.node.route}>
            {row.node.route}
          </span>
        ) : (
          <span className="faint">{t('menus.columns.routeEmpty')}</span>
        ),
    },
    {
      key: 'permission',
      header: t('menus.columns.permission'),
      width: 170,
      render: (row) =>
        row.node.permissionCode ? (
          <span className="mono">{row.node.permissionCode}</span>
        ) : (
          <span className="faint">{t('menus.columns.permissionEmpty')}</span>
        ),
    },
    {
      key: 'children',
      header: t('menus.columns.children'),
      width: 80,
      render: (row) => row.node.children.length,
    },
    {
      key: 'sort',
      header: t('menus.columns.sortOrder'),
      width: 130,
      render: (row) => (
        <span className="menu-sort">
          <span className="mono">{row.node.sortOrder}</span>
          <Button
            size="sm"
            variant="ghost"
            aria-label={t('menus.moveUp', { name: row.node.label })}
            disabled={!canMove(row.node, 'up') || busyId === row.node.id}
            onClick={() => void move(row.node, 'up')}
          >
            ↑
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label={t('menus.moveDown', { name: row.node.label })}
            disabled={!canMove(row.node, 'down') || busyId === row.node.id}
            onClick={() => void move(row.node, 'down')}
          >
            ↓
          </Button>
        </span>
      ),
    },
    {
      key: 'state',
      header: t('menus.columns.state'),
      width: 150,
      render: (row) => (
        <span className="badge-stack">
          <Badge tone={row.node.enabled ? 'success' : 'neutral'}>
            {row.node.enabled ? t('menus.statusOptions.enabled') : t('menus.statusOptions.disabled')}
          </Badge>
          <Badge tone={row.node.visible ? 'info' : 'warning'}>
            {row.node.visible ? t('menus.visibilityOptions.visible') : t('menus.visibilityOptions.hidden')}
          </Badge>
        </span>
      ),
    },
    {
      key: 'actions',
      header: t('common.actions'),
      align: 'right',
      width: 240,
      render: (row) => {
        const blocked = deletionBlock(row.node);
        return (
          <div className="data-table-actions">
            {canCreate && row.node.route === null && !row.node.external ? (
              <Button size="sm" variant="secondary" onClick={() => openCreate(row.node.id)}>
                {t('menus.addChild')}
              </Button>
            ) : null}
            {canUpdate ? (
              <Button size="sm" variant="ghost" onClick={() => openEdit(row.node)}>
                {t('common.edit')}
              </Button>
            ) : null}
            {canDelete ? (
              <Button
                size="sm"
                variant="danger"
                disabled={blocked !== null}
                title={blocked ?? undefined}
                onClick={() => setDeleteTarget(row.node)}
              >
                {t('common.delete')}
              </Button>
            ) : null}
          </div>
        );
      },
    },
  ];

  const hasFilters = activeChips.length > 0;

  return (
    <div className="stack">
      <PageHeader
        breadcrumb={breadcrumb}
        title={t('menus.title')}
        description={t('menus.description')}
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() => setExpanded(new Set())}
              disabled={expanded.size === 0}
            >
              {t('menus.collapseAll')}
            </Button>
            <Button
              variant="secondary"
              onClick={() => setExpanded(new Set(allNodeIds(tree)))}
              disabled={tree.length === 0}
            >
              {t('menus.expandAll')}
            </Button>
            <Button variant="secondary" onClick={reload} loading={loading}>
              {t('menus.refresh')}
            </Button>
            {canCreate ? <Button onClick={() => openCreate(null)}>{t('menus.create')}</Button> : null}
          </>
        }
      />

      <Toolbar
        summary={t('menus.summary', { count: countNodes(tree) })}
        activeFilters={
          hasFilters
            ? activeChips.map((chip) => (
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
        <Field label={t('menus.filters.q')}>
          {({ inputId, describedBy }) => (
            <Input
              inputId={inputId}
              describedBy={describedBy}
              type="search"
              value={staged.q}
              placeholder={t('menus.filters.qPlaceholder')}
              onChange={(event) => setStaged((current) => ({ ...current, q: event.target.value }))}
              onKeyDown={(event) => {
                if (event.key === 'Enter') applyFilters(staged);
              }}
            />
          )}
        </Field>
        <Field label={t('menus.filters.type')}>
          {({ inputId, describedBy }) => (
            <Select
              inputId={inputId}
              describedBy={describedBy}
              value={staged.type}
              options={[
                { value: 'all', label: t('menus.filterAll') },
                { value: 'group', label: t('menus.types.group') },
                { value: 'page', label: t('menus.types.page') },
                { value: 'external', label: t('menus.types.external') },
              ]}
              onChange={(event) =>
                setStaged((current) => ({ ...current, type: event.target.value as MenuTypeFilter }))
              }
            />
          )}
        </Field>
        <Field label={t('menus.filters.status')}>
          {({ inputId, describedBy }) => (
            <Select
              inputId={inputId}
              describedBy={describedBy}
              value={staged.status}
              options={[
                { value: 'all', label: t('menus.filterAll') },
                { value: 'enabled', label: t('menus.statusOptions.enabled') },
                { value: 'disabled', label: t('menus.statusOptions.disabled') },
              ]}
              onChange={(event) =>
                setStaged((current) => ({ ...current, status: event.target.value as MenuStatusFilter }))
              }
            />
          )}
        </Field>
        <Field label={t('menus.filters.visibility')}>
          {({ inputId, describedBy }) => (
            <Select
              inputId={inputId}
              describedBy={describedBy}
              value={staged.visibility}
              options={[
                { value: 'all', label: t('menus.filterAll') },
                { value: 'visible', label: t('menus.visibilityOptions.visible') },
                { value: 'hidden', label: t('menus.visibilityOptions.hidden') },
              ]}
              onChange={(event) =>
                setStaged((current) => ({
                  ...current,
                  visibility: event.target.value as MenuVisibilityFilter,
                }))
              }
            />
          )}
        </Field>
        <Field label={t('menus.filters.rootOnly')}>
          {({ inputId }) => (
            <Checkbox
              id={inputId}
              label={t('menus.filters.rootOnlyLabel')}
              checked={staged.rootOnly}
              onChange={(event) => setStaged((current) => ({ ...current, rootOnly: event.target.checked }))}
            />
          )}
        </Field>
      </Toolbar>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.node.id}
        loading={loading}
        error={error ? translateError(locale, error) : null}
        requestId={requestId}
        onRetry={reload}
        labels={{
          empty: hasFilters ? t('list.noResults') : t('menus.empty'),
          emptyDescription: hasFilters ? t('list.noResultsHint') : t('menus.emptyHint'),
          loading: t('common.loading'),
          errorTitle: t('common.error'),
          retry: t('common.retry'),
          copy: t('list.copy'),
          copied: t('list.copied'),
        }}
        emptyAction={
          canCreate ? <Button onClick={() => openCreate(null)}>{t('menus.create')}</Button> : undefined
        }
        emptySecondaryAction={
          hasFilters ? (
            <Button variant="secondary" onClick={() => applyFilters(EMPTY_FILTERS)}>
              {t('list.clearFilters')}
            </Button>
          ) : undefined
        }
      />

      <MenuFormDrawer
        open={formOpen}
        mode={formMode}
        node={formNode}
        parentId={formParentId}
        tree={tree}
        onClose={() => setFormOpen(false)}
        onSaved={() => {
          seededExpansion.current = expanded.size > 0;
          reload();
        }}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        title={t('menus.deleteTitle')}
        description={
          deleteTarget
            ? t('menus.deleteConfirm', {
                name: deleteTarget.label,
                code: deleteTarget.code,
                parent: deleteTarget.parentId
                  ? (findParentLabel(tree, deleteTarget.parentId) ?? t('menus.fields.parentNone'))
                  : t('menus.fields.parentNone'),
              })
            : ''
        }
        confirmLabel={t('common.yesDelete')}
        cancelLabel={t('common.cancel')}
        destructive
        loading={deleting}
        confirmDisabled={deleteTarget !== null && deletionBlock(deleteTarget) !== null}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

/** Label of a node in the currently loaded tree, used in the delete summary. */
function findParentLabel(tree: MenuNode[], id: string): string | null {
  for (const node of tree) {
    if (node.id === id) return node.label;
    const found = findParentLabel(node.children, id);
    if (found) return found;
  }
  return null;
}
