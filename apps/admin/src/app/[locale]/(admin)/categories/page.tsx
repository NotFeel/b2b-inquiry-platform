'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { CategoryListItem, CategoryNode } from '@b2b/contracts';
import {
  Badge,
  Button,
  ConfirmDialog,
  DataTable,
  ErrorState,
  Field,
  IconChevronDown,
  IconChevronRight,
  Input,
  LoadingState,
  PageHeader,
  Pagination,
  Select,
  useToast,
  type DataTableColumn,
} from '@b2b/ui';
import { AdminApiError } from '../../../../lib/admin-api';
import {
  categoriesApi,
  type CategoryDeleteImpact,
  type CategoryProductFilter,
  type CategoryStatusFilter,
  type CategoryVisibilityFilter,
} from '../../../../lib/categories-api';
import {
  allNodeIds,
  ancestorIds,
  countNodes,
  defaultExpandedIds,
  findNode,
  flattenTree,
  highlightParts,
  localizedName,
  moveWithinSiblings,
  pathLabel,
} from '../../../../lib/category-tree-state';
import type { CategoryFormMode } from '../../../../lib/category-form';
import {
  CategoryDetailPanel,
  type CategoryDetailLabels,
} from '../../../../components/category-detail-panel';
import { CategoryFormDrawer } from '../../../../components/category-form-drawer';
import { useBreadcrumb } from '../../../../components/use-breadcrumb';
import { useResource } from '../../../../lib/use-resource';
import { useViewport } from '../../../../components/use-viewport';
import { useSession } from '../../../../components/session-provider';
import { translateError } from '../../../../lib/i18n';

type ViewMode = 'tree' | 'list';

interface FilterState {
  q: string;
  status: CategoryStatusFilter;
  visibility: CategoryVisibilityFilter;
  hasProducts: CategoryProductFilter;
}

const EMPTY_FILTERS: FilterState = { q: '', status: 'all', visibility: 'all', hasProducts: 'all' };
const PAGE_SIZE = 20;

/** Filters live in the URL so a refresh or a shared link keeps them (docs/22 §9.2). */
function readFilters(params: URLSearchParams): FilterState {
  const read = <T extends string>(key: string, allowed: readonly T[], fallback: T): T => {
    const value = params.get(key);
    return value && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
  };
  return {
    q: params.get('q') ?? '',
    status: read('status', ['all', 'enabled', 'disabled'] as const, 'all'),
    visibility: read('visibility', ['all', 'visible', 'hidden'] as const, 'all'),
    hasProducts: read('hasProducts', ['all', 'with', 'without'] as const, 'all'),
  };
}

function toQueryString(filters: FilterState, selectedId: string | null, view: ViewMode): string {
  const params = new URLSearchParams();
  if (filters.q.trim()) params.set('q', filters.q.trim());
  if (filters.status !== 'all') params.set('status', filters.status);
  if (filters.visibility !== 'all') params.set('visibility', filters.visibility);
  if (filters.hasProducts !== 'all') params.set('hasProducts', filters.hasProducts);
  if (selectedId) params.set('selected', selectedId);
  if (view === 'list') params.set('view', 'list');
  return params.toString();
}

/**
 * Category management workbench (docs/22).
 *
 * The left tree is the navigation and the right panel is the work: hierarchy is
 * visible at a glance, the parent is picked from a tree selector instead of a
 * pasted UUID, and every structural rule (cycle, depth, duplicate code/slug,
 * delete protection) is re-checked by the API.
 */
