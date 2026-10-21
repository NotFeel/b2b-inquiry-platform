import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import {
  createCustomerSchema,
  createInquiryActivitySchema,
  customerListQuerySchema,
  customerLookupQuerySchema,
  inquiryActivityListQuerySchema,
  type CreateCustomerInput,
  type CreateInquiryActivityInput,
} from '@b2b/validation';
import { CurrentActor, Permission, RequestId, RequirePermissions } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod.pipe';
import type { AuthenticatedActor } from '../../common/request-context';
import { LeadsService } from './leads.service';

@Controller('admin')
export class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  @RequirePermissions(Permission.customerRead)
  @Get('customers')
  async listCustomers(
    @Query(zodPipe(customerListQuerySchema)) query: {
      page: number;
      pageSize: number;
      phone?: string;
      countryCode?: string;
      q?: string;
    },
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    return this.leads.listCustomers({ ...query, revealPhone: this.canReveal(actor) });
  }

  // Dedicated lookup used by the phone search box.
  @RequirePermissions(Permission.customerRead)
  @Post('customers/lookup')
  async lookup(
    @Body(zodPipe(customerLookupQuerySchema)) body: { phone: string; country?: string },
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    return {
      data: await this.leads.lookup(body.phone, {
        countryCode: body.country,
        revealPhone: this.canReveal(actor),
      }),
    };
  }

  @RequirePermissions(Permission.customerCreate)
  @Post('customers')
  async createCustomer(
    @Body(zodPipe(createCustomerSchema)) body: CreateCustomerInput,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return { data: await this.leads.createCustomer(body, actor.id, requestId) };
  }

  @RequirePermissions(Permission.leadCreate)
  @Post('inquiry-activities')
  async createActivity(
    @Body(zodPipe(createInquiryActivitySchema)) body: CreateInquiryActivityInput,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return { data: await this.leads.createActivity(body, actor.id, requestId) };
  }

  @RequirePermissions(Permission.leadRead)
  @Get('inquiry-activities')
  async listActivities(
    @Query(zodPipe(inquiryActivityListQuerySchema))
    query: { page: number; pageSize: number; customerId?: string; from?: string; to?: string },
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    return this.leads.listActivities({ ...query, revealPhone: this.canReveal(actor) });
  }

  // Full phone numbers are only shown to roles that may act on them.
  private canReveal(actor: AuthenticatedActor): boolean {
    return (
      actor.roles.includes('super_admin') ||
      actor.permissions.has(Permission.customerExport) ||
      actor.permissions.has(Permission.leadCreate)
    );
  }
}
