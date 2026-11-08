import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@b2b/contracts';
import type { AuditService } from '../../common/services/audit.service';
import type { CryptoService } from '../../common/services/crypto.service';
import type { JsonLogger } from '../../common/logger.service';
import type { StorageService } from '../../common/services/storage.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AppEnv } from '../../config/config.module';
import { FilesService } from './files.service';

const ASSET_ID = 'aaaaaaaa-1111-4111-8111-111111111111';

describe('FilesService shared-reference protection', () => {
  const fileAssetFindUnique = vi.fn();
  const fileAssetDelete = vi.fn();
  const productImageCount = vi.fn();
  const categoryCount = vi.fn();
  const adCount = vi.fn();
  const companyProfileCount = vi.fn();
  const commercialDocumentCount = vi.fn();
  const globalSettingCount = vi.fn();
  const deletionJobCreate = vi.fn();
  const auditRecord = vi.fn();
  let service: FilesService;
  let prisma: Record<string, unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    fileAssetFindUnique.mockResolvedValue({
      id: ASSET_ID,
      storageKey: 'logo/2026/11/logo.png',
      purpose: 'logo',
      status: 'ready',
      isPublic: true,
    });
    fileAssetDelete.mockResolvedValue({});
    productImageCount.mockResolvedValue(0);
    categoryCount.mockResolvedValue(0);
    adCount.mockResolvedValue(0);
    companyProfileCount.mockResolvedValue(0);
    commercialDocumentCount.mockResolvedValue(0);
    globalSettingCount.mockResolvedValue(0);
    deletionJobCreate.mockResolvedValue({ id: 'job-1' });
    auditRecord.mockResolvedValue(undefined);
    prisma = {
      fileAsset: { findUnique: fileAssetFindUnique, delete: fileAssetDelete },
      productImage: { count: productImageCount },
      category: { count: categoryCount },
      ad: { count: adCount },
      companyProfile: { count: companyProfileCount },
      commercialDocument: { count: commercialDocumentCount },
      globalSetting: { count: globalSettingCount },
      fileDeletionJob: { create: deletionJobCreate },
      $transaction: vi.fn(async (arg: unknown) =>
        Array.isArray(arg) ? Promise.all(arg) : (arg as (tx: unknown) => unknown)(prisma),
      ),
    };
    service = new FilesService(
      {} as AppEnv,
      prisma as unknown as PrismaService,
      {} as StorageService,
      {} as CryptoService,
      { record: auditRecord } as unknown as AuditService,
      {} as JsonLogger,
    );
  });

  it('refuses to delete an image still referenced by a company profile', async () => {
    companyProfileCount.mockResolvedValue(1);
    await expect(service.remove(ASSET_ID, 'actor', 'request')).rejects.toMatchObject({
      code: ERROR_CODES.assetInUse,
    });
    expect(fileAssetDelete).not.toHaveBeenCalled();
    expect(deletionJobCreate).not.toHaveBeenCalled();
  });

  it('refuses to delete an image embedded in a commercial document snapshot', async () => {
    commercialDocumentCount.mockResolvedValue(2);
    await expect(service.remove(ASSET_ID, 'actor', 'request')).rejects.toMatchObject({
      code: ERROR_CODES.assetInUse,
    });
    expect(fileAssetDelete).not.toHaveBeenCalled();
  });

  it('records a physical deletion task for an unreferenced image', async () => {
    const result = await service.remove(ASSET_ID, 'actor', 'request');

    expect(deletionJobCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          storageKey: 'logo/2026/11/logo.png',
          entityType: 'file_asset',
          entityId: ASSET_ID,
        }),
      }),
    );
    expect(fileAssetDelete).toHaveBeenCalledWith({ where: { id: ASSET_ID } });
    expect(result).toEqual({ deleted: true, deletionJobId: 'job-1' });
  });
});
