import type { PrismaClient } from '@b2b/database';
import { describe, expect, it, vi } from 'vitest';
import type { WorkerLogger } from '../logger';
import type { ObjectStorage } from '../storage';
import { processFileDeletion } from './file-delete';

const sourceKey = 'product-image/2026/10/source.png';
const derivativeKey = 'public/products/asset/version/640.webp';

function imageFixture() {
  return {
    id: 'image-1',
    productId: 'product-1',
    fileAssetId: 'asset-1',
    isCover: false,
    asset: {
      derivatives: {
        variants: [
          {
            width: 640,
            height: 480,
            key: derivativeKey,
            format: 'webp',
            sizeBytes: 100,
          },
        ],
      },
    },
  };
}

function transactionMock() {
  return {
    productImage: {
      deleteMany: vi.fn(async () => ({ count: 1 })),
      count: vi.fn(async () => 0),
      findFirst: vi.fn(async () => null),
      update: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    category: { count: vi.fn(async () => 0) },
    ad: { count: vi.fn(async () => 0) },
    pdfConversionJob: {
      count: vi.fn(async () => 0),
      findMany: vi.fn(async () => []),
      findUnique: vi.fn(async () => null),
      update: vi.fn(async () => ({})),
    },
    quoteTemplate: { deleteMany: vi.fn(async () => ({ count: 1 })) },
    fileAsset: {
      deleteMany: vi.fn(async () => ({ count: 1 })),
      findUnique: vi.fn(async () => null),
      update: vi.fn(async () => ({})),
    },
    fileDeletionJob: { updateMany: vi.fn(async () => ({ count: 1 })) },
    auditLog: { create: vi.fn(async () => ({})) },
  };
}

function quoteTemplateDepsWith(
  deleteImpl: (key: string) => Promise<void>,
  references: { exports?: number; sharedVersions?: number } = {},
) {
  const transaction = transactionMock();
  const storageKey = 'quote-template/2026/10/B2B_Quotation_Template.xlsx';
  const prisma = {
    quoteTemplate: {
      findUnique: vi.fn(async () => ({ id: 'template-1', storageKey })),
      count: vi.fn(async () => references.sharedVersions ?? 0),
    },
    quoteExportJob: { count: vi.fn(async () => references.exports ?? 0) },
    $transaction: vi.fn(async (callback: (tx: typeof transaction) => unknown) =>
      callback(transaction),
    ),
  };
  const logger = {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  return {
    deps: {
      prisma: prisma as unknown as PrismaClient,
      storage: { delete: vi.fn(deleteImpl) } as unknown as ObjectStorage,
      logger: logger as unknown as WorkerLogger,
      env: null,
    },
    storageKey,
    transaction,
    logger,
  };
}

function depsWith(deleteImpl: (key: string) => Promise<void>) {
  const transaction = transactionMock();
  const prisma = {
    productImage: { findUnique: vi.fn(async () => imageFixture()) },
    fileDeletionJob: { findFirst: vi.fn(async () => null) },
    $transaction: vi.fn(async (callback: (tx: typeof transaction) => unknown) =>
      callback(transaction),
    ),
  };
  const logger = {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  return {
    deps: {
      prisma: prisma as unknown as PrismaClient,
      storage: { delete: vi.fn(deleteImpl) } as unknown as ObjectStorage,
      logger: logger as unknown as WorkerLogger,
      env: null,
    },
    transaction,
    logger,
  };
}

describe('physical product-image deletion', () => {
  it('deletes the source and every responsive object before clearing DB state', async () => {
    const { deps, transaction } = depsWith(async () => undefined);

    await processFileDeletion(
      {
        jobId: 'job-1',
        storageKey: sourceKey,
        entityType: 'product_image',
        entityId: 'image-1',
        productId: 'product-1',
      },
      deps,
    );

    expect(deps.storage.delete).toHaveBeenNthCalledWith(1, sourceKey);
    expect(deps.storage.delete).toHaveBeenNthCalledWith(2, derivativeKey);
    expect(transaction.productImage.deleteMany).toHaveBeenCalledOnce();
    expect(transaction.fileDeletionJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'job-1' },
        data: expect.objectContaining({ status: 'SUCCEEDED' }),
      }),
    );
  });

  it('keeps the task failed when a derivative object cannot be deleted', async () => {
    let calls = 0;
    const { deps, transaction, logger } = depsWith(async () => {
      calls += 1;
      if (calls === 2) throw new Error('storage.derivative_delete_failed');
    });

    await expect(
      processFileDeletion(
        {
          jobId: 'job-1',
          storageKey: sourceKey,
          entityType: 'product_image',
          entityId: 'image-1',
          productId: 'product-1',
        },
        deps,
      ),
    ).rejects.toThrow('storage.derivative_delete_failed');

    expect(transaction.fileDeletionJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'job-1' },
        data: expect.objectContaining({ status: 'FAILED' }),
      }),
    );
    expect(transaction.productImage.deleteMany).not.toHaveBeenCalled();
    expect(transaction.productImage.updateMany).toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
  });
});

