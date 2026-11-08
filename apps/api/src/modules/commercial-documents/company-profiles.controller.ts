import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import {
  createBankAccountSchema,
  createCompanyProfileSchema,
  createCompanyProfileWithBankAccountsSchema,
  idParamSchema,
  updateBankAccountSchema,
  updateCompanyProfileSchema,
  type CreateBankAccountInput,
  type CreateCompanyProfileInput,
  type CreateCompanyProfileWithBankAccountsInput,
  type UpdateBankAccountInput,
  type UpdateCompanyProfileInput,
} from '@b2b/validation';
import { CurrentActor, Permission, RequestId, RequirePermissions } from '../../common/decorators';
import { ApiError } from '../../common/errors/api-error';
import { zodPipe } from '../../common/pipes/zod.pipe';
import type { AuthenticatedActor } from '../../common/request-context';
import { CompanyProfilesService, type CompanyAssetKind } from './company-profiles.service';

@Controller('admin')
export class CompanyProfilesController {
  constructor(private readonly profiles: CompanyProfilesService) {}

  @RequirePermissions(Permission.companyProfileManage)
  @Get('company-profiles')
  async list() {
    return this.profiles.list();
  }

  /** Enabled seller/bank choices for the document editor. */
  @RequirePermissions(Permission.commercialDocumentRead)
  @Get('company-profiles/options')
  async options() {
    return this.profiles.options();
  }

  @RequirePermissions(Permission.companyProfileManage)
  @Post('company-profiles')
  async create(
    @Body(zodPipe(createCompanyProfileSchema)) body: CreateCompanyProfileInput,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return { data: await this.profiles.create(body, actor.id, requestId) };
  }

  /**
   * Company + initial bank accounts are one transaction. The guard requires
   * both permissions; hiding the UI is not sufficient (docs/44 §7.4).
   */
  @RequirePermissions(Permission.companyProfileManage, Permission.bankAccountManage)
  @Post('company-profiles/with-bank-accounts')
  async createWithBankAccounts(
    @Body(zodPipe(createCompanyProfileWithBankAccountsSchema))
    body: CreateCompanyProfileWithBankAccountsInput,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return { data: await this.profiles.createWithBankAccounts(body, actor.id, requestId) };
  }

  @RequirePermissions(Permission.companyProfileManage)
  @Patch('company-profiles/:id')
  async update(
    @Param('id') id: string,
    @Body(zodPipe(updateCompanyProfileSchema)) body: UpdateCompanyProfileInput,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return {
      data: await this.profiles.update(idParamSchema.parse({ id }).id, body, actor.id, requestId),
    };
  }

  @RequirePermissions(Permission.companyProfileManage)
  @Delete('company-profiles/:id')
  async remove(
    @Param('id') id: string,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return {
      data: await this.profiles.remove(idParamSchema.parse({ id }).id, actor.id, requestId),
    };
  }

  /**
   * Deletes the profile's logo or stamp and queues the object for physical
   * deletion. An image still referenced by another company, an issued PI/CI
   * snapshot or the site logo is protected with HTTP 409 (docs/44 §22).
   */
  @RequirePermissions(Permission.companyProfileManage)
  @Delete('company-profiles/:id/assets/:kind')
  async removeAsset(
    @Param('id') id: string,
    @Param('kind') kind: string,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return {
      data: await this.profiles.removeAsset(
        idParamSchema.parse({ id }).id,
        assetKind(kind),
        actor.id,
        requestId,
      ),
    };
  }

  /** Purges an image uploaded for a company that has not been saved yet. */
  @RequirePermissions(Permission.companyProfileManage)
  @Delete('company-profile-assets/:assetId')
  async removeUploadedAsset(
    @Param('assetId') assetId: string,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return {
      data: await this.profiles.removeUploadedAsset(
        idParamSchema.parse({ id: assetId }).id,
        actor.id,
        requestId,
      ),
    };
  }

  @RequirePermissions(Permission.bankAccountManage)
  @Post('bank-accounts')
  async createBankAccount(
    @Body(zodPipe(createBankAccountSchema)) body: CreateBankAccountInput,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return { data: await this.profiles.createBankAccount(body, actor.id, requestId) };
  }

  @RequirePermissions(Permission.bankAccountManage)
  @Get('bank-accounts/:id')
  async getBankAccount(@Param('id') id: string) {
    return {
      data: await this.profiles.getBankAccount(idParamSchema.parse({ id }).id),
    };
  }

  @RequirePermissions(Permission.bankAccountManage)
  @Patch('bank-accounts/:id')
  async updateBankAccount(
    @Param('id') id: string,
    @Body(zodPipe(updateBankAccountSchema)) body: UpdateBankAccountInput,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return {
      data: await this.profiles.updateBankAccount(
        idParamSchema.parse({ id }).id,
        body,
        actor.id,
        requestId,
      ),
    };
  }

  @RequirePermissions(Permission.bankAccountManage)
  @Delete('bank-accounts/:id')
  async removeBankAccount(
    @Param('id') id: string,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return {
      data: await this.profiles.removeBankAccount(
        idParamSchema.parse({ id }).id,
        actor.id,
        requestId,
      ),
    };
  }
}

function assetKind(value: string): CompanyAssetKind {
  if (value === 'logo' || value === 'stamp') return value;
  throw ApiError.validation('Unknown company image kind.', { kind: 'validation.invalid' });
}
