import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  quotationCalculatorExcelExportSchema,
  quotationHistoryExcelExportSchema,
  idParamSchema,
  orderListQuerySchema,
  quotationCalculationSchema,
  quotationPreviewSchema,
  quotationListQuerySchema,
  quotationProductSearchQuerySchema,
  updateOrderCustomerSnapshotSchema,
  syncOrderCustomerProfileSchema,
  type OrderListQuery,
  type UpdateOrderCustomerSnapshotInput,
  type SyncOrderCustomerProfileInput,
  type QuotationCalculatorExcelExportInput,
  type QuotationCalculationInput,
  type QuotationHistoryExcelExportInput,
  type QuotationListQuery,
  type QuotationProductSearchQuery,
} from '@b2b/validation';
import { ERROR_CODES } from '@b2b/contracts';
import type { Response } from 'express';
import {
  Permission,
  CurrentActor,
  RequestId,
  RequirePermissions,
  SUPER_ADMIN_ROLE,
} from '../../common/decorators';
import { ApiError } from '../../common/errors/api-error';
import { zodPipe } from '../../common/pipes/zod.pipe';
import type { AuthenticatedActor } from '../../common/request-context';
import { RateLimitService } from '../../common/services/rate-limit.service';
import { QuotationOrderService } from './quotation-order.service';
import { QuotationCalculatorExcelExportService } from './quotation-calculator-excel-export.service';

const QUOTATION_XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const EXPORT_RATE_LIMIT_PER_MINUTE = 10;

@Controller('admin')
export class QuotationOrderController {
  constructor(
    private readonly service: QuotationOrderService,
    private readonly excelExport: QuotationCalculatorExcelExportService,
    private readonly rateLimit: RateLimitService,
  ) {}

  @RequirePermissions(Permission.quotationCalculate)
  @Get('quotation-calculator/excel-templates')
  async calculatorExcelTemplates() {
    return { data: await this.excelExport.listTemplates() };
  }

  @RequirePermissions(Permission.quotationRead)
  @Get('quotations/excel-templates')
  async quotationExcelTemplates() {
    return { data: await this.excelExport.listTemplates() };
  }

  @RequirePermissions(Permission.orderRead)
  @Get('orders/excel-templates')
  async orderExcelTemplates() {
    return { data: await this.excelExport.listTemplates() };
  }

  @RequirePermissions(Permission.quotationCalculate)
  @Post('quotation-calculator/export-excel')
  async exportCalculatorExcel(
    @Body(zodPipe(quotationCalculatorExcelExportSchema)) body: QuotationCalculatorExcelExportInput,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
    @Res() response: Response,
  ): Promise<void> {
    if (!this.canReadCost(actor)) {
      throw new ApiError(ERROR_CODES.forbidden, 'Cost access is required for calculator export.', {
        status: 403,
      });
    }
    await this.assertExcelRateLimit(actor, 'current');
    const file = await this.excelExport.exportCurrent(body, actor.id, requestId);
    this.sendExcel(file, response, requestId);
  }

  @RequirePermissions(Permission.quotationRead)
  @Post('quotations/:id/export-excel')
  async exportQuotationExcel(
    @Param('id') id: string,
    @Body(zodPipe(quotationHistoryExcelExportSchema)) body: QuotationHistoryExcelExportInput,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
    @Res() response: Response,
  ): Promise<void> {
    await this.assertExcelRateLimit(actor, 'quotation');
    const file = await this.excelExport.exportQuotation(
      idParamSchema.parse({ id }).id,
      body,
      actor.id,
      requestId,
    );
    this.sendExcel(file, response, requestId);
  }

  @RequirePermissions(Permission.orderRead)
  @Post('orders/:id/export-excel')
  async exportOrderExcel(
    @Param('id') id: string,
    @Body(zodPipe(quotationHistoryExcelExportSchema)) body: QuotationHistoryExcelExportInput,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
    @Res() response: Response,
  ): Promise<void> {
    await this.assertExcelRateLimit(actor, 'order');
    const file = await this.excelExport.exportOrder(
      idParamSchema.parse({ id }).id,
      body,
      actor.id,
      requestId,
    );
    this.sendExcel(file, response, requestId);
  }

