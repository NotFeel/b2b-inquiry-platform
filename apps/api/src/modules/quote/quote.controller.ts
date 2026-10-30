import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res } from '@nestjs/common';
import {
  quoteExportCreateSchema,
  quoteExportPreviewSchema,
  quoteTemplateStatusSchema,
  quoteTemplateUploadSchema,
  type QuoteExportCreateInput,
  type QuoteExportPreviewInput,
  type QuoteTemplateStatusInput,
  type QuoteTemplateUploadInput,
} from '@b2b/validation';
import type { Response } from 'express';
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

  @RequirePermissions(Permission.quoteRead)
  @Get('quote-templates/:id/file')
  async downloadTemplate(
    @Param('id') id: string,
    @RequestId() requestId: string,
    @Res() response: Response,
  ): Promise<void> {
    const file = await this.quote.getTemplateFile(id);
    response.setHeader('Content-Type', file.mimeType);
    response.setHeader('Content-Disposition', attachmentDisposition(file.filename));
    response.setHeader('Content-Length', String(file.body.length));
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Request-Id', requestId);
    response.send(file.body);
  }

  @RequirePermissions(Permission.quoteRead)
  @Get('quote-templates/:id/preview')
  async previewTemplate(@Param('id') id: string) {
    return { data: await this.quote.previewTemplate(id) };
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
    @Body(zodPipe(quoteTemplateStatusSchema)) body: QuoteTemplateStatusInput,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return { data: await this.quote.setTemplateStatus(id, body.status, actor.id, requestId) };
  }

  @RequirePermissions(Permission.quoteDelete)
  @Delete('quote-templates/:id')
  async removeTemplate(
    @Param('id') id: string,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return this.quote.requestTemplateDeletion(id, actor.id, requestId);
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

function attachmentDisposition(filename: string): string {
  const fallback =
    filename
      .replace(/[^\x20-\x7e]/g, '_')
      .replace(/["\\]/g, '_')
      .slice(0, 120) || 'quote-template.xlsx';
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
