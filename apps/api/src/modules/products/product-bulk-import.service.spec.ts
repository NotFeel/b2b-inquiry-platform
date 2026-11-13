import { describe, expect, it, vi } from 'vitest';
import type { StoredImportConfiguration, StoredImportPayload } from '@b2b/product-import';
import { configurationHash } from '@b2b/product-import';
import type { AppEnv } from '../../config/config.module';
import type { AuthenticatedActor } from '../../common/request-context';
import type { AuditService } from '../../common/services/audit.service';
import type { StorageService } from '../../common/services/storage.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { DictionaryService } from '../dictionary/dictionary.service';
import type { FilesService } from '../files/files.service';
import type { ProductImagesService } from './product-images.service';
import { ProductBulkImportService } from './product-bulk-import.service';

const CATEGORY_ID = 'df63681e-6377-4ea4-8fef-64459c7b0964';
const FILE_SHA256 = 'a'.repeat(64);

function importFixture() {
  const configuration: StoredImportConfiguration = {
    settings: {
      categoryId: CATEGORY_ID,
      publishStatus: 'draft',
      lifecycleStatus: 'available',
      tagIds: [],
      templateVersion: 'optimized-v1',
    },
    lifecycleStatusItemId: '8570e92e-7140-4d7f-9f4e-711c8ea33879',
    publishStatusItemId: '226b3280-f29c-4b2d-9949-61982ac3f071',
    tagCodes: [],
  };
  const payload = {
    configuration,
    rows: [
      {
        rowNumber: 2,
        sku: 'IMPORT-001',
        slug: 'import-001',
        nameEn: 'Import Product',
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
        images: [],
      },
    ],
  } satisfies StoredImportPayload;
  return {
    payload,
    configHash: configurationHash(FILE_SHA256, configuration),
  };
}

function createHarness() {
  const fixture = importFixture();
  const validation = {
    id: '4d8fd2f2-45d0-4dbe-9fef-61a709585cb1',
    actorId: '7c7fb6ea-7f87-4e0e-aef7-8bd091f55bc3',
    fileSha256: FILE_SHA256,
    configHash: fixture.configHash,
    payload: fixture.payload,
    consumedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
  };
  const transaction = {
    productImportValidation: {
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    product: {
      create: vi.fn(async () => ({ id: 'a3f888e1-c5b4-4791-88ec-82fca5ae8c8b' })),
    },
    outboxEvent: { create: vi.fn() },
    auditLog: { create: vi.fn() },
  };
  const prisma = {
    productImportValidation: {
      findUnique: vi.fn(async () => validation),
    },
    $transaction: vi.fn(async (callback: (client: typeof transaction) => Promise<Date>) =>
      callback(transaction),
    ),
  };
  const images = { revalidatePublicCatalogue: vi.fn(async () => undefined) };
  const audit = { record: vi.fn(async () => undefined) };
  const service = new ProductBulkImportService(
    {} as AppEnv,
    prisma as unknown as PrismaService,
    {} as DictionaryService,
    {} as FilesService,
    {} as StorageService,
    audit as unknown as AuditService,
    images as unknown as ProductImagesService,
  );
  const internals = service as unknown as {
    validateConfiguration: (settings: unknown) => Promise<{ issues: unknown[] }>;
    assertRowsStillUnique: (rows: unknown[]) => Promise<void>;
    resolveStagedAssets: (payload: unknown, actorId: string) => Promise<unknown[]>;
  };
  vi.spyOn(internals, 'validateConfiguration').mockResolvedValue({ issues: [] });
  vi.spyOn(internals, 'assertRowsStillUnique').mockResolvedValue(undefined);
  vi.spyOn(internals, 'resolveStagedAssets').mockResolvedValue([]);
  return { service, validation, images, audit };
}

const actor: AuthenticatedActor = {
  id: '7c7fb6ea-7f87-4e0e-aef7-8bd091f55bc3',
  username: 'importer',
  displayName: 'Importer',
  roles: [],
  permissions: new Set(),
  sessionId: 'session-1',
  mustChangePassword: false,
};

describe('product bulk import public cache invalidation', () => {
  it('invalidates products after a successful atomic commit', async () => {
    const { service, validation, images } = createHarness();

    await expect(
      service.commit('validation-token', actor, 'request-commit'),
    ).resolves.toMatchObject({
      batchId: validation.id,
      createdCount: 1,
    });
    expect(images.revalidatePublicCatalogue).toHaveBeenCalledWith('product_import_committed');
  });

  it('does not invalidate products when the commit transaction fails', async () => {
    const { service, images, audit } = createHarness();
    const prisma = (service as unknown as { prisma: PrismaService }).prisma as unknown as {
      $transaction: (callback: (client: unknown) => Promise<unknown>) => Promise<unknown>;
    };
    prisma.$transaction = vi.fn(async () => {
      throw new Error('constraint failure');
    });

    await expect(service.commit('validation-token', actor, 'request-commit')).rejects.toMatchObject(
      { code: 'IMPORT_ATOMIC_COMMIT_FAILED' },
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'product_import.failed' }),
    );
    expect(images.revalidatePublicCatalogue).not.toHaveBeenCalled();
  });
});