  @RequirePermissions(Permission.quotationRead)
  @Get('quotation-calculator/config')
  async config(@Query('locale') locale: string | undefined) {
    return { data: await this.service.config(locale === 'zh-CN' ? 'zh-CN' : 'en-US') };
  }

  @RequirePermissions(Permission.quotationRead)
  @Get('quotation-calculator/products')
  async products(
    @Query(zodPipe(quotationProductSearchQuerySchema)) query: QuotationProductSearchQuery,
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    return {
      data: await this.service.products(
        query.q,
        query.categoryId,
        this.canReadCost(actor),
        query.locale,
        query.publishStatus,
      ),
    };
  }

  @RequirePermissions(Permission.quotationCalculate)
  @Post('quotation-calculator/preview')
  async preview(
    @Body(zodPipe(quotationPreviewSchema)) body: QuotationCalculationInput,
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    return { data: await this.service.preview(body, this.canReadCost(actor)) };
  }

  @RequirePermissions(Permission.quotationCreate)
  @Post('quotations')
  async createQuotation(
    @Body(zodPipe(quotationCalculationSchema)) body: QuotationCalculationInput,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ) {
    const key = this.requireIdempotencyKey(idempotencyKey);
    const data = await this.service.createQuotation(body, actor.id, requestId, key);
    return { data: this.canReadCost(actor) ? data : this.withoutCost(data) };
  }

  @RequirePermissions(Permission.quotationRead)
  @Get('quotations')
  async quotations(@Query(zodPipe(quotationListQuerySchema)) query: QuotationListQuery) {
    return this.service.listQuotations(query);
  }

  @RequirePermissions(Permission.quotationRead)
  @Get('quotations/:id')
  async quotationDetail(@Param('id') id: string, @CurrentActor() actor: AuthenticatedActor) {
    const data = await this.service.quotationDetail(idParamSchema.parse({ id }).id);
    return { data: this.canReadCost(actor) ? data : this.withoutCost(data) };
  }

  @RequirePermissions(Permission.quotationUpdate, Permission.quotationCostRead)
  @Get('quotations/:id/edit-data')
  async quotationEditData(@Param('id') id: string) {
    return { data: await this.service.quotationEditData(idParamSchema.parse({ id }).id) };
  }

  @RequirePermissions(Permission.quotationUpdate)
  @Patch('quotations/:id')
  async updateQuotation(
    @Param('id') id: string,
    @Body(zodPipe(quotationCalculationSchema)) body: QuotationCalculationInput,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    const data = await this.service.updateQuotation(
      idParamSchema.parse({ id }).id,
      body,
      actor.id,
      requestId,
    );
    return { data: this.canReadCost(actor) ? data : this.withoutCost(data) };
  }

  @RequirePermissions(Permission.quotationDelete)
  @Delete('quotations/:id')
  async deleteQuotation(
    @Param('id') id: string,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return {
      data: await this.service.deleteQuotation(idParamSchema.parse({ id }).id, actor.id, requestId),
    };
  }

  @RequirePermissions(Permission.quotationConvertToOrder)
  @Post('quotations/:id/convert-to-order')
  async convert(
    @Param('id') id: string,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    const data = await this.service.convertQuotation(
      idParamSchema.parse({ id }).id,
      actor.id,
      requestId,
    );
    return { data: this.canReadOrderCost(actor) ? data : this.withoutCost(data) };
  }

  @RequirePermissions(Permission.orderCreate)
  @Post('orders')
  async createOrder(
    @Body(zodPipe(quotationCalculationSchema)) body: QuotationCalculationInput,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ) {
    const key = this.requireIdempotencyKey(idempotencyKey);
    const data = await this.service.createOrder(body, actor.id, requestId, key);
    return { data: this.canReadOrderCost(actor) ? data : this.withoutCost(data) };
  }

