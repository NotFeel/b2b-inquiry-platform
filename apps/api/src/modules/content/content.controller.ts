import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import {
  upsertContentPageSchema,
  upsertFaqSchema,
  type UpsertContentPageInput,
  type UpsertFaqInput,
} from '@b2b/validation';
import { Permission, RequirePermissions } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod.pipe';
import { ContentService } from './content.service';

@Controller('admin/content')
export class ContentController {
  constructor(private readonly content: ContentService) {}

  @RequirePermissions(Permission.contentRead)
  @Get('pages')
  async listPages() {
    return { data: await this.content.listPages() };
  }

  @RequirePermissions(Permission.contentUpdate)
  @Post('pages')
  async upsertPage(@Body(zodPipe(upsertContentPageSchema)) body: UpsertContentPageInput) {
    return { data: await this.content.upsertPage(body) };
  }

  @RequirePermissions(Permission.contentUpdate)
  @Delete('pages/:id')
  async removePage(@Param('id') id: string) {
    return this.content.removePage(id);
  }

  @RequirePermissions(Permission.contentRead)
  @Get('faq')
  async listFaq() {
    return { data: await this.content.listFaq() };
  }

  @RequirePermissions(Permission.contentUpdate)
  @Post('faq')
  async upsertFaq(@Body(zodPipe(upsertFaqSchema)) body: UpsertFaqInput) {
    return { data: await this.content.upsertFaq(body) };
  }

  @RequirePermissions(Permission.contentUpdate)
  @Post('faq/:id')
  async updateFaq(@Param('id') id: string, @Body(zodPipe(upsertFaqSchema)) body: UpsertFaqInput) {
    return { data: await this.content.upsertFaq(body, id) };
  }

  @RequirePermissions(Permission.contentUpdate)
  @Delete('faq/:id')
  async removeFaq(@Param('id') id: string) {
    return this.content.removeFaq(id);
  }
}
