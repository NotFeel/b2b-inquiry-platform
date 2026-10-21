import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import {
  createRoleSchema,
  replaceRolePermissionsSchema,
  roleListQuerySchema,
  updateRoleSchema,
  type CreateRoleInput,
  type ReplaceRolePermissionsInput,
  type RoleListQueryInput,
  type UpdateRoleInput,
} from '@b2b/validation';
import { CurrentActor, Permission, RequestId, RequirePermissions } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod.pipe';
import type { AuthenticatedActor } from '../../common/request-context';
import { RbacService, type RoleActor } from './rbac.service';

// Role & permission management (docs/18).
//
// Reading role basics (`role.read`), editing them (`role.update`), reading the
// permission set (`role.permissions.read`) and replacing it
// (`role.permissions.update`) are four distinct capabilities so a read-only
// operator can never change authorization.
@Controller('admin')
export class RbacController {
  constructor(private readonly rbac: RbacService) {}

  @RequirePermissions(Permission.roleRead)
  @Get('roles')
  async listRoles(@Query(zodPipe(roleListQuerySchema)) query: RoleListQueryInput) {
    return this.rbac.listRoles(query);
  }

  // Assignable-role inventory for the user form's multi-select. Declared before
  // the parameterised role routes so the static path always wins.
  @RequirePermissions(Permission.roleRead)
  @Get('roles/assignable')
  async listAssignableRoles(@CurrentActor() actor: AuthenticatedActor) {
    return { data: await this.rbac.listAssignableRoles([...actor.roles]) };
  }

  @RequirePermissions(Permission.rolePermissionsRead)
  @Get('permissions/tree')
  async permissionTree() {
    return { data: await this.rbac.getPermissionTree() };
  }

  @RequirePermissions(Permission.roleRead)
  @Get('permissions')
  async listPermissions() {
    return { data: await this.rbac.listPermissions() };
  }

  @RequirePermissions(Permission.roleRead)
  @Get('roles/:id')
  async getRole(@Param('id') id: string) {
    return { data: await this.rbac.getRole(id) };
  }

  @RequirePermissions(Permission.rolePermissionsRead)
  @Get('roles/:id/permissions')
  async getRolePermissions(@Param('id') id: string) {
    return { data: await this.rbac.getRolePermissions(id) };
  }

  @RequirePermissions(Permission.roleRead)
  @Get('roles/:id/users')
  async listRoleUsers(@Param('id') id: string) {
    return { data: await this.rbac.listRoleUsers(id) };
  }

  @RequirePermissions(Permission.roleCreate)
  @Post('roles')
  async createRole(
    @Body(zodPipe(createRoleSchema)) body: CreateRoleInput,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return { data: await this.rbac.createRole(body, actor.id, requestId) };
  }

  @RequirePermissions(Permission.roleUpdate)
  @Patch('roles/:id')
  async updateRole(
    @Param('id') id: string,
    @Body(zodPipe(updateRoleSchema)) body: UpdateRoleInput,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return { data: await this.rbac.updateRole(id, body, actor.id, requestId) };
  }

  @RequirePermissions(Permission.rolePermissionsUpdate)
  @Put('roles/:id/permissions')
  async replaceRolePermissions(
    @Param('id') id: string,
    @Body(zodPipe(replaceRolePermissionsSchema)) body: ReplaceRolePermissionsInput,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return { data: await this.rbac.replaceRolePermissions(id, body, this.toActor(actor), requestId) };
  }

  @RequirePermissions(Permission.roleDelete)
  @Delete('roles/:id')
  async removeRole(
    @Param('id') id: string,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return this.rbac.removeRole(id, actor.id, requestId);
  }

  private toActor(actor: AuthenticatedActor): RoleActor {
    return { id: actor.id, roles: actor.roles, permissions: actor.permissions };
  }
}
