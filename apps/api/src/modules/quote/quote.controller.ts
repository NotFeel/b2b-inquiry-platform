import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  quoteExportCreateSchema,
  quoteExportPreviewSchema,
  quoteTemplateUploadSchema,
  type QuoteExportCreateInput,
  type QuoteExportPreviewInput,
  type QuoteTemplateUploadInput,
} from '@b2b/validation';
import { CurrentActor, Permission, RequestId, RequirePermissions } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod.pipe';
import type { AuthenticatedActor } from '../../common/request-context';
import { QuoteService } from './quote.service';

@Controller('admin')
export class QuoteController {
  constructor(private readonly quote: QuoteService) {}

  @RequirePermissions(Permission.quoteRead)
  @Get('quote-templates')
  async listTemplates() {
    return { data: await this.quote.listTemplates() };
  }

  @RequirePermissions(Permission.quoteExport)
  @Post('quote-templates')
  async createTemplate(
    @Body(zodPipe(quoteTemplateUploadSchema)) body: QuoteTemplateUploadInput,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return { data: await this.quote.createTemplateVersion(body, actor.id, requestId) };
  }

  @RequirePermissions(Permission.quoteExport)
  @Patch('quote-templates/:id/status')
  async setTemplateStatus(
    @Param('id') id: string,
    @Body() body: { status: 'draft' | 'active' | 'disabled' },
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return { data: await this.quote.setTemplateStatus(id, body.status, actor.id, requestId) };
  }

  @RequirePermissions(Permission.quoteExport)
  @Post('quote-exports/preview')
  async preview(@Body(zodPipe(quoteExportPreviewSchema)) body: QuoteExportPreviewInput) {
    return { data: await this.quote.preview(body) };
  }

  @RequirePermissions(Permission.quoteExport)
  @Post('quote-exports')
  async create(
    @Body(zodPipe(quoteExportCreateSchema)) body: QuoteExportCreateInput,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return { data: await this.quote.createExport(body, actor.id, requestId) };
  }

  @RequirePermissions(Permission.quoteRead)
  @Get('quote-exports')
  async listExports(@Query() query: { page?: string; pageSize?: string; status?: string }) {
    return this.quote.listExports({
      page: Number.parseInt(query.page ?? '1', 10) || 1,
      pageSize: Math.min(Number.parseInt(query.pageSize ?? '20', 10) || 20, 100),
      status: query.status,
    });
  }

  @RequirePermissions(Permission.quoteRead)
  @Get('quote-exports/:id')
  async detail(@Param('id') id: string) {
    return { data: await this.quote.getExport(id) };
  }

  @RequirePermissions(Permission.quoteDelete)
  @Delete('quote-exports/:id')
  async remove(
    @Param('id') id: string,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return this.quote.requestDeletion(id, actor.id, requestId);
  }
}
