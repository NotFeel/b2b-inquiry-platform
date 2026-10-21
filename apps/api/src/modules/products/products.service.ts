import { Injectable } from '@nestjs/common';
import { DICTIONARY_TYPES, ERROR_CODES, PUBLIC_LOCALE } from '@b2b/contracts';
import type {
  ProductAdminDetail,
  ProductAdminSummary,
  ProductSlugSuggestion,
} from '@b2b/contracts';
import type {
  CreateProductInput,
  ProductListQueryInput,
  ProductSlugSuggestionInput,
  UpdateProductInput,
} from '@b2b/validation';
import { ApiError } from '../../common/errors/api-error';
import { AuditService } from '../../common/services/audit.service';
import { StorageService } from '../../common/services/storage.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CategoriesService } from '../categories/categories.service';
import { DictionaryService } from '../dictionary/dictionary.service';
import { ProductImagesService } from './product-images.service';
import { canPublishProduct } from './product-image-policy';
import { buildProductSlugCandidate, productUniqueConstraintError } from './product-slug';

const PRODUCT_STATUS_MAP = {
  draft: 'DRAFT',
  published: 'PUBLISHED',
  unpublished: 'UNPUBLISHED',
} as const;

const LIFECYCLE_MAP = {
  available: 'AVAILABLE',
  preorder: 'PREORDER',
  discontinued: 'DISCONTINUED',
} as const;

/** Marketing display is read from product tags, not from the legacy booleans. */
const MARKETING_TAG_CODES = {
  featured: 'featured',
  newArrival: 'new-arrival',
  preorder: 'preorder',
} as const;

const SORT_COLUMNS: Record<string, 'updatedAt' | 'createdAt' | 'sku' | 'sortOrder'> = {
  updated_at: 'updatedAt',
  created_at: 'createdAt',
  sku: 'sku',
  sort_order: 'sortOrder',
};

interface CategoryLabel {
  id: string;
  parentId: string | null;
  name: string;
}

