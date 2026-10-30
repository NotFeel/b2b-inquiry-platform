import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ERROR_CODES } from '@b2b/contracts';
import { describe, expect, it, vi } from 'vitest';
import type { AppEnv } from '../../config/config.module';
import type { AuditService } from '../../common/services/audit.service';
import type { StorageService } from '../../common/services/storage.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { ProductsService } from '../products/products.service';
import { QuoteService } from './quote.service';

const ACTOR_ID = '11111111-1111-4111-8111-111111111111';
const ASSET_ID = '22222222-2222-4222-8222-222222222222';
const TEMPLATE_ID = '33333333-3333-4333-8333-333333333333';
const REAL_TEMPLATE = readFileSync(
  resolve(process.cwd(), '../../assets/templates/B2B_Quotation_Template.xlsx'),
);

function asset(overrides: Record<string, unknown> = {}) {
  return {
    id: ASSET_ID,
    storageKey: 'quote-template/2026/10/template.xlsx',
    originalName: 'B2B_Quotation_Template.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    sizeBytes: 10_240n,
    purpose: 'quote-template',
    status: 'ready',
    isPublic: false,
    uploadedById: ACTOR_ID,
    ...overrides,
  };
}

function template(overrides: Record<string, unknown> = {}) {
  return {
    id: TEMPLATE_ID,
    name: 'B2B quotation',
    templateType: 'product_quote',
    version: 3,
    storageKey: 'quote-template/2026/10/template.xlsx',
    sheetName: 'Quotation',
    headerRow: 7,
    itemStartRow: 8,
    fieldMapping: { A: 'product.sku' },
    validationReport: { requiredFieldsPresent: true },
    status: 'draft',
    uploadedById: ACTOR_ID,
    createdAt: new Date('2026-10-30T00:00:00.000Z'),
    updatedAt: new Date('2026-10-30T00:00:00.000Z'),
    ...overrides,
  };
}

function harness(fileAsset = asset()) {
  const audit = { record: vi.fn(async () => undefined) };
  const prisma = {
    fileAsset: {
      findUnique: vi.fn(async () => fileAsset),
      findMany: vi.fn(async () => [fileAsset]),
    },
    quoteTemplate: {
      findFirst: vi.fn(async () => template({ version: 2 })),
      findUnique: vi.fn(async () => template()),
      findMany: vi.fn(async () => [template()]),
      count: vi.fn(async () => 0),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) =>
        template({ ...data, id: TEMPLATE_ID }),
      ),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => template(data)),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    quoteExportJob: { count: vi.fn(async () => 0) },
    fileDeletionJob: {
      findUnique: vi.fn(async (): Promise<{ status: string } | null> => null),
      findMany: vi.fn(async (): Promise<Array<{ entityId: string; status: string }>> => []),
      upsert: vi.fn(async ({ create }: { create: Record<string, unknown> }) => create),
    },
    $transaction: vi.fn(async (callback: (client: unknown) => Promise<unknown>) =>
      callback(prisma),
    ),
  };
  const storage = {
    get: vi.fn(async () => REAL_TEMPLATE),
    delete: vi.fn(async () => undefined),
  };
  const service = new QuoteService(
    { QUOTE_EXPORT_MAX_PRODUCTS: 200 } as AppEnv,
    prisma as unknown as PrismaService,
    {} as ProductsService,
    audit as unknown as AuditService,
    storage as unknown as StorageService,
  );
  return { service, prisma, storage, audit };
}

const INPUT = {
  name: 'B2B quotation',
  templateType: 'product_quote' as const,
  fileAssetId: ASSET_ID,
};

