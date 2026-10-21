import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  categoryListQuerySchema,
  categoryTreeQuerySchema,
  createCategorySchema,
  moveCategorySchema,
  reorderCategoriesSchema,
  updateCategorySchema,
  type CategoryListQueryInput,
  type CategoryTreeQueryInput,
  type CreateCategoryInput,
  type ReorderCategoriesInput,
  type UpdateCategoryInput,
} from '@b2b/validation';
import { CurrentActor, Permission, RequestId, RequirePermissions } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod.pipe';
import type { AuthenticatedActor } from '../../common/request-context';
import { CategoriesService } from './categories.service';

// Category administration (docs/22 §5.1).
//
// Every route carries its own `RequirePermissions` guard: hiding a button in the
// admin UI is never the control that protects a write.
@Controller('admin/categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  /** Full admin tree, filterable by name/code/slug, status and product presence. */
  @RequirePermissions(Permission.categoryRead)
  @Get('tree')
  async tree(@Query(zodPipe(categoryTreeQuerySchema)) query: CategoryTreeQueryInput) {
    return { data: await this.categories.listAdminTree(query) };
  }

  /** Paginated flat view for search and bulk inspection. */
  @RequirePermissions(Permission.categoryRead)
  @Get()
  async list(@Query(zodPipe(categoryListQuerySchema)) query: CategoryListQueryInput) {
    return this.categories.listCategories(query);
  }

  /** Detail panel payload: path, counts and direct children. */
  @RequirePermissions(Permission.categoryRead)
  @Get(':id')
  async detail(@Param('id') id: string, @Query('locale') locale?: string) {
    return { data: await this.categories.getDetail(id, locale) };
  }

  /** Delete impact preview, so the dialog can explain what blocks the delete. */
  @RequirePermissions(Permission.categoryRead)
  @Get(':id/delete-impact')
  async deleteImpact(@Param('id') id: string) {
    return { data: await this.categories.deleteImpact(id) };
  }

  @RequirePermissions(Permission.categoryCreate)
  @Post()
  async create(
    @Body(zodPipe(createCategorySchema)) body: CreateCategoryInput,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return { data: await this.categories.create(body, actor.id, requestId) };
  }

  @RequirePermissions(Permission.categoryUpdate)
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body(zodPipe(updateCategorySchema)) body: UpdateCategoryInput,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return { data: await this.categories.update(id, body, actor.id, requestId) };
  }

  @RequirePermissions(Permission.categoryUpdate)
  @Post(':id/move')
  async move(
    @Param('id') id: string,
    @Body(zodPipe(moveCategorySchema)) body: { parentId: string | null; sortOrder?: number },
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return {
      data: await this.categories.move(id, body.parentId, actor.id, requestId, body.sortOrder),
    };
  }

  /** Sibling reorder behind the up/down buttons in the workbench. */
  @RequirePermissions(Permission.categoryUpdate)
  @Post('reorder')
  async reorder(
    @Body(zodPipe(reorderCategoriesSchema)) body: ReorderCategoriesInput,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return {
      data: await this.categories.reorder(body.parentId, body.orderedIds, actor.id, requestId),
    };
  }

  @RequirePermissions(Permission.categoryDelete)
  @Delete(':id')
  async remove(
    @Param('id') id: string,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return this.categories.remove(id, actor.id, requestId);
  }
}
