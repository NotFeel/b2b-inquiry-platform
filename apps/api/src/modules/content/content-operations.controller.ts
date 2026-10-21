import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Permission } from '../../common/decorators';
import { CurrentActor, RequestId, RequirePermissions } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod.pipe';
import type { AuthenticatedActor } from '../../common/request-context';
import {
  contentStatusSchema,
  createCredentialSchema,
  createFactoryMediaSchema,
  createFactoryProcessStepSchema,
  credentialListQuerySchema,
  factoryMediaListQuerySchema,
  factoryProcessListQuerySchema,
  updateCredentialSchema,
  updateFactoryMediaSchema,
  updateFactoryProcessStepSchema,
  updateHomeSectionSchema,
  type ContentStatusInput,
  type CreateCredentialInput,
  type CreateFactoryMediaInput,
  type CreateFactoryProcessStepInput,
  type CredentialListQueryInput,
  type FactoryMediaListQueryInput,
  type FactoryProcessListQueryInput,
  type UpdateCredentialInput,
  type UpdateFactoryMediaInput,
  type UpdateFactoryProcessStepInput,
  type UpdateHomeSectionInput,
} from '@b2b/validation';
import { ContentOperationsService } from './content-operations.service';

@Controller('admin/content')
export class ContentOperationsController {
  constructor(private readonly content: ContentOperationsService) {}

  // ------------------------------------------------------------ factory media

  @RequirePermissions(Permission.factoryMediaRead)
  @Get('factory-media')
  async listFactoryMedia(
    @Query(zodPipe(factoryMediaListQuerySchema)) query: FactoryMediaListQueryInput,
  ) {
    return this.content.listFactoryMedia(query);
  }

  @RequirePermissions(Permission.factoryMediaRead)
  @Get('factory-media/:id')
  async getFactoryMedia(@Param('id') id: string, @Query('locale') locale = 'en-US') {
    return { data: await this.content.getFactoryMedia(id, locale) };
  }

  @RequirePermissions(Permission.factoryMediaCreate)
  @Post('factory-media')
  async createFactoryMedia(
    @Body(zodPipe(createFactoryMediaSchema)) body: CreateFactoryMediaInput,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return { data: await this.content.createFactoryMedia(body, actor.id, requestId) };
  }

  @RequirePermissions(Permission.factoryMediaUpdate)
  @Patch('factory-media/:id')
  async updateFactoryMedia(
    @Param('id') id: string,
    @Body(zodPipe(updateFactoryMediaSchema)) body: UpdateFactoryMediaInput,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return {
      data: await this.content.updateFactoryMedia(
        id,
        body,
        actor.id,
        requestId,
        actor.permissions.has(Permission.fileDelete),
      ),
    };
  }

  @RequirePermissions(Permission.factoryMediaPublish)
  @Post('factory-media/:id/status')
  async setFactoryMediaStatus(
    @Param('id') id: string,
    @Body(zodPipe(contentStatusSchema)) body: ContentStatusInput,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return {
      data: await this.content.setFactoryMediaStatus(id, body.status, actor.id, requestId),
    };
  }

  @RequirePermissions(Permission.factoryMediaDelete)
  @Delete('factory-media/:id')
  async deleteFactoryMedia(
    @Param('id') id: string,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return this.content.deleteFactoryMedia(
      id,
      actor.id,
      requestId,
      actor.permissions.has(Permission.fileDelete),
    );
  }

  // ---------------------------------------------------------- factory process

  @RequirePermissions(Permission.factoryProcessRead)
  @Get('factory-process')
  async listFactoryProcess(
    @Query(zodPipe(factoryProcessListQuerySchema)) query: FactoryProcessListQueryInput,
  ) {
    return this.content.listFactoryProcess(query);
  }

  @RequirePermissions(Permission.factoryProcessRead)
  @Get('factory-process/:id')
  async getFactoryProcess(@Param('id') id: string, @Query('locale') locale = 'en-US') {
    return { data: await this.content.getFactoryProcessStep(id, locale) };
  }

