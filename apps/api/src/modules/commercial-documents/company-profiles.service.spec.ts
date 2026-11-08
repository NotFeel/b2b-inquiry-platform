import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@b2b/contracts';
import type { AuditService } from '../../common/services/audit.service';
import type { StorageService } from '../../common/services/storage.service';
import type { PrismaService } from '../../prisma/prisma.service';
import { CompanyProfilesService } from './company-profiles.service';

const COMPANY_ID = '11111111-2222-4333-8444-555555555555';
const ACCOUNT_ID = '22222222-3333-4444-8555-666666666666';

function account(overrides: Record<string, unknown> = {}) {
  return {
    id: ACCOUNT_ID,
    companyProfileId: COMPANY_ID,
    label: 'USD Main',
    accountHolder: 'Example Co',
    bankName: 'Bank of China',
    bankAddress: 'Shanghai',
    bankCountryCode: 'CN',
    accountNumber: '6222021234567890',
    swiftCode: 'BKCHCNBJ',
    wireRoutingNumber: null,
    achRoutingNumber: null,
    currencyCode: 'USD',
    isDefault: true,
    enabled: true,
    sortOrder: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function companyProfile(overrides: Record<string, unknown> = {}) {
  return {
    id: COMPANY_ID,
    code: 'example',
    companyName: 'Example Co',
    contactName: null,
    phone: null,
    email: null,
    taxId: null,
    website: null,
    address: {},
    logoAssetId: null,
    stampAssetId: null,
    isDefault: true,
    enabled: true,
    updatedAt: new Date(),
    bankAccounts: [],
    ...overrides,
  };
}

describe('CompanyProfilesService bank safety rules', () => {
  const dictionaryFindFirst = vi.fn();
  const companyFindUnique = vi.fn();
  const companyFindMany = vi.fn();
  const bankFindUnique = vi.fn();
  const bankUpdate = vi.fn();
  const bankUpdateMany = vi.fn();
  const bankCreate = vi.fn();
  const documentFindFirst = vi.fn();
  const transaction = vi.fn();
  const fileAssetFindUnique = vi.fn();
  const fileAssetFindMany = vi.fn();
  const fileAssetDelete = vi.fn();
  const companyUpdate = vi.fn();
  const companyProfileFindMany = vi.fn();
  const documentCount = vi.fn();
  const globalSettingCount = vi.fn();
  const deletionJobFindUnique = vi.fn();
  const deletionJobCreate = vi.fn();
  const auditRecord = vi.fn();
  let service: CompanyProfilesService;
  let prisma: Record<string, unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    dictionaryFindFirst.mockImplementation(async ({ where }: { where: { code: string } }) => ({
      code: where.code,
    }));
    companyFindUnique.mockResolvedValue({ id: COMPANY_ID, code: 'example' });
    companyFindMany.mockResolvedValue([]);
    bankFindUnique.mockResolvedValue(account());
    bankUpdate.mockResolvedValue(account({ enabled: false, isDefault: false }));
    bankUpdateMany.mockResolvedValue({ count: 1 });
    bankCreate.mockResolvedValue(account());
    documentFindFirst.mockResolvedValue(null);
    fileAssetFindUnique.mockResolvedValue(null);
    fileAssetFindMany.mockResolvedValue([]);
    fileAssetDelete.mockResolvedValue({});
    companyUpdate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: COMPANY_ID,
      code: 'example',
      companyName: 'Example Co',
      contactName: null,
      phone: null,
      email: null,
      taxId: null,
      website: null,
      address: {},
      logoAssetId: null,
      stampAssetId: null,
      isDefault: true,
      enabled: true,
      updatedAt: new Date(),
      ...data,
    }));
    companyProfileFindMany.mockResolvedValue([]);
    documentCount.mockResolvedValue(0);
    globalSettingCount.mockResolvedValue(0);
    deletionJobFindUnique.mockResolvedValue(null);
    deletionJobCreate.mockResolvedValue({ id: 'job-1', status: 'QUEUED' });
    auditRecord.mockResolvedValue(undefined);
    prisma = {
      dictionaryItem: { findFirst: dictionaryFindFirst },
      companyProfile: {
        findUnique: companyFindUnique,
        findMany: companyFindMany,
        update: companyUpdate,
      },
      fileAsset: {
        findUnique: fileAssetFindUnique,
        findMany: fileAssetFindMany,
        delete: fileAssetDelete,
      },
      fileDeletionJob: {
        findUnique: deletionJobFindUnique,
        create: deletionJobCreate,
      },
      commercialDocument: { findFirst: documentFindFirst, count: documentCount },
      globalSetting: { count: globalSettingCount },
      bankAccountProfile: {
        findUnique: bankFindUnique,
        update: bankUpdate,
        updateMany: bankUpdateMany,
        create: bankCreate,
      },
      $transaction: transaction.mockImplementation(async (callback: (tx: unknown) => unknown) =>
        callback(prisma),
      ),
    };
    service = new CompanyProfilesService(
      prisma as unknown as PrismaService,
      { record: auditRecord } as unknown as AuditService,
      { publicUrl: (key: string) => `/api/v1/files/${key}` } as unknown as StorageService,
    );
  });

  it('masks account numbers in the management list and omits routing data', async () => {
    companyFindMany.mockResolvedValue([
      {
        id: COMPANY_ID,
        code: 'example',
        companyName: 'Example Co',
        contactName: null,
        phone: null,
        email: null,
        taxId: null,
        website: null,
        address: {},
        logoAssetId: null,
        stampAssetId: null,
        isDefault: true,
        enabled: true,
        updatedAt: new Date(),
        bankAccounts: [account()],
      },
    ]);

    const result = await service.list();
    const bank = result.data[0]?.bankAccounts?.[0];

    expect(bank).toMatchObject({ maskedAccountNumber: '****7890', hasSwift: true });
    expect(bank).not.toHaveProperty('accountNumber');
    expect(bank).not.toHaveProperty('swiftCode');
    expect(bank).not.toHaveProperty('wireRoutingNumber');
  });

  it('rejects a new account with an unknown currency before writing', async () => {
    dictionaryFindFirst.mockResolvedValueOnce(null);

    await expect(
      service.createBankAccount(
        {
          companyProfileId: COMPANY_ID,
          label: 'USD Main',
          accountHolder: 'Example Co',
          bankName: 'Bank',
          bankAddress: null,
          bankCountryCode: 'CN',
          accountNumber: '1234',
          swiftCode: null,
          wireRoutingNumber: null,
          achRoutingNumber: null,
          currencyCode: 'USD',
          isDefault: true,
          enabled: true,
          sortOrder: 0,
        },
        'actor',
        'request',
      ),
    ).rejects.toMatchObject({ code: ERROR_CODES.bankAccountCurrencyInvalid });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('clears defaults only for the same company and currency', async () => {
    await service.createBankAccount(
      {
        companyProfileId: COMPANY_ID,
        label: 'USD Main',
        accountHolder: 'Example Co',
        bankName: 'Bank',
        bankAddress: null,
        bankCountryCode: 'CN',
        accountNumber: '1234',
        swiftCode: null,
        wireRoutingNumber: null,
        achRoutingNumber: null,
        currencyCode: 'USD',
        isDefault: true,
        enabled: true,
        sortOrder: 0,
      },
      'actor',
      'request',
    );

    expect(bankUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { companyProfileId: COMPANY_ID, currencyCode: 'USD', isDefault: true },
      }),
    );
  });

  it('turns DELETE into a disable operation', async () => {
    const result = await service.removeBankAccount(ACCOUNT_ID, 'actor', 'request');
    expect(result).toEqual({ disabled: true });
    expect(bankUpdate).toHaveBeenCalledWith({
      where: { id: ACCOUNT_ID },
      data: { enabled: false, isDefault: false },
    });
  });

  it('refuses changing a currency that a commercial document already used', async () => {
    documentFindFirst.mockResolvedValue({ id: 'doc-1' });

    await expect(
      service.updateBankAccount(ACCOUNT_ID, { currencyCode: 'EUR' }, 'actor', 'request'),
    ).rejects.toMatchObject({ code: ERROR_CODES.bankAccountCurrencyInUse });
  });

  it('always clears the default flag when disabling an account', async () => {
    bankUpdate.mockResolvedValue(account({ enabled: false, isDefault: false }));
    await service.updateBankAccount(ACCOUNT_ID, { enabled: false }, 'actor', 'request');
    expect(bankUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ enabled: false, isDefault: false }),
      }),
    );
  });

  it('omits full account details from the document options DTO', async () => {
    companyFindMany.mockResolvedValue([
      {
        id: COMPANY_ID,
        companyName: 'Example Co',
        contactName: 'Bob',
        phone: null,
        email: null,
        taxId: null,
        isDefault: true,
        address: {},
        logoAssetId: null,
        stampAssetId: null,
        bankAccounts: [account()],
      },
    ]);
    const result = await service.options();
    const bank = result.data[0]?.bankAccounts[0];
    expect(bank).toMatchObject({ maskedAccountNumber: '****7890' });
    expect(bank).not.toHaveProperty('accountNumber');
    expect(bank).not.toHaveProperty('swiftCode');
  });

  it('returns public preview URLs for saved logo and stamp assets', async () => {
    companyFindMany.mockResolvedValue([
      companyProfile({
        logoAssetId: 'aaaaaaaa-1111-4111-8111-111111111111',
        stampAssetId: 'bbbbbbbb-2222-4222-8222-222222222222',
      }),
    ]);
    fileAssetFindMany.mockResolvedValue([
      { id: 'aaaaaaaa-1111-4111-8111-111111111111', storageKey: 'logo/2026/11/logo.png' },
      { id: 'bbbbbbbb-2222-4222-8222-222222222222', storageKey: 'logo/2026/11/stamp.png' },
    ]);

    const result = await service.list();

    expect(result.data[0]).toMatchObject({
      logoUrl: '/api/v1/files/logo/2026/11/logo.png',
      stampUrl: '/api/v1/files/logo/2026/11/stamp.png',
    });
  });

  it('detaches a company logo and enqueues its physical deletion', async () => {
    const assetId = 'aaaaaaaa-1111-4111-8111-111111111111';
    companyFindUnique
      .mockResolvedValueOnce(companyProfile({ logoAssetId: assetId }))
      .mockResolvedValueOnce(companyProfile({ logoAssetId: null }));
    fileAssetFindUnique.mockResolvedValue({
      id: assetId,
      storageKey: 'logo/2026/11/logo.png',
      purpose: 'logo',
      uploadedById: 'actor',
    });
    companyProfileFindMany.mockResolvedValue([
      { id: COMPANY_ID, logoAssetId: assetId, stampAssetId: null },
    ]);

    const result = await service.removeAsset(COMPANY_ID, 'logo', 'actor', 'request');

    expect(companyUpdate).toHaveBeenCalledWith({
      where: { id: COMPANY_ID },
      data: { logoAssetId: null },
    });
    expect(deletionJobCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          storageKey: 'logo/2026/11/logo.png',
          entityType: 'file_asset',
          entityId: assetId,
        }),
      }),
    );
    expect(fileAssetDelete).toHaveBeenCalledWith({ where: { id: assetId } });
    expect(result).toMatchObject({ assetId, removed: true, deletionJobId: 'job-1' });
    expect(result.profile.logoAssetId).toBeNull();
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'company_profile.logo_removed' }),
    );
  });

  it('refuses to delete a logo referenced by an issued document snapshot', async () => {
    const assetId = 'aaaaaaaa-1111-4111-8111-111111111111';
    companyFindUnique.mockResolvedValue(companyProfile({ logoAssetId: assetId }));
    fileAssetFindUnique.mockResolvedValue({
      id: assetId,
      storageKey: 'logo/2026/11/logo.png',
      purpose: 'logo',
      uploadedById: 'actor',
    });
    documentCount.mockResolvedValue(1);

    await expect(service.removeAsset(COMPANY_ID, 'logo', 'actor', 'request')).rejects.toMatchObject(
      { code: ERROR_CODES.assetInUse },
    );
    expect(fileAssetDelete).not.toHaveBeenCalled();
    expect(deletionJobCreate).not.toHaveBeenCalled();
  });

  it('purges an unreferenced image uploaded for an unsaved company', async () => {
    const assetId = 'aaaaaaaa-1111-4111-8111-111111111111';
    fileAssetFindUnique.mockResolvedValue({
      id: assetId,
      storageKey: 'logo/2026/11/new.png',
      purpose: 'logo',
      uploadedById: 'actor',
    });

    const result = await service.removeUploadedAsset(assetId, 'actor', 'request');

    expect(fileAssetDelete).toHaveBeenCalledWith({ where: { id: assetId } });
    expect(result).toMatchObject({ assetId, removed: true, deletionJobId: 'job-1' });
  });

  it('does not let an operator purge another operator’s unsaved image', async () => {
    const assetId = 'aaaaaaaa-1111-4111-8111-111111111111';
    fileAssetFindUnique.mockResolvedValue({
      id: assetId,
      storageKey: 'logo/2026/11/new.png',
      purpose: 'logo',
      uploadedById: 'someone-else',
    });

    await expect(service.removeUploadedAsset(assetId, 'actor', 'request')).rejects.toMatchObject({
      code: ERROR_CODES.forbidden,
    });
    expect(fileAssetDelete).not.toHaveBeenCalled();
  });

  it('rolls back the whole combined create when an initial account has an invalid country', async () => {
    companyFindUnique.mockResolvedValue(null);
    dictionaryFindFirst.mockResolvedValueOnce({ code: 'USD' }).mockResolvedValueOnce(null);
    await expect(
      service.createWithBankAccounts(
        {
          company: {
            companyName: 'Example Co',
            contactName: null,
            phone: null,
            email: null,
            taxId: null,
            website: null,
            address: {
              line1: null,
              line2: null,
              city: null,
              state: null,
              postalCode: null,
              countryCode: null,
            },
            isDefault: false,
            enabled: true,
          },
          bankAccounts: [
            {
              label: 'USD Main',
              accountHolder: 'Example Co',
              bankName: 'Bank',
              bankAddress: null,
              bankCountryCode: 'CN',
              accountNumber: '1234',
              swiftCode: null,
              wireRoutingNumber: null,
              achRoutingNumber: null,
              currencyCode: 'USD',
              isDefault: true,
              enabled: true,
              sortOrder: 0,
            },
          ],
        },
        'actor',
        'request',
      ),
    ).rejects.toMatchObject({ code: ERROR_CODES.bankAccountCountryInvalid });
    expect(transaction).not.toHaveBeenCalled();
  });
});
