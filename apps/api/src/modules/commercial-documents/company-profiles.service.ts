import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ERROR_CODES } from '@b2b/contracts';
import type {
  CreateBankAccountInput,
  CreateCompanyProfileInput,
  UpdateBankAccountInput,
  UpdateCompanyProfileInput,
} from '@b2b/validation';
import { PrismaService } from '../../prisma/prisma.service';
import { ApiError } from '../../common/errors/api-error';
import { AuditService } from '../../common/services/audit.service';

// Seller and bank details are company-level reference data. Documents copy a
// snapshot at creation/issue time, so editing a profile never rewrites an
// issued document (docs/41 §8.2).
@Injectable()
export class CompanyProfilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list() {
    const profiles = await this.prisma.companyProfile.findMany({
      orderBy: [{ isDefault: 'desc' }, { companyName: 'asc' }],
      include: {
        bankAccounts: { orderBy: [{ isDefault: 'desc' }, { sortOrder: 'asc' }, { label: 'asc' }] },
      },
    });
    return { data: profiles.map((profile) => this.dto(profile)) };
  }

  /** Minimal enabled set used by the document editor. */
  async options() {
    const profiles = await this.prisma.companyProfile.findMany({
      where: { enabled: true },
      orderBy: [{ isDefault: 'desc' }, { companyName: 'asc' }],
      include: { bankAccounts: { where: { enabled: true }, orderBy: [{ isDefault: 'desc' }, { sortOrder: 'asc' }] } },
    });
    return {
      data: profiles.map((profile) => ({
        id: profile.id,
        companyName: profile.companyName,
        isDefault: profile.isDefault,
        address: profile.address,
        bankAccounts: profile.bankAccounts.map((account) => ({
          id: account.id,
          label: account.label,
          accountHolder: account.accountHolder,
          bankName: account.bankName,
          bankAddress: account.bankAddress,
          accountNumber: account.accountNumber,
          swiftCode: account.swiftCode,
          wireRoutingNumber: account.wireRoutingNumber,
          achRoutingNumber: account.achRoutingNumber,
          currencyCode: account.currencyCode,
          isDefault: account.isDefault,
        })),
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
    const code = input.code ?? `company-${randomUUID().slice(0, 12)}`;
    const exists = await this.prisma.companyProfile.findUnique({ where: { code } });
    if (exists) {
      throw ApiError.conflict(ERROR_CODES.conflict, 'A company profile with this code exists.');
    }
    const profile = await this.prisma.$transaction(async (transaction) => {
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
    await this.audit.record({
      actorId,
      action: 'company_profile.created',
      entityType: 'CompanyProfile',
      entityId: profile.id,
      requestId,
      metadata: { code, isDefault: input.isDefault },
    });
    return this.dto(profile);
  }

  async update(
    id: string,
    input: UpdateCompanyProfileInput,
    actorId: string,
    requestId: string,
  ) {
    const existing = await this.prisma.companyProfile.findUnique({ where: { id } });
    if (!existing) throw ApiError.notFound('Company profile not found.');
    const profile = await this.prisma.$transaction(async (transaction) => {
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
        if (duplicate) {
          throw ApiError.conflict(ERROR_CODES.conflict, 'A company profile with this code exists.');
        }
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
    await this.audit.record({
      actorId,
      action: 'company_profile.updated',
      entityType: 'CompanyProfile',
      entityId: id,
      requestId,
      metadata: { changedFields: Object.keys(input) },
    });
    return this.dto(profile);
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

  async createBankAccount(input: CreateBankAccountInput, actorId: string, requestId: string) {
    const profile = await this.prisma.companyProfile.findUnique({
      where: { id: input.companyProfileId },
      select: { id: true },
    });
    if (!profile) throw ApiError.notFound('Company profile not found.');
    const account = await this.prisma.$transaction(async (transaction) => {
      if (input.isDefault) {
        await transaction.bankAccountProfile.updateMany({
          where: { companyProfileId: input.companyProfileId, isDefault: true },
          data: { isDefault: false },
        });
      }
      return transaction.bankAccountProfile.create({
        data: {
          companyProfileId: input.companyProfileId,
          label: input.label,
          accountHolder: input.accountHolder,
          bankName: input.bankName,
          bankAddress: input.bankAddress ?? null,
          accountNumber: input.accountNumber,
          swiftCode: input.swiftCode ?? null,
          wireRoutingNumber: input.wireRoutingNumber ?? null,
          achRoutingNumber: input.achRoutingNumber ?? null,
          currencyCode: input.currencyCode ?? null,
          isDefault: input.isDefault,
          enabled: input.enabled,
          sortOrder: input.sortOrder,
        },
      });
    });
    await this.audit.record({
      actorId,
      action: 'bank_account.created',
      entityType: 'BankAccountProfile',
      entityId: account.id,
      requestId,
      // Never log the account number, SWIFT or routing numbers.
      metadata: { label: account.label, companyProfileId: account.companyProfileId },
    });
    return this.bankDto(account);
  }

  async updateBankAccount(
    id: string,
    input: UpdateBankAccountInput,
    actorId: string,
    requestId: string,
  ) {
    const existing = await this.prisma.bankAccountProfile.findUnique({ where: { id } });
    if (!existing) throw ApiError.notFound('Bank account not found.');
    const account = await this.prisma.$transaction(async (transaction) => {
      if (input.isDefault === true) {
        await transaction.bankAccountProfile.updateMany({
          where: { companyProfileId: existing.companyProfileId, isDefault: true, id: { not: id } },
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
          ...(input.accountNumber !== undefined ? { accountNumber: input.accountNumber } : {}),
          ...(input.swiftCode !== undefined ? { swiftCode: input.swiftCode } : {}),
          ...(input.wireRoutingNumber !== undefined
            ? { wireRoutingNumber: input.wireRoutingNumber }
            : {}),
          ...(input.achRoutingNumber !== undefined
            ? { achRoutingNumber: input.achRoutingNumber }
            : {}),
          ...(input.currencyCode !== undefined ? { currencyCode: input.currencyCode } : {}),
          ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
          ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
          ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        },
      });
    });
    await this.audit.record({
      actorId,
      action: 'bank_account.updated',
      entityType: 'BankAccountProfile',
      entityId: id,
      requestId,
      metadata: { changedFields: Object.keys(input) },
    });
    return this.bankDto(account);
  }

  async removeBankAccount(id: string, actorId: string, requestId: string) {
    const account = await this.prisma.bankAccountProfile.findUnique({ where: { id } });
    if (!account) throw ApiError.notFound('Bank account not found.');
    await this.prisma.bankAccountProfile.delete({ where: { id } });
    await this.audit.record({
      actorId,
      action: 'bank_account.deleted',
      entityType: 'BankAccountProfile',
      entityId: id,
      requestId,
      metadata: { label: account.label },
    });
    return { deleted: true };
  }

  private dto(profile: {
    id: string;
    code: string;
    companyName: string;
    contactName: string | null;
    phone: string | null;
    email: string | null;
    taxId: string | null;
    website: string | null;
    address: unknown;
    logoAssetId: string | null;
    stampAssetId: string | null;
    isDefault: boolean;
    enabled: boolean;
    updatedAt?: Date;
    bankAccounts?: Array<{
      id: string;
      companyProfileId: string;
      label: string;
      accountHolder: string;
      bankName: string;
      bankAddress: string | null;
      accountNumber: string;
      swiftCode: string | null;
      wireRoutingNumber: string | null;
      achRoutingNumber: string | null;
      currencyCode: string | null;
      isDefault: boolean;
      enabled: boolean;
      sortOrder: number;
    }>;
  }) {
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
      isDefault: profile.isDefault,
      enabled: profile.enabled,
      updatedAt: profile.updatedAt?.toISOString(),
      bankAccounts: profile.bankAccounts?.map((account) => this.bankDto(account)),
    };
  }

  private bankDto(account: {
    id: string;
    companyProfileId: string;
    label: string;
    accountHolder: string;
    bankName: string;
    bankAddress: string | null;
    accountNumber: string;
    swiftCode: string | null;
    wireRoutingNumber: string | null;
    achRoutingNumber: string | null;
    currencyCode: string | null;
    isDefault: boolean;
    enabled: boolean;
    sortOrder: number;
  }) {
    return {
      id: account.id,
      companyProfileId: account.companyProfileId,
      label: account.label,
      accountHolder: account.accountHolder,
      bankName: account.bankName,
      bankAddress: account.bankAddress,
      accountNumber: account.accountNumber,
      swiftCode: account.swiftCode,
      wireRoutingNumber: account.wireRoutingNumber,
      achRoutingNumber: account.achRoutingNumber,
      currencyCode: account.currencyCode,
      isDefault: account.isDefault,
      enabled: account.enabled,
      sortOrder: account.sortOrder,
    };
  }
}