export default function CategoriesPage() {
  const { t, locale, can } = useSession();
  const toast = useToast();
  const breadcrumb = useBreadcrumb();
  const viewport = useViewport();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [view, setView] = useState<ViewMode>(() =>
    searchParams.get('view') === 'list' ? 'list' : 'tree',
  );
  const [staged, setStaged] = useState<FilterState>(() => readFilters(searchParams));
  const [applied, setApplied] = useState<FilterState>(() => readFilters(searchParams));
  const [selectedId, setSelectedId] = useState<string | null>(() => searchParams.get('selected'));
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [mobilePane, setMobilePane] = useState<'tree' | 'detail'>('tree');
  const [page, setPage] = useState(1);
  const seededExpansion = useRef(false);

  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<CategoryFormMode>('createRoot');
  const [formNode, setFormNode] = useState<CategoryNode | null>(null);
  const [formParentId, setFormParentId] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<CategoryNode | null>(null);
  const [deleteImpact, setDeleteImpact] = useState<CategoryDeleteImpact | null>(null);
  const [deleteImpactLoading, setDeleteImpactLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const canCreate = can('category.create');
  const canUpdate = can('category.update');
  const canDelete = can('category.delete');

  const treeLoader = useCallback(
    () =>
      categoriesApi.tree({
        locale,
        ...(applied.q.trim() ? { q: applied.q.trim() } : {}),
        status: applied.status,
        visibility: applied.visibility,
        hasProducts: applied.hasProducts,
      }),
    [locale, applied],
  );
  const tree = useResource(treeLoader, [applied, locale], locale);
  const nodes = useMemo(() => tree.data ?? [], [tree.data]);

  const detailLoader = useCallback(
    () => (selectedId ? categoriesApi.detail(selectedId, locale) : Promise.resolve(null)),
    [selectedId, locale],
  );
  const detail = useResource(detailLoader, [selectedId, locale], locale);

  const listLoader = useCallback(
    () =>
      view === 'list'
        ? categoriesApi.list({
            locale,
            page,
            pageSize: PAGE_SIZE,
            ...(applied.q.trim() ? { q: applied.q.trim() } : {}),
            status: applied.status,
            visibility: applied.visibility,
            hasProducts: applied.hasProducts,
          })
        : Promise.resolve(null),
    [view, locale, page, applied],
  );
  const list = useResource(listLoader, [view, page, applied, locale], locale);

  // Top-level branches open on first paint; later reloads keep whatever the
  // administrator expanded or collapsed (docs/22 §2.4.3).
  useEffect(() => {
    if (seededExpansion.current || nodes.length === 0) return;
    seededExpansion.current = true;
    setExpanded(new Set(defaultExpandedIds(nodes)));
  }, [nodes]);

  const rows = useMemo(() => flattenTree(nodes, expanded), [nodes, expanded]);
  const activeFilters =
    applied.q.trim().length > 0 ||
    applied.status !== 'all' ||
    applied.visibility !== 'all' ||
    applied.hasProducts !== 'all';

  const syncUrl = useCallback(
    (filters: FilterState, selected: string | null, nextView: ViewMode) => {
      const query = toQueryString(filters, selected, nextView);
      router.replace(query.length > 0 ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router],
  );

  const applyFilters = (next: FilterState) => {
    setStaged(next);
    setApplied(next);
    setPage(1);
    seededExpansion.current = false;
    syncUrl(next, selectedId, view);
  };

  const selectNode = (id: string | null) => {
    setSelectedId(id);
    if (id) {
      setExpanded((current) => {
        const next = new Set(current);
        for (const ancestorId of ancestorIds(nodes, id)) next.add(ancestorId);
        return next;
      });
      setMobilePane('detail');
    }
    syncUrl(applied, id, view);
  };

  const selectFromList = (row: CategoryListItem) => {
    setView('tree');
    // A result must reveal its branch, not just its detail panel.
    setExpanded(
      (current) => new Set([...current, ...row.path.slice(0, -1).map((entry) => entry.id)]),
    );
    selectNode(row.id);
  };

  const toggleExpand = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const refreshAll = () => {
    tree.reload();
    detail.reload();
    if (view === 'list') list.reload();
  };

  const openCreateRoot = () => {
    setFormMode('createRoot');
    setFormNode(null);
    setFormParentId(null);
    setFormOpen(true);
  };

  const openCreateChild = (parent: CategoryNode) => {
    setFormMode('createChild');
    setFormNode(null);
    setFormParentId(parent.id);
    setFormOpen(true);
  };

  const openEdit = () => {
    if (!detail.data) return;
    const node = findNode(nodes, detail.data.id);
    if (!node) return;
    setFormMode('edit');
    setFormNode(node);
    setFormParentId(node.parentId);
    setFormOpen(true);
  };

  /**
   * A reorder rewrites the full sibling order, so it is offered only on an
   * unfiltered tree: with a filter active the sibling set on screen is partial
   * and the API would (correctly) reject the request.
   */
  const canMove = (node: CategoryNode, direction: 'up' | 'down') =>
    canUpdate &&
    !activeFilters &&
    moveWithinSiblings(nodes, node.parentId, node.id, direction) !== null;

  const reorder = async (node: CategoryNode, direction: 'up' | 'down') => {
    const orderedIds = moveWithinSiblings(nodes, node.parentId, node.id, direction);
    if (!orderedIds) return;
    setBusyId(node.id);
    try {
      await categoriesApi.reorder({ parentId: node.parentId, orderedIds });
      toast.success(t('categories.reorderSuccess'));
      refreshAll();
    } catch (caught) {
      // The server kept the previous order; reload to restore the real one.
      toast.error(
        caught instanceof AdminApiError
          ? translateError(locale, caught.code)
          : t('errors.INTERNAL_ERROR'),
      );
      refreshAll();
    } finally {
      setBusyId(null);
    }
  };

  const openDelete = async (node: CategoryNode) => {
    setDeleteTarget(node);
    setDeleteImpact(null);
    setDeleteImpactLoading(true);
    try {
      setDeleteImpact(await categoriesApi.deleteImpact(node.id));
    } catch {
      // The dialog still blocks the delete locally, and the API refuses anyway.
      setDeleteImpact(null);
    } finally {
      setDeleteImpactLoading(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await categoriesApi.remove(deleteTarget.id);
      toast.success(t('categories.deleteSuccess'));
      const removedId = deleteTarget.id;
      setDeleteTarget(null);
      if (selectedId === removedId) selectNode(null);
      refreshAll();
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

  const detailLabels: CategoryDetailLabels = {
    empty: t('categories.detail.empty'),
    emptyHint: t('categories.detail.emptyHint'),
    emptyAction: t('categories.createRoot'),
    loading: t('categories.detailLoading'),
    errorTitle: t('common.error'),
    retry: t('common.retry'),
    path: t('categories.detail.path'),
    code: t('categories.fields.code'),
    slug: t('categories.fields.slug'),
    parent: t('categories.fields.parent'),
    sortOrder: t('categories.fields.sortOrder'),
    updatedAt: t('categories.detail.updatedAt'),
    enabled: t('categories.statusOptions.enabled'),
    disabled: t('categories.statusOptions.disabled'),
    visible: t('categories.visibilityOptions.visible'),
    hidden: t('categories.visibilityOptions.hidden'),
    directProducts: t('categories.detail.directProducts'),
    totalProducts: t('categories.detail.totalProducts'),
    childrenTitle: t('categories.children.title'),
    childrenEmpty: t('categories.children.empty'),
    childrenEmptyHint: t('categories.children.emptyHint'),
    addChild: t('categories.createChild'),
    edit: t('common.edit'),
    remove: t('common.delete'),
    moveUp: (name) => t('categories.moveUp', { name }),
    moveDown: (name) => t('categories.moveDown', { name }),
    deleteBlocked: t('categories.deleteBlocked'),
    columns: {
      name: t('categories.columns.name'),
      code: t('categories.fields.code'),
      slug: t('categories.fields.slug'),
      products: t('categories.columns.productsShort'),
      state: t('common.status'),
      actions: t('common.actions'),
    },
    table: {
      loading: t('common.loading'),
      empty: t('categories.children.empty'),
      errorTitle: t('common.error'),
      retry: t('common.retry'),
    },
  };

  const listColumns: DataTableColumn<CategoryListItem>[] = [
    {
      key: 'name',
      header: t('categories.columns.name'),
      render: (row) => (
        <button type="button" className="link-button" onClick={() => selectFromList(row)}>
          {row.name}
        </button>
      ),
    },
    {
      key: 'path',
      header: t('categories.detail.path'),
      render: (row) => (
        <span className="muted small">{row.path.map((entry) => entry.name).join(' / ')}</span>
      ),
    },
    {
      key: 'code',
      header: t('categories.fields.code'),
      render: (row) => <span className="mono">{row.code}</span>,
    },
    {
      key: 'slug',
      header: t('categories.fields.slug'),
      render: (row) => <span className="mono">{row.slug}</span>,
    },
    {
      key: 'products',
      header: t('categories.columns.productsShort'),
      align: 'right',
      render: (row) => (
        <span className="mono">
          {row.productCount} / {row.totalProductCount}
        </span>
      ),
    },
    {
      key: 'state',
      header: t('common.status'),
      render: (row) => (
        <span className="badge-stack">
          <Badge tone={row.enabled ? 'success' : 'neutral'}>
            {row.enabled
              ? t('categories.statusOptions.enabled')
              : t('categories.statusOptions.disabled')}
          </Badge>
          <Badge tone={row.visible ? 'info' : 'warning'}>
            {row.visible
              ? t('categories.visibilityOptions.visible')
              : t('categories.visibilityOptions.hidden')}
          </Badge>
        </span>
      ),
    },
  ];

  const deleteBlockReason = deleteTarget
    ? deleteImpact?.blockedBy === 'children'
      ? t('categories.deleteHasChildren', { count: deleteImpact.childCount })
      : deleteImpact?.blockedBy === 'products'
        ? t('categories.deleteHasProducts', { count: deleteImpact.productCount })
        : null
    : null;
  const deleteTargetLabel = deleteTarget
    ? (pathLabel(nodes, deleteTarget.id, locale) ?? deleteTarget.name)
    : '';

  const showTree = viewport !== 'mobile' || mobilePane === 'tree';
  const showDetail = viewport !== 'mobile' || mobilePane === 'detail';

  return (
    <div className="stack">
      <PageHeader
        breadcrumb={breadcrumb}
        title={t('categories.title')}
        description={t('categories.description')}
        actions={
          <>
            <Button variant="secondary" onClick={() => setView(view === 'tree' ? 'list' : 'tree')}>
              {view === 'tree' ? t('categories.viewList') : t('categories.viewTree')}
            </Button>
            <Button variant="secondary" onClick={refreshAll} loading={tree.loading}>
              {t('categories.refresh')}
            </Button>
            {canCreate ? (
              <Button onClick={openCreateRoot}>{t('categories.createRoot')}</Button>
            ) : null}
          </>
        }
      />

      {view === 'list' ? (
        <section className="panel">
          <DataTable
            columns={listColumns}
            rows={list.data?.data ?? []}
            rowKey={(row) => row.id}
            labels={{
              empty: t('categories.empty'),
              emptyDescription: activeFilters ? t('list.noResultsHint') : t('categories.emptyHint'),
              loading: t('common.loading'),
              errorTitle: t('common.error'),
              retry: t('common.retry'),
            }}
            loading={list.loading}
            error={list.error ? translateError(locale, list.error) : null}
            requestId={list.requestId}
            onRetry={list.reload}
          />
          {list.data && list.data.pagination.totalPages > 1 ? (
            <Pagination
              page={list.data.pagination.page}
              pageSize={list.data.pagination.pageSize}
              total={list.data.pagination.total}
              totalPages={list.data.pagination.totalPages}
              onPageChange={setPage}
              labels={{
                previous: t('common.previous'),
                next: t('common.next'),
                rowsPerPage: t('common.rowsPerPage'),
                range: t('list.range', {
                  from: (list.data.pagination.page - 1) * list.data.pagination.pageSize + 1,
                  to: Math.min(
                    list.data.pagination.page * list.data.pagination.pageSize,
                    list.data.pagination.total,
                  ),
                  total: list.data.pagination.total,
                }),
              }}
            />
          ) : null}
        </section>
      ) : (
        <div className="workbench" data-pane={viewport === 'mobile' ? mobilePane : 'both'}>
          {showTree ? (
            <section className="panel workbench-tree" aria-label={t('categories.treePanel')}>
              <div className="tree-filters">
                <Field label={t('categories.filters.q')}>
                  {({ inputId, describedBy }) => (
                    <Input
                      inputId={inputId}
                      describedBy={describedBy}
                      type="search"
                      value={staged.q}
                      placeholder={t('categories.filters.qPlaceholder')}
                      onChange={(event) =>
                        setStaged((current) => ({ ...current, q: event.target.value }))
                      }
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') applyFilters(staged);
                      }}
                    />
                  )}
                </Field>
                <Select
                  aria-label={t('categories.filters.status')}
                  value={staged.status}
                  options={[
                    { value: 'all', label: t('categories.filters.statusAll') },
                    { value: 'enabled', label: t('categories.statusOptions.enabled') },
                    { value: 'disabled', label: t('categories.statusOptions.disabled') },
                  ]}
                  onChange={(event) =>
                    applyFilters({ ...staged, status: event.target.value as CategoryStatusFilter })
                  }
                />
                <Select
                  aria-label={t('categories.filters.visibility')}
                  value={staged.visibility}
                  options={[
                    { value: 'all', label: t('categories.filters.visibilityAll') },
                    { value: 'visible', label: t('categories.visibilityOptions.visible') },
                    { value: 'hidden', label: t('categories.visibilityOptions.hidden') },
                  ]}
                  onChange={(event) =>
                    applyFilters({
                      ...staged,
                      visibility: event.target.value as CategoryVisibilityFilter,
                    })
                  }
                />
                <Select
                  aria-label={t('categories.filters.hasProducts')}
                  value={staged.hasProducts}
                  options={[
                    { value: 'all', label: t('categories.filters.productsAll') },
                    { value: 'with', label: t('categories.filters.withProducts') },
                    { value: 'without', label: t('categories.filters.withoutProducts') },
                  ]}
                  onChange={(event) =>
                    applyFilters({
                      ...staged,
                      hasProducts: event.target.value as CategoryProductFilter,
                    })
                  }
                />
                <div className="tree-filter-actions">
                  <Button variant="secondary" onClick={() => applyFilters(staged)}>
                    {t('list.apply')}
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => applyFilters(EMPTY_FILTERS)}
                    disabled={!activeFilters}
                  >
                    {t('list.reset')}
                  </Button>
                </div>
              </div>
              <div className="tree-panel-head">
                <span className="muted small">
                  {t('categories.summary', { count: countNodes(nodes) })}
                </span>
                <span className="tree-panel-head-actions">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setExpanded(new Set())}
                    disabled={expanded.size === 0}
                  >
                    {t('categories.collapseAll')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setExpanded(new Set(allNodeIds(nodes)))}
                    disabled={nodes.length === 0}
                  >
                    {t('categories.expandAll')}
                  </Button>
                </span>
              </div>

              <div className="tree-scroll">
                {tree.loading && nodes.length === 0 ? (
                  <LoadingState label={t('common.loading')} rows={6} />
                ) : tree.error && nodes.length === 0 ? (
                  <ErrorState
                    title={t('common.error')}
                    description={translateError(locale, tree.error)}
                    requestId={tree.requestId}
                    onRetry={tree.reload}
                    retryLabel={t('common.retry')}
                  />
                ) : nodes.length === 0 ? (
                  <div className="state-block">
                    <strong>{activeFilters ? t('list.noResults') : t('categories.empty')}</strong>
                    <span>
                      {activeFilters ? t('list.noResultsHint') : t('categories.emptyHint')}
                    </span>
                    {canCreate && !activeFilters ? (
                      <Button size="sm" onClick={openCreateRoot}>
                        {t('categories.createRoot')}
                      </Button>
                    ) : null}
                    {activeFilters ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => applyFilters(EMPTY_FILTERS)}
                      >
                        {t('list.clearFilters')}
                      </Button>
                    ) : null}
                  </div>
                ) : (
                  <ul className="tree" role="tree">
                    {rows.map((row) => (
                      <TreeRow
                        key={row.node.id}
                        node={row.node}
                        depth={row.depth}
                        hasChildren={row.hasChildren}
                        expanded={expanded.has(row.node.id)}
                        selected={selectedId === row.node.id}
                        locale={locale}
                        needle={applied.q}
                        labels={{
                          expand: t('categories.expand'),
                          collapse: t('categories.collapse'),
                          disabled: t('categories.statusOptions.disabled'),
                          hidden: t('categories.visibilityOptions.hidden'),
                          productCount: t('categories.detail.totalProducts'),
                        }}
                        onSelect={selectNode}
                        onToggle={toggleExpand}
                      />
                    ))}
                  </ul>
                )}
              </div>
            </section>
          ) : null}

          {showDetail ? (
            <div className="workbench-detail-column">
              {viewport === 'mobile' ? (
                <Button variant="secondary" size="sm" onClick={() => setMobilePane('tree')}>
                  {t('categories.backToTree')}
                </Button>
              ) : null}
              <CategoryDetailPanel
                detail={detail.data}
                loading={detail.loading}
                error={detail.error ? translateError(locale, detail.error) : null}
                requestId={detail.requestId}
                onRetry={detail.reload}
                locale={locale}
                canCreate={canCreate}
                canUpdate={canUpdate}
                canDelete={canDelete}
                canMove={canMove}
                busyId={busyId}
                onEdit={openEdit}
                onAddChild={() => {
                  const node = detail.data ? findNode(nodes, detail.data.id) : null;
                  if (node) openCreateChild(node);
                }}
                onDelete={() => {
                  const node = detail.data ? findNode(nodes, detail.data.id) : null;
                  if (node) void openDelete(node);
                }}
                onReorderChild={(child, direction) => void reorder(child, direction)}
                onSelectNode={selectNode}
                labels={detailLabels}
              />
            </div>
          ) : null}
        </div>
      )}

      <CategoryFormDrawer
        open={formOpen}
        mode={formMode}
        node={formNode}
        parentId={formParentId}
        tree={nodes}
        onClose={() => setFormOpen(false)}
        onSaved={(id) => {
          // Open the parent branch so the new node is visible where it landed.
          if (formParentId) setExpanded((current) => new Set([...current, formParentId]));
          setSelectedId(id);
          setMobilePane('detail');
          refreshAll();
        }}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        title={t('categories.deleteTitle')}
        description={
          deleteTarget
            ? deleteBlockReason
              ? `${t('categories.deleteConfirm', { name: deleteTargetLabel })} ${deleteBlockReason}`
              : t('categories.deleteConfirmOk', { name: deleteTargetLabel })
            : ''
        }
        confirmLabel={t('common.yesDelete')}
        cancelLabel={t('common.cancel')}
        destructive
        loading={deleting}
        confirmDisabled={deleteImpactLoading || deleteBlockReason !== null}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

interface TreeRowProps {
  node: CategoryNode;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
  selected: boolean;
  locale: string;
  needle: string;
  labels: {
    expand: string;
    collapse: string;
    disabled: string;
    hidden: string;
    productCount: string;
  };
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
}

/**
 * One tree row (docs/22 §2.4).
 *
 * The toggle is a separate button from the label so expanding a branch never
 * changes the selection, and the product count is the rolled-up total - the
 * number an operator asks about when they look at a directory.
 */
function TreeRow({
  node,
  depth,
  hasChildren,
  expanded,
  selected,
  locale,
  needle,
  labels,
  onSelect,
  onToggle,
}: TreeRowProps) {
  const name = localizedName(node, locale);
  const parts = highlightParts(name, needle);

  return (
    <li role="treeitem" aria-expanded={hasChildren ? expanded : undefined} aria-selected={selected}>
      <div className="tree-row" data-selected={selected || undefined}>
        {hasChildren ? (
          <button
            type="button"
            className="tree-row-toggle"
            aria-label={expanded ? labels.collapse : labels.expand}
            aria-expanded={expanded}
            onClick={() => onToggle(node.id)}
          >
            {expanded ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
          </button>
        ) : (
          <span className="tree-row-toggle" aria-hidden="true" />
        )}
        <button
          type="button"
          className="tree-row-label"
          style={{ paddingLeft: `${4 + depth * 18}px` }}
          aria-current={selected || undefined}
          onClick={() => onSelect(node.id)}
        >
          <span className="tree-row-name">
            {parts.map((part, index) =>
              part.match ? (
                <mark key={index}>{part.text}</mark>
              ) : (
                <span key={index}>{part.text}</span>
              ),
            )}
          </span>
        </button>
        {/* Status is text, never colour alone (docs/06 §7). */}
        {!node.enabled ? <Badge tone="neutral">{labels.disabled}</Badge> : null}
        {node.visible ? null : <Badge tone="warning">{labels.hidden}</Badge>}
        <span className="tree-row-count mono" title={labels.productCount}>
          {node.totalProductCount}
        </span>
      </div>
    </li>
  );
}
