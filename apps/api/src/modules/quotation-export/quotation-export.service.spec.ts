import ExcelJS from 'exceljs';
import Decimal from 'decimal.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../prisma/prisma.service';
import { CategoriesService } from '../categories/categories.service';
import { StorageService } from '../../common/services/storage.service';
import { JsonLogger } from '../../common/logger.service';
import { QuotationExportService } from './quotation-export.service';

const CATEGORY_ID = '11111111-1111-4111-8111-111111111111';
const PRODUCT_ID = '22222222-2222-4222-8222-222222222222';
const PRODUCT_ID_2 = '33333333-3333-4333-8333-333333333333';
const TEMPLATE_ID = '55555555-5555-4555-8555-555555555555';
const IMAGE_KEY = 'product-image/2026/10/cover.png';
const TEMPLATE_KEY = 'quote-template/2026/10/B2B_Quotation_Template.xlsx';
const REAL_TEMPLATE = readFileSync(
  resolve(process.cwd(), '../../assets/templates/B2B_Quotation_Template.xlsx'),
);
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zt9sAAAAASUVORK5CYII=',
  'base64',
);

const now = new Date('2026-10-30T10:30:00.000Z');

function product(overrides: Record<string, unknown> = {}) {
  return {
    id: PRODUCT_ID,
    sku: 'SKU-001',
    slug: 'sku-001',
    categoryId: CATEGORY_ID,
    priceCny: new Decimal('3.6966991739'),
    lifecycleStatus: 'AVAILABLE',
    publishStatus: 'PUBLISHED',
    cartonLengthCm: 40,
    cartonWidthCm: 30,
    cartonHeightCm: 30,
    cartonWeightKg: new Decimal('12.5'),
    cartonQuantity: 4,
    lengthMm: 100,
    widthMm: 80,
    heightMm: 60,
    weightGrams: 450,
    packaging: 'Carton',
    createdAt: now,
    updatedAt: now,
    translations: [
      { productId: PRODUCT_ID, locale: 'en-US', name: 'Steel gate', description: null },
    ],
    category: {
      id: CATEGORY_ID,
      parentId: null,
      translations: [{ categoryId: CATEGORY_ID, locale: 'en-US', name: 'Gates' }],
    },
    images: [
      {
        id: '44444444-4444-4444-8444-444444444444',
        productId: PRODUCT_ID,
        fileAssetId: null,
        storageKey: IMAGE_KEY,
        altText: 'Steel gate',
        sortOrder: 0,
        isCover: true,
        width: 1,
        height: 1,
        sizeBytes: 1n,
        sha256: null,
        deleteState: 'READY',
        createdAt: now,
        asset: null,
      },
    ],
    ...overrides,
  };
}

