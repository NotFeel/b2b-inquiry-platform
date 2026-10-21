import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  createPiDocumentSchema,
  piListQuerySchema,
  piStatusSchema,
  updatePiDocumentSchema,
  type CreatePiDocumentInput,
  type UpdatePiDocumentInput,
} from '@b2b/validation';
import { CurrentActor, Permission, RequestId, RequirePermissions } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod.pipe';
import type { AuthenticatedActor } from '../../common/request-context';
import { PiService } from './pi.service';

@Controller('admin/pi-documents')
export class PiController {
  constructor(private readonly pi: PiService) {}

  @RequirePermissions(Permission.piRead)
  @Get()
  async list(@Query(zodPipe(piListQuerySchema)) query: Parameters<PiService['list']>[0]) {
    return this.pi.list(query);
  }

  @RequirePermissions(Permission.piRead)
  @Get(':id')
  async detail(@Param('id') id: string) {
    return { data: await this.pi.detail(id) };
  }

  @RequirePermissions(Permission.piCreate)
  @Post()
  async create(
    @Body(zodPipe(createPiDocumentSchema)) body: CreatePiDocumentInput,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return { data: await this.pi.create(body, actor.id, requestId) };
  }

  @RequirePermissions(Permission.piUpdate)
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body(zodPipe(updatePiDocumentSchema)) body: UpdatePiDocumentInput,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return { data: await this.pi.update(id, body, actor.id, requestId) };
  }

  @RequirePermissions(Permission.piUpdate)
  @Post(':id/status')
  async setStatus(
    @Param('id') id: string,
    @Body(zodPipe(piStatusSchema)) body: { status: string },
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return { data: await this.pi.setStatus(id, body.status, actor.id, requestId) };
  }

  @RequirePermissions(Permission.piUpdate)
  @Post(':id/revisions')
  async createRevision(
    @Param('id') id: string,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return { data: await this.pi.createRevision(id, actor.id, requestId) };
  }

  @RequirePermissions(Permission.piExport)
  @Post(':id/export')
  async export(
    @Param('id') id: string,
    @Body() body: { templateId?: string },
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return { data: await this.pi.requestExport(id, body?.templateId ?? null, actor.id, requestId) };
  }
}