  @RequirePermissions(Permission.orderRead)
  @Get('orders')
  async orders(@Query(zodPipe(orderListQuerySchema)) query: OrderListQuery) {
    return this.service.listOrders(query);
  }

  @RequirePermissions(Permission.orderRead)
  @Get('orders/:id')
  async orderDetail(@Param('id') id: string, @CurrentActor() actor: AuthenticatedActor) {
    const data = await this.service.orderDetail(idParamSchema.parse({ id }).id);
    return { data: this.canReadOrderCost(actor) ? data : this.withoutCost(data) };
  }

  @RequirePermissions(Permission.orderCustomerSnapshotUpdate)
  @Patch('orders/:id/customer-snapshot')
  async updateOrderCustomerSnapshot(
    @Param('id') id: string,
    @Body(zodPipe(updateOrderCustomerSnapshotSchema)) body: UpdateOrderCustomerSnapshotInput,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    const data = await this.service.updateOrderCustomerSnapshot(
      idParamSchema.parse({ id }).id,
      body,
      actor.id,
      requestId,
    );
    return { data: this.canReadOrderCost(actor) ? data : this.withoutCost(data) };
  }

  @RequirePermissions(Permission.orderCustomerProfileSync, Permission.customerUpdate)
  @Post('orders/:id/sync-customer-profile')
  async syncOrderCustomerProfile(
    @Param('id') id: string,
    @Body(zodPipe(syncOrderCustomerProfileSchema)) body: SyncOrderCustomerProfileInput,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return {
      data: await this.service.syncOrderCustomerProfile(
        idParamSchema.parse({ id }).id,
        body,
        actor.id,
        requestId,
      ),
    };
  }

  private canReadCost(actor: AuthenticatedActor) {
    return (
      actor.roles.includes(SUPER_ADMIN_ROLE) ||
      actor.permissions.has(Permission.quotationCostRead) ||
      actor.permissions.has(Permission.productCostRead)
    );
  }

  private requireIdempotencyKey(value: string | undefined): string {
    if (!value || !/^[A-Za-z0-9._:-]{16,120}$/.test(value)) {
      throw ApiError.validation('A valid Idempotency-Key header is required.');
    }
    return value;
  }

  private canReadOrderCost(actor: AuthenticatedActor) {
    return (
      actor.roles.includes(SUPER_ADMIN_ROLE) || actor.permissions.has(Permission.orderCostRead)
    );
  }

  private async assertExcelRateLimit(
    actor: AuthenticatedActor,
    source: 'current' | 'quotation' | 'order',
  ) {
    const result = await this.rateLimit.consume(
      `quotation-calculator-excel:${source}:${actor.id}`,
      EXPORT_RATE_LIMIT_PER_MINUTE,
      60,
    );
    if (!result.allowed) {
      throw new ApiError(ERROR_CODES.rateLimited, 'Too many quotation Excel export requests.', {
        details: { retryAfterSeconds: result.retryAfterSeconds },
      });
    }
  }

  private sendExcel(
    file: { buffer: Buffer; filename: string },
    response: Response,
    requestId: string,
  ): void {
    response.setHeader('Content-Type', QUOTATION_XLSX_MIME);
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${file.filename}"; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
    );
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Request-Id', requestId);
    response.send(file.buffer);
  }

  private withoutCost<
    T extends {
      items?: Array<Record<string, unknown>>;
      fees?: Array<Record<string, unknown>>;
      freight?: Record<string, unknown> | null;
    },
  >(data: T): T {
    if (!data.items && !data.fees && !data.freight) return data;
    return {
      ...data,
      ...(data.items
        ? {
            items: data.items.map(
              ({
                costCny: _cost,
                markupPercent: _markup,
                allocatedFreightCny: _freightCny,
                allocatedFreightForeign: _freightForeign,
                ...item
              }) => item,
            ),
          }
        : {}),
      ...(data.freight ? { freight: undefined } : {}),
      ...(data.fees
        ? {
            fees: data.fees.map((fee) =>
              fee.isFreight ? { ...fee, amountCny: undefined, amountForeign: undefined } : fee,
            ),
          }
        : {}),
    };
  }
}
