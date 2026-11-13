import { describe, expect, it, vi } from 'vitest';
import { ERROR_CODES, type PublicProductCard } from '@b2b/contracts';
import type { PrismaService } from '../../prisma/prisma.service';
import type { CategoriesService } from '../categories/categories.service';
import type { PublicCatalogService } from '../products/public-catalog.service';
import type { HomepageManagementService } from './homepage-management.service';
import { PUBLIC_PRODUCT_WHERE } from '../products/public-catalog.service';
import { encodeHomepageCursor } from './public-homepage-cursor';
import { PublicHomepageService } from './public-homepage.service';

const CATEGORY_ID = 'df63681e-6377-4ea4-8fef-64459c7b0964';
const OTHER_CATEGORY_ID = 'b227f71f-7145-4a67-812f-0c3a6fca340c';
const COLLECTION_ID = '843498b1-3dc9-4137-97fa-ff64854be803';
const UPDATED_AT = new Date('2026-11-12T15:30:00.000Z');

type PublishStatus = 'DRAFT' | 'PUBLISHED' | 'UNPUBLISHED';
type LifecycleStatus = 'AVAILABLE' | 'PREORDER' | 'DISCONTINUED';

interface ProductFixture {
  id: string;
  sku: string;
  slug: string;
  categoryId: string | null;
  sortOrder: number;
  isNew: boolean;
  publishStatus: PublishStatus;
  lifecycleStatus: LifecycleStatus;
}

interface CollectionFixture {
  id: string;
  categoryId: string;
  enabled: boolean;
  sortOrder: number;
  productLimit: number;
  updatedAt: Date;
  translations: { locale: string; title: string; subtitle: string | null }[];
  category: {
    id: string;
    slug: string;
    translations: { locale: string; name: string }[];
  };
}

interface MembershipFixture {
  id: string;
  sortOrder: number;
  product: ProductFixture;
}

interface ProductWhere {
  publishStatus?: PublishStatus;
  lifecycleStatus?: { not: LifecycleStatus };
  isNew?: boolean;
  categoryId?: string;
  id?: { notIn: string[] };
  OR?: ProductCursorCondition[];
}

type ProductCursorCondition =
  { sortOrder: { gt: number } } | { sortOrder: number; sku: { gt: string } };

interface MembershipWhere {
  collectionId: string;
  OR?: MembershipCursorCondition[];
  product?: { is?: ProductWhere };
}

type MembershipCursorCondition =
  { sortOrder: { gt: number } } | { sortOrder: number; id: { gt: string } };

interface HarnessOptions {
  newArrivalsLimit?: number;
  enabled?: boolean;
  arrivals?: ProductFixture[];
  collections?: CollectionFixture[];
  memberships?: Map<string, MembershipFixture[]>;
  publicCategoryIds?: Set<string>;
}

function uuidFor(prefix: number, index: number): string {
  return `${prefix.toString(16).padStart(8, '0')}-0000-4000-8000-${index
    .toString(16)
    .padStart(12, '0')}`;
}

function product(index: number, overrides: Partial<ProductFixture> = {}): ProductFixture {
  return {
    id: uuidFor(1, index),
    sku: `SKU-${String(index).padStart(6, '0')}`,
    slug: `product-${index}`,
    categoryId: CATEGORY_ID,
    sortOrder: Math.floor(index / 4),
    isNew: false,
    publishStatus: 'PUBLISHED',
    lifecycleStatus: 'AVAILABLE',
    ...overrides,
  };
}

function collection(overrides: Partial<CollectionFixture> = {}): CollectionFixture {
  return {
    id: COLLECTION_ID,
    categoryId: CATEGORY_ID,
    enabled: true,
    sortOrder: 10,
    productLimit: 120,
    updatedAt: UPDATED_AT,
    translations: [{ locale: 'en-US', title: 'Collection', subtitle: null }],
    category: {
      id: CATEGORY_ID,
      slug: 'collection',
      translations: [{ locale: 'en-US', name: 'Collection' }],
    },
    ...overrides,
  };
}

function matchesProduct(row: ProductFixture, where: ProductWhere): boolean {
  if (where.publishStatus && row.publishStatus !== where.publishStatus) return false;
  if (where.lifecycleStatus?.not && row.lifecycleStatus === where.lifecycleStatus.not) {
    return false;
  }
  if (where.isNew !== undefined && row.isNew !== where.isNew) return false;
  if (where.categoryId && row.categoryId !== where.categoryId) return false;
  if (where.id?.notIn.includes(row.id)) return false;
  if (!where.OR) return true;
  return where.OR.some((condition) => {
    if ('sku' in condition) {
      return row.sortOrder === condition.sortOrder && row.sku > condition.sku.gt;
    }
    return row.sortOrder > condition.sortOrder.gt;
  });
}

