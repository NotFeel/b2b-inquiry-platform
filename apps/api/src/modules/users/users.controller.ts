import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  adminUserListQuerySchema,
  createAdminUserSchema,
  resetPasswordSchema,
  updateAdminUserSchema,
  updateUserStatusSchema,
  type CreateAdminUserInput,
  type UpdateAdminUserInput,
  type UpdateUserStatusInput,
} from '@b2b/validation';
import { CurrentActor, Permission, RequestId, RequirePermissions } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod.pipe';
import type { AuthenticatedActor } from '../../common/request-context';
import { UsersService, type UserActor } from './users.service';

@Controller('admin/users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @RequirePermissions(Permission.userRead)
  @Get()
  async list(@Query(zodPipe(adminUserListQuerySchema)) query: Parameters<UsersService['list']>[0]) {
    return this.users.list(query);
  }

  @RequirePermissions(Permission.userRead)
  @Get(':id')
  async detail(@Param('id') id: string) {
    return { data: await this.users.detail(id) };
  }

  @RequirePermissions(Permission.userCreate)
  @Post()
  async create(
    @Body(zodPipe(createAdminUserSchema)) body: CreateAdminUserInput,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    // Creating a user always assigns roles, so the assignment capability is
    // required in addition to user.create (docs/17 §7).
    this.users.assertCanAssignRoles(this.toActor(actor));
    return this.users.create(body, this.toActor(actor), requestId);
  }

  @RequirePermissions(Permission.userUpdate)
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body(zodPipe(updateAdminUserSchema)) body: UpdateAdminUserInput,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    // A profile-only update stays possible without the assignment capability;
    // a payload that carries roleIds is checked separately and re-validated in
    // the service.
    if (body.roleIds !== undefined) {
      this.users.assertCanAssignRoles(this.toActor(actor));
    }
    return { data: await this.users.update(id, body, this.toActor(actor), requestId) };
  }

  // Status stays a dedicated operation so a normal edit cannot disable an
  // account by accident (docs/17 §5.5).
  @RequirePermissions(Permission.userUpdate)
  @Patch(':id/status')
  async setStatus(
    @Param('id') id: string,
    @Body(zodPipe(updateUserStatusSchema)) body: UpdateUserStatusInput,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return { data: await this.users.setStatus(id, body, this.toActor(actor), requestId) };
  }

  @RequirePermissions(Permission.userUpdate)
  @Post(':id/reset-password')
  async resetPassword(
    @Param('id') id: string,
    @Body(zodPipe(resetPasswordSchema)) body: { password?: string; mustChangePassword: boolean },
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return this.users.resetPassword(id, body, actor.id, requestId);
  }

  @RequirePermissions(Permission.userDelete)
  @Delete(':id')
  async remove(
    @Param('id') id: string,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return this.users.remove(id, actor.id, requestId);
  }

  private toActor(actor: AuthenticatedActor): UserActor {
    return { id: actor.id, roles: actor.roles, permissions: actor.permissions };
  }
}
