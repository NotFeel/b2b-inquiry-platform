import { afterEach, describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@b2b/contracts';
import { Prisma } from '@b2b/database';
import type { AppEnv } from '../../config/config.module';
import { ApiError } from '../../common/errors/api-error';
import type { JsonLogger } from '../../common/logger.service';
import type { AuditService } from '../../common/services/audit.service';
import type { StorageService } from '../../common/services/storage.service';
import type { PrismaService } from '../../prisma/prisma.service';
import { HOMEPAGE_DISPLAY_CONFIG_KEY } from './homepage-management-policy';
import { HomepageManagementService } from './homepage-management.service';

const COLLECTION_ID = '843498b1-3dc9-4137-97fa-ff64854be803';
const CATEGORY_ID = 'df63681e-6377-4ea4-8fef-64459c7b0964';
const NEXT_CATEGORY_ID = 'b227f71f-7145-4a67-812f-0c3a6fca340c';
const NOW = new Date('2026-11-12T15:30:00.000Z');

function createHarness(prisma: Record<string, unknown>, env: Partial<AppEnv> = {}) {
  const audit = { record: vi.fn(async () => undefined) };
  const logger = { info: vi.fn(), warn: vi.fn() };
  const storage = {
    adminProductImageUrl: vi.fn((assetId: string) => `/api/v1/admin/media/assets/${assetId}/preview`),
    publicUrl: vi.fn((key: string) => `/api/v1/files/${key}`),
  };
  const service = new HomepageManagementService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    logger as unknown as JsonLogger,
    storage as unknown as StorageService,
    {
      APP_BASE_URL: 'http://storefront.test',
      REVALIDATE_SECRET: undefined,
      ...env,
    } as AppEnv,
  );
  return { service, audit, logger, storage };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function transactionClient<T extends Record<string, unknown>>(overrides: T): T {
  return overrides;
}

function collectionDetailRow(overrides: Record<string, unknown> = {}) {
  return {
    id: COLLECTION_ID,
    categoryId: CATEGORY_ID,
    enabled: true,
    sortOrder: 10,
    productLimit: 120,
    createdAt: NOW,
    updatedAt: NOW,
    category: {
      id: CATEGORY_ID,
      code: 'fasteners',
      slug: 'fasteners',
      enabled: true,
      visible: true,
      translations: [{ locale: 'en-US', name: 'Fasteners' }],
    },
    translations: [{ locale: 'en-US', title: 'Industrial fasteners', subtitle: null }],
    _count: { products: 2 },
    products: [
      {
        productId: 'product-1',
        sortOrder: 10,
        product: {
          id: 'product-1',
          sku: 'SKU-1',
          categoryId: CATEGORY_ID,
          publishStatus: 'PUBLISHED',
          lifecycleStatus: 'AVAILABLE',
          translations: [{ locale: 'en-US', name: 'Bolt' }],
          images: [
            {
              fileAssetId: 'asset-1',
              storageKey: 'products/asset-1/source.png',
              altText: 'Bolt cover',
              sortOrder: 5,
              isCover: true,
              deleteState: 'READY',
            },
          ],
        },
      },
      {
        productId: 'product-2',
        sortOrder: 20,
        product: {
          id: 'product-2',
          sku: 'SKU-2',
          categoryId: CATEGORY_ID,
          publishStatus: 'DRAFT',
          lifecycleStatus: 'AVAILABLE',
          translations: [{ locale: 'zh-CN', name: '螺母' }],
          images: [],
        },
      },
    ],
    ...overrides,
  };
}

describe('homepage singleton display configuration', () => {
  it('uses one fixed unique key for concurrent get-or-create calls', async () => {
    const upsert = vi.fn(async (_args: { where: { configKey: string } }) => ({
      newArrivalsLimit: 12,
      enabled: true,
      updatedAt: NOW,
    }));
    const { service } = createHarness({ homepageDisplayConfig: { upsert } });

    const [first, second] = await Promise.all([
      service.getDisplayConfig(),
      service.getDisplayConfig(),
    ]);

    expect(first).toEqual(second);
    expect(upsert).toHaveBeenCalledTimes(2);
    for (const call of upsert.mock.calls) {
      expect((call[0] as { where: { configKey: string } }).where.configKey).toBe(
        HOMEPAGE_DISPLAY_CONFIG_KEY,
      );
    }
    expect(HOMEPAGE_DISPLAY_CONFIG_KEY).toBe('default');
  });

  it('recovers from a concurrent first-read uniqueness race', async () => {
    const collision = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: '6.19.3',
      meta: { target: ['configKey'] },
    });
    const upsert = vi.fn(async () => {
      throw collision;
    });
    const findUnique = vi.fn(async () => ({
      newArrivalsLimit: 12,
      enabled: true,
      updatedAt: NOW,
    }));
    const { service } = createHarness({
      homepageDisplayConfig: { upsert, findUnique },
    });

    await expect(service.getDisplayConfig()).resolves.toEqual({
      newArrivalsLimit: 12,
      enabled: true,
      updatedAt: NOW.toISOString(),
    });
    expect(findUnique).toHaveBeenCalledWith({
      where: { configKey: HOMEPAGE_DISPLAY_CONFIG_KEY },
      select: { newArrivalsLimit: true, enabled: true, updatedAt: true },
    });
  });

  it('rejects a stale configuration write before updating', async () => {
    const tx = transactionClient({
      homepageDisplayConfig: {
        upsert: vi.fn(async () => ({
          newArrivalsLimit: 48,
          enabled: true,
          updatedAt: NOW,
        })),
        update: vi.fn(),
      },
    });
    const prisma = {
      $transaction: vi.fn(async (work: (client: unknown) => Promise<unknown>) => work(tx)),
    };
    const { service, audit } = createHarness(prisma);

    await expect(
      service.updateDisplayConfig(
        { newArrivalsLimit: 120, expectedUpdatedAt: '2026-11-12T15:00:00.000Z' },
        'actor-1',
        'request-1',
      ),
    ).rejects.toMatchObject({ code: ERROR_CODES.homepageConfigConcurrentUpdate });
    expect(tx.homepageDisplayConfig.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('revalidates the storefront homepage after a committed configuration update', async () => {
    const tx = transactionClient({
      homepageDisplayConfig: {
        upsert: vi.fn(async () => ({
          newArrivalsLimit: 48,
          enabled: true,
          updatedAt: NOW,
        })),
        update: vi.fn(async () => ({
          newArrivalsLimit: 120,
          enabled: false,
          updatedAt: new Date('2026-11-12T15:31:00.000Z'),
        })),
      },
    });
    const prisma = {
      $transaction: vi.fn(async (work: (client: unknown) => Promise<unknown>) => work(tx)),
    };
    const fetchMock = vi.fn(async () => ({ ok: true, status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const { service } = createHarness(prisma, {
      APP_BASE_URL: 'https://storefront.example',
      REVALIDATE_SECRET: 'revalidate-secret',
    });

    await service.updateDisplayConfig(
      { newArrivalsLimit: 120, enabled: false, expectedUpdatedAt: NOW.toISOString() },
      'actor-1',
      'request-1',
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'https://storefront.example/api/revalidate?tag=homepage',
      {
        method: 'POST',
        headers: { 'x-revalidate-secret': 'revalidate-secret' },
      },
    );
  });

  it('keeps a committed update successful when homepage revalidation fails', async () => {
    const tx = transactionClient({
      homepageDisplayConfig: {
        upsert: vi.fn(async () => ({ newArrivalsLimit: 12, enabled: true, updatedAt: NOW })),
        update: vi.fn(async () => ({
          newArrivalsLimit: 48,
          enabled: true,
          updatedAt: new Date('2026-11-12T15:31:00.000Z'),
        })),
      },
    });
    const prisma = {
      $transaction: vi.fn(async (work: (client: unknown) => Promise<unknown>) => work(tx)),
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('storefront unavailable');
      }),
    );
    const { service, logger } = createHarness(prisma, {
      APP_BASE_URL: 'https://storefront.example',
      REVALIDATE_SECRET: 'revalidate-secret',
    });

    await expect(
      service.updateDisplayConfig(
        { newArrivalsLimit: 48, expectedUpdatedAt: NOW.toISOString() },
        'actor-1',
        'request-1',
      ),
    ).resolves.toMatchObject({ newArrivalsLimit: 48 });
    expect(logger.warn).toHaveBeenCalledWith('homepage.revalidate_failed', {
      reason: 'config_updated',
      error: 'storefront unavailable',
    });
  });

  it('returns the configuration-specific conflict code after P2034 retry exhaustion', async () => {
    const conflict = new Prisma.PrismaClientKnownRequestError('Serialization failure', {
      code: 'P2034',
      clientVersion: '6.19.3',
    });
    const prisma = {
      $transaction: vi.fn(async () => {
        throw conflict;
      }),
    };
    const { service, audit } = createHarness(prisma);

    await expect(
      service.updateDisplayConfig(
        { newArrivalsLimit: 120, expectedUpdatedAt: NOW.toISOString() },
        'actor-1',
        'request-1',
      ),
    ).rejects.toMatchObject({ code: ERROR_CODES.homepageConfigConcurrentUpdate });
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(audit.record).not.toHaveBeenCalled();
  });
});

describe('homepage collection rules', () => {
  it('keeps the collection-specific conflict code after P2034 retry exhaustion', async () => {
    const conflict = new Prisma.PrismaClientKnownRequestError('Serialization failure', {
      code: 'P2034',
      clientVersion: '6.19.3',
    });
    const prisma = {
      $transaction: vi.fn(async () => {
        throw conflict;
      }),
    };
    const { service, audit } = createHarness(prisma);

    await expect(
      service.sortCollections({ orderedIds: [] }, 'actor-1', 'request-1'),
    ).rejects.toMatchObject({ code: ERROR_CODES.homepageCollectionConcurrentUpdate });
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('rejects a second collection for the same category', async () => {
    const prisma = {
      category: { findUnique: vi.fn(async () => ({ id: CATEGORY_ID })) },
      homepageCollection: {
        findUnique: vi.fn(async () => ({ id: COLLECTION_ID })),
        create: vi.fn(),
      },
    };
    const { service } = createHarness(prisma);

    await expect(
      service.createCollection(
        {
          categoryId: CATEGORY_ID,
          enabled: true,
          productLimit: 6,
          translations: [{ locale: 'en-US', title: 'Fasteners', subtitle: null }],
        },
        'actor-1',
        'request-1',
      ),
    ).rejects.toMatchObject({ code: ERROR_CODES.homepageCollectionCategoryConflict });
    expect(prisma.homepageCollection.create).not.toHaveBeenCalled();
  });

  it('maps a concurrent category unique race to the stable conflict response', async () => {
    const collision = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: '6.19.3',
      meta: { target: ['categoryId'] },
    });
    const tx = transactionClient({
      homepageCollection: {
        findUnique: vi.fn(async (args: { where: { id?: string; categoryId?: string } }) =>
          args.where.id
            ? {
                id: COLLECTION_ID,
                categoryId: CATEGORY_ID,
                enabled: true,
                sortOrder: 10,
                productLimit: 24,
                updatedAt: NOW,
                translations: [],
                _count: { products: 0 },
              }
            : null,
        ),
        update: vi.fn(async () => {
          throw collision;
        }),
      },
      category: { findUnique: vi.fn(async () => ({ id: NEXT_CATEGORY_ID })) },
    });
    const prisma = {
      $transaction: vi.fn(async (work: (client: unknown) => Promise<unknown>) => work(tx)),
    };
    const { service, audit } = createHarness(prisma);

    await expect(
      service.updateCollection(
        COLLECTION_ID,
        { categoryId: NEXT_CATEGORY_ID },
        'actor-1',
        'request-1',
      ),
    ).rejects.toMatchObject({ code: ERROR_CODES.homepageCollectionCategoryConflict });
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('rejects cross-category products inside the transaction', async () => {
    const tx = transactionClient({
      homepageCollection: {
        findUnique: vi.fn(async () => ({
          id: COLLECTION_ID,
          categoryId: CATEGORY_ID,
          productLimit: 120,
          updatedAt: NOW,
        })),
        update: vi.fn(),
      },
      product: {
        findMany: vi.fn(async () => [{ id: 'product-other', categoryId: 'other-category' }]),
      },
      homepageCollectionProduct: { deleteMany: vi.fn(), createMany: vi.fn() },
    });
    const prisma = {
      $transaction: vi.fn(async (work: (client: unknown) => Promise<unknown>) => work(tx)),
    };
    const { service, audit } = createHarness(prisma);

    await expect(
      service.updateProducts(
        COLLECTION_ID,
        { products: [{ productId: 'product-other' }] },
        'actor-1',
        'request-1',
      ),
    ).rejects.toMatchObject({
      code: ERROR_CODES.homepageCollectionProductCategoryMismatch,
    });
    expect(tx.homepageCollectionProduct.deleteMany).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('rejects duplicate product ids before opening a write transaction', async () => {
    const prisma = { $transaction: vi.fn() };
    const { service } = createHarness(prisma);

    await expect(
      service.updateProducts(
        COLLECTION_ID,
        {
          products: [{ productId: 'product-1' }, { productId: 'product-1', sortOrder: 20 }],
        },
        'actor-1',
        'request-1',
      ),
    ).rejects.toMatchObject({ code: ERROR_CODES.homepageCollectionProductDuplicate });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('replaces product selection atomically, preserves order and writes an audit row', async () => {
    const detail = collectionDetailRow();
    const findUnique = vi.fn(async (args: { select?: unknown }) =>
      args.select
        ? { id: COLLECTION_ID, categoryId: CATEGORY_ID, productLimit: 120, updatedAt: NOW }
        : detail,
    );
    const tx = transactionClient({
      homepageCollection: { findUnique, update: vi.fn(async () => ({ id: COLLECTION_ID })) },
      product: {
        findMany: vi.fn(async () => [
          { id: 'product-1', categoryId: CATEGORY_ID },
          { id: 'product-2', categoryId: CATEGORY_ID },
        ]),
      },
      homepageCollectionProduct: {
        deleteMany: vi.fn(async () => ({ count: 1 })),
        createMany: vi.fn(async () => ({ count: 2 })),
      },
    });
    const prisma = {
      $transaction: vi.fn(async (work: (client: unknown) => Promise<unknown>) => work(tx)),
      homepageCollection: { findUnique },
    };
    const { service, audit } = createHarness(prisma);

    const result = await service.updateProducts(
      COLLECTION_ID,
      { products: [{ productId: 'product-1' }, { productId: 'product-2' }] },
      'actor-1',
      'request-1',
    );

    expect(result.products.map((product) => product.sortOrder)).toEqual([10, 20]);
    expect(tx.homepageCollectionProduct.createMany).toHaveBeenCalledWith({
      data: [
        { collectionId: COLLECTION_ID, productId: 'product-1', sortOrder: 10 },
        { collectionId: COLLECTION_ID, productId: 'product-2', sortOrder: 20 },
      ],
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'actor-1',
        action: 'homepage.collection.products.update',
        entityId: COLLECTION_ID,
        requestId: 'request-1',
      }),
    );
  });

  it('persists the complete collection order in one serializable transaction', async () => {
    const update = vi.fn(async () => ({ id: 'updated' }));
    const tx = transactionClient({
      homepageCollection: {
        findMany: vi.fn(async () => [{ id: 'a' }, { id: 'b' }]),
        update,
      },
    });
    const prisma = {
      $transaction: vi.fn(async (work: (client: unknown) => Promise<unknown>) => work(tx)),
    };
    const { service, audit } = createHarness(prisma);

    await expect(
      service.sortCollections({ orderedIds: ['b', 'a'] }, 'actor-1', 'request-1'),
    ).resolves.toEqual({ reordered: 2 });
    expect(update.mock.calls).toEqual([
      [{ where: { id: 'b' }, data: { sortOrder: 10 } }],
      [{ where: { id: 'a' }, data: { sortOrder: 20 } }],
    ]);
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'homepage.collection.reorder' }),
    );
  });

  it('deletes only the collection configuration and audits its snapshot', async () => {
    const tx = transactionClient({
      homepageCollection: {
        findUnique: vi.fn(async () => ({
          id: COLLECTION_ID,
          categoryId: CATEGORY_ID,
          translations: [{ locale: 'en-US', title: 'Fasteners', subtitle: null }],
          _count: { products: 2 },
        })),
        delete: vi.fn(async () => ({ id: COLLECTION_ID })),
      },
      category: { delete: vi.fn() },
      product: { delete: vi.fn() },
    });
    const prisma = {
      $transaction: vi.fn(async (work: (client: unknown) => Promise<unknown>) => work(tx)),
    };
    const { service, audit } = createHarness(prisma);

    await expect(service.removeCollection(COLLECTION_ID, 'actor-1', 'request-1')).resolves.toEqual({
      deleted: true,
    });
    expect(tx.category.delete).not.toHaveBeenCalled();
    expect(tx.product.delete).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'homepage.collection.delete',
        metadata: expect.objectContaining({ categoryId: CATEGORY_ID, selectedProductCount: 2 }),
      }),
    );
  });
});

describe('homepage product totals', () => {
  it('rejects a selection larger than the configured total', async () => {
    const tx = transactionClient({
      homepageCollection: {
        findUnique: vi.fn(async () => ({
          id: COLLECTION_ID,
          categoryId: CATEGORY_ID,
          productLimit: 6,
          updatedAt: NOW,
        })),
      },
    });
    const prisma = {
      $transaction: vi.fn(async (work: (client: unknown) => Promise<unknown>) => work(tx)),
    };
    const { service } = createHarness(prisma);

    await expect(
      service.updateProducts(
        COLLECTION_ID,
        { products: Array.from({ length: 12 }, (_, index) => ({ productId: `product-${index}` })) },
        'actor-1',
        'request-1',
      ),
    ).rejects.toBeInstanceOf(ApiError);
  });
});

describe('homepage collection cover image projection', () => {
  it('returns an admin-safe cover URL for selected products and never leaks storage keys or prices', async () => {
    const findUnique = vi.fn(async () => collectionDetailRow());
    const { service } = createHarness({ homepageCollection: { findUnique } });

    const detail = await service.getCollection(COLLECTION_ID, 'en-US');

    expect(findUnique).toHaveBeenCalledWith({
      where: { id: COLLECTION_ID },
      include: expect.anything(),
    });

    const [first, second] = detail.products;
    expect(first).toMatchObject({
      productId: 'product-1',
      sortOrder: 10,
      coverImageUrl: '/api/v1/admin/media/assets/asset-1/preview',
      coverImageAlt: 'Bolt cover',
    });
    expect(second?.coverImageUrl).toBeNull();
    expect(second?.coverImageAlt).toBeNull();

    const serialized = JSON.stringify(detail);
    expect(serialized).not.toContain('storageKey');
    expect(serialized).not.toContain('products/asset-1/source.png');
    expect(serialized).not.toContain('priceCny');
    expect(serialized).not.toContain('priceVisible');
  });

  it('ignores images that are not READY and prefers the flagged cover among usable images', async () => {
    const row = collectionDetailRow({
      products: [
        {
          productId: 'product-3',
          sortOrder: 30,
          product: {
            id: 'product-3',
            sku: 'SKU-3',
            categoryId: CATEGORY_ID,
            publishStatus: 'PUBLISHED',
            lifecycleStatus: 'AVAILABLE',
            translations: [{ locale: 'en-US', name: 'Washer' }],
            images: [
              {
                fileAssetId: 'asset-pending',
                storageKey: 'products/pending/source.png',
                altText: 'Pending cover',
                sortOrder: 1,
                isCover: true,
                deleteState: 'PENDING_DELETE',
              },
              {
                fileAssetId: 'asset-ready',
                storageKey: 'products/ready/source.png',
                altText: 'Ready image',
                sortOrder: 9,
                isCover: false,
                deleteState: 'READY',
              },
            ],
          },
        },
      ],
    });
    const { service } = createHarness({
      homepageCollection: { findUnique: vi.fn(async () => row) },
    });

    const detail = await service.getCollection(COLLECTION_ID, 'en-US');
    const product = detail.products[0];

    expect(product?.coverImageUrl).toBe('/api/v1/admin/media/assets/asset-ready/preview');
    expect(product?.coverImageAlt).toBe('Ready image');
  });

  it('falls back to the earliest READY image when no image is flagged as cover', async () => {
    const row = collectionDetailRow({
      products: [
        {
          productId: 'product-4',
          sortOrder: 40,
          product: {
            id: 'product-4',
            sku: 'SKU-4',
            categoryId: CATEGORY_ID,
            publishStatus: 'PUBLISHED',
            lifecycleStatus: 'AVAILABLE',
            translations: [{ locale: 'en-US', name: 'Nut' }],
            images: [
              {
                fileAssetId: null,
                storageKey: 'products/legacy/late.png',
                altText: 'Late',
                sortOrder: 20,
                isCover: false,
                deleteState: 'READY',
              },
              {
                fileAssetId: null,
                storageKey: 'products/legacy/early.png',
                altText: 'Early',
                sortOrder: 3,
                isCover: false,
                deleteState: 'READY',
              },
            ],
          },
        },
      ],
    });
    const { service } = createHarness({
      homepageCollection: { findUnique: vi.fn(async () => row) },
    });

    const detail = await service.getCollection(COLLECTION_ID, 'en-US');
    expect(detail.products[0]?.coverImageUrl).toBe('/api/v1/files/products/legacy/early.png');
    expect(detail.products[0]?.coverImageAlt).toBe('Early');
  });

  it('returns null cover fields when the product has no usable image', async () => {
    const row = collectionDetailRow({
      products: [
        {
          productId: 'product-5',
          sortOrder: 50,
          product: {
            id: 'product-5',
            sku: 'SKU-5',
            categoryId: CATEGORY_ID,
            publishStatus: 'DRAFT',
            lifecycleStatus: 'AVAILABLE',
            translations: [{ locale: 'en-US', name: 'Bracket' }],
            images: [],
          },
        },
      ],
    });
    const { service } = createHarness({
      homepageCollection: { findUnique: vi.fn(async () => row) },
    });

    const detail = await service.getCollection(COLLECTION_ID, 'en-US');
    expect(detail.products[0]?.coverImageUrl).toBeNull();
    expect(detail.products[0]?.coverImageAlt).toBeNull();
  });
});
