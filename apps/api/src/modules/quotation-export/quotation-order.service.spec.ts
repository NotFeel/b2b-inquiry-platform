import { beforeEach, describe, expect, it, vi } from 'vitest';
import Decimal from 'decimal.js';
import type { AuditService } from '../../common/services/audit.service';
import type { JsonLogger } from '../../common/logger.service';
import type { CategoriesService } from '../categories/categories.service';
import type { StorageService } from '../../common/services/storage.service';
import type { PrismaService } from '../../prisma/prisma.service';
import { QuotationOrderService } from './quotation-order.service';

const CATEGORY_ID = '0f5e5c7a-1793-4d04-a8ee-4f0c11c1bff5';
const DESCENDANT_ID = '3f074cf0-c2a6-4ef9-850b-2e0b1c73e269';

describe('quotation product search', () => {
  const findMany = vi.fn();
  const resolveAdminCategoryScope = vi.fn();
  let service: QuotationOrderService;

  beforeEach(() => {
    vi.clearAllMocks();
    findMany.mockResolvedValue([
      {
        id: '299dfcb5-a758-4c3a-a468-4c934ff59daf',
        sku: 'SKU-100',
        priceCny: new Decimal('12.3400'),
        publishStatus: 'PUBLISHED',
        cartonLengthCm: 20,
        cartonWidthCm: 10,
        cartonHeightCm: 8,
        cartonWeightKg: new Decimal('1.250'),
        cartonQuantity: 12,
        translations: [{ name: 'Sample product' }],
        images: [
          {
            fileAssetId: '7de1926a-064f-4559-8110-40960cae5e70',
            altText: 'Sample',
          },
        ],
      },
    ]);
    resolveAdminCategoryScope.mockResolvedValue([CATEGORY_ID, DESCENDANT_ID]);
    const prisma = { product: { findMany } } as unknown as PrismaService;
    const categories = { resolveAdminCategoryScope } as unknown as CategoriesService;
    const storage = {
      adminProductImageUrl: (id: string) => `/api/v1/admin/media/assets/${id}/preview`,
    } as StorageService;
    const logger = { error: vi.fn(), warn: vi.fn() } as unknown as JsonLogger;
    service = new QuotationOrderService(prisma, {} as AuditService, storage, categories, logger);
  });

  it('searches SKU/name within the selected category subtree and returns picker fields', async () => {
    const result = await service.products('sku-1', CATEGORY_ID, true, 'en-US');

    expect(resolveAdminCategoryScope).toHaveBeenCalledWith(CATEGORY_ID, true);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          categoryId: { in: [CATEGORY_ID, DESCENDANT_ID] },
          OR: [
            { sku: { contains: 'sku-1', mode: 'insensitive' } },
            {
              translations: {
                some: { locale: 'en-US', name: { contains: 'sku-1', mode: 'insensitive' } },
              },
            },
          ],
        }),
      }),
    );
    expect(result[0]).toMatchObject({
      sku: 'SKU-100',
      name: 'Sample product',
      imageUrl: '/api/v1/admin/media/assets/7de1926a-064f-4559-8110-40960cae5e70/preview',
      imageAlt: 'Sample',
      publishStatus: 'published',
      costCny: '12.34',
    });
  });

  it('omits internal cost when the actor cannot read it', async () => {
    const result = await service.products(undefined, undefined, false, 'en-US');
    expect(result[0]?.costCny).toBeNull();
  });
});
