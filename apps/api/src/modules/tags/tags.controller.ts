import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  createTagSchema,
  tagListQuerySchema,
  updateTagSchema,
  updateTagStatusSchema,
  type CreateTagInput,
  type TagListQueryInput,
  type UpdateTagInput,
  type UpdateTagStatusInput,
} from '@b2b/validation';
import { CurrentActor, Permission, RequestId, RequirePermissions } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod.pipe';
import type { AuthenticatedActor } from '../../common/request-context';
import { TagsService } from './tags.service';

// Tag administration (docs/23 §6).
//
// Each route carries its own permission: create, update and delete are separate
// capabilities, and hiding a button in the admin UI is never the control.
@Controller('admin/tags')
export class TagsController {
  constructor(private readonly tags: TagsService) {}

  /** Paginated list with server-side search, status and usage filters. */
  @RequirePermissions(Permission.tagRead)
  @Get()
  async list(@Query(zodPipe(tagListQuerySchema)) query: TagListQueryInput) {
    return this.tags.list(query);
  }

  /** Enabled tags for pickers (declared before `:id`). */
  @RequirePermissions(Permission.tagRead)
  @Get('options')
  async options(@Query('locale') locale?: string) {
    return { data: await this.tags.options(locale) };
  }

  @RequirePermissions(Permission.tagRead)
  @Get(':id')
  async detail(@Param('id') id: string, @Query('locale') locale?: string) {
    return { data: await this.tags.detail(id, locale) };
  }

  @RequirePermissions(Permission.tagCreate)
  @Post()
  async create(
    @Body(zodPipe(createTagSchema)) body: CreateTagInput,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return { data: await this.tags.create(body, actor.id, requestId) };
  }

  @RequirePermissions(Permission.tagUpdate)
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body(zodPipe(updateTagSchema)) body: UpdateTagInput,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return { data: await this.tags.update(id, body, actor.id, requestId) };
  }

  /** Enable/disable without touching the existing product associations. */
  @RequirePermissions(Permission.tagUpdate)
  @Patch(':id/status')
  async setStatus(
    @Param('id') id: string,
    @Body(zodPipe(updateTagStatusSchema)) body: UpdateTagStatusInput,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return { data: await this.tags.setStatus(id, body.enabled, actor.id, requestId) };
  }

  @RequirePermissions(Permission.tagDelete)
  @Delete(':id')
  async remove(
    @Param('id') id: string,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return this.tags.remove(id, actor.id, requestId);
  }
}
