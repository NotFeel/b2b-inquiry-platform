import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { pdfConversionCreateSchema, type PdfConversionCreateInput } from '@b2b/validation';
import { CurrentActor, Permission, RequestId, RequirePermissions } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod.pipe';
import type { AuthenticatedActor } from '../../common/request-context';
import { PdfService } from './pdf.service';

@Controller('admin/pdf-conversions')
export class PdfController {
  constructor(private readonly pdf: PdfService) {}

  @RequirePermissions(Permission.pdfConvert)
  @Post()
  async create(
    @Body(zodPipe(pdfConversionCreateSchema)) body: PdfConversionCreateInput,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return { data: await this.pdf.create(body, actor.id, requestId) };
  }

  @RequirePermissions(Permission.pdfConvert)
  @Get()
  async list(@Query() query: { page?: string; pageSize?: string }) {
    return this.pdf.list({
      page: Number.parseInt(query.page ?? '1', 10) || 1,
      pageSize: Math.min(Number.parseInt(query.pageSize ?? '20', 10) || 20, 100),
    });
  }

  @RequirePermissions(Permission.pdfConvert)
  @Get(':id')
  async detail(@Param('id') id: string) {
    return { data: await this.pdf.get(id) };
  }
}
