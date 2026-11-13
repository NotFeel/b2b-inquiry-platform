import { Inject, Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  type ErrorCode,
  type HomepageCollectionDetail,
  type HomepageCollectionProductSummary,
  type HomepageCollectionSummary,
  type HomepageDisplayConfigSummary,
} from '@b2b/contracts';
import type {
  CreateHomepageCollectionInput,
  HomepageCollectionListQueryInput,
  SortHomepageCollectionsInput,
  UpdateHomepageCollectionInput,
  UpdateHomepageCollectionProductsInput,
  UpdateHomepageDisplayConfigInput,
} from '@b2b/validation';
import { Prisma } from '@b2b/database';
import { APP_ENV, type AppEnv } from '../../config/config.module';
import { ApiError } from '../../common/errors/api-error';
import { JsonLogger } from '../../common/logger.service';
import { AuditService } from '../../common/services/audit.service';
import { StorageService } from '../../common/services/storage.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  HOMEPAGE_DISPLAY_CONFIG_KEY,
  HOMEPAGE_SORT_STEP,
  assertCompleteCollectionOrder,
  assertHomepageCollectionNotModified,
  assertHomepageConfigNotModified,
  assertProductsBelongToCategory,
  assertSelectedProductCount,
  assertUniqueProductIds,
  productSortOrders,
  resolveHomepageTranslation,
} from './homepage-management-policy';

const COLLECTION_INCLUDE = {
  category: {
    select: {
      id: true,
      code: true,
      slug: true,
      enabled: true,
      visible: true,
      translations: { select: { locale: true, name: true } },
    },
  },
  translations: { select: { locale: true, title: true, subtitle: true } },
  _count: { select: { products: true } },
} satisfies Prisma.HomepageCollectionInclude;

const COLLECTION_DETAIL_INCLUDE = {
  ...COLLECTION_INCLUDE,
  products: {
    select: {
      productId: true,
      sortOrder: true,
      product: {
        select: {
          id: true,
          sku: true,
          categoryId: true,
          publishStatus: true,
          lifecycleStatus: true,
          translations: { select: { locale: true, name: true } },
          images: {
            select: {
              fileAssetId: true,
              storageKey: true,
              altText: true,
              sortOrder: true,
              isCover: true,
              deleteState: true,
            },
            orderBy: [{ sortOrder: 'asc' }, { fileAssetId: 'asc' }],
          },
        },
      },
    },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
  },
} satisfies Prisma.HomepageCollectionInclude;

type CollectionRow = Prisma.HomepageCollectionGetPayload<{ include: typeof COLLECTION_INCLUDE }>;
type CollectionDetailRow = Prisma.HomepageCollectionGetPayload<{
  include: typeof COLLECTION_DETAIL_INCLUDE;
}>;

const PUBLISH_STATUS_MAP = {
  DRAFT: 'draft',
  PUBLISHED: 'published',
  UNPUBLISHED: 'unpublished',
} as const;

const LIFECYCLE_STATUS_MAP = {
  AVAILABLE: 'available',
  PREORDER: 'preorder',
  DISCONTINUED: 'discontinued',
} as const;

/**
 * Minimal image projection safe to expose to the Admin collection editor.
 *
 * `storageKey` stays server-side: it only feeds `StorageService` and is never
 * serialised into the response.
 */
interface CollectionCoverImageRow {
  fileAssetId: string | null;
  storageKey: string;
  altText: string | null;
  sortOrder: number;
  isCover: boolean;
  deleteState: string;
}

/** Mirrors the Admin product list cover rule: READY images, cover first. */
function resolveCollectionCoverImage(
  images: CollectionCoverImageRow[],
): CollectionCoverImageRow | null {
  const usable = images.filter((image) => image.deleteState === 'READY');
  return (
    usable.find((image) => image.isCover) ??
    [...usable].sort((left, right) => left.sortOrder - right.sortOrder)[0] ??
    null
  );
}

/**
 * Admin Homepage configuration (docs/45 stage C).
 *
 * Configured totals have no business cap beyond PostgreSQL INTEGER. Product
 * visibility is resolved by the later public aggregate; this Service only
 * validates that an Admin-selected product currently belongs to the selected
 * Category. Category/Product master data is never copied or deleted here.
 */