function matchesMembershipCursor(row: MembershipFixture, where: MembershipWhere): boolean {
  if (!where.OR) return true;
  return where.OR.some((condition) => {
    if ('id' in condition) {
      return row.sortOrder === condition.sortOrder && row.id > condition.id.gt;
    }
    return row.sortOrder > condition.sortOrder.gt;
  });
}

function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function createHarness(options: HarnessOptions = {}) {
  const arrivals = options.arrivals ?? [];
  const collections = options.collections ?? [];
  const memberships = options.memberships ?? new Map<string, MembershipFixture[]>();
  const publicCategoryIds =
    options.publicCategoryIds ?? new Set(collections.map((row) => row.categoryId));

  const productFindMany = vi.fn(
    async (args: { where: ProductWhere; take: number }): Promise<ProductFixture[]> => {
      const rows = arrivals
        .filter((row) => matchesProduct(row, args.where))
        .sort(
          (left, right) => left.sortOrder - right.sortOrder || compareText(left.sku, right.sku),
        );
      return rows.slice(0, args.take);
    },
  );

  const collectionFindMany = vi.fn(
    async (args: { where: { enabled?: boolean } }): Promise<CollectionFixture[]> =>
      collections
        .filter((row) => args.where.enabled === undefined || row.enabled === args.where.enabled)
        .sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id)),
  );

  const collectionFindFirst = vi.fn(
    async (args: { where: { id: string; enabled?: boolean } }): Promise<CollectionFixture | null> =>
      collections.find(
        (row) =>
          row.id === args.where.id &&
          (args.where.enabled === undefined || row.enabled === args.where.enabled),
      ) ?? null,
  );

  const membershipFindMany = vi.fn(
    async (args: { where: MembershipWhere; take: number }): Promise<MembershipFixture[]> => {
      const candidate = memberships.get(args.where.collectionId) ?? [];
      return candidate
        .filter((row) => matchesMembershipCursor(row, args.where))
        .filter((row) => {
          const productWhere = args.where.product?.is;
          return productWhere ? matchesProduct(row.product, productWhere) : true;
        })
        .sort((left, right) => left.sortOrder - right.sortOrder || compareText(left.id, right.id))
        .slice(0, args.take);
    },
  );

  const config = {
    getDisplayConfig: vi.fn(async () => ({
      newArrivalsLimit: options.newArrivalsLimit ?? 12,
      enabled: options.enabled ?? true,
      updatedAt: UPDATED_AT.toISOString(),
    })),
  };
  const catalog = {
    toPublicCard: vi.fn((row: ProductFixture): PublicProductCard => ({
      sku: row.sku,
      slug: row.slug,
      name: `Product ${row.sku}`,
      summary: null,
      lifecycleStatus: row.lifecycleStatus.toLowerCase() as PublicProductCard['lifecycleStatus'],
      isNew: row.isNew,
      isFeatured: false,
      isPreOrder: false,
      category: {
        id: row.categoryId ?? CATEGORY_ID,
        slug: 'collection',
        name: 'Collection',
      },
      coverImage: null,
      tags: [],
    })),
  };
  const categories = {
    filterPublicCategoryIds: vi.fn(async (ids: string[]) => {
      return new Set(ids.filter((id) => publicCategoryIds.has(id)));
    }),
  };
  const prisma = {
    product: { findMany: productFindMany },
    homepageCollection: {
      findMany: collectionFindMany,
      findFirst: collectionFindFirst,
    },
    homepageCollectionProduct: { findMany: membershipFindMany },
  };

  const service = new PublicHomepageService(
    prisma as unknown as PrismaService,
    catalog as unknown as PublicCatalogService,
    categories as unknown as CategoriesService,
    config as unknown as HomepageManagementService,
  );
  return {
    service,
    config,
    productFindMany,
    collectionFindMany,
    collectionFindFirst,
    membershipFindMany,
  };
}