describe('physical quote-template deletion', () => {
  it('deletes the private object before removing the template, asset and durable task', async () => {
    const { deps, storageKey, transaction, logger } = quoteTemplateDepsWith(async () => undefined);

    await processFileDeletion(
      {
        jobId: 'template-job-1',
        storageKey,
        entityType: 'quote_template',
        entityId: 'template-1',
      },
      deps,
    );

    expect(deps.storage.delete).toHaveBeenCalledWith(storageKey);
    expect(transaction.quoteTemplate.deleteMany).toHaveBeenCalledWith({
      where: { id: 'template-1' },
    });
    expect(transaction.fileAsset.deleteMany).toHaveBeenCalledWith({ where: { storageKey } });
    expect(transaction.fileDeletionJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'template-job-1' },
        data: expect.objectContaining({ status: 'SUCCEEDED' }),
      }),
    );
    expect(transaction.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'quote_template.permanent_delete_succeeded',
        entityType: 'quote_template',
        entityId: 'template-1',
      }),
    });
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain(storageKey);
  });

  it('keeps the retryable task and database rows when physical storage deletion fails', async () => {
    const { deps, storageKey, transaction } = quoteTemplateDepsWith(async () => {
      throw new Error('storage.delete_failed');
    });

    await expect(
      processFileDeletion(
        {
          jobId: 'template-job-2',
          storageKey,
          entityType: 'quote_template',
          entityId: 'template-1',
        },
        deps,
      ),
    ).rejects.toThrow('storage.delete_failed');

    expect(transaction.fileDeletionJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'template-job-2' },
        data: expect.objectContaining({ status: 'FAILED' }),
      }),
    );
    expect(transaction.quoteTemplate.deleteMany).not.toHaveBeenCalled();
    expect(transaction.fileAsset.deleteMany).not.toHaveBeenCalled();
    expect(transaction.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'quote_template.permanent_delete_failed',
        entityType: 'quote_template',
        entityId: 'template-1',
      }),
    });
  });

  it('does not touch storage when a stale task has become referenced again', async () => {
    const { deps, storageKey, transaction } = quoteTemplateDepsWith(async () => undefined, {
      exports: 1,
    });

    await expect(
      processFileDeletion(
        {
          jobId: 'template-job-3',
          storageKey,
          entityType: 'quote_template',
          entityId: 'template-1',
        },
        deps,
      ),
    ).rejects.toThrow('quote_template.in_use');

    expect(deps.storage.delete).not.toHaveBeenCalled();
    expect(transaction.quoteTemplate.deleteMany).not.toHaveBeenCalled();
    expect(transaction.fileAsset.deleteMany).not.toHaveBeenCalled();
    expect(transaction.fileDeletionJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'template-job-3' },
        data: expect.objectContaining({ status: 'FAILED' }),
      }),
    );
  });
});

describe('Excel-to-PDF compensating output deletion', () => {
  it('completes when the failed database transaction never created an output asset row', async () => {
    const { deps, transaction } = depsWith(async () => undefined);

    await processFileDeletion(
      {
        jobId: 'excel-pdf-compensation-1',
        storageKey: 'private/excel-pdf/outputs/orphan.pdf',
        entityType: 'excel_pdf_asset',
        entityId: '77777777-7777-4777-8777-777777777777',
      },
      deps,
    );

    expect(deps.storage.delete).toHaveBeenCalledWith('private/excel-pdf/outputs/orphan.pdf');
    expect(transaction.fileAsset.deleteMany).not.toHaveBeenCalled();
    expect(transaction.fileDeletionJob.updateMany).toHaveBeenCalledWith({
      where: { id: 'excel-pdf-compensation-1' },
      data: expect.objectContaining({ status: 'SUCCEEDED' }),
    });
  });
});
