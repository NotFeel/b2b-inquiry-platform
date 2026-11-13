import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { config as loadDotenv } from 'dotenv';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@b2b/database';
import type { AppEnv } from '../../config/config.module';
import type { JsonLogger } from '../../common/logger.service';
import type { AuditEntry, AuditService } from '../../common/services/audit.service';
import type { StorageService } from '../../common/services/storage.service';
import type { PrismaService } from '../../prisma/prisma.service';
import { HOMEPAGE_DISPLAY_CONFIG_KEY } from './homepage-management-policy';
import { HomepageManagementService } from './homepage-management.service';

for (const candidate of [join(process.cwd(), '.env'), join(process.cwd(), '..', '..', '.env')]) {
  if (existsSync(candidate)) {
    loadDotenv({ path: candidate });
    break;
  }
}

const databaseUrl = process.env.DATABASE_URL ?? '';
const runsIntegration = process.env.HOMEPAGE_DB_INTEGRATION === '1';

function isLocalDatabase(value: string): boolean {
  if (!value) return false;
  try {
    const hostname = new URL(value).hostname;
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  } catch {
    return false;
  }
}

if (runsIntegration && (process.env.NODE_ENV === 'production' || !isLocalDatabase(databaseUrl))) {
  throw new Error('Homepage integration tests refuse to run outside a local PostgreSQL database.');
}

interface ConfigSnapshot {
  newArrivalsLimit: number;
  enabled: boolean;
}