interface SummaryImageRow {
  id: string;
  fileAssetId: string | null;
  storageKey: string;
  altText: string | null;
  sortOrder: number;
  isCover: boolean;
  deleteState: string;
}

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly categories: CategoriesService,
    private readonly dictionary: DictionaryService,
    private readonly images: ProductImagesService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Maps a submitted status code to its dictionary item id (docs/20 §7.4).
   *
   * The enum column stays authoritative for reads in this release, so the code
   * doubles as the enum value; the dictionary lookup proves the code still
   * exists in the expected type and keeps the new foreign key in parity. A
   * missing type (unseeded environment) falls back to the enum only, and a
   * disabled item is refused unless the record already holds it.
   */
  private async resolveStatusItemId(
    typeCode: string,
    code: string,
    currentCode: string | null,
  ): Promise<string | null> {
    const item = await this.dictionary.resolveItem(typeCode, code);
    if (!item) return null;
    if (!item.enabled && code !== currentCode) {
      throw new ApiError(
        ERROR_CODES.dictionaryTypeMismatch,
        `Dictionary item ${code} is disabled and cannot be selected any more.`,
        { status: 422, details: { typeCode, code, reason: 'disabled' } },
      );
    }
    return item.id;
  }

  async list(query: ProductListQueryInput, canSeeCost: boolean) {
    const categoryIds = await this.resolveCategoryScope(query);
    const where = {
      ...(categoryIds ? { categoryId: { in: categoryIds } } : {}),
      ...(query.publishStatus ? { publishStatus: PRODUCT_STATUS_MAP[query.publishStatus] } : {}),
      ...(query.lifecycleStatus ? { lifecycleStatus: LIFECYCLE_MAP[query.lifecycleStatus] } : {}),
      ...(query.isFeatured !== undefined ? { isFeatured: query.isFeatured } : {}),
      ...(query.isNew !== undefined ? { isNew: query.isNew } : {}),
      ...(query.tag ? { tags: { some: { tag: { code: query.tag } } } } : {}),
      ...(query.tagId ? { tags: { some: { tagId: query.tagId } } } : {}),
      // An image that is pending or failed a physical delete is not a usable
      // image, so it must not make a product look complete (docs/24 §3.4).
      ...(query.hasImages === 'with' ? { images: { some: { deleteState: 'READY' } } } : {}),
      ...(query.hasImages === 'without' ? { images: { none: { deleteState: 'READY' } } } : {}),
      ...(query.q
        ? {
            OR: [
              { sku: { contains: query.q, mode: 'insensitive' as const } },
              { slug: { contains: query.q, mode: 'insensitive' as const } },
              {
                translations: {
                  some: { name: { contains: query.q, mode: 'insensitive' as const } },
                },
              },
            ],
          }
        : {}),
    };

    const orderBy = this.buildAdminOrderBy(query);
    const [total, products] = await this.prisma.$transaction([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        orderBy,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          translations: true,
          tags: { include: { tag: { include: { translations: true } } } },
          category: { include: { translations: true } },
          images: {
            select: {
              id: true,
              fileAssetId: true,
              storageKey: true,
              altText: true,
              sortOrder: true,
              isCover: true,
              deleteState: true,
            },
            orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          },
        },
      }),
    ]);

    const pathByCategory = await this.buildCategoryPaths(
      products.map((product) => product.categoryId).filter((id): id is string => id !== null),
    );

    return {
      data: products.map((product) =>
        this.toAdminSummary(
          {
            ...product,
            categoryPath: product.categoryId
              ? (pathByCategory.get(product.categoryId) ?? null)
              : null,
          },
          canSeeCost,
        ),
      ),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      },
    };
  }

  async detail(id: string, canSeeCost: boolean): Promise<ProductAdminDetail> {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: {
        translations: true,
        images: {
          select: {
            id: true,
            fileAssetId: true,
            storageKey: true,
            altText: true,
            sortOrder: true,
            isCover: true,
            deleteState: true,
          },
        },
        tags: { include: { tag: { include: { translations: true } } } },
        category: { include: { translations: true } },
      },
    });
    if (!product) throw ApiError.notFound('Product not found.');

    const pathByCategory = await this.buildCategoryPaths(
      product.categoryId ? [product.categoryId] : [],
    );
    const gallery = await this.images.gallery(id);
    const summary = this.toAdminSummary(
      {
        ...product,
        categoryPath: product.categoryId ? (pathByCategory.get(product.categoryId) ?? null) : null,
      },
      canSeeCost,
    );

    return {
      ...summary,
      // Dictionary mirror of the enum statuses, kept in parity since the staged
      // migration (docs/20 §8). The enum stays authoritative for reads.
      lifecycleStatusItemId: product.lifecycleStatusItemId,
      publishStatusItemId: product.publishStatusItemId,
      lengthMm: product.lengthMm,
      widthMm: product.widthMm,
      heightMm: product.heightMm,
      weightGrams: product.weightGrams,
      packaging: product.packaging,
      cartonLengthCm: product.cartonLengthCm,
      cartonWidthCm: product.cartonWidthCm,
      cartonHeightCm: product.cartonHeightCm,
      cartonWeightKg: product.cartonWeightKg?.toString() ?? null,
      cartonQuantity: product.cartonQuantity,
      translations: Object.fromEntries(
        product.translations.map((translation) => [
          translation.locale,
          {
            name: translation.name,
            description: translation.description,
            seoTitle: translation.seoTitle,
            seoDescription: translation.seoDescription,
          },
        ]),
      ),
      images: gallery.images,
      coverImageId: gallery.coverImageId,
      tags: product.tags.map((productTag) => ({
        id: productTag.tag.id,
        code: productTag.tag.code,
        colorToken: productTag.tag.colorToken,
        enabled: productTag.tag.enabled,
        labels: Object.fromEntries(productTag.tag.translations.map((t) => [t.locale, t.label])),
        // A disabled tag stays on the product on purpose: the editor must show
        // the historical association instead of silently dropping it (docs/23 §8.1).
      })),
      createdAt: product.createdAt.toISOString(),
    };
  }

  async create(input: CreateProductInput, actorId: string, requestId: string) {
    await this.assertSkuFree(input.sku);
    await this.assertSlugFree(input.slug);
    await this.assertCategoryUsable(input.categoryId);
    const translationRows = this.normalizeTranslations(input.translations);
    const { ids: tagIds, codes: tagCodes } = await this.resolveTagIds(input.tagIds, input.tagCodes);
    const flags = this.deriveMarketingFlags(tagCodes, input.lifecycleStatus);
    // Dictionary parity (docs/20 §8 switch preparation): the submitted codes are
    // validated against their status types and mirrored into the new columns.
    const lifecycleStatusItemId = await this.resolveStatusItemId(
      DICTIONARY_TYPES.productLifecycle,
      input.lifecycleStatus,
      null,
    );
    const publishStatusItemId = await this.resolveStatusItemId(
      DICTIONARY_TYPES.productPublishStatus,
      input.publishStatus,
      null,
    );

    let product: { id: string; sku: string; slug: string };
    try {
      product = await this.prisma.product.create({
        data: {
          sku: input.sku,
          slug: input.slug,
          categoryId: input.categoryId,
          priceCny: input.priceCny ?? null,
          lifecycleStatus: LIFECYCLE_MAP[input.lifecycleStatus],
          publishStatus: PRODUCT_STATUS_MAP[input.publishStatus],
          lifecycleStatusItemId,
          publishStatusItemId,
          isNew: flags.isNew,
          isFeatured: flags.isFeatured,
          isPreOrder: flags.isPreOrder,
          sortOrder: input.sortOrder,
          lengthMm: input.lengthMm ?? null,
          widthMm: input.widthMm ?? null,
          heightMm: input.heightMm ?? null,
          weightGrams: input.weightGrams ?? null,
          packaging: input.packaging ?? null,
          cartonLengthCm: input.cartonLengthCm ?? null,
          cartonWidthCm: input.cartonWidthCm ?? null,
          cartonHeightCm: input.cartonHeightCm ?? null,
          cartonWeightKg: input.cartonWeightKg ?? null,
          cartonQuantity: input.cartonQuantity ?? null,
          createdById: actorId,
          translations: { create: translationRows },
          tags: { create: tagIds.map((tagId) => ({ tagId })) },
        },
        select: { id: true, sku: true, slug: true },
      });
    } catch (error) {
      this.rethrowProductUniqueConflict(error);
    }

    await this.audit.record({
      actorId,
      action: 'product.created',
      entityType: 'product',
      entityId: product.id,
      requestId,
      metadata: { sku: product.sku, publishStatus: input.publishStatus },
    });
    await this.images.revalidatePublicCatalogue('product_created');
    return { id: product.id, sku: product.sku, slug: product.slug };
  }

  async update(id: string, input: UpdateProductInput, actorId: string, requestId: string) {
    const existing = await this.prisma.product.findUnique({ where: { id } });
    if (!existing) throw ApiError.notFound('Product not found.');
    if (input.slug && input.slug !== existing.slug) {
      // Without a redirect table, changing a published slug would silently
      // break storefront links and any indexed URLs (docs/26 §3.1/§5.1).
      if (existing.publishStatus !== 'DRAFT') {
        throw new ApiError(
          ERROR_CODES.productSlugLocked,
          'The URL slug can only be changed while the product is a draft.',
          { details: { slug: 'products.validation.slugLocked' } },
        );
      }
      await this.assertSlugFree(input.slug);
    }
    if (input.categoryId && input.categoryId !== existing.categoryId) {
      await this.assertCategoryUsable(input.categoryId);
    }

    const translationRows = input.translations
      ? this.normalizeTranslations(input.translations)
      : null;
    const tagSelection =
      input.tagIds || input.tagCodes
        ? await this.resolveTagIds(input.tagIds ?? [], input.tagCodes)
        : null;
    const tagIds = tagSelection?.ids ?? null;
    // Only validate and mirror the statuses the request actually touches.
    const lifecycleStatusItemId = input.lifecycleStatus
      ? await this.resolveStatusItemId(
          DICTIONARY_TYPES.productLifecycle,
          input.lifecycleStatus,
          existing.lifecycleStatus.toLowerCase(),
        )
      : undefined;
    const publishStatusItemId = input.publishStatus
      ? await this.resolveStatusItemId(
          DICTIONARY_TYPES.productPublishStatus,
          input.publishStatus,
          existing.publishStatus.toLowerCase(),
        )
      : undefined;
    if (input.publishStatus === 'published') {
      await this.assertPublishable(id);
    }
    const nextLifecycle =
      input.lifecycleStatus ??
      (existing.lifecycleStatus.toLowerCase() as 'available' | 'preorder' | 'discontinued');
    const effectiveTagCodes = tagSelection
      ? tagSelection.codes
      : (
          await this.prisma.productTag.findMany({
            where: { productId: id },
            select: { tag: { select: { code: true } } },
          })
        ).map((productTag) => productTag.tag.code);
    const flags = this.deriveMarketingFlags(effectiveTagCodes, nextLifecycle);

    let updated: { id: string; slug: string; publishStatus: string };
    try {
      updated = await this.prisma.$transaction(async (transaction) => {
        if (translationRows) {
          for (const translation of translationRows) {
            await transaction.productTranslation.upsert({
              where: { productId_locale: { productId: id, locale: translation.locale } },
              create: { productId: id, ...translation },
              update: {
                name: translation.name,
                description: translation.description,
                seoTitle: translation.seoTitle,
                seoDescription: translation.seoDescription,
              },
            });
          }
        }
        if (tagIds) {
          await transaction.productTag.deleteMany({ where: { productId: id } });
          if (tagIds.length > 0) {
            await transaction.productTag.createMany({
              data: tagIds.map((tagId) => ({ productId: id, tagId })),
              skipDuplicates: true,
            });
          }
        }
        return transaction.product.update({
          where: { id },
          data: {
            ...(input.slug !== undefined ? { slug: input.slug } : {}),
            ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
            ...(input.priceCny !== undefined ? { priceCny: input.priceCny } : {}),
            ...(input.lifecycleStatus
              ? { lifecycleStatus: LIFECYCLE_MAP[input.lifecycleStatus] }
              : {}),
            ...(input.publishStatus
              ? { publishStatus: PRODUCT_STATUS_MAP[input.publishStatus] }
              : {}),
            ...(lifecycleStatusItemId !== undefined ? { lifecycleStatusItemId } : {}),
            ...(publishStatusItemId !== undefined ? { publishStatusItemId } : {}),
            // Always written: the booleans are a derived, read-only mirror of
            // the marketing tags, so a lifecycle change recomputes them instead
            // of leaving two sources that can disagree.
            isNew: flags.isNew,
            isFeatured: flags.isFeatured,
            isPreOrder: flags.isPreOrder,
            ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
            ...(input.lengthMm !== undefined ? { lengthMm: input.lengthMm } : {}),
            ...(input.widthMm !== undefined ? { widthMm: input.widthMm } : {}),
            ...(input.heightMm !== undefined ? { heightMm: input.heightMm } : {}),
            ...(input.weightGrams !== undefined ? { weightGrams: input.weightGrams } : {}),
            ...(input.packaging !== undefined ? { packaging: input.packaging } : {}),
            ...(input.cartonLengthCm !== undefined ? { cartonLengthCm: input.cartonLengthCm } : {}),
            ...(input.cartonWidthCm !== undefined ? { cartonWidthCm: input.cartonWidthCm } : {}),
            ...(input.cartonHeightCm !== undefined ? { cartonHeightCm: input.cartonHeightCm } : {}),
            ...(input.cartonWeightKg !== undefined ? { cartonWeightKg: input.cartonWeightKg } : {}),
            ...(input.cartonQuantity !== undefined ? { cartonQuantity: input.cartonQuantity } : {}),
          },
          select: { id: true, slug: true, publishStatus: true },
        });
      });
    } catch (error) {
      this.rethrowProductUniqueConflict(error);
    }

    await this.audit.record({
      actorId,
      action: 'product.updated',
      entityType: 'product',
      entityId: id,
      requestId,
      // Field names only: an audit diff must never carry the internal price
      // (AGENTS.md B8, docs/24 §9).
      metadata: { fields: Object.keys(input).filter((field) => field !== 'priceCny') },
    });
    await this.images.revalidatePublicCatalogue('product_updated');
    return {
      id: updated.id,
      slug: updated.slug,
      publishStatus: updated.publishStatus.toLowerCase(),
    };
  }

  async setPublishStatus(
    id: string,
    publishStatus: 'draft' | 'published' | 'unpublished',
    actorId: string,
    requestId: string,
  ) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) throw ApiError.notFound('Product not found.');
    if (product.publishStatus === PRODUCT_STATUS_MAP[publishStatus]) {
      // Idempotent: re-sending the current status must not fail, so a retried
      // request after a network error is safe.
      return { id: product.id, publishStatus: product.publishStatus.toLowerCase() };
    }
    if (publishStatus === 'published') {
      await this.assertPublishable(id);
    }
    const publishStatusItemId = await this.resolveStatusItemId(
      DICTIONARY_TYPES.productPublishStatus,
      publishStatus,
      product.publishStatus.toLowerCase(),
    );
    const updated = await this.prisma.product.update({
      where: { id },
      data: { publishStatus: PRODUCT_STATUS_MAP[publishStatus], publishStatusItemId },
      select: { id: true, publishStatus: true },
    });
    await this.audit.record({
      actorId,
      action: publishStatus === 'published' ? 'product.published' : 'product.unpublished',
      entityType: 'product',
      entityId: id,
      requestId,
      metadata: { from: product.publishStatus, to: updated.publishStatus },
    });
    await this.images.revalidatePublicCatalogue('product_publish_status');
    return { id: updated.id, publishStatus: updated.publishStatus.toLowerCase() };
  }

  /**
   * Permanent delete of a whole product (docs/24 §8.1-§8.2).
   *
   * The request never touches the product row: it queues the physical removal of
   * every image object plus one aggregate task that deletes the product only
   * after all of them are confirmed gone. A Prisma cascade would drop the image
   * rows - and the only record of their storage keys - before any object was
   * removed.
   */
  async remove(id: string, actorId: string, requestId: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      select: { id: true, sku: true, publishStatus: true },
    });
    if (!product) throw ApiError.notFound('Product not found.');
    if (product.publishStatus === 'PUBLISHED') {
      throw new ApiError(
        ERROR_CODES.productNotDeletable,
        'An unpublished product is required before a permanent delete.',
        { status: 409, details: { publishStatus: product.publishStatus } },
      );
    }

    const plan = await this.images.planProductPurge(id, actorId, requestId);
    await this.audit.record({
      actorId,
      action: 'product.permanent_delete_requested',
      entityType: 'product',
      entityId: id,
      requestId,
      metadata: {
        sku: product.sku,
        operationId: plan.productOperationId,
        imageOperations: plan.imageOperations,
      },
    });
    return {
      accepted: true,
      productId: id,
      operationId: plan.productOperationId,
      imageOperations: plan.imageOperations,
    };
  }

  /** Used by quote exports; the caller decides whether prices may appear. */
  async resolveExportScope(filter: {
    categoryId?: string | null;
    includeDescendants?: boolean;
    publishStatus?: string;
    lifecycleStatus?: string;
    tag?: string;
    search?: string;
  }): Promise<string[]> {
    let categoryIds: string[] | null = null;
    if (filter.categoryId) {
      categoryIds =
        filter.includeDescendants === false
          ? [filter.categoryId]
          : await this.categories.getSubtreeIds(filter.categoryId);
    }
    const products = await this.prisma.product.findMany({
      where: {
        ...(categoryIds ? { categoryId: { in: categoryIds } } : {}),
        ...(filter.publishStatus
          ? {
              publishStatus:
                PRODUCT_STATUS_MAP[filter.publishStatus as keyof typeof PRODUCT_STATUS_MAP],
            }
          : {}),
        ...(filter.lifecycleStatus
          ? { lifecycleStatus: LIFECYCLE_MAP[filter.lifecycleStatus as keyof typeof LIFECYCLE_MAP] }
          : {}),
        ...(filter.tag ? { tags: { some: { tag: { code: filter.tag } } } } : {}),
        ...(filter.search
          ? {
              OR: [
                { sku: { contains: filter.search, mode: 'insensitive' as const } },
                {
                  translations: {
                    some: { name: { contains: filter.search, mode: 'insensitive' as const } },
                  },
                },
              ],
            }
          : {}),
      },
      orderBy: [{ sortOrder: 'asc' }, { sku: 'asc' }],
      select: { id: true },
    });
    return products.map((product) => product.id);
  }

  private async resolveCategoryScope(query: ProductListQueryInput): Promise<string[] | null> {
    let categoryId: string | null = null;
    if (query.categoryId) categoryId = query.categoryId;
    else if (query.categorySlug) {
      categoryId = await this.categories.resolveCategoryFilterId({
        categorySlug: query.categorySlug,
      });
    }
    if (!categoryId) return null;
    // Default behaviour for the catalog: include the node and all descendants.
    return query.includeDescendants === false
      ? [categoryId]
      : this.categories.getSubtreeIds(categoryId);
  }

  private buildAdminOrderBy(query: ProductListQueryInput) {
    const column = SORT_COLUMNS[query.sortBy] ?? 'updatedAt';
    const direction = query.sortOrder;
    return [{ [column]: direction }, { id: 'asc' as const }];
  }

  /**
   * `Parent / Child / Leaf` labels for the rows on this page.
   *
   * Paths are composed by fetching one level of ancestors at a time instead of
   * one query per product, so a list page never becomes an N+1 (docs/22 §7.3).
   */
  private async buildCategoryPaths(ids: string[]): Promise<Map<string, string>> {
    const labels = new Map<string, CategoryLabel>();
    let pending = new Set(ids);
    while (pending.size > 0) {
      const rows = await this.prisma.category.findMany({
        where: { id: { in: [...pending] } },
        select: {
          id: true,
          parentId: true,
          translations: { select: { locale: true, name: true } },
        },
      });
      if (rows.length === 0) break;
      const next = new Set<string>();
      for (const row of rows) {
        labels.set(row.id, {
          id: row.id,
          parentId: row.parentId,
          name:
            row.translations.find((translation) => translation.locale === PUBLIC_LOCALE)?.name ??
            row.translations[0]?.name ??
            row.id,
        });
        if (row.parentId && !labels.has(row.parentId)) next.add(row.parentId);
      }
      pending = next;
    }

    const paths = new Map<string, string>();
    for (const id of ids) {
      const chain: string[] = [];
      let current = labels.get(id);
      const guard = new Set<string>();
      while (current && !guard.has(current.id)) {
        guard.add(current.id);
        chain.unshift(current.name);
        current = current.parentId ? labels.get(current.parentId) : undefined;
      }
      paths.set(id, chain.length > 0 ? chain.join(' / ') : id);
    }
    return paths;
  }

  private async assertSkuFree(sku: string): Promise<void> {
    const existing = await this.prisma.product.findUnique({ where: { sku } });
    if (existing) {
      throw new ApiError(ERROR_CODES.productSkuConflict, 'This SKU is already in use.', {
        details: { sku: 'products.validation.skuTaken' },
      });
    }
  }

  private async assertSlugFree(slug: string): Promise<void> {
    const existing = await this.prisma.product.findUnique({ where: { slug } });
    if (existing) {
      throw new ApiError(
        ERROR_CODES.productSlugConflict,
        'This product URL slug is already in use.',
        { details: { slug: 'products.validation.slugTaken' } },
      );
    }
  }

  /**
   * Server-side candidate generation (docs/26 §3.4).
   *
   * The pre-check keeps generated values friendly; the unique index is still the
   * final concurrency guard in create/update.
   */
  async suggestSlug(input: ProductSlugSuggestionInput): Promise<ProductSlugSuggestion> {
    const attempts = input.strategy === 'name-random' ? 8 : 1;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const candidate = buildProductSlugCandidate(input.name, input.strategy);
      const existing = await this.prisma.product.findFirst({
        where: {
          slug: candidate,
          ...(input.excludeProductId ? { id: { not: input.excludeProductId } } : {}),
        },
        select: { id: true },
      });
      if (!existing) {
        return { slug: candidate, strategy: input.strategy, available: true };
      }
    }
    throw new ApiError(
      ERROR_CODES.productSlugSuggestionConflict,
      'A free product URL slug could not be generated.',
      { details: { slug: 'products.validation.slugTaken' } },
    );
  }

  /**
   * Converts a database unique-constraint race into the same field-level
   * conflict the pre-check produces. Checking first is not enough when two
   * administrators save the same slug concurrently.
   */
  private rethrowProductUniqueConflict(error: unknown): never {
    const mapped = productUniqueConstraintError(error);
    if (mapped) throw mapped;
    throw error;
  }

  /**
   * A product must be filed under a real, enabled category.
   *
   * The editor picks from the category tree, but the check is repeated here so a
   * direct API call cannot file a product under a disabled branch or a
   * hand-typed UUID (docs/22 §4.4, docs/24 §3.3 A).
   */
  private async assertCategoryUsable(categoryId: string): Promise<void> {
    const category = await this.prisma.category.findUnique({ where: { id: categoryId } });
    if (!category || !category.enabled) {
      throw ApiError.validation('The selected category does not exist or is disabled.', {
        categoryId: category ? 'product.category.disabled' : 'product.category.missing',
      });
    }
  }

  /**
   * Publishing needs one usable image.
   *
   * The storefront renders a cover image on every card, so publishing without
   * one would ship a broken card; the rule is enforced server-side (docs/24 §3.4).
   */
  private async assertPublishable(productId: string): Promise<void> {
    const usableImages = await this.prisma.productImage.count({
      where: { productId, deleteState: 'READY' },
    });
    if (!canPublishProduct(usableImages)) {
      throw new ApiError(
        ERROR_CODES.productPublishRequiresImage,
        'At least one usable image is required before publishing.',
        { status: 422, details: { images: 0 } },
      );
    }
  }

  /**
   * Resolves structured tag references.
   *
   * `tagIds` is the contract. `tagCodes` stays accepted so existing
   * integrations keep working, but both are validated against the tag table:
   * an unknown or free-text value can never create a product-tag link.
   */
  private async resolveTagIds(
    tagIds: string[],
    tagCodes?: string[],
  ): Promise<{ ids: string[]; codes: string[] }> {
    const codes = tagCodes ?? [];
    if (tagIds.length === 0 && codes.length === 0) return { ids: [], codes: [] };
    const tags = await this.prisma.tag.findMany({
      where: { OR: [{ id: { in: tagIds } }, { code: { in: codes } }] },
      select: { id: true, code: true },
    });
    const missingIds = tagIds.filter((tagId) => !tags.some((tag) => tag.id === tagId));
    const missingCodes = codes.filter((code) => !tags.some((tag) => tag.code === code));
    if (missingIds.length > 0 || missingCodes.length > 0) {
      throw ApiError.validation('Unknown tags.', {
        tagIds: missingIds.join(','),
        tagCodes: missingCodes.join(','),
      });
    }
    const resolvedIds = new Set<string>();
    const resolvedCodes = new Set<string>();
    for (const tag of tags) {
      if (tagIds.includes(tag.id) || codes.includes(tag.code)) {
        resolvedIds.add(tag.id);
        resolvedCodes.add(tag.code);
      }
    }
    return { ids: [...resolvedIds], codes: [...resolvedCodes] };
  }

  /**
   * Derives the legacy marketing booleans from the tags that are now their
   * single source of truth (后台商品管理页面优化与技术实施方案 §4.2).
   *
   * The pre-order home rail still requires a `PREORDER` lifecycle: the tag is a
   * curation/display decision, while the lifecycle is the business state, so the
   * two stay independent without contradicting each other.
   */
  private deriveMarketingFlags(
    tagCodes: string[],
    lifecycleStatus: 'available' | 'preorder' | 'discontinued',
  ): { isNew: boolean; isFeatured: boolean; isPreOrder: boolean } {
    return {
      isFeatured: tagCodes.includes(MARKETING_TAG_CODES.featured),
      isNew: tagCodes.includes(MARKETING_TAG_CODES.newArrival),
      isPreOrder: tagCodes.includes(MARKETING_TAG_CODES.preorder) && lifecycleStatus === 'preorder',
    };
  }

  /** English content is mandatory: the public storefront renders it. */
  private normalizeTranslations(
    translations: {
      locale: string;
      name: string;
      description?: string | null;
      seoTitle?: string | null;
      seoDescription?: string | null;
    }[],
  ) {
    const seen = new Set<string>();
    for (const translation of translations) {
      if (seen.has(translation.locale)) {
        throw ApiError.validation('The same locale was submitted twice.', {
          translations: 'product.translation.duplicate',
        });
      }
      seen.add(translation.locale);
    }
    if (!seen.has(PUBLIC_LOCALE)) {
      throw ApiError.validation('An English (en-US) translation is required.', {
        'translations.en-US': 'product.translation.englishRequired',
      });
    }
    return translations.map((translation) => ({
      locale: translation.locale,
      name: translation.name,
      description: translation.description ?? null,
      seoTitle: translation.seoTitle ?? null,
      seoDescription: translation.seoDescription ?? null,
    }));
  }

  private toAdminSummary(
    product: {
      id: string;
      sku: string;
      slug: string;
      categoryId: string | null;
      categoryPath: string | null;
      priceCny: { toString(): string } | null;
      publishStatus: string;
      lifecycleStatus: string;
      isNew: boolean;
      isFeatured: boolean;
      isPreOrder: boolean;
      sortOrder: number;
      updatedAt: Date;
      translations: { locale: string; name: string }[];
      category: { translations: { locale: string; name: string }[] } | null;
      images: SummaryImageRow[];
      tags: { tag: { id: string; code: string } }[];
    },
    canSeeCost: boolean,
  ): ProductAdminSummary {
    const english = product.translations.find(
      (translation) => translation.locale === PUBLIC_LOCALE,
    );
    const chinese = product.translations.find((translation) => translation.locale === 'zh-CN');
    const usableImages = product.images.filter((image) => image.deleteState === 'READY');
    const cover =
      usableImages.find((image) => image.isCover) ??
      [...usableImages].sort((left, right) => left.sortOrder - right.sortOrder)[0] ??
      null;
    return {
      id: product.id,
      sku: product.sku,
      slug: product.slug,
      name: english?.name ?? product.translations[0]?.name ?? product.sku,
      nameZh: chinese?.name ?? null,
      categoryId: product.categoryId,
      categoryName: this.pickCategoryName(product.category?.translations ?? []),
      categoryPath: product.categoryPath,
      publishStatus: product.publishStatus.toLowerCase() as ProductAdminSummary['publishStatus'],
      lifecycleStatus:
        product.lifecycleStatus.toLowerCase() as ProductAdminSummary['lifecycleStatus'],
      isNew: product.isNew,
      isFeatured: product.isFeatured,
      isPreOrder: product.isPreOrder,
      sortOrder: product.sortOrder,
      imageCount: usableImages.length,
      hasCover: cover !== null,
      coverImageUrl: cover
        ? cover.fileAssetId
          ? this.storage.adminProductImageUrl(cover.fileAssetId)
          : this.storage.publicUrl(cover.storageKey)
        : null,
      coverImageAlt: cover?.altText ?? null,
      pendingImageDeletes: product.images.filter((image) => image.deleteState !== 'READY').length,
      tagCodes: product.tags.map((productTag) => productTag.tag.code),
      tagIds: product.tags.map((productTag) => productTag.tag.id),
      priceCny: canSeeCost && product.priceCny !== null ? product.priceCny.toString() : null,
      priceVisible: canSeeCost,
      updatedAt: product.updatedAt.toISOString(),
    };
  }

  private pickCategoryName(translations: { locale: string; name: string }[]): string | null {
    if (translations.length === 0) return null;
    return (
      translations.find((translation) => translation.locale === PUBLIC_LOCALE)?.name ??
      translations[0]?.name ??
      null
    );
  }
}
