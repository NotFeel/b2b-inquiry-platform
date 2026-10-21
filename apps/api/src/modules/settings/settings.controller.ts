import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  createSettingSchema,
  settingListQuerySchema,
  settingLocaleQuerySchema,
  updateSettingSchema,
  type CreateSettingInput,
  type SettingListQueryInput,
  type UpdateSettingInput,
} from '@b2b/validation';
import { CurrentActor, Permission, RequestId, RequirePermissions } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod.pipe';
import type { AuthenticatedActor } from '../../common/request-context';
import { SettingsService } from './settings.service';

// Global settings administration (docs/21 §6.1).
//
// Reading, creating, updating and deleting are four separate permissions; the
// service re-checks the system/secret/value-type policies on every write path,
// so a hidden button is never the protection.
@Controller('admin/settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @RequirePermissions(Permission.settingRead)
  @Get()
  async list(@Query(zodPipe(settingListQuerySchema)) query: SettingListQueryInput) {
    return this.settings.listSettings(query);
  }

  // Static path declared before `:key` so it always wins.
  @RequirePermissions(Permission.settingRead)
  @Get('groups')
  async groups() {
    return { data: await this.settings.listGroups() };
  }

  @RequirePermissions(Permission.settingRead)
  @Get(':key')
  async detail(
    @Param('key') key: string,
    @Query(zodPipe(settingLocaleQuerySchema)) query: { locale: string },
  ) {
    return { data: await this.settings.getSetting(key, query.locale) };
  }

  @RequirePermissions(Permission.settingCreate)
  @Post()
  async create(
    @Body(zodPipe(createSettingSchema)) body: CreateSettingInput,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return { data: await this.settings.createSetting(body, actor.id, requestId) };
  }

  @RequirePermissions(Permission.settingUpdate)
  @Patch(':key')
  async update(
    @Param('key') key: string,
    @Body(zodPipe(updateSettingSchema)) body: UpdateSettingInput,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return {
      data: await this.settings.updateSetting(key, body, actor.id, requestId, body.locale ?? undefined),
    };
  }

  @RequirePermissions(Permission.settingDelete)
  @Delete(':key')
  async remove(
    @Param('key') key: string,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return this.settings.deleteSetting(key, actor.id, requestId);
  }
}