describe('public homepage New Arrivals batches', () => {
  it.each([48, 120, 600])(
    'returns at most 24 at a time for configured total %s without duplicates or gaps',
    async (limit) => {
      const arrivals = Array.from({ length: 600 }, (_, index) => product(index, { isNew: true }));
      const { service } = createHarness({ newArrivalsLimit: limit, arrivals });
      const seen: string[] = [];
      let cursor: string | undefined;

      do {
        const page = await service.getNewArrivals('en-US', cursor);
        expect(page.limit).toBe(limit);
        expect(page.products.length).toBeLessThanOrEqual(24);
        seen.push(...page.products.map((item) => item.sku));
        cursor = page.nextCursor ?? undefined;
        if (!cursor) expect(page.hasMore).toBe(false);
      } while (cursor);

      const expected = [...arrivals]
        .sort((left, right) => left.sortOrder - right.sortOrder || compareText(left.sku, right.sku))
        .slice(0, limit)
        .map((item) => item.sku);
      expect(seen).toEqual(expected);
      expect(new Set(seen).size).toBe(expected.length);
    },
  );

  it('uses the existing published/not-discontinued rule and Product.isNew', async () => {
    const visible = product(1, { isNew: true });
    const draft = product(2, { isNew: true, publishStatus: 'DRAFT' });
    const discontinued = product(3, { isNew: true, lifecycleStatus: 'DISCONTINUED' });
    const old = product(4, { isNew: false });
    const { service, productFindMany } = createHarness({
      newArrivalsLimit: 12,
      arrivals: [visible, draft, discontinued, old],
    });

    const result = await service.getNewArrivals('en-US');

    expect(result.products.map((item) => item.sku)).toEqual([visible.sku]);
    expect(productFindMany.mock.calls[0]?.[0].where).toMatchObject({
      ...PUBLIC_PRODUCT_WHERE,
      isNew: true,
    });
  });

  it('rejects a cursor from a different configured total before querying products', async () => {
    const { service, productFindMany } = createHarness({
      newArrivalsLimit: 120,
      arrivals: [product(1, { isNew: true })],
    });
    const cursor = encodeHomepageCursor({
      version: 1,
      kind: 'new-arrivals',
      configuredLimit: 48,
      returned: 24,
      afterSortOrder: 1,
      afterSku: 'SKU-1',
    });

    await expect(service.getNewArrivals('en-US', cursor)).rejects.toMatchObject({
      code: ERROR_CODES.validationFailed,
    });
    expect(productFindMany).not.toHaveBeenCalled();
  });
});

