import { createHash } from 'node:crypto';
import type { PrismaClient } from '@b2b/database';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ProductBulkImportParser,
  type ParsedProductImage,
  type ParsedProductRow,
  type ParsedProductWorkbook,
} from './product-bulk-import-parser';
import { validateAndStageProductImport } from './validation';

const imageBytes = Buffer.from('UNIQUE_PRODUCT_IMAGE_BYTES_SENTINEL');
const image: ParsedProductImage = {
  source: 'drawing',
  rowNumber: 2,
  columnNumber: 18,
  mediaName: 'product.png',
  mimeType: 'image/png',
  width: 1200,
  height: 1200,
  sizeBytes: imageBytes.byteLength,
  sha256: createHash('sha256').update(imageBytes).digest('hex'),
  bytes: imageBytes,
};
const row: ParsedProductRow = {
  rowNumber: 2,
  sku: 'IMPORT-PAYLOAD-1',
  slug: 'import-payload-1',
  nameEn: 'Import payload test',
  descriptionEn: null,
  nameZh: null,
  descriptionZh: null,
  lengthMm: null,
  widthMm: null,
  heightMm: null,
  weightGrams: null,
  packaging: null,
  cartonLengthCm: null,
  cartonWidthCm: null,
  cartonHeightCm: null,
  cartonWeightKg: null,
  cartonQuantity: null,
  priceCny: null,
  sortOrder: 0,
  images: [image],
};
const parsedWorkbook: ParsedProductWorkbook = {
  templateVersion: 'optimized-v1',
  fileSha256: 'a'.repeat(64),
  rows: [row],
  errors: [],
  warnings: [],
  imageCount: 1,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('validateAndStageProductImport', () => {
  it('writes image bytes to storage and persists metadata only in validation JSONB', async () => {
    vi.spyOn(ProductBulkImportParser.prototype, 'parse').mockResolvedValue(parsedWorkbook);
    let persistedPayload: unknown;
    const transaction = {
      fileAsset: {
        create: vi.fn(async () => ({ id: '11111111-1111-4111-8111-111111111111' })),
      },
      productImportValidation: {
        create: vi.fn(async (input: { data: { payload: unknown } }) => {
          persistedPayload = input.data.payload;
          return input.data;
        }),
      },
    };
    const prisma = {
      productImportValidation: { findUnique: vi.fn(async () => null) },
      category: { findUnique: vi.fn(async () => ({ enabled: true })) },
      dictionaryItem: {
        findFirst: vi.fn(async ({ where }: { where: { type: { code: string } } }) => ({
          id: where.type.code === 'product_lifecycle' ? 'lifecycle-id' : 'publish-id',
          code: where.type.code === 'product_lifecycle' ? 'available' : 'draft',
          enabled: true,
        })),
      },
      product: {
        findMany: vi.fn(async () => []),
        findUnique: vi.fn(async () => null),
      },
      $transaction: vi.fn(async (callback: (client: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    } as unknown as PrismaClient;
    const storage = {
      put: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
    };

    const outcome = await validateAndStageProductImport(
      {
        buffer: Buffer.from('mocked workbook'),
        settings: {
          categoryId: '22222222-2222-4222-8222-222222222222',
          publishStatus: 'draft',
          lifecycleStatus: 'available',
          tagIds: [],
          templateVersion: 'optimized-v1',
        },
        actor: {
          id: '33333333-3333-4333-8333-333333333333',
          canUpdateCost: true,
          canPublish: true,
        },
        maxImageBytes: 10 * 1024 * 1024,
        maxPixels: 50_000_000,
        validationId: '44444444-4444-4444-8444-444444444444',
      },
      { prisma, storage },
    );

    expect(outcome.result.validationId).toBe('44444444-4444-4444-8444-444444444444');
    expect(storage.put).toHaveBeenCalledWith(
      expect.stringMatching(/^product-image\//),
      imageBytes,
      'image/png',
    );
    const assetData = transaction.fileAsset.create.mock.calls[0]?.[0]?.data;
    expect(assetData).not.toHaveProperty('bytes');

    const serialized = JSON.stringify(persistedPayload);
    expect(serialized).not.toContain('"bytes"');
    expect(serialized).not.toContain('"type":"Buffer"');
    expect(serialized).not.toContain(imageBytes.toString('base64'));
    expect(serialized).toContain('"fileAssetId":"11111111-1111-4111-8111-111111111111"');
    expect(serialized).toContain('"storageKey":"product-image/');
  });
});