@Injectable()
export class HomepageManagementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly logger: JsonLogger,
    private readonly storage: StorageService,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  // -------------------------------------------------------- singleton config

  async getDisplayConfig(): Promise<HomepageDisplayConfigSummary> {
    const select = { newArrivalsLimit: true, enabled: true, updatedAt: true } as const;
    let row: { newArrivalsLimit: number; enabled: boolean; updatedAt: Date };
    try {
      row = await this.prisma.homepageDisplayConfig.upsert({
        where: { configKey: HOMEPAGE_DISPLAY_CONFIG_KEY },
        create: {
          configKey: HOMEPAGE_DISPLAY_CONFIG_KEY,
          newArrivalsLimit: 12,
          enabled: true,
        },
        update: {},
        select,
      });
    } catch (error) {
      if (!this.isUniqueConflict(error)) throw error;
      const existing = await this.prisma.homepageDisplayConfig.findUnique({
        where: { configKey: HOMEPAGE_DISPLAY_CONFIG_KEY },
        select,
      });
      if (!existing) throw error;
      row = existing;
    }
    return this.toConfigSummary(row);
  }

  async updateDisplayConfig(
    input: UpdateHomepageDisplayConfigInput,
    actorId: string,
    requestId: string,
  ): Promise<HomepageDisplayConfigSummary> {
    const result = await this.withSerializableTransaction(async (tx) => {
      const current = await tx.homepageDisplayConfig.upsert({
        where: { configKey: HOMEPAGE_DISPLAY_CONFIG_KEY },
        create: {
          configKey: HOMEPAGE_DISPLAY_CONFIG_KEY,
          newArrivalsLimit: 12,
          enabled: true,
        },
        update: {},
      });
      assertHomepageConfigNotModified(current.updatedAt, input.expectedUpdatedAt);

      const updated = await tx.homepageDisplayConfig.update({
        where: { configKey: HOMEPAGE_DISPLAY_CONFIG_KEY },
        data: {
          newArrivalsLimit: input.newArrivalsLimit,
          ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        },
        select: { newArrivalsLimit: true, enabled: true, updatedAt: true },
      });
      return { current, updated };
    }, ERROR_CODES.homepageConfigConcurrentUpdate);

    await this.audit.record({
      actorId,
      action: 'homepage.config.update',
      entityType: 'homepage_display_config',
      entityId: HOMEPAGE_DISPLAY_CONFIG_KEY,
      requestId,
      metadata: {
        newArrivalsLimit: {
          from: result.current.newArrivalsLimit,
          to: result.updated.newArrivalsLimit,
        },
        enabled: { from: result.current.enabled, to: result.updated.enabled },
      },
    });
    await this.revalidatePublicHomepage('config_updated');
    return this.toConfigSummary(result.updated);
  }

  // -------------------------------------------------------------- collection

  async listCollections(query: HomepageCollectionListQueryInput) {
    const rows = await this.prisma.homepageCollection.findMany({
      include: COLLECTION_INCLUDE,
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
    return { data: rows.map((row) => this.toCollectionSummary(row, query.locale)) };
  }

  async getCollection(id: string, locale: string): Promise<HomepageCollectionDetail> {
    const row = await this.prisma.homepageCollection.findUnique({
      where: { id },
      include: COLLECTION_DETAIL_INCLUDE,
    });
    if (!row) throw this.collectionNotFound();
    return this.toCollectionDetail(row, locale);
  }

  async createCollection(
    input: CreateHomepageCollectionInput,
    actorId: string,
    requestId: string,
  ): Promise<HomepageCollectionDetail> {
    await this.assertCategoryExists(input.categoryId);
    const existing = await this.prisma.homepageCollection.findUnique({
      where: { categoryId: input.categoryId },
      select: { id: true },
    });
    if (existing) throw this.categoryCollectionConflict(input.categoryId);

    let created: { id: string };
    try {
      created = await this.prisma.homepageCollection.create({
        data: {
          categoryId: input.categoryId,
          enabled: input.enabled,
          sortOrder: input.sortOrder ?? 0,
          productLimit: input.productLimit,
          translations: {
            create: input.translations.map((translation) => ({
              locale: translation.locale,
              title: translation.title,
              subtitle: translation.subtitle ?? null,
            })),
          },
        },
        select: { id: true },
      });
    } catch (error) {
      if (this.isUniqueConflict(error)) throw this.categoryCollectionConflict(input.categoryId);
      throw error;
    }

    await this.audit.record({
      actorId,
      action: 'homepage.collection.create',
      entityType: 'homepage_collection',
      entityId: created.id,
      requestId,
      metadata: {
        categoryId: input.categoryId,
        enabled: input.enabled,
        sortOrder: input.sortOrder ?? 0,
        productLimit: input.productLimit,
        locales: input.translations.map((translation) => translation.locale),
      },
    });
    await this.revalidatePublicHomepage('collection_created');
    return this.getCollection(created.id, 'en-US');
  }

  async updateCollection(
    id: string,
    input: UpdateHomepageCollectionInput,
    actorId: string,
    requestId: string,
  ): Promise<HomepageCollectionDetail> {
    const result = await this.withSerializableTransaction(async (tx) => {
      const current = await tx.homepageCollection.findUnique({
        where: { id },
        include: {
          translations: { select: { locale: true, title: true, subtitle: true } },
          _count: { select: { products: true } },
        },
      });
      if (!current) throw this.collectionNotFound();
      assertHomepageCollectionNotModified(current.updatedAt, input.expectedUpdatedAt);

      const nextCategoryId = input.categoryId ?? current.categoryId;
      const nextProductLimit = input.productLimit ?? current.productLimit;
      if (nextCategoryId !== current.categoryId) {
        await this.assertCategoryExists(nextCategoryId, tx);
        if (current._count.products > 0) {
          throw new ApiError(
            ERROR_CODES.homepageCollectionCategoryChangeBlocked,
            'Remove the selected products before changing the collection category.',
            { details: { selectedProductCount: current._count.products } },
          );
        }
        const duplicate = await tx.homepageCollection.findUnique({
          where: { categoryId: nextCategoryId },
          select: { id: true },
        });
        if (duplicate && duplicate.id !== id) throw this.categoryCollectionConflict(nextCategoryId);
      }
      assertSelectedProductCount(current._count.products, nextProductLimit);

      if (input.translations) {
        await tx.homepageCollectionTranslation.deleteMany({ where: { collectionId: id } });
        await tx.homepageCollectionTranslation.createMany({
          data: input.translations.map((translation) => ({
            collectionId: id,
            locale: translation.locale,
            title: translation.title,
            subtitle: translation.subtitle ?? null,
          })),
        });
      }
      let updated: { updatedAt: Date };
      try {
        updated = await tx.homepageCollection.update({
          where: { id },
          data: {
            ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
            ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
            ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
            ...(input.productLimit !== undefined ? { productLimit: input.productLimit } : {}),
          },
          select: { updatedAt: true },
        });
      } catch (error) {
        // Two concurrent category moves can both pass the pre-check. The
        // database's unique constraint is authoritative; preserve the normal
        // conflict response instead of leaking a Prisma error as HTTP 500.
        if (nextCategoryId !== current.categoryId && this.isUniqueConflict(error)) {
          throw this.categoryCollectionConflict(nextCategoryId);
        }
        throw error;
      }
      return { current, updated };
    });

    await this.audit.record({
      actorId,
      action: 'homepage.collection.update',
      entityType: 'homepage_collection',
      entityId: id,
      requestId,
      metadata: {
        ...(input.categoryId !== undefined
          ? { categoryId: { from: result.current.categoryId, to: input.categoryId } }
          : {}),
        ...(input.enabled !== undefined
          ? { enabled: { from: result.current.enabled, to: input.enabled } }
          : {}),
        ...(input.sortOrder !== undefined
          ? { sortOrder: { from: result.current.sortOrder, to: input.sortOrder } }
          : {}),
        ...(input.productLimit !== undefined
          ? { productLimit: { from: result.current.productLimit, to: input.productLimit } }
          : {}),
        ...(input.translations
          ? { locales: input.translations.map((translation) => translation.locale) }
          : {}),
      },
    });
    await this.revalidatePublicHomepage('collection_updated');
    return this.getCollection(id, 'en-US');
  }

  /** Complete collection order in one retryable serializable transaction. */
  async sortCollections(
    input: SortHomepageCollectionsInput,
    actorId: string,
    requestId: string,
  ): Promise<{ reordered: number }> {
    await this.withSerializableTransaction(async (tx) => {
      const rows = await tx.homepageCollection.findMany({ select: { id: true } });
      assertCompleteCollectionOrder(
        input.orderedIds,
        rows.map((row) => row.id),
      );
      for (const [index, id] of input.orderedIds.entries()) {
        await tx.homepageCollection.update({
          where: { id },
          data: { sortOrder: (index + 1) * HOMEPAGE_SORT_STEP },
        });
      }
    });

    await this.audit.record({
      actorId,
      action: 'homepage.collection.reorder',
      entityType: 'homepage_collection',
      entityId: null,
      requestId,
      metadata: { orderedIds: input.orderedIds },
    });
    await this.revalidatePublicHomepage('collections_reordered');
    return { reordered: input.orderedIds.length };
  }

  /** Removes only the display configuration; Category and Product remain. */
  async removeCollection(
    id: string,
    actorId: string,
    requestId: string,
  ): Promise<{ deleted: true }> {
    const deleted = await this.withSerializableTransaction(async (tx) => {
      const current = await tx.homepageCollection.findUnique({
        where: { id },
        include: {
          translations: { select: { locale: true, title: true, subtitle: true } },
          _count: { select: { products: true } },
        },
      });
      if (!current) throw this.collectionNotFound();
      await tx.homepageCollection.delete({ where: { id } });
      return current;
    });

    await this.audit.record({
      actorId,
      action: 'homepage.collection.delete',
      entityType: 'homepage_collection',
      entityId: id,
      requestId,
      metadata: {
        categoryId: deleted.categoryId,
        selectedProductCount: deleted._count.products,
        translations: deleted.translations,
      },
    });
    await this.revalidatePublicHomepage('collection_deleted');
    return { deleted: true };
  }

  // ------------------------------------------------------ selected products

  /** Atomically replaces selection and display order (docs/45 §4.4). */
  async updateProducts(
    id: string,
    input: UpdateHomepageCollectionProductsInput,
    actorId: string,
    requestId: string,
  ): Promise<HomepageCollectionDetail> {
    const productIds = input.products.map((item) => item.productId);
    assertUniqueProductIds(productIds);

    const result = await this.withSerializableTransaction(async (tx) => {
      const collection = await tx.homepageCollection.findUnique({
        where: { id },
        select: { id: true, categoryId: true, productLimit: true, updatedAt: true },
      });
      if (!collection) throw this.collectionNotFound();
      assertHomepageCollectionNotModified(collection.updatedAt, input.expectedUpdatedAt);
      assertSelectedProductCount(productIds.length, collection.productLimit);

      const products =
        productIds.length === 0
          ? []
          : await tx.product.findMany({
              where: { id: { in: productIds } },
              select: { id: true, categoryId: true },
            });
      const found = new Set(products.map((product) => product.id));
      const missing = productIds.filter((productId) => !found.has(productId));
      if (missing.length > 0) {
        throw new ApiError(
          ERROR_CODES.productNotFound,
          'One or more selected products do not exist.',
          {
            details: { productIds: missing },
          },
        );
      }
      assertProductsBelongToCategory(products, collection.categoryId);

      await tx.homepageCollectionProduct.deleteMany({ where: { collectionId: id } });
      if (input.products.length > 0) {
        const sortOrders = productSortOrders(input.products);
        await tx.homepageCollectionProduct.createMany({
          data: input.products.map((product, index) => ({
            collectionId: id,
            productId: product.productId,
            sortOrder: sortOrders[index],
          })),
        });
      }
      // A deterministic updatedAt token changes even when the new selection is
      // empty, so the next optimistic write cannot reuse a stale token.
      await tx.homepageCollection.update({
        where: { id },
        data: { productLimit: collection.productLimit },
        select: { id: true },
      });
      return { previousUpdatedAt: collection.updatedAt, productIds };
    });

    await this.audit.record({
      actorId,
      action: 'homepage.collection.products.update',
      entityType: 'homepage_collection',
      entityId: id,
      requestId,
      metadata: {
        previousUpdatedAt: result.previousUpdatedAt.toISOString(),
        selectedProductIds: result.productIds,
      },
    });
    await this.revalidatePublicHomepage('collection_products_updated');
    return this.getCollection(id, 'en-US');
  }

  // ----------------------------------------------------------------- helpers

  private async assertCategoryExists(
    categoryId: string,
    client: Pick<PrismaService, 'category'> = this.prisma,
  ): Promise<void> {
    const category = await client.category.findUnique({
      where: { id: categoryId },
      select: { id: true },
    });
    if (!category) {
      throw new ApiError(
        ERROR_CODES.homepageCollectionCategoryInvalid,
        'The selected homepage collection category does not exist.',
        { details: { categoryId } },
      );
    }
  }

  /**
   * Storefront homepage cache invalidation (docs/45 §4.3, stage D).
   *
   * Product/category mutations already invalidate their own catalogue tags.
   * Homepage-specific mutations additionally invalidate the aggregate response
   * so the next visitor sees the new section order and configured totals.
   * A missing secret leaves the ISR TTL as the fallback; a webhook failure must
   * not turn an already-committed configuration change into an API error.
   */
  private async revalidatePublicHomepage(reason: string): Promise<void> {
    const secret = this.env.REVALIDATE_SECRET;
    if (!secret) {
      this.logger.info('homepage.revalidate_skipped', {
        reason,
        cause: 'REVALIDATE_SECRET is not configured',
      });
      return;
    }
    try {
      const response = await fetch(`${this.env.APP_BASE_URL}/api/revalidate?tag=homepage`, {
        method: 'POST',
        headers: { 'x-revalidate-secret': secret },
      });
      if (!response.ok) {
        this.logger.warn('homepage.revalidate_failed', { reason, status: response.status });
      }
    } catch (error) {
      this.logger.warn('homepage.revalidate_failed', {
        reason,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private toConfigSummary(row: {
    newArrivalsLimit: number;
    enabled: boolean;
    updatedAt: Date;
  }): HomepageDisplayConfigSummary {
    return {
      newArrivalsLimit: row.newArrivalsLimit,
      enabled: row.enabled,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toCollectionSummary(row: CollectionRow, locale: string): HomepageCollectionSummary {
    const translation = resolveHomepageTranslation(row.translations, locale);
    const categoryName =
      row.category.translations.find((item) => item.locale === locale)?.name ??
      row.category.translations.find((item) => item.locale === 'en-US')?.name ??
      row.category.translations[0]?.name ??
      row.category.code;
    return {
      id: row.id,
      categoryId: row.categoryId,
      categoryCode: row.category.code,
      categorySlug: row.category.slug,
      categoryName,
      categoryEnabled: row.category.enabled,
      categoryVisible: row.category.visible,
      enabled: row.enabled,
      sortOrder: row.sortOrder,
      productLimit: row.productLimit,
      title: translation.title,
      subtitle: translation.subtitle,
      translations: row.translations.map((item) => ({ ...item })),
      selectedProductCount: row._count.products,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toCollectionDetail(row: CollectionDetailRow, locale: string): HomepageCollectionDetail {
    const summary = this.toCollectionSummary(row, locale);
    return {
      ...summary,
      products: row.products.map((item) => this.toProductSummary(item.product, item.sortOrder)),
    };
  }

  private toProductSummary(
    product: CollectionDetailRow['products'][number]['product'],
    sortOrder: number,
  ): HomepageCollectionProductSummary {
    const name =
      product.translations.find((translation) => translation.locale === 'en-US')?.name ??
      product.translations[0]?.name ??
      product.sku;
    const cover = resolveCollectionCoverImage(product.images);
    return {
      productId: product.id,
      sku: product.sku,
      name,
      categoryId: product.categoryId,
      publishStatus: PUBLISH_STATUS_MAP[product.publishStatus],
      lifecycleStatus: LIFECYCLE_STATUS_MAP[product.lifecycleStatus],
      sortOrder,
      coverImageUrl: cover
        ? cover.fileAssetId
          ? this.storage.adminProductImageUrl(cover.fileAssetId)
          : this.storage.publicUrl(cover.storageKey)
        : null,
      coverImageAlt: cover?.altText ?? null,
    };
  }

  private collectionNotFound(): ApiError {
    return new ApiError(ERROR_CODES.homepageCollectionNotFound, 'Homepage collection not found.');
  }

  private categoryCollectionConflict(categoryId: string): ApiError {
    return new ApiError(
      ERROR_CODES.homepageCollectionCategoryConflict,
      'This category already has a homepage collection.',
      { details: { categoryId } },
    );
  }

  private isUniqueConflict(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }

  private isWriteConflict(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034';
  }

  /**
   * Serializable retry handles category uniqueness and full-order writes as one
   * unit. A repeated P2034 is surfaced as a stable concurrent-update code.
   */
  private async withSerializableTransaction<T>(
    work: (tx: Prisma.TransactionClient) => Promise<T>,
    conflictCode: ErrorCode = ERROR_CODES.homepageCollectionConcurrentUpdate,
  ): Promise<T> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await this.prisma.$transaction(work, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error) {
        if (attempt === 0 && this.isWriteConflict(error)) continue;
        if (this.isWriteConflict(error)) {
          throw new ApiError(
            conflictCode,
            'Another administrator changed the homepage configuration. Reload and retry.',
          );
        }
        throw error;
      }
    }
    throw new ApiError(
      conflictCode,
      'Concurrent homepage configuration detected. Reload and retry.',
    );
  }
}