  @RequirePermissions(Permission.factoryProcessCreate)
  @Post('factory-process')
  async createFactoryProcess(
    @Body(zodPipe(createFactoryProcessStepSchema)) body: CreateFactoryProcessStepInput,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return { data: await this.content.createFactoryProcessStep(body, actor.id, requestId) };
  }

  @RequirePermissions(Permission.factoryProcessUpdate)
  @Patch('factory-process/:id')
  async updateFactoryProcess(
    @Param('id') id: string,
    @Body(zodPipe(updateFactoryProcessStepSchema)) body: UpdateFactoryProcessStepInput,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return {
      data: await this.content.updateFactoryProcessStep(
        id,
        body,
        actor.id,
        requestId,
        actor.permissions.has(Permission.fileDelete),
      ),
    };
  }

  @RequirePermissions(Permission.factoryProcessPublish)
  @Post('factory-process/:id/status')
  async setFactoryProcessStatus(
    @Param('id') id: string,
    @Body(zodPipe(contentStatusSchema)) body: ContentStatusInput,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return {
      data: await this.content.setFactoryProcessStatus(id, body.status, actor.id, requestId),
    };
  }

  @RequirePermissions(Permission.factoryProcessDelete)
  @Delete('factory-process/:id')
  async deleteFactoryProcess(
    @Param('id') id: string,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return this.content.deleteFactoryProcessStep(
      id,
      actor.id,
      requestId,
      actor.permissions.has(Permission.fileDelete),
    );
  }

  // -------------------------------------------------------------- credentials

  @RequirePermissions(Permission.credentialsRead)
  @Get('credentials')
  async listCredentials(
    @Query(zodPipe(credentialListQuerySchema)) query: CredentialListQueryInput,
  ) {
    return this.content.listCredentials(query);
  }

  @RequirePermissions(Permission.credentialsRead)
  @Get('credentials/:id')
  async getCredential(@Param('id') id: string, @Query('locale') locale = 'en-US') {
    return { data: await this.content.getCredential(id, locale) };
  }

  @RequirePermissions(Permission.credentialsCreate)
  @Post('credentials')
  async createCredential(
    @Body(zodPipe(createCredentialSchema)) body: CreateCredentialInput,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return { data: await this.content.createCredential(body, actor.id, requestId) };
  }

  @RequirePermissions(Permission.credentialsUpdate)
  @Patch('credentials/:id')
  async updateCredential(
    @Param('id') id: string,
    @Body(zodPipe(updateCredentialSchema)) body: UpdateCredentialInput,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return {
      data: await this.content.updateCredential(
        id,
        body,
        actor.id,
        requestId,
        actor.permissions.has(Permission.fileDelete),
      ),
    };
  }

  @RequirePermissions(Permission.credentialsPublish)
  @Post('credentials/:id/status')
  async setCredentialStatus(
    @Param('id') id: string,
    @Body(zodPipe(contentStatusSchema)) body: ContentStatusInput,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return {
      data: await this.content.setCredentialStatus(id, body.status, actor.id, requestId),
    };
  }

  @RequirePermissions(Permission.credentialsDelete)
  @Delete('credentials/:id')
  async deleteCredential(
    @Param('id') id: string,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return this.content.deleteCredential(
      id,
      actor.id,
      requestId,
      actor.permissions.has(Permission.fileDelete),
    );
  }

  // ------------------------------------------------------------ home sections

  @RequirePermissions(Permission.homeSectionsRead)
  @Get('home-sections')
  async listHomeSections() {
    return { data: await this.content.listHomeSections() };
  }

  @RequirePermissions(Permission.homeSectionsUpdate)
  @Patch('home-sections/:code')
  async updateHomeSection(
    @Param('code') code: string,
    @Body(zodPipe(updateHomeSectionSchema)) body: UpdateHomeSectionInput,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return {
      data: await this.content.updateHomeSection(code, body, actor.id, requestId),
    };
  }
}
