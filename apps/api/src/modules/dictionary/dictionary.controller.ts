import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  createDictionaryItemSchema,
  createDictionaryTypeSchema,
  dictionaryItemListQuerySchema,
  dictionaryOptionQuerySchema,
  dictionaryTypeListQuerySchema,
  reorderDictionaryItemsSchema,
  updateDictionaryItemSchema,
  updateDictionaryTypeSchema,
  type CreateDictionaryItemInput,
  type CreateDictionaryTypeInput,
  type DictionaryItemListQueryInput,
  type DictionaryOptionQueryInput,
  type DictionaryTypeListQueryInput,
  type ReorderDictionaryItemsInput,
  type UpdateDictionaryItemInput,
  type UpdateDictionaryTypeInput,
} from '@b2b/validation';
import { CurrentActor, Permission, RequestId, RequirePermissions } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod.pipe';
import type { AuthenticatedActor } from '../../common/request-context';
import { DictionaryService } from './dictionary.service';

// Two-level dictionary management (docs/20 §6).
//
// `dictionary.read` = maintain/inspect the dictionary, `dictionary.update` =
// change it, `dictionary.option.read` = read selectable options for a business
// form (granted to the operator roles that own those forms).
@Controller('admin/dictionary')
export class DictionaryController {
  constructor(private readonly dictionary: DictionaryService) {}

  // -------------------------------------------------------------- type side

  @RequirePermissions(Permission.dictionaryRead)
  @Get('types')
  async listTypes(@Query(zodPipe(dictionaryTypeListQuerySchema)) query: DictionaryTypeListQueryInput) {
    return this.dictionary.listTypes(query);
  }

  @RequirePermissions(Permission.dictionaryRead)
  @Get('types/:id')
  async getType(@Param('id') id: string) {
    return { data: await this.dictionary.getType(id) };
  }

  @RequirePermissions(Permission.dictionaryUpdate)
  @Post('types')
  async createType(
    @Body(zodPipe(createDictionaryTypeSchema)) body: CreateDictionaryTypeInput,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return { data: await this.dictionary.createType(body, actor.id, requestId) };
  }

  @RequirePermissions(Permission.dictionaryUpdate)
  @Patch('types/:id')
  async updateType(
    @Param('id') id: string,
    @Body(zodPipe(updateDictionaryTypeSchema)) body: UpdateDictionaryTypeInput,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return { data: await this.dictionary.updateType(id, body, actor.id, requestId) };
  }

  @RequirePermissions(Permission.dictionaryUpdate)
  @Delete('types/:id')
  async removeType(
    @Param('id') id: string,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return this.dictionary.removeType(id, actor.id, requestId);
  }

  // -------------------------------------------------------------- item side

  @RequirePermissions(Permission.dictionaryRead)
  @Get('types/:typeCode/items')
  async listItems(
    @Param('typeCode') typeCode: string,
    @Query(zodPipe(dictionaryItemListQuerySchema)) query: DictionaryItemListQueryInput,
  ) {
    return this.dictionary.listItems(typeCode, query);
  }

  @RequirePermissions(Permission.dictionaryUpdate)
  @Post('types/:typeCode/items')
  async createItem(
    @Param('typeCode') typeCode: string,
    @Body(zodPipe(createDictionaryItemSchema)) body: CreateDictionaryItemInput,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return { data: await this.dictionary.createItem(typeCode, body, actor.id, requestId) };
  }

  @RequirePermissions(Permission.dictionaryUpdate)
  @Post('types/:typeCode/reorder')
  async reorderItems(
    @Param('typeCode') typeCode: string,
    @Body(zodPipe(reorderDictionaryItemsSchema)) body: ReorderDictionaryItemsInput,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return this.dictionary.reorderItems(typeCode, body, actor.id, requestId);
  }

  @RequirePermissions(Permission.dictionaryRead)
  @Get('items/:id')
  async getItem(@Param('id') id: string) {
    return { data: await this.dictionary.getItem(id) };
  }

  @RequirePermissions(Permission.dictionaryUpdate)
  @Patch('items/:id')
  async updateItem(
    @Param('id') id: string,
    @Body(zodPipe(updateDictionaryItemSchema)) body: UpdateDictionaryItemInput,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return { data: await this.dictionary.updateItem(id, body, actor.id, requestId) };
  }

  @RequirePermissions(Permission.dictionaryUpdate)
  @Delete('items/:id')
  async removeItem(
    @Param('id') id: string,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return this.dictionary.removeItem(id, actor.id, requestId);
  }

  // ------------------------------------------------------------ option side

  /**
   * Selectable options for one business form (docs/20 §6.3).
   *
   * Returns enabled items by default; `includeDisabled=true` lets an edit form
   * resolve a value that was disabled after the record was created.
   */
  @RequirePermissions(Permission.dictionaryOptionRead)
  @Get('options/:typeCode')
  async getOptions(
    @Param('typeCode') typeCode: string,
    @Query(zodPipe(dictionaryOptionQuerySchema)) query: DictionaryOptionQueryInput,
  ) {
    return { data: await this.dictionary.getOptions(typeCode, query) };
  }
}
