import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  createMenuSchema,
  menuListQuerySchema,
  reorderMenusSchema,
  updateMenuSchema,
  type CreateMenuInput,
  type MenuListQueryInput,
  type ReorderMenusInput,
  type UpdateMenuInput,
} from '@b2b/validation';
import { CurrentActor, Permission, RequestId, RequirePermissions } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod.pipe';
import type { AuthenticatedActor } from '../../common/request-context';
import { MenusService } from './menus.service';

// Menu administration (docs/19 §6).
//
// Reading, creating, updating (including reordering) and deleting are separate
// permissions. Binding a permission code to a menu is navigation configuration
// and never grants that permission to any role.
@Controller('admin/menus')
export class MenusController {
  constructor(private readonly menus: MenusService) {}

  @RequirePermissions(Permission.menuRead)
  @Get()
  async list(@Query(zodPipe(menuListQuerySchema)) query: MenuListQueryInput) {
    return { data: await this.menus.listAdminMenus(query) };
  }

  // Declared before the parameterised routes so the static path always wins.
  @RequirePermissions(Permission.menuRead)
  @Get('permission-options')
  async permissionOptions() {
    return { data: await this.menus.listPermissionOptions() };
  }

  @RequirePermissions(Permission.menuUpdate)
  @Patch('reorder')
  async reorder(
    @Body(zodPipe(reorderMenusSchema)) body: ReorderMenusInput,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return this.menus.reorder(body, actor.id, requestId);
  }

  @RequirePermissions(Permission.menuRead)
  @Get(':id')
  async detail(@Param('id') id: string) {
    return { data: await this.menus.detail(id) };
  }

  @RequirePermissions(Permission.menuCreate)
  @Post()
  async create(
    @Body(zodPipe(createMenuSchema)) body: CreateMenuInput,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return { data: await this.menus.create(body, actor.id, requestId) };
  }

  @RequirePermissions(Permission.menuUpdate)
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body(zodPipe(updateMenuSchema)) body: UpdateMenuInput,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return { data: await this.menus.update(id, body, actor.id, requestId) };
  }

  @RequirePermissions(Permission.menuDelete)
  @Delete(':id')
  async remove(
    @Param('id') id: string,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return this.menus.remove(id, actor.id, requestId);
  }
}
