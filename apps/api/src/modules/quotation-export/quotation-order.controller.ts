import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import {
  idParamSchema,
  orderListQuerySchema,
  quotationCalculationSchema,
  quotationPreviewSchema,
  quotationListQuerySchema,
  quotationProductSearchQuerySchema,
  type OrderListQuery,
  type QuotationCalculationInput,
  type QuotationListQuery,
  type QuotationProductSearchQuery,
} from '@b2b/validation';
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
import { QuotationOrderService } from './quotation-order.service';

@Controller('admin')
export class QuotationOrderController {
  constructor(private readonly service: QuotationOrderService) {}

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