describe('public homepage collections', () => {
  it.each([48, 120, 600])(
    'keeps collection batches at 24 for configured total %s',
    async (limit) => {
      const visibleCollection = collection({ productLimit: limit });
      const memberships = Array.from({ length: 600 }, (_, index) => ({
        id: uuidFor(2, index),
        sortOrder: Math.floor(index / 3),
        product: product(index),
      }));
      const { service } = createHarness({
        collections: [visibleCollection],
        memberships: new Map([[COLLECTION_ID, memberships]]),
      });
      const seen: string[] = [];
      let cursor: string | undefined;

      do {
        const page = await service.getCollectionProducts(COLLECTION_ID, 'en-US', cursor);
        expect(page.productLimit).toBe(limit);
        expect(page.products.length).toBeLessThanOrEqual(24);
        seen.push(...page.products.map((item) => item.sku));
        cursor = page.nextCursor ?? undefined;
        if (!cursor) expect(page.hasMore).toBe(false);
      } while (cursor);

      const expected = [...memberships]
        .sort((left, right) => left.sortOrder - right.sortOrder || compareText(left.id, right.id))
        .slice(0, limit)
        .map((item) => item.product.sku);
      expect(seen).toEqual(expected);
      expect(new Set(seen).size).toBe(expected.length);
    },
  );

  it('omits disabled/global-hidden sections and invalid products, then deduplicates New Arrivals', async () => {
    const sharedNew = product(1, { isNew: true });
    const normal = product(2);
    const wrongCategory = product(3, { categoryId: OTHER_CATEGORY_ID });
    const draft = product(4, { publishStatus: 'DRAFT' });
    const discontinued = product(5, { lifecycleStatus: 'DISCONTINUED' });
    const visibleCollection = collection();
    const disabledCollection = collection({
      id: uuidFor(3, 1),
      categoryId: uuidFor(4, 1),
      enabled: false,
    });
    const hiddenCollection = collection({
      id: uuidFor(3, 2),
      categoryId: uuidFor(4, 2),
      sortOrder: 20,
    });
    const { service, collectionFindMany, membershipFindMany } = createHarness({
      newArrivalsLimit: 12,
      arrivals: [sharedNew],
      collections: [visibleCollection, disabledCollection, hiddenCollection],
      memberships: new Map([
        [
          COLLECTION_ID,
          [
            { id: uuidFor(2, 1), sortOrder: 10, product: sharedNew },
            { id: uuidFor(2, 2), sortOrder: 20, product: normal },
            { id: uuidFor(2, 3), sortOrder: 30, product: wrongCategory },
            { id: uuidFor(2, 4), sortOrder: 40, product: draft },
            { id: uuidFor(2, 5), sortOrder: 50, product: discontinued },
          ],
        ],
      ]),
      publicCategoryIds: new Set([CATEGORY_ID]),
    });

    const homepage = await service.getHomepage('en-US');

    expect(collectionFindMany.mock.calls[0]?.[0].where).toEqual({ enabled: true });
    expect(homepage.collections.map((item) => item.id)).toEqual([COLLECTION_ID]);
    expect(homepage.newArrivals.products.map((item) => item.sku)).toEqual([sharedNew.sku]);
    expect(homepage.collections[0]?.products.map((item) => item.sku)).toEqual([normal.sku]);
    expect(membershipFindMany.mock.calls[0]?.[0].where).toMatchObject({
      collectionId: COLLECTION_ID,
      product: {
        is: {
          ...PUBLIC_PRODUCT_WHERE,
          categoryId: CATEGORY_ID,
          id: { notIn: [sharedNew.id] },
        },
      },
    });
  });

  it('deduplicates only the products that can actually appear in New Arrivals', async () => {
    const arrivals = Array.from({ length: 20 }, (_, index) => product(index, { isNew: true }));
    const visibleCollection = collection({ productLimit: 48 });
    const { service } = createHarness({
      newArrivalsLimit: 12,
      arrivals,
      collections: [visibleCollection],
      memberships: new Map([
        [
          COLLECTION_ID,
          arrivals.map((row, index) => ({
            id: uuidFor(2, index),
            sortOrder: (index + 1) * 10,
            product: row,
          })),
        ],
      ]),
    });

    const page = await service.getCollectionProducts(COLLECTION_ID, 'en-US');

    expect(page.products.map((item) => item.sku)).toEqual(
      arrivals.slice(12).map((item) => item.sku),
    );
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeNull();
  });

  it('keeps scanning configured candidates to fill a 24-item batch after duplicates', async () => {
    const duplicates = Array.from({ length: 12 }, (_, index) => product(index, { isNew: true }));
    const candidates = Array.from({ length: 30 }, (_, index) => product(index + 100));
    const visibleCollection = collection({ productLimit: 48 });
    const memberships = [...duplicates, ...candidates].map((row, index) => ({
      id: uuidFor(2, index),
      sortOrder: (index + 1) * 10,
      product: row,
    }));
    const { service, membershipFindMany } = createHarness({
      newArrivalsLimit: 12,
      arrivals: duplicates,
      collections: [visibleCollection],
      memberships: new Map([[COLLECTION_ID, memberships]]),
    });
    const seen: string[] = [];
    let cursor: string | undefined;

    do {
      const page = await service.getCollectionProducts(COLLECTION_ID, 'en-US', cursor);
      expect(page.products.length).toBeLessThanOrEqual(24);
      seen.push(...page.products.map((item) => item.sku));
      cursor = page.nextCursor ?? undefined;
      if (!cursor) expect(page.hasMore).toBe(false);
    } while (cursor);

    expect(seen).toEqual(candidates.map((item) => item.sku));
    expect(new Set(seen).size).toBe(30);
    expect(membershipFindMany).toHaveBeenCalledTimes(2);
  });

  it('returns 24 then 18 when 12 early candidates duplicate New Arrivals', async () => {
    const duplicates = Array.from({ length: 12 }, (_, index) => product(index, { isNew: true }));
    const candidates = Array.from({ length: 42 }, (_, index) => product(index + 100));
    const visibleCollection = collection({ productLimit: 48 });
    const memberships = [...duplicates, ...candidates].map((row, index) => ({
      id: uuidFor(2, index),
      sortOrder: (index + 1) * 10,
      product: row,
    }));
    const { service } = createHarness({
      newArrivalsLimit: 12,
      arrivals: duplicates,
      collections: [visibleCollection],
      memberships: new Map([[COLLECTION_ID, memberships]]),
    });

    const first = await service.getCollectionProducts(COLLECTION_ID, 'en-US');
    expect(first.products.map((item) => item.sku)).toEqual(
      candidates.slice(0, 24).map((item) => item.sku),
    );
    expect(first.hasMore).toBe(true);
    expect(first.nextCursor).toEqual(expect.any(String));

    const second = await service.getCollectionProducts(
      COLLECTION_ID,
      'en-US',
      first.nextCursor ?? undefined,
    );
    expect(second.products.map((item) => item.sku)).toEqual(
      candidates.slice(24).map((item) => item.sku),
    );
    expect(second.products).toHaveLength(18);
    expect(second.hasMore).toBe(false);
    expect(second.nextCursor).toBeNull();
  });

  it('returns the real remaining count when all later candidates are deduplicated', async () => {
    const duplicates = Array.from({ length: 12 }, (_, index) => product(index, { isNew: true }));
    const valid = Array.from({ length: 10 }, (_, index) => product(index + 100));
    const visibleCollection = collection({ productLimit: 48 });
    const { service } = createHarness({
      newArrivalsLimit: 12,
      arrivals: duplicates,
      collections: [visibleCollection],
      memberships: new Map([
        [
          COLLECTION_ID,
          [...duplicates, ...valid].map((row, index) => ({
            id: uuidFor(2, index),
            sortOrder: (index + 1) * 10,
            product: row,
          })),
        ],
      ]),
    });

    const page = await service.getCollectionProducts(COLLECTION_ID, 'en-US');

    expect(page.products.map((item) => item.sku)).toEqual(valid.map((item) => item.sku));
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeNull();
  });

  it('returns a stable empty homepage when global collections are disabled', async () => {
    const { service, collectionFindMany } = createHarness({
      enabled: false,
      collections: [collection()],
    });

    await expect(service.getHomepage('en-US')).resolves.toMatchObject({
      enabled: false,
      collections: [],
    });
    expect(collectionFindMany).not.toHaveBeenCalled();
    await expect(service.getCollectionProducts(COLLECTION_ID, 'en-US')).rejects.toMatchObject({
      code: ERROR_CODES.homepageCollectionNotFound,
    });
  });

  it('returns 404 for a disabled or hidden collection', async () => {
    const disabled = collection({ enabled: false });
    const hidden = collection({ id: uuidFor(3, 9), categoryId: uuidFor(4, 9), sortOrder: 20 });
    const { service } = createHarness({
      collections: [disabled, hidden],
      publicCategoryIds: new Set(),
    });

    await expect(service.getCollectionProducts(disabled.id, 'en-US')).rejects.toMatchObject({
      code: ERROR_CODES.homepageCollectionNotFound,
    });
    await expect(service.getCollectionProducts(hidden.id, 'en-US')).rejects.toMatchObject({
      code: ERROR_CODES.homepageCollectionNotFound,
    });
  });

  it('rejects stale collection cursors after configuration changes', async () => {
    const visibleCollection = collection();
    const { service } = createHarness({
      collections: [visibleCollection],
      memberships: new Map([
        [COLLECTION_ID, [{ id: uuidFor(2, 1), sortOrder: 10, product: product(1) }]],
      ]),
    });
    const cursor = encodeHomepageCursor({
      version: 1,
      kind: 'collection',
      collectionId: COLLECTION_ID,
      collectionUpdatedAt: '2026-11-12T14:00:00.000Z',
      productLimit: 120,
      returned: 24,
      afterSortOrder: 10,
      afterId: uuidFor(2, 1),
    });

    await expect(
      service.getCollectionProducts(COLLECTION_ID, 'en-US', cursor),
    ).rejects.toMatchObject({ code: ERROR_CODES.validationFailed });
  });

  it('keeps each collection cursor independent', async () => {
    const collectionA = collection({ productLimit: 120 });
    const collectionB = collection({
      id: uuidFor(3, 7),
      categoryId: OTHER_CATEGORY_ID,
      sortOrder: 20,
    });
    const { service } = createHarness({
      collections: [collectionA, collectionB],
      memberships: new Map([
        [
          collectionA.id,
          Array.from({ length: 30 }, (_, index) => ({
            id: uuidFor(2, index),
            sortOrder: index + 1,
            product: product(index),
          })),
        ],
        [collectionB.id, [{ id: uuidFor(4, 1), sortOrder: 1, product: product(1) }]],
      ]),
    });

    const first = await service.getCollectionProducts(collectionA.id, 'en-US');
    expect(first.nextCursor).toEqual(expect.any(String));

    await expect(
      service.getCollectionProducts(collectionB.id, 'en-US', first.nextCursor ?? undefined),
    ).rejects.toMatchObject({ code: ERROR_CODES.validationFailed });
  });

  it('never exposes price, cost or admin-only fields in the public payload', async () => {
    const visibleCollection = collection({ productLimit: 6 });
    const { service } = createHarness({
      newArrivalsLimit: 12,
      arrivals: [product(1, { isNew: true })],
      collections: [visibleCollection],
      memberships: new Map([
        [COLLECTION_ID, [{ id: uuidFor(2, 1), sortOrder: 10, product: product(2) }]],
      ]),
    });

    const payload = JSON.stringify(await service.getHomepage('en-US'));
    expect(payload).not.toMatch(/price|cost|publishStatus|createdById|updatedById|deletedAt/i);
  });
});
