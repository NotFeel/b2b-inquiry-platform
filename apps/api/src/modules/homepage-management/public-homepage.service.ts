import { Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  type PublicHomepage,
  type PublicHomepageCollection,
  type PublicHomepageNewArrivals,
} from '@b2b/contracts';
import type { Prisma } from '@b2b/database';
import { ApiError } from '../../common/errors/api-error';
import { PrismaService } from '../../prisma/prisma.service';
import { CategoriesService } from '../categories/categories.service';
import {
  PUBLIC_PRODUCT_SELECT,
  PUBLIC_PRODUCT_WHERE,
  PublicCatalogService,
} from '../products/public-catalog.service';
import { HomepageManagementService } from './homepage-management.service';
import { resolveHomepageTranslation } from './homepage-management-policy';
import {
  HOMEPAGE_PRODUCT_BATCH_SIZE,
  decodeCollectionCursor,
  decodeNewArrivalsCursor,
  encodeHomepageCursor,
  homepageCursorInvalid,
} from './public-homepage-cursor';

const PUBLIC_COLLECTION_SELECT = {
  id: true,
  categoryId: true,
  productLimit: true,
  updatedAt: true,
  translations: { select: { locale: true, title: true, subtitle: true } },
  category: {
    select: {
      id: true,
      slug: true,
      translations: { select: { locale: true, name: true } },
    },
  },
} satisfies Prisma.HomepageCollectionSelect;

type PublicCollectionRow = Prisma.HomepageCollectionGetPayload<{
  select: typeof PUBLIC_COLLECTION_SELECT;
}>;

type SelectedCollectionProduct = Prisma.HomepageCollectionProductGetPayload<{
  select: {
    id: true;
    sortOrder: true;
    product: { select: typeof PUBLIC_PRODUCT_SELECT };
  };
}>;

/**
 * Public homepage data exit (docs/45 stage D).
 *
 * The service never redefines Product/Category visibility. Product cards come
 * from the catalogue projection and mapper; collection membership only adds
 * the configured order, exact-category scope, enabled configuration, and the
 * cross-section New Arrivals exclusion.
 */
