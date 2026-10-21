import { Injectable } from '@nestjs/common';
import { DEFAULT_ADMIN_LOCALE, ERROR_CODES, PUBLIC_LOCALE } from '@b2b/contracts';
import type {
  CategoryDetail,
  CategoryListItem,
  CategoryNode,
  CategoryPathEntry,
  Paginated,
  PublicCategoryTreeNode,
} from '@b2b/contracts';
import { buildPaginationMeta } from '@b2b/contracts';
import type {
  CategoryListQueryInput,
  CategoryTreeQueryInput,
  CreateCategoryInput,
  UpdateCategoryInput,
} from '@b2b/validation';
import { ApiError } from '../../common/errors/api-error';
import { JsonLogger } from '../../common/logger.service';
import { AuditService } from '../../common/services/audit.service';
import { StorageService } from '../../common/services/storage.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  MAX_CATEGORY_DEPTH,
  assertCategoryNotModified,
  assertCategoryParentIsValid,
  assertNewCategoryDepthIsValid,
  assertReorderIsComplete,
  categoryDeleteBlock,
  collectDescendantIds,
  collectPath,
  computeCategoryCounts,
  isPubliclyReachable,
  orphanedParentRefs,
  siblingSortOrders,
  type CategoryCounts,
  type CategoryRef,
} from './category-policy';

export { MAX_CATEGORY_DEPTH };

const CATEGORY_SELECT = {
  id: true,
  code: true,
  slug: true,
  parentId: true,
  coverFileAssetId: true,
  sortOrder: true,
  enabled: true,
  visible: true,
  createdAt: true,
  updatedAt: true,
  translations: { select: { locale: true, name: true, description: true } },
} as const;

interface CategoryRow extends CategoryRef {
  coverFileAssetId: string | null;
  createdAt: Date;
  updatedAt: Date;
  translations: { locale: string; name: string; description: string | null }[];
}

/** Direct product counts per category, in one grouped query (no N+1). */
type DirectCounts = Map<string, number>;

