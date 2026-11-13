import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppEnv } from '../../config/config.module';
import type { JsonLogger } from '../../common/logger.service';
import type { AuditService } from '../../common/services/audit.service';
import type { StorageService } from '../../common/services/storage.service';
import type { PrismaService } from '../../prisma/prisma.service';
import { CategoriesService } from './categories.service';

const CATEGORY_ID = 'df63681e-6377-4ea4-8fef-64459c7b0964';
const UPDATED_AT = new Date('2026-11-12T15:30:00.000Z');

function categoryRow() {
  return {
    id: CATEGORY_ID,
    code: 'qa-category',
    slug: 'qa-category',
    parentId: null,
    sortOrder: 10,
    enabled: true,
    visible: true,
    coverFileAssetId: null,
    createdAt: UPDATED_AT,
    updatedAt: UPDATED_AT,
    translations: [{ locale: 'en-US', name: 'QA Category', description: null }],
    cover: null,
  };
}

function createHarness() {
  const row = categoryRow();
  const categoryFindUnique = vi.fn(async (args: { where: Record<string, unknown> }) => {
    return 'id' in args.where ? row : null;
  });
  const categoryFindMany = vi.fn(async () => [row]);
  const categoryCreate = vi.fn(async () => row);
  const categoryUpdate = vi.fn(async () => row);
  const categoryDelete = vi.fn(async () => row);
  const categoryCount = vi.fn(async () => 0);
  const productCount = vi.fn(async () => 0);

  const prisma = {
    category: {
      findUnique: categoryFindUnique,
      findMany: categoryFindMany,
      create: categoryCreate,
      update: categoryUpdate,
      delete: categoryDelete,
      count: categoryCount,
    },
    product: { count: productCount },
    $transaction: vi.fn(async (operations: Promise<unknown>[]) => Promise.all(operations)),
  };
  const audit = { record: vi.fn(async () => undefined) };
  const logger = { info: vi.fn(), warn: vi.fn() };
  const env = {
    APP_BASE_URL: 'https://storefront.example',
    REVALIDATE_SECRET: 'test-revalidate-secret',
  };
  const service = new CategoriesService(
    env as unknown as AppEnv,
    prisma as unknown as PrismaService,
    logger as unknown as JsonLogger,
    audit as unknown as AuditService,
    {} as StorageService,
  );
  return { service, audit };
}

describe('category public cache invalidation', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    [
      'create',
      (service: CategoriesService) =>
        service.create(
          {
            code: 'new-category',
            slug: 'new-category',
            parentId: null,
            sortOrder: 10,
            enabled: true,
            visible: true,
            translations: [{ locale: 'en-US', name: 'New Category', description: null }],
          },
          'actor-1',
          'request-create',
        ),
    ],
    [
      'update',
      (service: CategoriesService) =>
        service.update(CATEGORY_ID, { enabled: false }, 'actor-1', 'request-update'),
    ],
    [
      'move',
      (service: CategoriesService) =>
        service.move(CATEGORY_ID, null, 'actor-1', 'request-move', 20),
    ],
    [
      'reorder',
      (service: CategoriesService) =>
        service.reorder(null, [CATEGORY_ID], 'actor-1', 'request-reorder'),
    ],
    [
      'delete',
      (service: CategoriesService) => service.remove(CATEGORY_ID, 'actor-1', 'request-delete'),
    ],
  ])('revalidates categories after a successful %s', async (_name, operation) => {
    const { service } = createHarness();

    await operation(service);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://storefront.example/api/revalidate?tag=categories',
      expect.objectContaining({
        method: 'POST',
        headers: { 'x-revalidate-secret': 'test-revalidate-secret' },
      }),
    );
  });

  it('keeps the committed write successful when revalidation fails', async () => {
    const { service, audit } = createHarness();
    fetchMock.mockRejectedValueOnce(new Error('storefront unavailable'));

    await expect(
      service.update(CATEGORY_ID, { enabled: false }, 'actor-1', 'request-update'),
    ).resolves.toEqual({ id: CATEGORY_ID });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'category.update', entityId: CATEGORY_ID }),
    );
  });
});
