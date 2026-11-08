import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ERROR_CODES } from '@b2b/contracts';
import type { BankAccountProfile, CompanyProfile, Prisma } from '@b2b/database';
import { Prisma as PrismaRuntime } from '@b2b/database';
import type {
  CreateBankAccountInput,
  CreateBankAccountWithoutCompanyIdInput,
  CreateCompanyProfileInput,
  CreateCompanyProfileWithBankAccountsInput,
  UpdateBankAccountInput,
  UpdateCompanyProfileInput,
} from '@b2b/validation';
import { PrismaService } from '../../prisma/prisma.service';
import { ApiError } from '../../common/errors/api-error';
import { AuditService } from '../../common/services/audit.service';
import { StorageService } from '../../common/services/storage.service';

type ProfileWithBanks = CompanyProfile & { bankAccounts?: BankAccountProfile[] };
export type CompanyAssetKind = 'logo' | 'stamp';

// Seller and bank details are company-level reference data. Documents copy a
// snapshot at creation/issue time, so editing a profile never rewrites an
// issued document (docs/41 §8.2, docs/44 §9).
@Injectable()
export class CompanyProfilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  /** Management list. Bank accounts are deliberately returned in safe form. */
  async list() {
    const profiles = await this.prisma.companyProfile.findMany({
      orderBy: [{ isDefault: 'desc' }, { companyName: 'asc' }],
      include: {
        bankAccounts: {
          orderBy: [
            { currencyCode: 'asc' },
            { isDefault: 'desc' },
            { sortOrder: 'asc' },
            { label: 'asc' },
          ],
        },
      },
    });
    const assetUrls = await this.loadAssetUrls(
      profiles.flatMap((profile) => [profile.logoAssetId, profile.stampAssetId]),
    );
    return { data: profiles.map((profile) => this.dto(profile, assetUrls)) };
  }

  /**
   * Minimal enabled set used by the document editor. It intentionally contains
   * no full account number, SWIFT or routing number (docs/44 §10.2).
   */
  async options() {
    const profiles = await this.prisma.companyProfile.findMany({
      where: { enabled: true },
      orderBy: [{ isDefault: 'desc' }, { companyName: 'asc' }],
      include: {
        bankAccounts: {
          where: { enabled: true, currencyCode: { not: null } },
          orderBy: [{ isDefault: 'desc' }, { sortOrder: 'asc' }, { label: 'asc' }],
        },
      },
    });
    const assetUrls = await this.loadAssetUrls(
      profiles.flatMap((profile) => [profile.logoAssetId, profile.stampAssetId]),
    );
    return {
      data: profiles.map((profile) => ({
        id: profile.id,
        companyName: profile.companyName,
        contactName: profile.contactName,
        phone: profile.phone,
        email: profile.email,
        taxId: profile.taxId,
        isDefault: profile.isDefault,
        address: profile.address,
        logoAssetId: profile.logoAssetId,
        stampAssetId: profile.stampAssetId,
        logoUrl: profile.logoAssetId ? (assetUrls.get(profile.logoAssetId) ?? null) : null,
        stampUrl: profile.stampAssetId ? (assetUrls.get(profile.stampAssetId) ?? null) : null,
        bankAccounts: profile.bankAccounts.map((account) => this.bankSummaryDto(account)),
      })),
    };
  }

  async defaultProfile() {
    return this.prisma.companyProfile.findFirst({
      where: { enabled: true },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
  }

  async create(input: CreateCompanyProfileInput, actorId: string, requestId: string) {
    await this.validateCompanyAddress(input.address);
    const code = input.code ?? `company-${randomUUID().slice(0, 12)}`;
    const exists = await this.prisma.companyProfile.findUnique({ where: { code } });
    if (exists) throw this.duplicateCodeError();
    let profile: CompanyProfile;
    try {
      profile = await this.prisma.$transaction(async (transaction) => {
        if (input.isDefault) {
          await transaction.companyProfile.updateMany({
            where: { isDefault: true },
            data: { isDefault: false },
          });
        }
        return transaction.companyProfile.create({
          data: {
            code,
            companyName: input.companyName,
            contactName: input.contactName ?? null,
            phone: input.phone ?? null,
            email: input.email ?? null,
            taxId: input.taxId ?? null,
            website: input.website ?? null,
            address: input.address as never,
            logoAssetId: input.logoAssetId ?? null,
            stampAssetId: input.stampAssetId ?? null,
            isDefault: input.isDefault,
            enabled: input.enabled,
          },
        });
      });
    } catch (error) {
      throw this.translateUniqueError(error);
    }
    await this.audit.record({
      actorId,
      action: 'company_profile.created',
      entityType: 'CompanyProfile',
      entityId: profile.id,
      requestId,
      metadata: { code, isDefault: input.isDefault },
    });
    return this.dtoWithAssets(profile);
  }

  /**
   * Creates a company and its initial bank accounts in one transaction. The
   * caller must hold both company and bank-account permissions (controller).
   */
  async createWithBankAccounts(
    input: CreateCompanyProfileWithBankAccountsInput,
    actorId: string,
    requestId: string,
  ) {
    await this.validateCompanyAddress(input.company.address);
    const code = input.company.code ?? `company-${randomUUID().slice(0, 12)}`;
    const exists = await this.prisma.companyProfile.findUnique({ where: { code } });
    if (exists) throw this.duplicateCodeError();

    const accounts: Array<
      CreateBankAccountWithoutCompanyIdInput & { currencyCode: string; bankCountryCode: string }
    > = [];
    for (const account of input.bankAccounts) {
      const currencyCode = await this.requireCurrency(account.currencyCode);
      const bankCountryCode = await this.requireCountry(account.bankCountryCode);
      this.assertAccountState(account.enabled, account.isDefault);
      accounts.push({ ...account, currencyCode, bankCountryCode });
    }
    this.assertSingleDefaultPerCurrency(accounts);

    let profile: ProfileWithBanks;
    try {
      profile = await this.prisma.$transaction(async (transaction) => {
        if (input.company.isDefault) {
          await transaction.companyProfile.updateMany({
            where: { isDefault: true },
            data: { isDefault: false },
          });
        }
        return transaction.companyProfile.create({
          data: {
            code,
            companyName: input.company.companyName,
            contactName: input.company.contactName ?? null,
            phone: input.company.phone ?? null,
            email: input.company.email ?? null,
            taxId: input.company.taxId ?? null,
            website: input.company.website ?? null,
            address: input.company.address as never,
            logoAssetId: input.company.logoAssetId ?? null,
            stampAssetId: input.company.stampAssetId ?? null,
            isDefault: input.company.isDefault,
            enabled: input.company.enabled,
            bankAccounts: {
              create: accounts.map((account) => this.bankCreateData(account)),
            },
          },
          include: { bankAccounts: true },
        });
      });
    } catch (error) {
      throw this.translateUniqueError(error);
    }
    await this.audit.record({
      actorId,
      action: 'company_profile.created',
      entityType: 'CompanyProfile',
      entityId: profile.id,
      requestId,
      // Account numbers, SWIFT and routing numbers never enter audit metadata.
      metadata: { code, isDefault: input.company.isDefault, bankAccountCount: accounts.length },
    });
    return this.dtoWithAssets(profile);
  }

  async update(id: string, input: UpdateCompanyProfileInput, actorId: string, requestId: string) {
    const existing = await this.prisma.companyProfile.findUnique({ where: { id } });
    if (!existing) throw ApiError.notFound('Company profile not found.');
    if (input.address !== undefined) await this.validateCompanyAddress(input.address);
    let profile: CompanyProfile;
    try {
      profile = await this.prisma.$transaction(async (transaction) => {
        if (input.isDefault === true) {
          await transaction.companyProfile.updateMany({
            where: { isDefault: true, id: { not: id } },
            data: { isDefault: false },
          });
        }
        if (input.code && input.code !== existing.code) {
          const duplicate = await transaction.companyProfile.findUnique({
            where: { code: input.code },
          });
          if (duplicate) throw this.duplicateCodeError();
        }
        return transaction.companyProfile.update({
          where: { id },
          data: {
            ...(input.code !== undefined ? { code: input.code } : {}),
            ...(input.companyName !== undefined ? { companyName: input.companyName } : {}),
            ...(input.contactName !== undefined ? { contactName: input.contactName } : {}),
            ...(input.phone !== undefined ? { phone: input.phone } : {}),
            ...(input.email !== undefined ? { email: input.email } : {}),
            ...(input.taxId !== undefined ? { taxId: input.taxId } : {}),
            ...(input.website !== undefined ? { website: input.website } : {}),
            ...(input.address !== undefined ? { address: input.address as never } : {}),
            ...(input.logoAssetId !== undefined ? { logoAssetId: input.logoAssetId } : {}),
            ...(input.stampAssetId !== undefined ? { stampAssetId: input.stampAssetId } : {}),
            ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
            ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
          },
        });
      });
    } catch (error) {
      throw this.translateUniqueError(error);
    }
    await this.audit.record({
      actorId,
      action: 'company_profile.updated',
      entityType: 'CompanyProfile',
      entityId: id,
      requestId,
      metadata: { changedFields: Object.keys(input) },
    });
    return this.dtoWithAssets(profile);
  }

  async remove(id: string, actorId: string, requestId: string) {
    const profile = await this.prisma.companyProfile.findUnique({
      where: { id },
      include: { _count: { select: { bankAccounts: true } } },
    });
    if (!profile) throw ApiError.notFound('Company profile not found.');
    if (profile._count.bankAccounts > 0) {
      throw ApiError.conflict(
        ERROR_CODES.conflict,
        'Remove or reassign this profile’s bank accounts before deleting it.',
      );
    }
    await this.prisma.companyProfile.delete({ where: { id } });
    await this.audit.record({
      actorId,
      action: 'company_profile.deleted',
      entityType: 'CompanyProfile',
      entityId: id,
      requestId,
      metadata: { code: profile.code },
    });
    return { deleted: true };
  }

  async getBankAccount(id: string) {
    const account = await this.prisma.bankAccountProfile.findUnique({ where: { id } });
    if (!account) throw ApiError.notFound('Bank account not found.');
    return this.bankDetailDto(account);
  }

  async createBankAccount(input: CreateBankAccountInput, actorId: string, requestId: string) {
    const profile = await this.prisma.companyProfile.findUnique({
      where: { id: input.companyProfileId },
      select: { id: true },
    });
    if (!profile) throw ApiError.notFound('Company profile not found.');
    const currencyCode = await this.requireCurrency(input.currencyCode);
    const bankCountryCode = await this.requireCountry(input.bankCountryCode);
    this.assertAccountState(input.enabled, input.isDefault);

    let account: BankAccountProfile;
    try {
      account = await this.prisma.$transaction(async (transaction) => {
        if (input.isDefault) {
          // Only the same company + same currency loses its default flag.
          await transaction.bankAccountProfile.updateMany({
            where: {
              companyProfileId: input.companyProfileId,
              currencyCode,
              isDefault: true,
            },
            data: { isDefault: false },
          });
        }
        return transaction.bankAccountProfile.create({
          data: {
            ...this.bankCreateData({
              ...input,
              currencyCode,
              bankCountryCode,
            }),
            companyProfileId: input.companyProfileId,
          },
        });
      });
    } catch (error) {
      throw this.translateUniqueError(error);
    }
    await this.audit.record({
      actorId,
      action: 'bank_account.created',
      entityType: 'BankAccountProfile',
      entityId: account.id,
      requestId,
      metadata: {
        label: account.label,
        companyProfileId: account.companyProfileId,
        currencyCode: account.currencyCode,
        isDefault: account.isDefault,
      },
    });
    return this.bankSummaryDto(account);
  }

  async updateBankAccount(
    id: string,
    input: UpdateBankAccountInput,
    actorId: string,
    requestId: string,
  ) {
    const existing = await this.prisma.bankAccountProfile.findUnique({ where: { id } });
    if (!existing) throw ApiError.notFound('Bank account not found.');

    const nextCurrency =
      input.currencyCode !== undefined
        ? await this.requireCurrency(input.currencyCode)
        : existing.currencyCode;
    let nextCountry = existing.bankCountryCode;
    if (input.bankCountryCode !== undefined) {
      if (input.bankCountryCode === null) {
        if (existing.bankCountryCode) {
          throw new ApiError(
            ERROR_CODES.bankAccountCountryInvalid,
            'An existing bank country cannot be cleared.',
            { status: 422 },
          );
        }
        nextCountry = null;
      } else {
        nextCountry = await this.requireCountry(input.bankCountryCode);
      }
    }

    const nextEnabled = input.enabled ?? existing.enabled;
    if (input.isDefault === true && !nextEnabled) {
      throw new ApiError(
        ERROR_CODES.bankAccountDefaultConflict,
        'A disabled bank account cannot be the default.',
        { status: 422 },
      );
    }
    if (nextEnabled && !nextCurrency) {
      throw new ApiError(
        ERROR_CODES.bankAccountCurrencyRequired,
        'A bank account must have a currency before it can be enabled.',
        { status: 422 },
      );
    }

    const currencyChanged = Boolean(
      existing.currencyCode && nextCurrency && existing.currencyCode !== nextCurrency,
    );
    if (currencyChanged && (await this.isAccountUsedByDocument(existing))) {
      throw new ApiError(
        ERROR_CODES.bankAccountCurrencyInUse,
        'This account has been used by a commercial document; create a new account instead.',
        { status: 409 },
      );
    }

    let nextDefault = input.isDefault ?? existing.isDefault;
    if (!nextEnabled) nextDefault = false;
    if (nextDefault && !nextCurrency) {
      throw new ApiError(
        ERROR_CODES.bankAccountCurrencyRequired,
        'Set a currency before making this account the default.',
        { status: 422 },
      );
    }
    // A currency change does not silently make the new currency default; the
    // operator must opt in explicitly.
    if (currencyChanged && input.isDefault === undefined) nextDefault = false;

    let account: BankAccountProfile;
    try {
      account = await this.prisma.$transaction(async (transaction) => {
        if (nextDefault && nextCurrency) {
          await transaction.bankAccountProfile.updateMany({
            where: {
              companyProfileId: existing.companyProfileId,
              currencyCode: nextCurrency,
              isDefault: true,
              id: { not: id },
            },
            data: { isDefault: false },
          });
        }
        return transaction.bankAccountProfile.update({
          where: { id },
          data: {
            ...(input.label !== undefined ? { label: input.label } : {}),
            ...(input.accountHolder !== undefined ? { accountHolder: input.accountHolder } : {}),
            ...(input.bankName !== undefined ? { bankName: input.bankName } : {}),
            ...(input.bankAddress !== undefined ? { bankAddress: input.bankAddress } : {}),
            bankCountryCode: nextCountry,
            ...(input.accountNumber !== undefined ? { accountNumber: input.accountNumber } : {}),
            ...(input.swiftCode !== undefined ? { swiftCode: input.swiftCode } : {}),
            ...(input.wireRoutingNumber !== undefined
              ? { wireRoutingNumber: input.wireRoutingNumber }
              : {}),
            ...(input.achRoutingNumber !== undefined
              ? { achRoutingNumber: input.achRoutingNumber }
              : {}),
            currencyCode: nextCurrency,
            enabled: nextEnabled,
            isDefault: nextDefault,
            ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
          },
        });
      });
    } catch (error) {
      throw this.translateUniqueError(error);
    }
    await this.audit.record({
      actorId,
      action: 'bank_account.updated',
      entityType: 'BankAccountProfile',
      entityId: id,
      requestId,
      metadata: {
        changedFields: Object.keys(input),
        companyProfileId: account.companyProfileId,
        currencyCode: account.currencyCode,
      },
    });
    return this.bankSummaryDto(account);
  }

  /**
   * The DELETE route is intentionally a disable operation (docs/44 §9). No
   * physical delete is allowed because documents keep JSON payment snapshots.
   */
  async removeBankAccount(id: string, actorId: string, requestId: string) {
    const account = await this.prisma.bankAccountProfile.findUnique({ where: { id } });
    if (!account) throw ApiError.notFound('Bank account not found.');
    await this.prisma.bankAccountProfile.update({
      where: { id },
      data: { enabled: false, isDefault: false },
    });
    await this.audit.record({
      actorId,
      action: 'bank_account.disabled',
      entityType: 'BankAccountProfile',
      entityId: id,
      requestId,
      metadata: { label: account.label, companyProfileId: account.companyProfileId },
    });
    return { disabled: true };
  }

  /**
   * Deletes one logo/stamp of a saved company. The profile reference and the
   * physical-delete task are written in one transaction, so a removed image can
   * never stay attached to the profile (docs/44 §22).
   */
  async removeAsset(id: string, kind: CompanyAssetKind, actorId: string, requestId: string) {
    const profile = await this.findProfileWithBanks(id);
    if (!profile) throw ApiError.notFound('Company profile not found.');
    const assetId = kind === 'logo' ? profile.logoAssetId : profile.stampAssetId;
    if (!assetId) {
      return {
        profile: await this.dtoWithAssets(profile),
        assetId: null,
        removed: false,
        deletionJobId: null,
      };
    }

    const asset = await this.prisma.fileAsset.findUnique({ where: { id: assetId } });
    if (!asset) {
      // A stale reference can still be detached; there is no stored object left
      // to enqueue for physical deletion.
      await this.prisma.companyProfile.update({
        where: { id },
        data: kind === 'logo' ? { logoAssetId: null } : { stampAssetId: null },
      });
      await this.audit.record({
        actorId,
        action: `company_profile.${kind}_removed`,
        entityType: 'CompanyProfile',
        entityId: id,
        requestId,
        metadata: { assetId, assetMissing: true },
      });
      const refreshed = await this.findProfileWithBanks(id);
      return {
        profile: await this.dtoWithAssets(refreshed ?? profile),
        assetId,
        removed: false,
        deletionJobId: null,
      };
    }

    await this.assertAssetUnreferenced(assetId, { companyProfileId: id, kind });
    const job = await this.prisma.$transaction(async (transaction) => {
      await transaction.companyProfile.update({
        where: { id },
        data: kind === 'logo' ? { logoAssetId: null } : { stampAssetId: null },
      });
      return this.queueFileDeletion(transaction, asset, actorId);
    });

    await this.audit.record({
      actorId,
      action: `company_profile.${kind}_removed`,
      entityType: 'CompanyProfile',
      entityId: id,
      requestId,
      metadata: {
        assetId,
        deletionJobId: job.id,
        storageScope: asset.storageKey.split('/')[0] ?? null,
      },
    });
    const refreshed = await this.findProfileWithBanks(id);
    return {
      profile: await this.dtoWithAssets(refreshed ?? profile),
      assetId,
      removed: true,
      deletionJobId: job.id,
    };
  }

  /**
   * Physically removes an image uploaded for a company that has not been saved
   * yet. Only the operator who uploaded the asset may purge their own orphan.
   */
  async removeUploadedAsset(assetId: string, actorId: string, requestId: string) {
    const asset = await this.prisma.fileAsset.findUnique({ where: { id: assetId } });
    if (!asset || asset.purpose !== 'logo') throw ApiError.notFound('Image not found.');
    if (asset.uploadedById !== actorId) {
      throw ApiError.forbidden('This upload belongs to another operator.');
    }
    await this.assertAssetUnreferenced(assetId);
    const job = await this.prisma.$transaction(async (transaction) =>
      this.queueFileDeletion(transaction, asset, actorId),
    );
    await this.audit.record({
      actorId,
      action: 'company_profile.uploaded_asset_removed',
      entityType: 'file_asset',
      entityId: assetId,
      requestId,
      metadata: {
        deletionJobId: job.id,
        storageScope: asset.storageKey.split('/')[0] ?? null,
      },
    });
    return { assetId, removed: true, deletionJobId: job.id };
  }

  /**
   * Company images are shared reference data. Deleting an asset still used by a
   * profile, a PI/CI document snapshot or the site logo would silently break that
   * consumer, so the request is refused instead (AGENTS §N.4).
   */
  private async assertAssetUnreferenced(
    assetId: string,
    ignore?: { companyProfileId: string; kind: CompanyAssetKind },
  ) {
    const [profiles, documentCount, settingCount] = await Promise.all([
      this.prisma.companyProfile.findMany({
        where: { OR: [{ logoAssetId: assetId }, { stampAssetId: assetId }] },
        select: { id: true, logoAssetId: true, stampAssetId: true },
      }),
      this.prisma.commercialDocument.count({
        where: {
          OR: [
            { sellerSnapshot: { path: ['logoAssetId'], equals: assetId } },
            { sellerSnapshot: { path: ['stampAssetId'], equals: assetId } },
            { signatureSnapshot: { path: ['stampAssetId'], equals: assetId } },
          ],
        },
      }),
      this.prisma.globalSetting.count({
        where: { key: 'site.logoFileAssetId', value: { equals: assetId } },
      }),
    ]);

    const remainingProfileReferences = profiles.some((profile) => {
      if (!ignore || profile.id !== ignore.companyProfileId) return true;
      return ignore.kind === 'logo'
        ? profile.stampAssetId === assetId
        : profile.logoAssetId === assetId;
    });
    if (remainingProfileReferences || documentCount > 0 || settingCount > 0) {
      throw new ApiError(
        ERROR_CODES.assetInUse,
        'This image is still referenced by a company profile, a PI/CI document snapshot or the site logo.',
        {
          status: 409,
          details: {
            companyProfileCount: profiles.length,
            documentCount,
            siteSettingCount: settingCount,
          },
        },
      );
    }
  }

  private async queueFileDeletion(
    transaction: Prisma.TransactionClient,
    asset: { id: string; storageKey: string },
    actorId: string,
  ) {
    const idempotencyKey = `file-asset:${asset.id}`;
    const existing = await transaction.fileDeletionJob.findUnique({
      where: { idempotencyKey },
    });
    const job =
      existing ??
      (await transaction.fileDeletionJob.create({
        data: {
          storageKey: asset.storageKey,
          entityType: 'file_asset',
          entityId: asset.id,
          requestedBy: actorId,
          status: 'QUEUED',
          idempotencyKey,
        },
      }));
    // The asset metadata is removed after the durable task is recorded. The
    // worker performs the physical object delete and retries on storage failure.
    await transaction.fileAsset.delete({ where: { id: asset.id } });
    return job;
  }

  private findProfileWithBanks(id: string) {
    return this.prisma.companyProfile.findUnique({
      where: { id },
      include: {
        bankAccounts: {
          orderBy: [
            { currencyCode: 'asc' },
            { isDefault: 'desc' },
            { sortOrder: 'asc' },
            { label: 'asc' },
          ],
        },
      },
    });
  }

  private async dtoWithAssets(profile: ProfileWithBanks) {
    const assetUrls = await this.loadAssetUrls([profile.logoAssetId, profile.stampAssetId]);
    return this.dto(profile, assetUrls);
  }

  private async loadAssetUrls(ids: Array<string | null | undefined>) {
    const uniqueIds = [...new Set(ids.filter((id): id is string => Boolean(id)))];
    if (uniqueIds.length === 0) return new Map<string, string>();
    const assets = await this.prisma.fileAsset.findMany({
      where: { id: { in: uniqueIds }, status: 'ready', isPublic: true },
      select: { id: true, storageKey: true },
    });
    return new Map(assets.map((asset) => [asset.id, this.storage.publicUrl(asset.storageKey)]));
  }

  private async validateCompanyAddress(address: unknown) {
    const countryCode =
      address && typeof address === 'object'
        ? (address as { countryCode?: unknown }).countryCode
        : null;
    if (typeof countryCode === 'string' && countryCode.length > 0) {
      await this.requireCountry(countryCode);
    }
  }

  private async requireCurrency(code: string | null | undefined): Promise<string> {
    if (!code) {
      throw new ApiError(
        ERROR_CODES.bankAccountCurrencyRequired,
        'A bank account currency is required.',
        { status: 422 },
      );
    }
    const item = await this.prisma.dictionaryItem.findFirst({
      where: {
        code,
        enabled: true,
        type: { code: 'currency', enabled: true },
      },
      select: { code: true },
    });
    if (!item) {
      throw new ApiError(
        ERROR_CODES.bankAccountCurrencyInvalid,
        'The selected currency is not available.',
        { status: 422 },
      );
    }
    return item.code;
  }

  private async requireCountry(code: string | null | undefined): Promise<string> {
    if (!code) {
      throw new ApiError(
        ERROR_CODES.bankAccountCountryInvalid,
        'A bank account country is required for new accounts.',
        { status: 422 },
      );
    }
    const item = await this.prisma.dictionaryItem.findFirst({
      where: {
        code,
        enabled: true,
        type: { code: 'country', enabled: true },
      },
      select: { code: true },
    });
    if (!item) {
      throw new ApiError(
        ERROR_CODES.bankAccountCountryInvalid,
        'The selected bank country is not available.',
        { status: 422 },
      );
    }
    return item.code;
  }

  private assertAccountState(enabled: boolean, isDefault: boolean) {
    if (!enabled && isDefault) {
      throw new ApiError(
        ERROR_CODES.bankAccountDefaultConflict,
        'A disabled bank account cannot be the default.',
        { status: 422 },
      );
    }
  }

  private assertSingleDefaultPerCurrency(
    accounts: Array<{ currencyCode: string; isDefault: boolean }>,
  ) {
    const seen = new Set<string>();
    for (const account of accounts) {
      if (!account.isDefault) continue;
      if (seen.has(account.currencyCode)) {
        throw new ApiError(
          ERROR_CODES.bankAccountDefaultConflict,
          'Only one default account is allowed per currency.',
          { status: 422 },
        );
      }
      seen.add(account.currencyCode);
    }
  }

  private async isAccountUsedByDocument(account: BankAccountProfile): Promise<boolean> {
    const used = await this.prisma.commercialDocument.findFirst({
      where: {
        OR: [
          { calculationSnapshot: { path: ['bankAccountId'], equals: account.id } },
          { paymentSnapshot: { path: ['accountNumber'], equals: account.accountNumber } },
        ],
      },
      select: { id: true },
    });
    return Boolean(used);
  }

  private bankCreateData(account: CreateBankAccountWithoutCompanyIdInput) {
    return {
      label: account.label,
      accountHolder: account.accountHolder,
      bankName: account.bankName,
      bankAddress: account.bankAddress ?? null,
      bankCountryCode: account.bankCountryCode,
      accountNumber: account.accountNumber,
      swiftCode: account.swiftCode ?? null,
      wireRoutingNumber: account.wireRoutingNumber ?? null,
      achRoutingNumber: account.achRoutingNumber ?? null,
      currencyCode: account.currencyCode,
      isDefault: account.isDefault,
      enabled: account.enabled,
      sortOrder: account.sortOrder,
    };
  }

  private duplicateCodeError() {
    return ApiError.conflict(ERROR_CODES.conflict, 'A company profile with this code exists.');
  }

  private translateUniqueError(error: unknown): unknown {
    if (!(error instanceof PrismaRuntime.PrismaClientKnownRequestError) || error.code !== 'P2002') {
      return error;
    }
    const target = (error.meta as { target?: unknown } | undefined)?.target;
    const fields = (Array.isArray(target) ? target.join(',') : String(target ?? '')).toLowerCase();
    // The only unique key on a company profile is `code`; bank-account writes
    // can only collide on the partial per-currency default index. This also
    // handles drivers that report the index name instead of column names.
    if (/(^|,)code($|,)/.test(fields)) return this.duplicateCodeError();
    return new ApiError(
      ERROR_CODES.bankAccountDefaultConflict,
      'Another session changed the default account for this currency. Refresh and try again.',
      { status: 409 },
    );
  }

  private maskAccountNumber(accountNumber: string): string {
    const normalized = accountNumber.replace(/\s+/g, '');
    const visible = normalized.slice(-4);
    return `****${visible}`;
  }

  private bankSummaryDto(account: {
    id: string;
    label: string;
    bankName: string;
    accountNumber: string;
    swiftCode: string | null;
    currencyCode: string | null;
    bankCountryCode: string | null;
    isDefault: boolean;
    enabled: boolean;
  }) {
    return {
      id: account.id,
      label: account.label,
      bankName: account.bankName,
      currencyCode: account.currencyCode,
      bankCountryCode: account.bankCountryCode,
      isDefault: account.isDefault,
      enabled: account.enabled,
      hasSwift: Boolean(account.swiftCode),
      maskedAccountNumber: this.maskAccountNumber(account.accountNumber),
    };
  }

  private bankDetailDto(account: BankAccountProfile) {
    return {
      ...this.bankSummaryDto(account),
      companyProfileId: account.companyProfileId,
      accountHolder: account.accountHolder,
      bankAddress: account.bankAddress,
      accountNumber: account.accountNumber,
      swiftCode: account.swiftCode,
      wireRoutingNumber: account.wireRoutingNumber,
      achRoutingNumber: account.achRoutingNumber,
      sortOrder: account.sortOrder,
    };
  }

  private dto(profile: ProfileWithBanks, assetUrls: Map<string, string> = new Map()) {
    return {
      id: profile.id,
      code: profile.code,
      companyName: profile.companyName,
      contactName: profile.contactName,
      phone: profile.phone,
      email: profile.email,
      taxId: profile.taxId,
      website: profile.website,
      address: profile.address,
      logoAssetId: profile.logoAssetId,
      stampAssetId: profile.stampAssetId,
      logoUrl: profile.logoAssetId ? (assetUrls.get(profile.logoAssetId) ?? null) : null,
      stampUrl: profile.stampAssetId ? (assetUrls.get(profile.stampAssetId) ?? null) : null,
      isDefault: profile.isDefault,
      enabled: profile.enabled,
      updatedAt: profile.updatedAt?.toISOString(),
      bankAccounts: profile.bankAccounts?.map((account) => this.bankSummaryDto(account)),
    };
  }
}
