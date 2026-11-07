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
        lifecycleStatus: 'AVAILABLE',
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

describe('order list aggregation', () => {
  it('returns per-type current documents and item snapshot totals', async () => {
    const now = new Date('2026-11-07T10:00:00.000Z');
    const orderFindMany = vi.fn(async () => [
      {
        id: '11111111-2222-4333-8444-555555555555',
        orderNo: 'O-20261107-AAAAAA',
        status: 'CONFIRMED',
        currencyCode: 'USD',
        totalAmountCny: new Decimal('1250.00'),
        totalAmountForeign: new Decimal('172.50'),
        orderDate: new Date('2026-11-07T00:00:00.000Z'),
        customerSnapshot: { companyName: 'ACME', contactName: 'Bob', countryCode: 'US' },
        buyerCompanyName: 'ACME',
        buyerContactName: 'Bob',
        buyerCountryCode: 'US',
        version: 2,
        updatedAt: now,
      },
    ]);
    const orderCount = vi.fn(async () => 1);
    const documentFindMany = vi.fn(async () => [
      {
        id: '22222222-3333-4444-8555-666666666666',
        orderId: '11111111-2222-4333-8444-555555555555',
        documentType: 'PI',
        documentNo: 'PI-1',
        revisionNo: 2,
        status: 'DRAFT',
        createdAt: new Date('2026-11-07T09:00:00.000Z'),
        updatedAt: now,
        issuedAt: null,
        totalAmount: new Decimal('172.50'),
        currency: 'USD',
        pdfFileKey: null,
      },
      {
        id: '33333333-4444-4555-8666-777777777777',
        orderId: '11111111-2222-4333-8444-555555555555',
        documentType: 'PI',
        documentNo: 'PI-1',
        revisionNo: 1,
        status: 'SUPERSEDED',
        createdAt: new Date('2026-11-07T08:00:00.000Z'),
        updatedAt: now,
        issuedAt: new Date('2026-11-07T08:30:00.000Z'),
        totalAmount: new Decimal('172.50'),
        currency: 'USD',
        pdfFileKey: 'private/commercial-documents/old.pdf',
      },
      {
        id: '44444444-5555-4666-8777-888888888888',
        orderId: '11111111-2222-4333-8444-555555555555',
        documentType: 'CI',
        documentNo: 'CI-1',
        revisionNo: 1,
        status: 'ISSUED',
        createdAt: new Date('2026-11-07T09:30:00.000Z'),
        updatedAt: now,
        issuedAt: new Date('2026-11-07T09:30:00.000Z'),
        totalAmount: new Decimal('172.50'),
        currency: 'USD',
        pdfFileKey: 'private/commercial-documents/ci.pdf',
      },
    ]);
    const orderItemGroupBy = vi.fn(async () => [
      {
        orderId: '11111111-2222-4333-8444-555555555555',
        _count: { _all: 2 },
        _sum: { quantity: new Decimal('528'), cartonCount: 3 },
      },
    ]);
    const prisma = {
      order: { count: orderCount, findMany: orderFindMany },
      commercialDocument: { findMany: documentFindMany },
      orderItem: { groupBy: orderItemGroupBy },
      $transaction: async (operations: Promise<unknown>[]) => Promise.all(operations),
    } as unknown as PrismaService;
    const service = new QuotationOrderService(
      prisma,
      {} as AuditService,
      {} as StorageService,
      {} as CategoriesService,
      { error: vi.fn(), warn: vi.fn() } as unknown as JsonLogger,
    );

    const result = await service.listOrders({ page: 1, pageSize: 20, sortOrder: 'desc' } as never);

    expect(documentFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          orderId: { in: ['11111111-2222-4333-8444-555555555555'] },
          status: { not: 'CANCELLED' },
        },
      }),
    );
    expect(result.data[0]).toMatchObject({
      itemSummary: { lineCount: 2, totalQuantity: '528', totalCartons: 3 },
      documents: {
        piCount: 2,
        ciCount: 1,
        pi: { documentNo: 'PI-1', revisionNo: 2, status: 'DRAFT', hasPdf: false },
        ci: { documentNo: 'CI-1', revisionNo: 1, status: 'ISSUED', hasPdf: true },
      },
    });
    expect(result.data[0]?.updatedAt).toBe(now.toISOString());
  });
});