describe('QuoteService quote templates', () => {
  it.each([
    ['another user', { uploadedById: '99999999-9999-4999-8999-999999999999' }],
    ['another purpose', { purpose: 'product-image' }],
    ['a public asset', { isPublic: true }],
    ['an unavailable asset', { status: 'processing' }],
  ])('rejects %s', async (_label, overrides) => {
    const { service } = harness(asset(overrides));

    await expect(service.createTemplateVersion(INPUT, ACTOR_ID, 'request-1')).rejects.toMatchObject(
      {
        code: ERROR_CODES.quoteTemplateInvalid,
      },
    );
  });

  it('inspects the real workbook and creates the next immutable draft version', async () => {
    const { service, prisma, storage } = harness();

    const created = await service.createTemplateVersion(INPUT, ACTOR_ID, 'request-1');

    expect(storage.get).toHaveBeenCalledWith('quote-template/2026/10/template.xlsx');
    expect(prisma.quoteTemplate.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: 'B2B quotation',
        templateType: 'product_quote',
        version: 3,
        sheetName: 'Quotation',
        headerRow: 7,
        itemStartRow: 8,
        status: 'draft',
        uploadedById: ACTOR_ID,
        fieldMapping: expect.objectContaining({
          A: 'product.sku',
          D: 'product.price_cny',
          G: 'product.carton_weight_kg',
        }),
        validationReport: expect.objectContaining({
          requiredFieldsPresent: true,
          missingRequiredFields: [],
        }),
      }),
    });
    expect(created).toMatchObject({
      id: TEMPLATE_ID,
      name: 'B2B quotation',
      templateType: 'product_quote',
      version: 3,
      fileName: 'B2B_Quotation_Template.xlsx',
      fileSizeBytes: '10240',
    });
    expect(JSON.stringify(created)).not.toContain('storageKey');
  });

  it('disables the previous active template of the same type when activating', async () => {
    const { service, prisma } = harness();

    const updated = await service.setTemplateStatus(
      TEMPLATE_ID,
      'active',
      ACTOR_ID,
      'request-2',
    );

    expect(prisma.quoteTemplate.updateMany).toHaveBeenCalledWith({
      where: {
        templateType: 'product_quote',
        status: 'active',
        id: { not: TEMPLATE_ID },
      },
      data: { status: 'disabled' },
    });
    expect(prisma.quoteTemplate.update).toHaveBeenCalledWith({
      where: { id: TEMPLATE_ID },
      data: { status: 'active' },
    });
    expect(updated).toMatchObject({ id: TEMPLATE_ID, status: 'active' });
    expect(JSON.stringify(updated)).not.toContain('storageKey');
  });

  it('refuses to activate a template whose structural check failed', async () => {
    const { service, prisma } = harness();
    prisma.quoteTemplate.findUnique.mockResolvedValueOnce(
      template({ validationReport: { requiredFieldsPresent: false } }),
    );

    await expect(
      service.setTemplateStatus(TEMPLATE_ID, 'active', ACTOR_ID, 'request-3'),
    ).rejects.toMatchObject({ code: ERROR_CODES.quoteTemplateInvalid });
    expect(prisma.quoteTemplate.updateMany).not.toHaveBeenCalled();
  });

  it('refuses to reactivate a version while its physical deletion needs a retry', async () => {
    const { service, prisma } = harness();
    prisma.fileDeletionJob.findUnique.mockResolvedValueOnce({ status: 'FAILED' });

    const error = await service
      .setTemplateStatus(TEMPLATE_ID, 'active', ACTOR_ID, 'request-4')
      .catch((reason: unknown) => reason);

    expect(error).toMatchObject({
      code: ERROR_CODES.quoteTemplateInUse,
      details: { reason: 'DELETION_PENDING' },
    });
    expect((error as { getStatus: () => number }).getStatus()).toBe(409);
    expect(prisma.quoteTemplate.update).not.toHaveBeenCalled();
  });

  it('downloads a private workbook with a sanitized filename', async () => {
    const { service, storage } = harness(asset({ originalName: '../B2B_Quotation_Template.xlsx' }));

    const file = await service.getTemplateFile(TEMPLATE_ID);

    expect(storage.get).toHaveBeenCalledWith('quote-template/2026/10/template.xlsx');
    expect(file.body).toEqual(REAL_TEMPLATE);
    expect(file.filename).toBe('.._B2B_Quotation_Template.xlsx');
    expect(file.mimeType).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(JSON.stringify(file)).not.toContain('storageKey');
  });

  it('refuses to read a file whose asset metadata is unavailable or public', async () => {
    const { service } = harness(asset({ isPublic: true }));

    await expect(service.getTemplateFile(TEMPLATE_ID)).rejects.toMatchObject({
      code: ERROR_CODES.fileNotFound,
    });
  });

  it('refuses download and preview access after physical deletion is queued', async () => {
    const { service, prisma, storage } = harness();
    prisma.fileDeletionJob.findUnique.mockResolvedValue({ status: 'QUEUED' });

    await expect(service.getTemplateFile(TEMPLATE_ID)).rejects.toMatchObject({
      code: ERROR_CODES.fileNotFound,
    });
    await expect(service.previewTemplate(TEMPLATE_ID)).rejects.toMatchObject({
      code: ERROR_CODES.fileNotFound,
    });
    expect(storage.get).not.toHaveBeenCalled();
  });

  it('queues an idempotent physical deletion and disables the version without deleting directly', async () => {
    const { service, prisma, storage, audit } = harness();

    const result = await service.requestTemplateDeletion(TEMPLATE_ID, ACTOR_ID, 'request-delete-1');

    expect(result).toEqual({ status: 'deletion_pending' });
    expect(storage.delete).not.toHaveBeenCalled();
    expect(prisma.quoteTemplate.updateMany).toHaveBeenCalledWith({
      where: { id: TEMPLATE_ID, status: { not: 'disabled' } },
      data: { status: 'disabled' },
    });
    expect(prisma.fileDeletionJob.upsert).toHaveBeenCalledWith({
      where: { idempotencyKey: `quote-template:${TEMPLATE_ID}` },
      create: expect.objectContaining({
        storageKey: 'quote-template/2026/10/template.xlsx',
        entityType: 'quote_template',
        entityId: TEMPLATE_ID,
        requestedBy: ACTOR_ID,
        status: 'QUEUED',
      }),
      update: expect.objectContaining({ status: 'QUEUED', lastErrorCode: null }),
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'quote_template.delete_requested',
        entityType: 'quote_template',
        entityId: TEMPLATE_ID,
        requestId: 'request-delete-1',
      }),
    );
  });

  it('returns the existing queued deletion without creating a duplicate task', async () => {
    const { service, prisma } = harness();
    prisma.fileDeletionJob.findUnique.mockResolvedValueOnce({ status: 'QUEUED' });

    await expect(
      service.requestTemplateDeletion(TEMPLATE_ID, ACTOR_ID, 'request-delete-2'),
    ).resolves.toEqual({ status: 'deletion_pending' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.fileDeletionJob.upsert).not.toHaveBeenCalled();
  });

  it('protects a version referenced by a historical export', async () => {
    const { service, prisma, storage } = harness();
    prisma.quoteExportJob.count.mockResolvedValueOnce(1);

    const error = await service
      .requestTemplateDeletion(TEMPLATE_ID, ACTOR_ID, 'request-delete-3')
      .catch((reason: unknown) => reason);

    expect(error).toMatchObject({
      code: ERROR_CODES.quoteTemplateInUse,
      details: { reason: 'EXPORT_REFERENCES' },
    });
    expect((error as { getStatus: () => number }).getStatus()).toBe(409);
    expect(storage.delete).not.toHaveBeenCalled();
    expect(prisma.fileDeletionJob.upsert).not.toHaveBeenCalled();
  });

  it('keeps a failed physical deletion visible so the operator can retry', async () => {
    const { service, prisma } = harness();
    prisma.fileDeletionJob.findMany.mockResolvedValueOnce([
      { entityId: TEMPLATE_ID, status: 'FAILED' },
    ]);

    const templates = await service.listTemplates();

    expect(templates).toHaveLength(1);
    expect(templates[0]).toMatchObject({ id: TEMPLATE_ID, deletionState: 'failed' });
  });
});