@Injectable()
export class CategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: JsonLogger,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  // ------------------------------------------------------------------ reads

  /**
   * All descendant category ids including the root, resolved with a recursive
   * CTE so the platform never loads the whole tree to answer one filter
   * (docs/04 §4).
   */
  async getSubtreeIds(rootId: string): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      WITH RECURSIVE subtree AS (
        SELECT id, "parentId" FROM categories WHERE id = ${rootId}::uuid
        UNION ALL
        SELECT c.id, c."parentId"
        FROM categories c
        JOIN subtree s ON c."parentId" = s.id
      )
      SELECT id FROM subtree
    `;
    return rows.map((row) => row.id);
  }

  /**
   * Ancestor chain root → self, used for storefront product breadcrumbs.
   *
   * `locale` defaults to the public locale, not the admin one: this chain is
   * rendered on English storefront pages even when an administrator triggered it.
   */
  async getAncestors(
    categoryId: string,
    locale = PUBLIC_LOCALE,
  ): Promise<{ id: string; slug: string; name: string }[]> {
    const rows = await this.loadRows();
    return collectPath(rows, categoryId).map((row) => ({
      id: row.id,
      slug: row.slug,
      name: this.nameOf(row.translations, locale) || row.code,
    }));
  }

  /**
   * Admin tree for the category workbench (docs/22 §5.2, §6.2).
   *
   * Every node carries its direct and rolled-up product counts plus its
   * translations, so the panel never needs a second request per node.
   */
  async listAdminTree(query: Partial<CategoryTreeQueryInput> = {}): Promise<CategoryNode[]> {
    const locale = query.locale ?? DEFAULT_ADMIN_LOCALE;
    const [rows, direct] = await Promise.all([this.loadRows(), this.directProductCounts()]);
    this.reportOrphans(rows);
    const counts = computeCategoryCounts(rows, direct);
    const filtered = this.applyTreeFilters(rows, query, counts);

    const compare = (left: CategoryRow, right: CategoryRow) =>
      left.sortOrder - right.sortOrder ||
      this.nameOf(left.translations, locale).localeCompare(
        this.nameOf(right.translations, locale),
      ) ||
      left.id.localeCompare(right.id);

    const build = (parentId: string | null): CategoryNode[] =>
      filtered
        .filter((row) => row.parentId === parentId)
        .sort(compare)
        .map((row) => ({
          ...this.toNode(row, locale, counts),
          children: build(row.id),
        }));

    if (query.rootOnly) {
      return filtered
        .filter((row) => row.parentId === null)
        .sort(compare)
        .map((row) => ({ ...this.toNode(row, locale, counts), children: [] }));
    }
    return build(null);
  }

  /** Detail for the right-hand panel: path, counts and the direct children. */
  async getDetail(id: string, locale: string = DEFAULT_ADMIN_LOCALE): Promise<CategoryDetail> {
    const [rows, direct] = await Promise.all([this.loadRows(), this.directProductCounts()]);
    const row = rows.find((candidate) => candidate.id === id);
    if (!row) throw ApiError.notFound('Category not found.');
    const counts = computeCategoryCounts(rows, direct);
    const path = collectPath(rows, id);
    const parent = path.length > 1 ? path[path.length - 2] : null;
    const compare = (left: CategoryRow, right: CategoryRow) =>
      left.sortOrder - right.sortOrder ||
      this.nameOf(left.translations, locale).localeCompare(
        this.nameOf(right.translations, locale),
      ) ||
      left.id.localeCompare(right.id);

    return {
      id: row.id,
      code: row.code,
      slug: row.slug,
      parentId: row.parentId,
      parentName: parent ? this.nameOf(parent.translations, locale) : null,
      sortOrder: row.sortOrder,
      enabled: row.enabled,
      visible: row.visible,
      coverImageId: row.coverFileAssetId,
      names: this.namesOf(row.translations),
      descriptions: this.descriptionsOf(row.translations),
      productCount: counts.get(row.id)?.direct ?? 0,
      totalProductCount: counts.get(row.id)?.total ?? 0,
      updatedAt: row.updatedAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      path: path.map((entry) => this.toPathEntry(entry, locale)),
      children: rows
        .filter((candidate) => candidate.parentId === id)
        .sort(compare)
        .map((child) => this.toNode(child, locale, counts)),
    };
  }

  /**
   * Paginated flat view over the same tree for search/audit (docs/22 §2.6).
   *
   * Rows are ordered by hierarchy path by default so a page of results still
   * reads as a tree instead of an arbitrary slice.
   */
  async listCategories(query: CategoryListQueryInput): Promise<Paginated<CategoryListItem>> {
    const [rows, direct] = await Promise.all([this.loadRows(), this.directProductCounts()]);
    const counts = computeCategoryCounts(rows, direct);
    const filtered = this.applyTreeFilters(rows, query, counts, { keepAncestors: false });

    const rootId = query.rootId;
    const inBranch = rootId ? new Set([rootId, ...collectDescendantIds(rows, rootId)]) : null;
    const scoped = filtered.filter(
      (row) =>
        (query.parentId ? row.parentId === query.parentId : true) &&
        (inBranch ? inBranch.has(row.id) : true),
    );

    const items = scoped
      .map((row) => this.toListItem(row, rows, counts, query.locale))
      .sort((left, right) => {
        if (query.sortBy === 'updatedAt') return left.updatedAt.localeCompare(right.updatedAt);
        if (query.sortBy === 'sortOrder') return left.sortOrder - right.sortOrder;
        return left.path
          .map((entry) => entry.name)
          .join('/')
          .localeCompare(right.path.map((entry) => entry.name).join('/'));
      });
    if (query.sortDir === 'desc') items.reverse();

    const total = items.length;
    const start = (query.page - 1) * query.pageSize;
    return {
      data: items.slice(start, start + query.pageSize),
      pagination: buildPaginationMeta(query.page, query.pageSize, total),
    };
  }

  // ----------------------------------------------------------------- writes

  async create(input: CreateCategoryInput, actorId: string, requestId: string) {
    if (await this.prisma.category.findUnique({ where: { slug: input.slug } })) {
      throw new ApiError(
        ERROR_CODES.categorySlugConflict,
        'This category URL slug is already in use.',
        {
          details: { slug: 'category.slug.taken' },
        },
      );
    }
    if (await this.prisma.category.findUnique({ where: { code: input.code } })) {
      throw new ApiError(
        ERROR_CODES.categoryCodeConflict,
        'This category code is already in use.',
        {
          details: { code: 'category.code.taken' },
        },
      );
    }

    const rows = await this.loadRefs();
    if (input.parentId) {
      await this.assertParentExists(input.parentId);
    }
    assertNewCategoryDepthIsValid({ rows, parentId: input.parentId ?? null });

    const category = await this.prisma.category.create({
      data: {
        code: input.code,
        slug: input.slug,
        parentId: input.parentId ?? null,
        sortOrder: input.sortOrder,
        enabled: input.enabled,
        visible: input.visible,
        coverFileAssetId: input.coverFileAssetId ?? null,
        translations: {
          create: input.translations.map((translation) => ({
            locale: translation.locale,
            name: translation.name,
            description: translation.description ?? null,
          })),
        },
      },
    });
    await this.audit.record({
      actorId,
      action: 'category.create',
      entityType: 'category',
      entityId: category.id,
      requestId,
      metadata: {
        code: category.code,
        slug: category.slug,
        parentId: category.parentId,
        enabled: category.enabled,
        visible: category.visible,
        locales: input.translations.map((translation) => translation.locale),
      },
    });
    return { id: category.id };
  }

  async update(id: string, input: UpdateCategoryInput, actorId: string, requestId: string) {
    const rows = await this.loadRows();
    const row = rows.find((candidate) => candidate.id === id);
    if (!row) throw ApiError.notFound('Category not found.');
    assertCategoryNotModified(row.updatedAt, input.expectedUpdatedAt);

    if (input.slug && input.slug !== row.slug) {
      const taken = await this.prisma.category.findUnique({ where: { slug: input.slug } });
      if (taken && taken.id !== id) {
        throw new ApiError(
          ERROR_CODES.categorySlugConflict,
          'This category URL slug is already in use.',
          {
            details: { slug: 'category.slug.taken' },
          },
        );
      }
    }
    if (input.parentId !== undefined && input.parentId !== row.parentId) {
      if (input.parentId !== null) await this.assertParentExists(input.parentId);
      assertCategoryParentIsValid({ rows, parentId: input.parentId, selfId: id });
    }

    await this.prisma.$transaction([
      ...(input.translations ?? []).map((translation) =>
        this.prisma.categoryTranslation.upsert({
          where: { categoryId_locale: { categoryId: id, locale: translation.locale } },
          create: {
            categoryId: id,
            locale: translation.locale,
            name: translation.name,
            description: translation.description ?? null,
          },
          update: { name: translation.name, description: translation.description ?? null },
        }),
      ),
      this.prisma.category.update({
        where: { id },
        data: {
          ...(input.slug !== undefined ? { slug: input.slug } : {}),
          ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
          ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
          ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
          ...(input.visible !== undefined ? { visible: input.visible } : {}),
          ...(input.coverFileAssetId !== undefined
            ? { coverFileAssetId: input.coverFileAssetId }
            : {}),
        },
      }),
    ]);

    await this.audit.record({
      actorId,
      action: 'category.update',
      entityType: 'category',
      entityId: id,
      requestId,
      // Only the fields that actually moved are recorded: a description edit
      // must not copy free text into the audit row (docs/22 §8.2).
      metadata: this.diffMetadata(row, input),
    });
    return { id };
  }

  async move(
    id: string,
    parentId: string | null,
    actorId: string,
    requestId: string,
    sortOrder?: number,
  ) {
    const rows = await this.loadRows();
    const row = rows.find((candidate) => candidate.id === id);
    if (!row) throw ApiError.notFound('Category not found.');
    if (parentId !== null) await this.assertParentExists(parentId);
    assertCategoryParentIsValid({ rows, parentId, selfId: id });

    await this.prisma.category.update({
      where: { id },
      data: { parentId, ...(sortOrder !== undefined ? { sortOrder } : {}) },
    });
    await this.audit.record({
      actorId,
      action: 'category.move',
      entityType: 'category',
      entityId: id,
      requestId,
      metadata: {
        from: row.parentId,
        to: parentId,
        ...(sortOrder !== undefined ? { sortOrder } : {}),
      },
    });
    return { id };
  }

  /**
   * Sibling reorder (docs/22 §2.4, §5.1).
   *
   * The submitted id list must be exactly the current siblings, and the new
   * orders are written in one transaction so no reader can observe a partial
   * order.
   */
  async reorder(parentId: string | null, orderedIds: string[], actorId: string, requestId: string) {
    const rows = await this.loadRefs();
    const siblings = rows.filter((row) => row.parentId === parentId).map((row) => row.id);
    assertReorderIsComplete(siblings, orderedIds);

    const orders = siblingSortOrders(orderedIds.length);
    await this.prisma.$transaction(
      orderedIds.map((id, index) =>
        this.prisma.category.update({ where: { id }, data: { sortOrder: orders[index] } }),
      ),
    );
    await this.audit.record({
      actorId,
      action: 'category.reorder',
      entityType: 'category',
      entityId: parentId ?? 'root',
      requestId,
      metadata: { parentId, orderedIds },
    });
    return { reordered: orderedIds.length };
  }

  /**
   * Physical delete, refused while children or products still reference the
   * node (docs/22 §6.5). Products are never cascaded; the safe alternative is
   * to disable/hide the category or migrate its products first.
   */
  async remove(id: string, actorId: string, requestId: string) {
    const row = await this.prisma.category.findUnique({ where: { id } });
    if (!row) throw ApiError.notFound('Category not found.');

    const block = await this.deleteBlock(id);
    if (block === 'children') {
      throw new ApiError(
        ERROR_CODES.categoryHasChildren,
        'This category still has child categories. Move or remove them first, or disable this category instead.',
      );
    }
    if (block === 'products') {
      throw new ApiError(
        ERROR_CODES.categoryHasProducts,
        'This category still has products. Reassign them first, or hide the category instead.',
      );
    }

    await this.prisma.category.delete({ where: { id } });
    await this.audit.record({
      actorId,
      action: 'category.delete',
      entityType: 'category',
      entityId: id,
      requestId,
      metadata: { code: row.code, slug: row.slug, parentId: row.parentId },
    });
    return { deleted: true };
  }

  /** Impact preview for the delete dialog, without performing the deletion. */
  async deleteImpact(
    id: string,
  ): Promise<{ childCount: number; productCount: number; blockedBy: string | null }> {
    const [childCount, productCount] = await Promise.all([
      this.prisma.category.count({ where: { parentId: id } }),
      this.prisma.product.count({ where: { categoryId: id } }),
    ]);
    return {
      childCount,
      productCount,
      blockedBy: categoryDeleteBlock({ childCount, productCount }),
    };
  }

  // ---------------------------------------------------------------- public

  /**
   * Public tree: only categories reachable through public ancestors.
   *
   * Counts here are live public products (published, not discontinued) - the
   * back-office totals would overstate what a shopper can actually open.
   */
  async listPublicTree(locale: string): Promise<PublicCategoryTreeNode[]> {
    const rows = await this.loadRows();
    const counts = computeCategoryCounts(rows, await this.publishedProductCounts());
    const visible = new Set(
      rows.filter((row) => isPubliclyReachable(rows, row.id)).map((row) => row.id),
    );
    const scope = rows.filter((row) => visible.has(row.id));

    const build = (parentId: string | null): PublicCategoryTreeNode[] =>
      scope
        .filter((row) => row.parentId === parentId)
        .sort(
          (left, right) => left.sortOrder - right.sortOrder || left.slug.localeCompare(right.slug),
        )
        .map((row) => ({
          id: row.id,
          code: row.code,
          slug: row.slug,
          name: this.nameOf(row.translations, locale),
          description: this.descriptionOf(row.translations, locale),
          coverImageUrl: row.cover ? this.storage.publicUrl(row.cover.storageKey) : null,
          productCount: counts.get(row.id)?.total ?? 0,
          children: build(row.id),
        }));
    return build(null);
  }

  async findPublicBySlug(slug: string, locale: string) {
    const rows = await this.loadRows();
    const row = rows.find((candidate) => candidate.slug === slug);
    if (!row || !isPubliclyReachable(rows, row.id)) return null;
    const counts = computeCategoryCounts(rows, await this.publishedProductCounts());
    return {
      id: row.id,
      code: row.code,
      slug: row.slug,
      name: this.nameOf(row.translations, locale),
      description: this.descriptionOf(row.translations, locale),
      productCount: counts.get(row.id)?.total ?? 0,
    };
  }

  /**
   * Category scope for a public product query (docs/22 §7.1-§7.2).
   *
   * Returns `null` when no category was requested, and an id list - possibly
   * empty - when one was. An empty list means "this category is not publicly
   * reachable", which the caller must translate into *zero* products rather
   * than "no filter": a hidden branch must never widen a query into the whole
   * catalogue.
   */
  async resolvePublicCategoryScope(
    input: { categoryId?: string; categorySlug?: string },
    options: { includeDescendants?: boolean } = {},
  ): Promise<string[] | null> {
    const categoryId = input.categoryId ?? null;
    const slug = input.categorySlug ?? null;
    if (!categoryId && !slug) return null;

    const rows = await this.loadRows();
    const row = categoryId
      ? rows.find((candidate) => candidate.id === categoryId)
      : rows.find((candidate) => candidate.slug === slug);
    if (!row || !isPubliclyReachable(rows, row.id)) return [];

    if (options.includeDescendants === false) return [row.id];
    return [row.id, ...collectDescendantIds(rows, row.id)].filter((id) =>
      isPubliclyReachable(rows, id),
    );
  }

  // ------------------------------------------------------- shared (admin)

  /**
   * Admin-side slug/id resolution used by product filters (docs/22 §5.2).
   *
   * Admin filtering intentionally ignores public visibility: the back office
   * must be able to see every product of a hidden category.
   */
  async resolveCategoryFilterId(input: {
    categoryId?: string;
    categorySlug?: string;
  }): Promise<string | null> {
    if (input.categoryId) return input.categoryId;
    if (!input.categorySlug) return null;
    const category = await this.prisma.category.findUnique({
      where: { slug: input.categorySlug },
      select: { id: true },
    });
    return category?.id ?? null;
  }

  // ---------------------------------------------------------------- helpers

  private async loadRows(): Promise<(CategoryRow & { cover: { storageKey: string } | null })[]> {
    return this.prisma.category.findMany({
      select: { ...CATEGORY_SELECT, cover: { select: { storageKey: true } } },
    });
  }

  private async loadRefs(): Promise<CategoryRef[]> {
    return this.prisma.category.findMany({
      select: {
        id: true,
        code: true,
        slug: true,
        parentId: true,
        sortOrder: true,
        enabled: true,
        visible: true,
      },
    });
  }

  private async assertParentExists(parentId: string): Promise<void> {
    const parent = await this.prisma.category.findUnique({ where: { id: parentId } });
    if (!parent) {
      throw new ApiError(ERROR_CODES.categoryParentInvalid, 'The parent category does not exist.', {
        details: { parentId: 'category.parent.missing' },
      });
    }
  }

  private async deleteBlock(id: string): Promise<'children' | 'products' | null> {
    const [childCount, productCount] = await Promise.all([
      this.prisma.category.count({ where: { parentId: id } }),
      this.prisma.product.count({ where: { categoryId: id } }),
    ]);
    return categoryDeleteBlock({ childCount, productCount });
  }

  /**
   * Back-office counts deliberately include every product record, draft or not
   * (docs/22 §6.3): the workbench answers "what is linked here", not "what is
   * live". One grouped query, rolled up in memory.
   */
  private async directProductCounts(): Promise<DirectCounts> {
    const grouped = await this.prisma.product.groupBy({
      by: ['categoryId'],
      _count: { _all: true },
    });
    const direct: DirectCounts = new Map();
    for (const group of grouped) {
      if (group.categoryId) direct.set(group.categoryId, group._count._all);
    }
    return direct;
  }

  private applyTreeFilters(
    rows: CategoryRow[],
    query: Partial<CategoryTreeQueryInput>,
    counts: Map<string, CategoryCounts>,
    options: { keepAncestors?: boolean } = {},
  ): CategoryRow[] {
    const keepAncestors = options.keepAncestors ?? true;
    let candidates = rows;

    if (query.status && query.status !== 'all') {
      const wanted = query.status === 'enabled';
      candidates = candidates.filter((row) => row.enabled === wanted);
    }
    if (query.visibility && query.visibility !== 'all') {
      const wanted = query.visibility === 'visible';
      candidates = candidates.filter((row) => row.visible === wanted);
    }
    if (query.hasProducts && query.hasProducts !== 'all') {
      const withProducts = query.hasProducts === 'with';
      candidates = candidates.filter(
        (row) => (counts.get(row.id)?.total ?? 0) > 0 === withProducts,
      );
    }

    const needle = query.q?.trim().toLowerCase();
    if (!needle) return candidates;

    const matches = (row: CategoryRow): boolean =>
      row.code.toLowerCase().includes(needle) ||
      row.slug.toLowerCase().includes(needle) ||
      row.translations.some((translation) => translation.name.toLowerCase().includes(needle));

    const byId = new Map(candidates.map((row) => [row.id, row]));
    const keep = new Set<string>();
    for (const row of candidates) {
      if (!matches(row)) continue;
      keep.add(row.id);
      // A match brings its subtree so the administrator sees where it sits
      // inside its branch, plus the ancestor path back to the root.
      for (const descendantId of collectDescendantIds(candidates, row.id)) keep.add(descendantId);
      if (keepAncestors) {
        let parentId = row.parentId;
        while (parentId && !keep.has(parentId)) {
          keep.add(parentId);
          parentId = byId.get(parentId)?.parentId ?? null;
        }
      }
    }
    return candidates.filter((row) => keep.has(row.id));
  }

  private toNode(
    row: CategoryRow,
    locale: string,
    counts: Map<string, CategoryCounts>,
  ): CategoryNode {
    return {
      id: row.id,
      code: row.code,
      slug: row.slug,
      name: this.nameOf(row.translations, locale) || row.code,
      parentId: row.parentId,
      sortOrder: row.sortOrder,
      enabled: row.enabled,
      visible: row.visible,
      coverImageId: row.coverFileAssetId,
      names: this.namesOf(row.translations),
      descriptions: this.descriptionsOf(row.translations),
      productCount: counts.get(row.id)?.direct ?? 0,
      totalProductCount: counts.get(row.id)?.total ?? 0,
      updatedAt: row.updatedAt.toISOString(),
      children: [],
    };
  }

  private toListItem(
    row: CategoryRow,
    rows: CategoryRow[],
    counts: Map<string, CategoryCounts>,
    locale: string,
  ): CategoryListItem {
    const path = collectPath(rows, row.id);
    const parent = path.length > 1 ? path[path.length - 2] : null;
    return {
      id: row.id,
      code: row.code,
      slug: row.slug,
      name: this.nameOf(row.translations, locale) || row.code,
      parentId: row.parentId,
      parentName: parent ? this.nameOf(parent.translations, locale) : null,
      sortOrder: row.sortOrder,
      enabled: row.enabled,
      visible: row.visible,
      productCount: counts.get(row.id)?.direct ?? 0,
      totalProductCount: counts.get(row.id)?.total ?? 0,
      updatedAt: row.updatedAt.toISOString(),
      path: path.map((entry) => this.toPathEntry(entry, locale)),
      depth: path.length,
    };
  }

  private toPathEntry(row: CategoryRow, locale: string): CategoryPathEntry {
    return { id: row.id, slug: row.slug, name: this.nameOf(row.translations, locale) };
  }

  private namesOf(translations: { locale: string; name: string }[]): Record<string, string> {
    return Object.fromEntries(
      translations.map((translation) => [translation.locale, translation.name]),
    );
  }

  private descriptionsOf(
    translations: { locale: string; description: string | null }[],
  ): Record<string, string | null> {
    return Object.fromEntries(
      translations.map((translation) => [translation.locale, translation.description]),
    );
  }

  /**
   * Translation fallback: requested locale → en-US → first available → code.
   * The rule is fixed here so the admin and the storefront can never disagree
   * about which name "the" name is (docs/22 §5.2).
   */
  private nameOf(translations: { locale: string; name: string }[], locale = 'en-US'): string {
    return (
      translations.find((translation) => translation.locale === locale)?.name ??
      translations.find((translation) => translation.locale === 'en-US')?.name ??
      translations[0]?.name ??
      ''
    );
  }

  private descriptionOf(
    translations: { locale: string; description: string | null }[],
    locale = 'en-US',
  ): string | null {
    return (
      translations.find((translation) => translation.locale === locale)?.description ??
      translations.find((translation) => translation.locale === 'en-US')?.description ??
      null
    );
  }

  /**
   * Direct counts of *publicly visible* products only (docs/22 §7.2): a draft or
   * discontinued product must not inflate a storefront category counter.
   */
  private async publishedProductCounts(): Promise<DirectCounts> {
    const grouped = await this.prisma.product.groupBy({
      by: ['categoryId'],
      where: { publishStatus: 'PUBLISHED', lifecycleStatus: { not: 'DISCONTINUED' } },
      _count: { _all: true },
    });
    const direct: DirectCounts = new Map();
    for (const group of grouped) {
      if (group.categoryId) direct.set(group.categoryId, group._count._all);
    }
    return direct;
  }

  private diffMetadata(row: CategoryRow, input: UpdateCategoryInput): Record<string, unknown> {
    const metadata: Record<string, unknown> = {};
    if (input.slug !== undefined && input.slug !== row.slug) {
      metadata.slug = { from: row.slug, to: input.slug };
    }
    if (input.parentId !== undefined && input.parentId !== row.parentId) {
      metadata.parentId = { from: row.parentId, to: input.parentId };
    }
    if (input.enabled !== undefined && input.enabled !== row.enabled) {
      metadata.enabled = { from: row.enabled, to: input.enabled };
    }
    if (input.visible !== undefined && input.visible !== row.visible) {
      metadata.visible = { from: row.visible, to: input.visible };
    }
    if (input.sortOrder !== undefined && input.sortOrder !== row.sortOrder) {
      metadata.sortOrder = { from: row.sortOrder, to: input.sortOrder };
    }
    if (input.translations) metadata.translationLocales = input.translations.map((t) => t.locale);
    return metadata;
  }

  /**
   * A category pointing at a parent that no longer exists is a data-integrity
   * problem: log it and keep rendering the rest of the tree rather than failing
   * the whole page (docs/22 §6.2).
   */
  private reportOrphans(rows: CategoryRow[]): void {
    const orphans = orphanedParentRefs(rows);
    if (orphans.length === 0) return;
    this.logger.warn(
      'category.tree.orphan_parent',
      { count: orphans.length, categoryIds: orphans },
      'CategoriesService',
    );
  }
}
