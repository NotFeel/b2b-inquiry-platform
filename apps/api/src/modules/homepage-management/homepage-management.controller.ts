import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import {
  createHomepageCollectionSchema,
  homepageCollectionIdSchema,
  homepageCollectionDetailQuerySchema,
  homepageCollectionListQuerySchema,
  sortHomepageCollectionsSchema,
  updateHomepageCollectionProductsSchema,
  updateHomepageCollectionSchema,
  updateHomepageDisplayConfigSchema,
  type CreateHomepageCollectionInput,
  type HomepageCollectionDetailQueryInput,
  type HomepageCollectionListQueryInput,
  type SortHomepageCollectionsInput,
  type UpdateHomepageCollectionInput,
  type UpdateHomepageCollectionProductsInput,
  type UpdateHomepageDisplayConfigInput,
} from '@b2b/validation';
import { CurrentActor, Permission, RequestId, RequirePermissions } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod.pipe';
import type { AuthenticatedActor } from '../../common/request-context';
import { HomepageManagementService } from './homepage-management.service';

/** Admin Homepage configuration API (docs/45 stage C). */
@Controller('admin/homepage-management')
export class HomepageManagementController {
  constructor(private readonly homepage: HomepageManagementService) {}

  @RequirePermissions(Permission.homepageRead)
  @Get('config')
  async getConfig() {
    return { data: await this.homepage.getDisplayConfig() };
  }

  @RequirePermissions(Permission.homepageConfigUpdate)
  @Patch('config')
  async updateConfig(
    @Body(zodPipe(updateHomepageDisplayConfigSchema)) body: UpdateHomepageDisplayConfigInput,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return { data: await this.homepage.updateDisplayConfig(body, actor.id, requestId) };
  }

  @RequirePermissions(Permission.homepageRead)
  @Get('collections')
  async listCollections(
    @Query(zodPipe(homepageCollectionListQuerySchema)) query: HomepageCollectionListQueryInput,
  ) {
    return this.homepage.listCollections(query);
  }

  @RequirePermissions(Permission.homepageCollectionCreate)
  @Post('collections')
  async createCollection(
    @Body(zodPipe(createHomepageCollectionSchema)) body: CreateHomepageCollectionInput,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return { data: await this.homepage.createCollection(body, actor.id, requestId) };
  }

  /** Literal route is declared before `collections/:id` handlers. */
  @RequirePermissions(Permission.homepageCollectionUpdate)
  @Put('collections/sort')
  async sortCollections(
    @Body(zodPipe(sortHomepageCollectionsSchema)) body: SortHomepageCollectionsInput,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return { data: await this.homepage.sortCollections(body, actor.id, requestId) };
  }

  @RequirePermissions(Permission.homepageRead)
  @Get('collections/:id')
  async collectionDetail(
    @Param('id', zodPipe(homepageCollectionIdSchema)) id: string,
    @Query(zodPipe(homepageCollectionDetailQuerySchema))
    query: HomepageCollectionDetailQueryInput,
  ) {
    return { data: await this.homepage.getCollection(id, query.locale) };
  }

  @RequirePermissions(Permission.homepageCollectionUpdate)
  @Patch('collections/:id')
  async updateCollection(
    @Param('id', zodPipe(homepageCollectionIdSchema)) id: string,
    @Body(zodPipe(updateHomepageCollectionSchema)) body: UpdateHomepageCollectionInput,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return { data: await this.homepage.updateCollection(id, body, actor.id, requestId) };
  }

  @RequirePermissions(Permission.homepageCollectionDelete)
  @Delete('collections/:id')
  async removeCollection(
    @Param('id', zodPipe(homepageCollectionIdSchema)) id: string,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return { data: await this.homepage.removeCollection(id, actor.id, requestId) };
  }

  @RequirePermissions(Permission.homepageProductUpdate)
  @Put('collections/:id/products')
  async updateProducts(
    @Param('id', zodPipe(homepageCollectionIdSchema)) id: string,
    @Body(zodPipe(updateHomepageCollectionProductsSchema))
    body: UpdateHomepageCollectionProductsInput,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return { data: await this.homepage.updateProducts(id, body, actor.id, requestId) };
  }
}