@Injectable()
export class PublicHomepageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: PublicCatalogService,
    private readonly categories: CategoriesService,
    private readonly homepageConfig: HomepageManagementService,
  ) {}

  async getHomepage(locale: string): Promise<PublicHomepage> {
    const config = await this.homepageConfig.getDisplayConfig();
    const [newArrivals, collectionRows, excludedNewArrivalIds] = await Promise.all([
      this.loadNewArrivalsBatch(config.newArrivalsLimit, locale),
      config.enabled
        ? this.prisma.homepageCollection.findMany({
            where: { enabled: true },
            select: PUBLIC_COLLECTION_SELECT,
            orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          })
        : Promise.resolve([] as PublicCollectionRow[]),
      config.enabled
        ? this.loadDisplayedNewArrivalIds(config.newArrivalsLimit)
        : Promise.resolve([] as string[]),
    ]);

    const publicCategoryIds = await this.categories.filterPublicCategoryIds(
      collectionRows.map((row) => row.categoryId),
    );
    const visibleCollections = collectionRows.filter((row) =>
      publicCategoryIds.has(row.categoryId),
    );
    const collections = await Promise.all(
      visibleCollections.map((row) =>
        this.loadCollectionBatch(row, locale, undefined, excludedNewArrivalIds),
      ),
    );

    return { enabled: config.enabled, newArrivals, collections };
  }

  async getNewArrivals(locale: string, cursor?: string): Promise<PublicHomepageNewArrivals> {
    const config = await this.homepageConfig.getDisplayConfig();
    return this.loadNewArrivalsBatch(config.newArrivalsLimit, locale, cursor);
  }

  async getCollectionProducts(
    id: string,
    locale: string,
    cursor?: string,
  ): Promise<PublicHomepageCollection> {
    const config = await this.homepageConfig.getDisplayConfig();
    if (!config.enabled) throw this.collectionNotFound();

    const row = await this.prisma.homepageCollection.findFirst({
      where: { id, enabled: true },
      select: PUBLIC_COLLECTION_SELECT,
    });
    if (!row) throw this.collectionNotFound();

    const publicCategoryIds = await this.categories.filterPublicCategoryIds([row.categoryId]);
    if (!publicCategoryIds.has(row.categoryId)) throw this.collectionNotFound();
    const excludedNewArrivalIds = await this.loadDisplayedNewArrivalIds(config.newArrivalsLimit);
    return this.loadCollectionBatch(row, locale, cursor, excludedNewArrivalIds);
  }

  /**
   * The cross-section boundary is the set of products that can actually appear
   * in New Arrivals under the current configured total, not every product with
   * `isNew = true` (docs/45 §0.2).
   */
  private async loadDisplayedNewArrivalIds(limit: number): Promise<string[]> {
    const rows = await this.prisma.product.findMany({
      where: { ...PUBLIC_PRODUCT_WHERE, isNew: true },
      orderBy: [{ sortOrder: 'asc' }, { sku: 'asc' }],
      take: limit,
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  private async loadNewArrivalsBatch(
    limit: number,
    locale: string,
    rawCursor?: string,
  ): Promise<PublicHomepageNewArrivals> {
    const cursor = decodeNewArrivalsCursor(rawCursor);
    if (cursor && cursor.configuredLimit !== limit) throw homepageCursorInvalid();

    const returned = cursor?.returned ?? 0;
    if (returned >= limit) {
      return { limit, products: [], nextCursor: null, hasMore: false };
    }

    const pageSize = Math.min(HOMEPAGE_PRODUCT_BATCH_SIZE, limit - returned);
    const where: Prisma.ProductWhereInput = {
      ...PUBLIC_PRODUCT_WHERE,
      isNew: true,
      ...(cursor
        ? {
            OR: [
              { sortOrder: { gt: cursor.afterSortOrder } },
              {
                sortOrder: cursor.afterSortOrder,
                sku: { gt: cursor.afterSku },
              },
            ],
          }
        : {}),
    };
    const rows = await this.prisma.product.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { sku: 'asc' }],
      take: pageSize + 1,
      select: PUBLIC_PRODUCT_SELECT,
    });

    const products = rows.slice(0, pageSize);
    const nextReturned = returned + products.length;
    const hasMore = rows.length > pageSize && nextReturned < limit;
    const last = products.at(-1);
    return {
      limit,
      products: products.map((product) => this.catalog.toPublicCard(product, locale)),
      hasMore,
      nextCursor:
        hasMore && last
          ? encodeHomepageCursor({
              version: 1,
              kind: 'new-arrivals',
              configuredLimit: limit,
              returned: nextReturned,
              afterSortOrder: last.sortOrder,
              afterSku: last.sku,
            })
          : null,
    };
  }

  private async loadCollectionBatch(
    row: PublicCollectionRow,
    locale: string,
    rawCursor?: string,
    excludedNewArrivalIds: readonly string[] = [],
  ): Promise<PublicHomepageCollection> {
    const cursor = decodeCollectionCursor(rawCursor);
    const updatedAt = row.updatedAt.toISOString();
    if (
      cursor &&
      (cursor.collectionId !== row.id ||
        cursor.collectionUpdatedAt !== updatedAt ||
        cursor.productLimit !== row.productLimit)
    ) {
      throw homepageCursorInvalid();
    }

    const returned = cursor?.returned ?? 0;
    const translation = resolveHomepageTranslation(row.translations, locale);
    const metadata = {
      id: row.id,
      categoryId: row.categoryId,
      categorySlug: row.category.slug,
      title: translation.title,
      subtitle: translation.subtitle,
      productLimit: row.productLimit,
    };
    if (returned >= row.productLimit) {
      return { ...metadata, products: [], nextCursor: null, hasMore: false };
    }

    const pageSize = Math.min(HOMEPAGE_PRODUCT_BATCH_SIZE, row.productLimit - returned);
    const where: Prisma.HomepageCollectionProductWhereInput = {
      collectionId: row.id,
      ...(cursor
        ? {
            OR: [
              { sortOrder: { gt: cursor.afterSortOrder } },
              {
                sortOrder: cursor.afterSortOrder,
                id: { gt: cursor.afterId },
              },
            ],
          }
        : {}),
      product: {
        is: {
          ...PUBLIC_PRODUCT_WHERE,
          categoryId: row.categoryId,
          ...(excludedNewArrivalIds.length > 0
            ? { id: { notIn: [...excludedNewArrivalIds] } }
            : {}),
        },
      },
    };
    const rows = await this.prisma.homepageCollectionProduct.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      take: pageSize + 1,
      select: {
        id: true,
        sortOrder: true,
        product: { select: PUBLIC_PRODUCT_SELECT },
      },
    });

    const selected = rows.slice(0, pageSize) as SelectedCollectionProduct[];
    const nextReturned = returned + selected.length;
    const hasMore = rows.length > pageSize && nextReturned < row.productLimit;
    const last = selected.at(-1);
    return {
      ...metadata,
      products: selected.map((entry) => this.catalog.toPublicCard(entry.product, locale)),
      hasMore,
      nextCursor:
        hasMore && last
          ? encodeHomepageCursor({
              version: 1,
              kind: 'collection',
              collectionId: row.id,
              collectionUpdatedAt: updatedAt,
              productLimit: row.productLimit,
              returned: nextReturned,
              afterSortOrder: last.sortOrder,
              afterId: last.id,
            })
          : null,
    };
  }

  private collectionNotFound(): ApiError {
    return new ApiError(ERROR_CODES.homepageCollectionNotFound, 'Homepage collection not found.');
  }
}