describe.skipIf(!runsIntegration).sequential('homepage management PostgreSQL integration', () => {
  const prisma = new PrismaClient({ log: [] });
  const secondaryPrisma = new PrismaClient({ log: [] });
  const auditEntries: AuditEntry[] = [];
  const audit = {
    record: vi.fn(async (entry: AuditEntry) => {
      auditEntries.push(entry);
    }),
  };
  const logger = { info: vi.fn(), warn: vi.fn() } as unknown as JsonLogger;
  const storage = {
    adminProductImageUrl: vi.fn((assetId: string) => `/api/v1/admin/media/assets/${assetId}/preview`),
    publicUrl: vi.fn((key: string) => `/api/v1/files/${key}`),
  } as unknown as StorageService;
  const service = new HomepageManagementService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    logger,
    storage,
    { APP_BASE_URL: '', REVALIDATE_SECRET: undefined } as AppEnv,
  );
  const secondaryService = new HomepageManagementService(
    secondaryPrisma as unknown as PrismaService,
    audit as unknown as AuditService,
    logger,
    storage,
    { APP_BASE_URL: '', REVALIDATE_SECRET: undefined } as AppEnv,
  );

  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  let originalConfig: ConfigSnapshot | null = null;
  let categoryAId = '';
  let categoryBId = '';
  let productA1Id = '';
  let productA2Id = '';
  let productB1Id = '';
  let collectionAId = '';
  let collectionBId = '';
  let originalCollectionOrders: { id: string; sortOrder: number }[] = [];

  beforeAll(async () => {
    originalConfig = await prisma.homepageDisplayConfig.findUnique({
      where: { configKey: HOMEPAGE_DISPLAY_CONFIG_KEY },
      select: { newArrivalsLimit: true, enabled: true },
    });
    originalCollectionOrders = await prisma.homepageCollection.findMany({
      select: { id: true, sortOrder: true },
    });

    const categoryA = await prisma.category.create({
      data: {
        code: `qa-home-a-${suffix}`,
        slug: `qa-home-a-${suffix}`,
        translations: { create: [{ locale: 'en-US', name: 'QA Homepage A' }] },
      },
      select: { id: true },
    });
    const categoryB = await prisma.category.create({
      data: {
        code: `qa-home-b-${suffix}`,
        slug: `qa-home-b-${suffix}`,
        translations: { create: [{ locale: 'en-US', name: 'QA Homepage B' }] },
      },
      select: { id: true },
    });
    categoryAId = categoryA.id;
    categoryBId = categoryB.id;

    const [productA1, productA2, productB1] = await Promise.all([
      prisma.product.create({
        data: {
          sku: `QA-HOME-A1-${suffix}`,
          slug: `qa-home-a1-${suffix}`,
          categoryId: categoryAId,
          publishStatus: 'PUBLISHED',
          translations: { create: [{ locale: 'en-US', name: 'QA product A1' }] },
        },
        select: { id: true },
      }),
      prisma.product.create({
        data: {
          sku: `QA-HOME-A2-${suffix}`,
          slug: `qa-home-a2-${suffix}`,
          categoryId: categoryAId,
          publishStatus: 'PUBLISHED',
          translations: { create: [{ locale: 'en-US', name: 'QA product A2' }] },
        },
        select: { id: true },
      }),
      prisma.product.create({
        data: {
          sku: `QA-HOME-B1-${suffix}`,
          slug: `qa-home-b1-${suffix}`,
          categoryId: categoryBId,
          publishStatus: 'PUBLISHED',
          translations: { create: [{ locale: 'en-US', name: 'QA product B1' }] },
        },
        select: { id: true },
      }),
    ]);
    productA1Id = productA1.id;
    productA2Id = productA2.id;
    productB1Id = productB1.id;
  });

  afterAll(async () => {
    if (categoryAId || categoryBId) {
      await prisma.homepageCollection.deleteMany({
        where: { categoryId: { in: [categoryAId, categoryBId].filter(Boolean) } },
      });
    }
    await prisma.product.deleteMany({
      where: { id: { in: [productA1Id, productA2Id, productB1Id].filter(Boolean) } },
    });
    await prisma.category.deleteMany({
      where: { id: { in: [categoryAId, categoryBId].filter(Boolean) } },
    });
    if (originalCollectionOrders.length > 0) {
      await prisma.$transaction(
        originalCollectionOrders.map((collection) =>
          prisma.homepageCollection.update({
            where: { id: collection.id },
            data: { sortOrder: collection.sortOrder },
          }),
        ),
      );
    }

    if (originalConfig) {
      await prisma.homepageDisplayConfig.upsert({
        where: { configKey: HOMEPAGE_DISPLAY_CONFIG_KEY },
        create: { configKey: HOMEPAGE_DISPLAY_CONFIG_KEY, ...originalConfig },
        update: originalConfig,
      });
    } else {
      await prisma.homepageDisplayConfig.deleteMany({
        where: { configKey: HOMEPAGE_DISPLAY_CONFIG_KEY },
      });
    }

    await Promise.all([prisma.$disconnect(), secondaryPrisma.$disconnect()]);
  });

  it('creates exactly one singleton under concurrent first reads', async () => {
    await prisma.homepageDisplayConfig.deleteMany({
      where: { configKey: HOMEPAGE_DISPLAY_CONFIG_KEY },
    });

    const results = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        index % 2 === 0 ? service.getDisplayConfig() : secondaryService.getDisplayConfig(),
      ),
    );

    expect(results).toHaveLength(8);
    expect(results.every((result) => result.newArrivalsLimit === 12)).toBe(true);
    await expect(prisma.homepageDisplayConfig.count()).resolves.toBe(1);
  });

  it('rejects non-default singleton keys and duplicate default rows in PostgreSQL', async () => {
    await service.getDisplayConfig();

    await expect(
      prisma.homepageDisplayConfig.create({
        data: {
          configKey: 'other',
          newArrivalsLimit: 12,
          enabled: true,
        },
      }),
    ).rejects.toThrow(/homepage_display_configs_singleton_check|check constraint/i);

    await expect(
      prisma.homepageDisplayConfig.create({
        data: {
          configKey: HOMEPAGE_DISPLAY_CONFIG_KEY,
          newArrivalsLimit: 12,
          enabled: true,
        },
      }),
    ).rejects.toThrow(/unique constraint|P2002/i);

    await expect(prisma.homepageDisplayConfig.count()).resolves.toBe(1);
  });

  it('stores unbounded valid totals while the database rejects invalid values', async () => {
    for (const newArrivalsLimit of [48, 120, 600]) {
      await expect(
        service.updateDisplayConfig(
          { newArrivalsLimit, expectedUpdatedAt: (await service.getDisplayConfig()).updatedAt },
          'actor-1',
          `request-${newArrivalsLimit}`,
        ),
      ).resolves.toMatchObject({ newArrivalsLimit });
    }

    await expect(
      prisma.homepageDisplayConfig.update({
        where: { configKey: HOMEPAGE_DISPLAY_CONFIG_KEY },
        data: { newArrivalsLimit: 7 },
      }),
    ).rejects.toThrow(/check constraint/);

    await expect(service.getDisplayConfig()).resolves.toMatchObject({ newArrivalsLimit: 600 });
  });

  it('enforces one collection per category and cross-category product ownership', async () => {
    const collectionA = await service.createCollection(
      {
        categoryId: categoryAId,
        enabled: true,
        productLimit: 24,
        translations: [{ locale: 'en-US', title: 'QA Fasteners', subtitle: null }],
      },
      'actor-1',
      'request-create-a',
    );
    collectionAId = collectionA.id;

    const updatedCollection = await service.updateCollection(
      collectionAId,
      {
        enabled: false,
        translations: [
          { locale: 'en-US', title: 'QA Fasteners Hidden', subtitle: 'Hidden for staging' },
          { locale: 'zh-CN', title: 'QA 紧固件', subtitle: null },
        ],
        expectedUpdatedAt: collectionA.updatedAt,
      },
      'actor-1',
      'request-update-a',
    );
    expect(updatedCollection.enabled).toBe(false);
    expect(updatedCollection.translations).toEqual(
      expect.arrayContaining([
        { locale: 'en-US', title: 'QA Fasteners Hidden', subtitle: 'Hidden for staging' },
        { locale: 'zh-CN', title: 'QA 紧固件', subtitle: null },
      ]),
    );

    await expect(
      service.createCollection(
        {
          categoryId: categoryAId,
          enabled: true,
          productLimit: 24,
          translations: [{ locale: 'en-US', title: 'Duplicate', subtitle: null }],
        },
        'actor-1',
        'request-create-duplicate',
      ),
    ).rejects.toMatchObject({ code: 'HOMEPAGE_COLLECTION_CATEGORY_CONFLICT' });

    const collectionB = await service.createCollection(
      {
        categoryId: categoryBId,
        enabled: true,
        productLimit: 24,
        translations: [{ locale: 'en-US', title: 'QA Tools', subtitle: null }],
      },
      'actor-1',
      'request-create-b',
    );
    collectionBId = collectionB.id;

    await expect(
      service.updateProducts(
        collectionBId,
        { products: [{ productId: productA1Id }] },
        'actor-1',
        'request-cross-category',
      ),
    ).rejects.toMatchObject({ code: 'HOMEPAGE_COLLECTION_PRODUCT_CATEGORY_MISMATCH' });
  });

  it('saves product order from the request array and rejects duplicate selection', async () => {
    const result = await service.updateProducts(
      collectionAId,
      {
        products: [
          { productId: productA1Id, sortOrder: 30 },
          { productId: productA2Id, sortOrder: 20 },
        ],
      },
      'actor-1',
      'request-products',
    );
    expect(result.products.map((product) => product.productId)).toEqual([productA1Id, productA2Id]);
    expect(result.products.map((product) => product.sortOrder)).toEqual([10, 20]);

    await expect(
      service.updateProducts(
        collectionAId,
        {
          products: [{ productId: productA1Id }, { productId: productA1Id }],
        },
        'actor-1',
        'request-duplicate-product',
      ),
    ).rejects.toMatchObject({ code: 'HOMEPAGE_COLLECTION_PRODUCT_DUPLICATE' });
  });

  it('rolls back every collection ordering update when a later write fails', async () => {
    const functionName = 'qa_homepage_sort_failure';
    const triggerName = 'qa_homepage_sort_failure_trigger';
    await prisma.$executeRawUnsafe(
      `DROP TRIGGER IF EXISTS "${triggerName}" ON homepage_collections`,
    );
    await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${functionName}"()`);

    try {
      await prisma.$executeRawUnsafe(`
        CREATE FUNCTION "${functionName}"() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW."sortOrder" = 20 THEN
            RAISE EXCEPTION 'qa forced homepage sort rollback';
          END IF;
          RETURN NEW;
        END;
        $$
      `);
      await prisma.$executeRawUnsafe(`
        CREATE TRIGGER "${triggerName}"
        BEFORE UPDATE ON homepage_collections
        FOR EACH ROW EXECUTE FUNCTION "${functionName}"()
      `);

      const otherCollections = await prisma.homepageCollection.findMany({
        where: { id: { notIn: [collectionAId, collectionBId] } },
        select: { id: true },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      });
      const before = await prisma.homepageCollection.findMany({
        select: { id: true, sortOrder: true },
        orderBy: [{ id: 'asc' }],
      });

      await expect(
        service.sortCollections(
          {
            orderedIds: [
              collectionAId,
              collectionBId,
              ...otherCollections.map((collection) => collection.id),
            ],
          },
          'actor-1',
          'request-sort-forced-failure',
        ),
      ).rejects.toThrow(/qa forced homepage sort rollback/);

      await expect(
        prisma.homepageCollection.findMany({
          select: { id: true, sortOrder: true },
          orderBy: [{ id: 'asc' }],
        }),
      ).resolves.toEqual(before);
    } finally {
      await prisma.$executeRawUnsafe(
        `DROP TRIGGER IF EXISTS "${triggerName}" ON homepage_collections`,
      );
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${functionName}"()`);
    }
  });

  it('reorders collections atomically and leaves the previous order on invalid input', async () => {
    const otherCollections = await prisma.homepageCollection.findMany({
      where: { id: { notIn: [collectionAId, collectionBId] } },
      select: { id: true },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
    const orderedIds = [
      collectionBId,
      collectionAId,
      ...otherCollections.map((collection) => collection.id),
    ];
    await service.sortCollections({ orderedIds }, 'actor-1', 'request-sort-valid');
    const firstPage = await prisma.homepageCollection.findMany({
      select: { id: true },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      take: 2,
    });
    expect(firstPage).toEqual([{ id: collectionBId }, { id: collectionAId }]);
    const reorderedSnapshot = await prisma.homepageCollection.findMany({
      select: { id: true, sortOrder: true },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });

    await expect(
      service.sortCollections({ orderedIds: [collectionAId] }, 'actor-1', 'request-sort-invalid'),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(
      prisma.homepageCollection.findMany({
        select: { id: true, sortOrder: true },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      }),
    ).resolves.toEqual(reorderedSnapshot);
  });

  it('deletes only the display configuration and records an audit entry', async () => {
    await expect(
      service.removeCollection(collectionAId, 'actor-1', 'request-delete-a'),
    ).resolves.toEqual({ deleted: true });
    collectionAId = '';

    await expect(
      prisma.category.findUnique({ where: { id: categoryAId } }),
    ).resolves.not.toBeNull();
    await expect(prisma.product.findUnique({ where: { id: productA1Id } })).resolves.not.toBeNull();
    expect(auditEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actorId: 'actor-1',
          action: 'homepage.collection.delete',
          requestId: 'request-delete-a',
        }),
      ]),
    );
    expect(new Set(auditEntries.map((entry) => entry.action))).toEqual(
      new Set([
        'homepage.config.update',
        'homepage.collection.create',
        'homepage.collection.update',
        'homepage.collection.products.update',
        'homepage.collection.reorder',
        'homepage.collection.delete',
      ]),
    );
  });
});
