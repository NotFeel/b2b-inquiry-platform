import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import {
  createBankAccountSchema,
  createCompanyProfileSchema,
  idParamSchema,
  updateBankAccountSchema,
  updateCompanyProfileSchema,
  type CreateBankAccountInput,
  type CreateCompanyProfileInput,
  type UpdateBankAccountInput,
  type UpdateCompanyProfileInput,
} from '@b2b/validation';
import { CurrentActor, Permission, RequestId, RequirePermissions } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod.pipe';
import type { AuthenticatedActor } from '../../common/request-context';
import { CompanyProfilesService } from './company-profiles.service';

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
