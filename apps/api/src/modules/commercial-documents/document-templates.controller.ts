import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  createDocumentTemplateSchema,
  documentTemplateListQuerySchema,
  documentTemplatePreviewSchema,
  documentTemplateValidateSchema,
  idParamSchema,
  updateDocumentTemplateSchema,
  type CreateDocumentTemplateInput,
  type DocumentTemplateListQuery,
  type DocumentTemplatePreviewInput,
  type DocumentTemplateValidateInput,
  type UpdateDocumentTemplateInput,
} from '@b2b/validation';
import { CurrentActor, Permission, RequestId, RequirePermissions } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod.pipe';
import type { AuthenticatedActor } from '../../common/request-context';
import { DocumentTemplatesService } from './document-templates.service';

@Controller('admin/document-templates')
export class DocumentTemplatesController {
  constructor(private readonly templates: DocumentTemplatesService) {}

  @RequirePermissions(Permission.documentTemplateRead)
  @Get()
  async list(@Query(zodPipe(documentTemplateListQuerySchema)) query: DocumentTemplateListQuery) {
    return this.templates.list(query);
  }

  @RequirePermissions(Permission.documentTemplateRead)
  @Get('active-options')
  async activeOptions() {
    return { data: await this.templates.activeOptions() };
  }

  @RequirePermissions(Permission.documentTemplateRead)
  @Get(':id')
  async detail(@Param('id') id: string) {
    return { data: await this.templates.detail(idParamSchema.parse({ id }).id) };
  }

  @RequirePermissions(Permission.documentTemplateCreate)
  @Post()
  async create(
    @Body(zodPipe(createDocumentTemplateSchema)) body: CreateDocumentTemplateInput,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return { data: await this.templates.create(body, actor.id, requestId) };
  }

  @RequirePermissions(Permission.documentTemplateUpdate)
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body(zodPipe(updateDocumentTemplateSchema)) body: UpdateDocumentTemplateInput,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return {
      data: await this.templates.update(idParamSchema.parse({ id }).id, body, actor.id, requestId),
    };
  }

  @RequirePermissions(Permission.documentTemplateRead)
  @Post(':id/validate')
  async validate(
    @Param('id') id: string,
    @Body(zodPipe(documentTemplateValidateSchema)) body: DocumentTemplateValidateInput,
  ) {
    return this.templates.validateTemplate(idParamSchema.parse({ id }).id, body);
  }

  @RequirePermissions(Permission.documentTemplateRead)
  @Post(':id/preview')
  async preview(
    @Param('id') id: string,
    @Body(zodPipe(documentTemplatePreviewSchema)) body: DocumentTemplatePreviewInput,
  ) {
    return this.templates.preview(idParamSchema.parse({ id }).id, body);
  }

  @RequirePermissions(Permission.documentTemplatePublish)
  @Post(':id/publish')
  async publish(
    @Param('id') id: string,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return {
      data: await this.templates.publish(idParamSchema.parse({ id }).id, actor.id, requestId),
    };
  }

  @RequirePermissions(Permission.documentTemplateDelete)
  @Delete(':id')
  async remove(
    @Param('id') id: string,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return {
      data: await this.templates.remove(idParamSchema.parse({ id }).id, actor.id, requestId),
    };
  }

  @RequirePermissions(Permission.documentTemplateRead)
  @Get(':id/versions')
  async versions(@Param('id') id: string) {
    return this.templates.versions(idParamSchema.parse({ id }).id);
  }
}
