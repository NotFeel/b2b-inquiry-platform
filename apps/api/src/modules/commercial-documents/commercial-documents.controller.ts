import { Body, Controller, Get, Param, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import {
  cancelCommercialDocumentSchema,
  commercialDocumentListQuerySchema,
  createCommercialDocumentSchema,
  idParamSchema,
  issueCommercialDocumentSchema,
  orderDocumentPrefillQuerySchema,
  updateCommercialDocumentSchema,
  type CancelCommercialDocumentInput,
  type CommercialDocumentListQuery,
  type CreateCommercialDocumentInput,
  type IssueCommercialDocumentInput,
  type OrderDocumentPrefillQuery,
  type UpdateCommercialDocumentInput,
} from '@b2b/validation';
import { CurrentActor, Permission, RequestId, RequirePermissions } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod.pipe';
import type { AuthenticatedActor } from '../../common/request-context';
import { StorageService } from '../../common/services/storage.service';
import { CommercialDocumentsService } from './commercial-documents.service';

@Controller('admin')
export class CommercialDocumentsController {
  constructor(
    private readonly documents: CommercialDocumentsService,
    private readonly storage: StorageService,
  ) {}

  @RequirePermissions(Permission.commercialDocumentRead)
  @Get('commercial-documents')
  async list(@Query(zodPipe(commercialDocumentListQuerySchema)) query: CommercialDocumentListQuery) {
    return this.documents.list(query);
  }

  @RequirePermissions(Permission.commercialDocumentRead)
  @Get('commercial-documents/:id')
  async detail(@Param('id') id: string) {
    return { data: await this.documents.detail(idParamSchema.parse({ id }).id) };
  }

  @RequirePermissions(Permission.commercialDocumentRead)
  @Get('orders/:id/document-prefill')
  async prefill(
    @Param('id') id: string,
    @Query(zodPipe(orderDocumentPrefillQuerySchema)) query: OrderDocumentPrefillQuery,
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    return {
      data: await this.documents.prefill(
        idParamSchema.parse({ id }).id,
        query.type,
        actor.id,
      ),
    };
  }

  @RequirePermissions(Permission.commercialDocumentCreate)
  @Post('orders/:id/commercial-documents')
  async create(
    @Param('id') id: string,
    @Body(zodPipe(createCommercialDocumentSchema)) body: CreateCommercialDocumentInput,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return {
      data: await this.documents.createFromOrder(
        idParamSchema.parse({ id }).id,
        body,
        actor.id,
        requestId,
      ),
    };
  }

  @RequirePermissions(Permission.commercialDocumentUpdate)
  @Patch('commercial-documents/:id')
  async update(
    @Param('id') id: string,
    @Body(zodPipe(updateCommercialDocumentSchema)) body: UpdateCommercialDocumentInput,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return {
      data: await this.documents.update(
        idParamSchema.parse({ id }).id,
        body,
        actor.id,
        requestId,
      ),
    };
  }

  @RequirePermissions(Permission.commercialDocumentPreview)
  @Post('commercial-documents/:id/preview')
  async preview(@Param('id') id: string) {
    return this.documents.preview(idParamSchema.parse({ id }).id);
  }

  @RequirePermissions(Permission.commercialDocumentPreview)
  @Post('commercial-documents/:id/render')
  async render(
    @Param('id') id: string,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return this.documents.requestRender(idParamSchema.parse({ id }).id, actor.id, requestId);
  }

  @RequirePermissions(Permission.commercialDocumentIssue)
  @Post('commercial-documents/:id/issue')
  async issue(
    @Param('id') id: string,
    @Body(zodPipe(issueCommercialDocumentSchema)) body: IssueCommercialDocumentInput,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return {
      data: await this.documents.issue(
        idParamSchema.parse({ id }).id,
        body.version,
        actor.id,
        requestId,
      ),
    };
  }

  @RequirePermissions(Permission.commercialDocumentRevisionCreate)
  @Post('commercial-documents/:id/revisions')
  async revision(
    @Param('id') id: string,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return {
      data: await this.documents.createRevision(
        idParamSchema.parse({ id }).id,
        actor.id,
        requestId,
      ),
    };
  }

  @RequirePermissions(Permission.commercialDocumentCancel)
  @Post('commercial-documents/:id/cancel')
  async cancel(
    @Param('id') id: string,
    @Body(zodPipe(cancelCommercialDocumentSchema)) body: CancelCommercialDocumentInput,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return {
      data: await this.documents.cancel(
        idParamSchema.parse({ id }).id,
        body,
        actor.id,
        requestId,
      ),
    };
  }

  @RequirePermissions(Permission.commercialDocumentDownload)
  @Get('commercial-documents/:id/download')
  async download(
    @Param('id') id: string,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
    @Res() response: Response,
  ): Promise<void> {
    const file = await this.documents.download(
      idParamSchema.parse({ id }).id,
      actor.id,
      requestId,
    );
    const ascii = file.filename.replace(/[^A-Za-z0-9._-]/g, '_') || 'commercial-document.pdf';
    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader('Content-Length', String(file.sizeBytes));
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
    );
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Request-Id', requestId);
    const stream = this.storage.createReadStream(file.storageKey);
    stream.on('error', () => response.destroy());
    stream.pipe(response);
  }
}