function quoteTemplate(overrides: Record<string, unknown> = {}) {
  return {
    id: TEMPLATE_ID,
    name: 'B2B Quotation Template',
    templateType: 'product_quote',
    version: 2,
    storageKey: TEMPLATE_KEY,
    sheetName: 'Quotation',
    headerRow: 7,
    itemStartRow: 8,
    fieldMapping: {
      A: 'product.sku',
      B: 'product.image',
      C: 'product.name',
      D: 'product.price_cny',
      E: 'product.carton_qty',
      F: 'product.carton_size_cm',
      G: 'product.carton_weight_kg',
    },
    validationReport: { requiredFieldsPresent: true },
    status: 'active',
    uploadedById: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function templateAsset(overrides: Record<string, unknown> = {}) {
  return {
    id: '66666666-6666-4666-8666-666666666666',
    storageKey: TEMPLATE_KEY,
    originalName: 'B2B_Quotation_Template.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    sizeBytes: BigInt(REAL_TEMPLATE.byteLength),
    purpose: 'quote-template',
    status: 'ready',
    isPublic: false,
    ...overrides,
  };
}

function setup(rows: ReturnType<typeof product> | ReturnType<typeof product>[] = product()) {
  const template = quoteTemplate();
  const asset = templateAsset();
  const productRows = Array.isArray(rows) ? rows : [rows];
  const firstRow = productRows[0] ?? product();
  const prisma = {
    product: {
      count: vi.fn().mockResolvedValue(productRows.length),
      findMany: vi.fn().mockResolvedValue(productRows),
    },
    category: {
      findMany: vi.fn().mockResolvedValue(firstRow.category ? [firstRow.category] : []),
    },
    quoteTemplate: {
      findMany: vi.fn().mockResolvedValue([template]),
      findUnique: vi.fn().mockResolvedValue(template),
    },
    fileAsset: {
      findMany: vi.fn().mockResolvedValue([asset]),
      findUnique: vi.fn().mockResolvedValue(asset),
    },
    auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-1' }) },
    $transaction: vi.fn(async (operations: Promise<unknown>[]) => Promise.all(operations)),
  };
  const categories = {
    resolveAdminCategoryScope: vi.fn().mockResolvedValue([CATEGORY_ID]),
  };
  const storage = {
    get: vi.fn(async (key: string) => {
      if (key === TEMPLATE_KEY) return REAL_TEMPLATE;
      if (key === IMAGE_KEY) return PNG;
      throw new Error(`Unexpected storage key: ${key}`);
    }),
    publicUrl: vi.fn((key: string) => `/files/${key}`),
    adminProductImageUrl: vi.fn((id: string) => `/admin/files/${id}`),
  };
  const logger = { info: vi.fn() };
  const service = new QuotationExportService(
    prisma as unknown as PrismaService,
    categories as unknown as CategoriesService,
    storage as unknown as StorageService,
    logger as unknown as JsonLogger,
  );
  return { service, prisma, categories, storage, logger, template, asset };
}

const selection = {
  categoryId: CATEGORY_ID,
  includeDescendants: true,
  productIds: [PRODUCT_ID],
  markupPercent: '15',
  currencyCode: 'USD' as const,
  exchangeRate: '0.1385',
};

const exportInput = {
  templateId: TEMPLATE_ID,
  categoryId: CATEGORY_ID,
  includeDescendants: true,
  productIds: [PRODUCT_ID],
  header: {
    companyName: 'Example Ltd.',
    contactPerson: 'Jerry',
    email: 'sales@example.com',
    phone: '+86 190 7428 9250',
    quotationTitle: 'Price List',
  },
  pricing: {
    markupPercent: '15',
    currencyCode: 'USD' as const,
    exchangeRate: '0.1385',
  },
};

describe('QuotationExportService', () => {
  it('lists only sanitized, active, exportable template metadata', async () => {
    const { service, prisma } = setup();
    const result = await service.listTemplates();

    expect(result).toEqual([
      {
        id: TEMPLATE_ID,
        name: 'B2B Quotation Template',
        version: 2,
        fileName: 'B2B_Quotation_Template.xlsx',
        sheetName: 'Quotation',
        status: 'active',
      },
    ]);
    expect(prisma.fileAsset.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          purpose: 'quote-template',
          status: 'ready',
          isPublic: false,
        }),
      }),
    );
    expect(JSON.stringify(result)).not.toContain(TEMPLATE_KEY);
  });

  it('lists cost readiness without exposing the CNY cost to actors lacking cost permission', async () => {
    const { service } = setup();
    const result = await service.listProducts(
      { ...selection, search: '', locale: 'en-US' },
      false,
      false,
    );

    expect(result.items[0]).toMatchObject({
      id: PRODUCT_ID,
      sku: 'SKU-001',
      hasCost: true,
      costCny: null,
      hasOriginalImage: true,
      categoryPath: 'Gates',
      eligibilityCodes: [],
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('3.6966991739');
    expect(serialized).not.toContain('priceCny');
    expect(serialized).not.toContain(IMAGE_KEY);
  });

  it('returns the exact database CNY cost only when cost permission is granted', async () => {
    const { service } = setup();
    const result = await service.listProducts(
      { ...selection, search: '', locale: 'en-US' },
      false,
      true,
    );

    expect(result.items[0]).toMatchObject({
      hasCost: true,
      costCny: '3.6966991739',
    });
    expect(JSON.stringify(result)).not.toContain('priceCny');
    expect(JSON.stringify(result)).not.toContain(IMAGE_KEY);
  });

  it('applies the publish/lifecycle limit in SQL unless unpublished export is allowed', async () => {
    const { service, prisma } = setup();
    const query = { ...selection, search: '', locale: 'en-US' as const };

    await service.listProducts(query, false, false);
    expect(prisma.product.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          publishStatus: 'PUBLISHED',
          lifecycleStatus: { not: 'DISCONTINUED' },
        }),
      }),
    );

    await service.listProducts(query, true, false);
    const privilegedWhere = prisma.product.findMany.mock.calls.at(-1)?.[0]?.where;
    expect(privilegedWhere).toMatchObject({ lifecycleStatus: { not: 'DISCONTINUED' } });
    expect(privilegedWhere).not.toHaveProperty('publishStatus');
  });

  it('aggregates product validation errors and returns no cost or image key', async () => {
    const invalid = product({
      priceCny: null,
      cartonQuantity: null,
      cartonLengthCm: 10,
      cartonWidthCm: null,
      cartonHeightCm: 20,
      cartonWeightKg: null,
      translations: [],
      images: [],
    });
    const { service } = setup(invalid);
    const result = await service.preview(selection, false);

    expect(result.items).toEqual([]);
    expect(new Set(result.errors.map((issue) => issue.code))).toEqual(
      new Set([
        'MISSING_COST',
        'MISSING_ENGLISH_NAME',
        'MISSING_PRIMARY_IMAGE',
        'INVALID_CARTON_QUANTITY',
        'INVALID_CARTON_DIMENSIONS',
        'INVALID_CARTON_WEIGHT',
      ]),
    );
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('priceCny');
    expect(serialized).not.toContain(IMAGE_KEY);
  });

  it('preserves the requested product order in preview and exported worksheet rows', async () => {
    const first = product();
    const second = product({
      id: PRODUCT_ID_2,
      sku: 'SKU-002',
      translations: [
        { productId: PRODUCT_ID_2, locale: 'en-US', name: 'Second product', description: null },
      ],
    });
    const { service } = setup([first, second]);
    const requestedOrder = [PRODUCT_ID_2, PRODUCT_ID];

    const preview = await service.preview({ ...selection, productIds: requestedOrder }, false);
    expect(preview.items.map((item) => item.productId)).toEqual(requestedOrder);
    expect(preview.items.map((item) => item.sku)).toEqual(['SKU-002', 'SKU-001']);

    const exported = await service.export(
      { ...exportInput, productIds: requestedOrder },
      false,
      'admin-id',
      'request-id',
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(
      exported.buffer as unknown as Parameters<typeof workbook.xlsx.load>[0],
    );
    const worksheet = workbook.getWorksheet('Quotation');
    if (!worksheet) throw new Error('Quotation worksheet missing');

    expect(worksheet.getCell('A8').value).toBe('SKU-002');
    expect(worksheet.getCell('C8').value).toBe('Second product');
    expect(worksheet.getCell('A9').value).toBe('SKU-001');
    expect(worksheet.getCell('C9').value).toBe('Steel gate');
  });

  it('refuses the whole export before storage or audit when any product is invalid', async () => {
    const invalid = product({ priceCny: null });
    const { service, storage, prisma } = setup(invalid);

    await expect(
      service.export(exportInput, false, 'admin-id', 'request-id'),
    ).rejects.toMatchObject({ code: 'QUOTATION_EXPORT_VALIDATION_FAILED', status: 422 });
    expect(storage.get).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('writes redacted audit metadata only after the workbook succeeds', async () => {
    const { service, prisma, storage, logger } = setup();
    const result = await service.export(exportInput, false, 'admin-id', 'request-id');

    expect(result.filename).toMatch(/^Quotation_USD_\d{8}_\d{6}\.xlsx$/);
    expect(result.buffer.subarray(0, 2).toString()).toBe('PK');
    expect(storage.get).toHaveBeenCalledWith(TEMPLATE_KEY);
    expect(storage.get).toHaveBeenCalledWith(IMAGE_KEY);
    expect(prisma.auditLog.create).toHaveBeenCalledOnce();
    const metadata = prisma.auditLog.create.mock.calls[0]?.[0]?.data?.metadata;
    expect(metadata).toMatchObject({
      templateId: TEMPLATE_ID,
      templateVersion: 2,
      templateSheetName: 'Quotation',
      selectedProductCount: 1,
      currencyCode: 'USD',
      markupPercent: '15',
      exchangeRate: '0.1385',
      requestId: 'request-id',
      outcome: 'SUCCEEDED',
    });
    const serialized = JSON.stringify(metadata);
    expect(serialized).not.toContain('sales@example.com');
    expect(serialized).not.toContain('+86 190 7428 9250');
    expect(serialized).not.toContain(TEMPLATE_KEY);
    expect(serialized).not.toContain(IMAGE_KEY);
    expect(serialized).not.toContain('3.6966991739');
    expect(logger.info).toHaveBeenCalledWith('quotation_export.completed', expect.any(Object));
  });

  it('returns no file when the required audit write fails', async () => {
    const { service, prisma, logger } = setup();
    prisma.auditLog.create.mockRejectedValueOnce(new Error('audit unavailable'));

    await expect(service.export(exportInput, false, 'admin-id', 'request-id')).rejects.toThrow(
      'audit unavailable',
    );
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('fails the whole export when an original image cannot be read', async () => {
    const { service, storage, prisma } = setup();
    storage.get.mockImplementation(async (key: string) => {
      if (key === TEMPLATE_KEY) return REAL_TEMPLATE;
      throw new Error('storage offline');
    });

    await expect(
      service.export(exportInput, false, 'admin-id', 'request-id'),
    ).rejects.toMatchObject({ code: 'QUOTATION_EXPORT_IMAGE_UNAVAILABLE', status: 422 });
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', null],
    ['wrong type', quoteTemplate({ templateType: 'pi' })],
    ['inactive', quoteTemplate({ status: 'inactive' })],
    ['missing sheet', quoteTemplate({ sheetName: null })],
    ['failed validation', quoteTemplate({ validationReport: { requiredFieldsPresent: false } })],
  ])('refuses a %s template before reading products or files', async (_label, template) => {
    const { service, prisma, storage } = setup();
    prisma.quoteTemplate.findUnique.mockResolvedValueOnce(template);

    await expect(
      service.export(exportInput, false, 'admin-id', 'request-id'),
    ).rejects.toMatchObject({ code: 'QUOTE_TEMPLATE_INVALID', status: 422 });
    expect(prisma.product.findMany).not.toHaveBeenCalled();
    expect(storage.get).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', null],
    ['not ready', templateAsset({ status: 'processing' })],
    ['public', templateAsset({ isPublic: true })],
    ['wrong purpose', templateAsset({ purpose: 'product-image' })],
  ])('refuses a %s template file before generating a quotation', async (_label, asset) => {
    const { service, prisma, storage } = setup();
    prisma.fileAsset.findUnique.mockResolvedValueOnce(asset);

    await expect(
      service.export(exportInput, false, 'admin-id', 'request-id'),
    ).rejects.toMatchObject({ code: 'QUOTE_TEMPLATE_INVALID', status: 422 });
    expect(storage.get).not.toHaveBeenCalled();
  });

  it('does not generate a file when private template storage is unavailable', async () => {
    const { service, storage, prisma } = setup();
    storage.get.mockImplementation(async (key: string) => {
      if (key === TEMPLATE_KEY) throw new Error('template storage offline');
      return PNG;
    });

    await expect(
      service.export(exportInput, false, 'admin-id', 'request-id'),
    ).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE', status: 503 });
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('revalidates the selected workbook and refuses a stale or malformed template', async () => {
    const { service, storage, prisma } = setup();
    storage.get.mockImplementation(async (key: string) => {
      if (key === TEMPLATE_KEY) return Buffer.from('not an xlsx');
      return PNG;
    });

    await expect(
      service.export(exportInput, false, 'admin-id', 'request-id'),
    ).rejects.toMatchObject({
      code: 'QUOTE_TEMPLATE_INVALID',
      status: 422,
      details: { reason: 'WORKBOOK_UNREADABLE' },
    });
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });
});
