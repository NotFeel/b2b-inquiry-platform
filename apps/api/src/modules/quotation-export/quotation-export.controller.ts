import { Body, Controller, Get, Post, Query, Res } from '@nestjs/common';
import {
  quotationExportPreviewSchema,
  quotationExportProductListQuerySchema,
  quotationExportSchema,
  type QuotationExportInput,
  type QuotationExportPreviewInput,
  type QuotationExportProductListQueryInput,
} from '@b2b/validation';
import { ERROR_CODES } from '@b2b/contracts';
import type { Response } from 'express';
import {
  CurrentActor,
  Permission,
  RequestId,
  RequirePermissions,
  SUPER_ADMIN_ROLE,
} from '../../common/decorators';
import { ApiError } from '../../common/errors/api-error';
import { zodPipe } from '../../common/pipes/zod.pipe';
import type { AuthenticatedActor } from '../../common/request-context';
import { RateLimitService } from '../../common/services/rate-limit.service';
import { QuotationExportService } from './quotation-export.service';

const QUOTATION_XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const CREATE_RATE_LIMIT_WINDOW_SECONDS = 60;
const PREVIEW_REQUESTS_PER_WINDOW = 120;
const EXPORT_REQUESTS_PER_WINDOW = 10;

@Controller('admin/quotation-export')
export class QuotationExportController {
  constructor(
    private readonly quotationExport: QuotationExportService,
    private readonly rateLimit: RateLimitService,
  ) {}

  @RequirePermissions(Permission.quotationExportRead)
  @Get('config')
  config() {
    return { data: this.quotationExport.config() };
  }

  @RequirePermissions(Permission.quotationExportRead)
  @Get('templates')
  async templates() {
    return { data: await this.quotationExport.listTemplates() };
  }

  @RequirePermissions(Permission.quotationExportRead)
  @Get('products')
  async products(
    @Query(zodPipe(quotationExportProductListQuerySchema))
    query: QuotationExportProductListQueryInput,
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    return {
      data: await this.quotationExport.listProducts(
        query,
        this.canExportUnpublished(actor),
        this.canReadCost(actor),
      ),
    };
  }

  @RequirePermissions(Permission.quotationExportCreate)
  @Post('preview')
  async preview(
    @Body(zodPipe(quotationExportPreviewSchema)) body: QuotationExportPreviewInput,
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    await this.assertCreateRateLimit(actor, 'preview', PREVIEW_REQUESTS_PER_WINDOW);
    return {
      data: await this.quotationExport.preview(body, this.canExportUnpublished(actor)),
    };
  }

  @RequirePermissions(Permission.quotationExportCreate)
  @Post('export')
  async export(
    @Body(zodPipe(quotationExportSchema)) body: QuotationExportInput,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
    @Res() response: Response,
  ): Promise<void> {
    await this.assertCreateRateLimit(actor, 'export', EXPORT_REQUESTS_PER_WINDOW);
    const file = await this.quotationExport.export(
      body,
      this.canExportUnpublished(actor),
      actor.id,
      requestId,
    );
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

  private async assertCreateRateLimit(
    actor: AuthenticatedActor,
    operation: 'preview' | 'export',
    limit: number,
  ): Promise<void> {
    // Keys stay in process memory and contain no IP, email, token or customer
    // data. Preview and export use separate buckets so frequent interactive
    // calculation cannot consume the stricter file-generation allowance.
    const result = await this.rateLimit.consume(
      `quotation-export:${operation}:${actor.id}`,
      limit,
      CREATE_RATE_LIMIT_WINDOW_SECONDS,
    );
    if (!result.allowed) {
      throw new ApiError(
        ERROR_CODES.rateLimited,
        'Too many quotation export requests. Please retry later.',
        { details: { retryAfterSeconds: result.retryAfterSeconds } },
      );
    }
  }

  private canExportUnpublished(actor: AuthenticatedActor): boolean {
    return (
      actor.roles.includes(SUPER_ADMIN_ROLE) ||
      actor.permissions.has(Permission.quotationExportUnpublished)
    );
  }

  private canReadCost(actor: AuthenticatedActor): boolean {
    return (
      actor.roles.includes(SUPER_ADMIN_ROLE) || actor.permissions.has(Permission.productCostRead)
    );
  }
}
