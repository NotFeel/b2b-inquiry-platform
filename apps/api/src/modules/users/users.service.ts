import { Injectable } from '@nestjs/common';
import { ERROR_CODES, PERMISSIONS, SYSTEM_ROLE_SUPER_ADMIN } from '@b2b/contracts';
import type { AdminUserSummary } from '@b2b/contracts';
import { Prisma, type PrismaClient } from '@b2b/database';
import type {
  CreateAdminUserInput,
  UpdateAdminUserInput,
  UpdateUserStatusInput,
} from '@b2b/validation';
import { ApiError } from '../../common/errors/api-error';
import { AuditService } from '../../common/services/audit.service';
import { CryptoService } from '../../common/services/crypto.service';
import { JsonLogger } from '../../common/logger.service';
import { PrismaService } from '../../prisma/prisma.service';
import { checkPasswordPolicy } from '../auth/password-policy';
import {
  assertLastSuperAdminRule,
  assertRoleSelectionIsValid,
  roleCodeSignature,
  type RoleRef,
} from './user-role-policy';

export interface AdminUserListQuery {
  page: number;
  pageSize: number;
  q?: string;
  status?: 'active' | 'disabled';
  roleId?: string;
}

/** Minimal actor shape needed for authorization decisions in this module. */
export interface UserActor {
  id: string;
  roles: string[];
  permissions: ReadonlySet<string>;
}

type TransactionClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends' | '$use'
>;

const USER_ROLE_SELECT = {
  userRoles: {
    include: {
      role: {
        select: {
          id: true,
          code: true,
          nameKey: true,
          translations: { select: { locale: true, name: true } },
        },
      },
    },
  },
} as const;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly logger: JsonLogger,
  ) {}

  private toStatus(status: 'ACTIVE' | 'DISABLED'): 'active' | 'disabled' {
    return status === 'ACTIVE' ? 'active' : 'disabled';
  }

  /** Explicit field whitelist: never serialise the ORM user (docs/17 §5.2, §10 BE-12). */
  private toSummary(user: {
    id: string;
    username: string;
    displayName: string;
    status: 'ACTIVE' | 'DISABLED';
    mustChangePassword: boolean;
    lastLoginAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    userRoles: {
      role: {
        id: string;
        code: string;
        nameKey: string;
        translations: { locale: string; name: string }[];
      };
    }[];
  }): AdminUserSummary {
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      status: this.toStatus(user.status),
      mustChangePassword: user.mustChangePassword,
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
      roles: user.userRoles.map((userRole) => ({
        id: userRole.role.id,
        code: userRole.role.code,
        nameKey: userRole.role.nameKey,
        names: Object.fromEntries(
          userRole.role.translations.map((item) => [item.locale, item.name]),
        ),
      })),
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    };
  }

  async list(query: AdminUserListQuery) {
    const where: Prisma.AdminUserWhereInput = {
      ...(query.q
        ? {
            OR: [
              { username: { contains: query.q, mode: 'insensitive' } },
              { displayName: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(query.status
        ? { status: query.status === 'active' ? ('ACTIVE' as const) : ('DISABLED' as const) }
        : {}),
      ...(query.roleId ? { userRoles: { some: { roleId: query.roleId } } } : {}),
    };

    const [total, users] = await this.prisma.$transaction([
      this.prisma.adminUser.count({ where }),
      this.prisma.adminUser.findMany({
        where,
        orderBy: [{ status: 'asc' }, { username: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: USER_ROLE_SELECT,
      }),
    ]);

    return {
      data: users.map((user) => this.toSummary(user)),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      },
    };
  }

  async detail(id: string): Promise<AdminUserSummary> {
    const user = await this.prisma.adminUser.findUnique({ where: { id }, include: USER_ROLE_SELECT });
    if (!user) throw new ApiError(ERROR_CODES.userNotFound, 'User not found.', { status: 404 });
    return this.toSummary(user);
  }

  /** Role assignment is gated separately from profile editing (docs/17 §7). */
  assertCanAssignRoles(actor: Pick<UserActor, 'roles' | 'permissions'>): void {
    if (
      actor.roles.includes(SYSTEM_ROLE_SUPER_ADMIN) ||
      actor.permissions.has(PERMISSIONS.userRoleAssign)
    ) {
      return;
    }
    throw new ApiError(
      ERROR_CODES.forbidden,
      'You are not allowed to assign roles. The user profile can still be edited.',
      { status: 403 },
    );
  }

  async create(input: CreateAdminUserInput, actor: UserActor, requestId: string) {
    const username = input.username.trim().toLowerCase();
    const existing = await this.prisma.adminUser.findUnique({ where: { username } });
    if (existing) {
      throw new ApiError(ERROR_CODES.usernameAlreadyExists, 'This username is already taken.', {
        status: 409,
        details: { username: 'validation.conflict' },
      });
    }

    const roles = await this.resolveRolesByIds(input.roleIds, actor.roles);
    const password = input.password ?? this.crypto.generatePassword(16);
    if (input.password) {
      const policy = checkPasswordPolicy(password, username);
      if (!policy.valid) {
        throw ApiError.validation('The password does not meet the password policy.', {
          password: policy.reasons.join(','),
        });
      }
    }
    const passwordHash = await this.crypto.hashPassword(password);

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const user = await tx.adminUser.create({
          data: {
            username,
            displayName: input.displayName,
            passwordHash,
            status: 'ACTIVE',
            // Accounts created by an administrator always start with a forced
            // password change; the temporary password is shown once.
            mustChangePassword: true,
            userRoles: { create: roles.map((role) => ({ roleId: role.id })) },
          },
          include: USER_ROLE_SELECT,
        });
        await this.writeAudit(tx, {
          actorId: actor.id,
          action: 'user.create',
          entityType: 'admin_user',
          entityId: user.id,
          requestId,
          metadata: { username, roles: roles.map((role) => role.code) },
        });
        return user;
      });

      return {
        data: this.toSummary(created),
        // Returned exactly once; never logged and never retrievable again.
        generatedPassword: input.password ? null : password,
      };
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ApiError(ERROR_CODES.usernameAlreadyExists, 'This username is already taken.', {
          status: 409,
          details: { username: 'validation.conflict' },
        });
      }
      throw error;
    }
  }

  async update(id: string, input: UpdateAdminUserInput, actor: UserActor, requestId: string) {
    await this.withSerializableTransaction(async (tx) => {
      const user = await tx.adminUser.findUnique({ where: { id }, include: USER_ROLE_SELECT });
      if (!user) throw new ApiError(ERROR_CODES.userNotFound, 'User not found.', { status: 404 });

      if (input.expectedUpdatedAt && user.updatedAt.toISOString() !== input.expectedUpdatedAt) {
        throw new ApiError(
          ERROR_CODES.userModified,
          'This user was changed by someone else. Reload and retry.',
          { status: 409 },
        );
      }

      const beforeCodes = user.userRoles.map((userRole) => userRole.role.code);
      let afterCodes = beforeCodes;

      if (input.roleIds) {
        const roles = await this.resolveRolesByIds(input.roleIds, actor.roles, tx);
        afterCodes = roles.map((role) => role.code);

        if (roleCodeSignature(beforeCodes) !== roleCodeSignature(afterCodes)) {
          const targetCurrentlySuperAdmin = beforeCodes.includes(SYSTEM_ROLE_SUPER_ADMIN);
          const nextIncludesSuperAdmin = afterCodes.includes(SYSTEM_ROLE_SUPER_ADMIN);
          if (targetCurrentlySuperAdmin && !nextIncludesSuperAdmin) {
            const otherActiveSuperAdmins = await tx.adminUser.count({
              where: {
                id: { not: id },
                status: 'ACTIVE',
                userRoles: { some: { role: { code: SYSTEM_ROLE_SUPER_ADMIN } } },
              },
            });
            assertLastSuperAdminRule({
              targetCurrentlySuperAdmin,
              nextSelectionIncludesSuperAdmin: nextIncludesSuperAdmin,
              otherActiveSuperAdmins,
            });
          }
        }
      }

      const updated = await tx.adminUser.update({
        where: { id },
        data: {
          ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
        },
        include: USER_ROLE_SELECT,
      });

      if (input.roleIds) {
        await tx.userRole.deleteMany({ where: { userId: id } });
        const uniqueRoleIds = Array.from(new Set(input.roleIds));
        await tx.userRole.createMany({
          data: uniqueRoleIds.map((roleId) => ({ userId: id, roleId })),
          skipDuplicates: true,
        });
        if (roleCodeSignature(beforeCodes) !== roleCodeSignature(afterCodes)) {
          await this.writeAudit(tx, {
            actorId: actor.id,
            action: 'user.roles_changed',
            entityType: 'admin_user',
            entityId: id,
            requestId,
            metadata: { before: beforeCodes, after: afterCodes },
          });
        }
      }

      await this.writeAudit(tx, {
        actorId: actor.id,
        action: 'user.update',
        entityType: 'admin_user',
        entityId: id,
        requestId,
        metadata: {
          displayNameChanged: input.displayName !== undefined,
          rolesChanged: Boolean(input.roleIds),
        },
      });

      return updated;
    });

    // Permissions are read from the database on every request by the session
    // guard, so a role change is effective on the target user's next request -
    // no cache needs invalidating. Active sessions are not revoked, because the
    // account itself is still valid.
    return this.detail(id);
  }

  async setStatus(id: string, input: UpdateUserStatusInput, actor: UserActor, requestId: string) {
    await this.withSerializableTransaction(async (tx) => {
      const user = await tx.adminUser.findUnique({ where: { id }, include: USER_ROLE_SELECT });
      if (!user) throw new ApiError(ERROR_CODES.userNotFound, 'User not found.', { status: 404 });

      if (input.expectedUpdatedAt && user.updatedAt.toISOString() !== input.expectedUpdatedAt) {
        throw new ApiError(
          ERROR_CODES.userModified,
          'This user was changed by someone else. Reload and retry.',
          { status: 409 },
        );
      }

      const isSuperAdmin = user.userRoles.some((userRole) => userRole.role.code === SYSTEM_ROLE_SUPER_ADMIN);
      if (isSuperAdmin && input.status === 'disabled') {
        const otherActiveSuperAdmins = await tx.adminUser.count({
          where: {
            id: { not: id },
            status: 'ACTIVE',
            userRoles: { some: { role: { code: SYSTEM_ROLE_SUPER_ADMIN } } },
          },
        });
        assertLastSuperAdminRule({
          targetCurrentlySuperAdmin: true,
          nextSelectionIncludesSuperAdmin: false,
          otherActiveSuperAdmins,
        });
      }

      const nextStatus = input.status === 'active' ? 'ACTIVE' : 'DISABLED';
      await tx.adminUser.update({
        where: { id },
        data: {
          status: nextStatus,
          // A disabled account must not keep working sessions alive.
          ...(nextStatus === 'DISABLED' ? { failedLoginCount: 0, lockedUntil: null } : {}),
        },
      });
      if (nextStatus === 'DISABLED') {
        await tx.adminSession.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      await this.writeAudit(tx, {
        actorId: actor.id,
        action: 'user.status_changed',
        entityType: 'admin_user',
        entityId: id,
        requestId,
        metadata: { from: this.toStatus(user.status), to: input.status },
      });
    });

    return this.detail(id);
  }

  async resetPassword(
    id: string,
    input: { password?: string; mustChangePassword: boolean },
    actorId: string,
    requestId: string,
  ) {
    const user = await this.prisma.adminUser.findUnique({ where: { id } });
    if (!user) throw new ApiError(ERROR_CODES.userNotFound, 'User not found.', { status: 404 });

    const password = input.password ?? this.crypto.generatePassword(16);
    if (input.password) {
      const policy = checkPasswordPolicy(input.password, user.username);
      if (!policy.valid) {
        throw ApiError.validation('The password does not meet the password policy.', {
          password: policy.reasons.join(','),
        });
      }
    }
    const passwordHash = await this.crypto.hashPassword(password);
    await this.prisma.$transaction(async (tx) => {
      await tx.adminUser.update({
        where: { id },
        data: {
          passwordHash,
          mustChangePassword: input.mustChangePassword,
          failedLoginCount: 0,
          lockedUntil: null,
        },
      });
      await tx.adminSession.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      // Never record the password or its hash - only that a reset happened.
      await this.writeAudit(tx, {
        actorId,
        action: 'user.password_reset',
        entityType: 'admin_user',
        entityId: id,
        requestId,
        metadata: { mustChangePassword: input.mustChangePassword },
      });
    });
    return { generatedPassword: input.password ? null : password };
  }

  async remove(id: string, actorId: string, requestId: string) {
    if (id === actorId) {
      throw new ApiError(ERROR_CODES.conflict, 'You cannot delete the account you are signed in with.');
    }

    await this.withSerializableTransaction(async (tx) => {
      const user = await tx.adminUser.findUnique({ where: { id }, include: USER_ROLE_SELECT });
      if (!user) throw new ApiError(ERROR_CODES.userNotFound, 'User not found.', { status: 404 });
      if (user.userRoles.some((userRole) => userRole.role.code === SYSTEM_ROLE_SUPER_ADMIN)) {
        const otherActiveSuperAdmins = await tx.adminUser.count({
          where: {
            id: { not: id },
            status: 'ACTIVE',
            userRoles: { some: { role: { code: SYSTEM_ROLE_SUPER_ADMIN } } },
          },
        });
        assertLastSuperAdminRule({
          targetCurrentlySuperAdmin: true,
          nextSelectionIncludesSuperAdmin: false,
          otherActiveSuperAdmins,
        });
      }
      await tx.adminUser.delete({ where: { id } });
      await this.writeAudit(tx, {
        actorId,
        action: 'user.delete',
        entityType: 'admin_user',
        entityId: id,
        requestId,
        metadata: { username: user.username },
      });
    });

    return { deleted: true };
  }

  private async resolveRolesByIds(
    roleIds: string[],
    actorRoles: string[],
    client: TransactionClient | PrismaService = this.prisma,
  ): Promise<RoleRef[]> {
    const unique = Array.from(new Set(roleIds));
    const roles = await client.role.findMany({
      where: { id: { in: unique } },
      select: { id: true, code: true },
    });
    return assertRoleSelectionIsValid({ requestedIds: unique, knownRoles: roles, actorRoles });
  }

  /**
   * Role/status changes run under Serializable isolation so two administrators
   * cannot concurrently remove the last super administrator (docs/17 §6.2).
   * A write conflict (P2034) is retried once before surfacing as USER_MODIFIED.
   */
  private async withSerializableTransaction<T>(work: (tx: TransactionClient) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await this.prisma.$transaction(work, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error) {
        if (attempt === 0 && this.isWriteConflict(error)) continue;
        if (this.isWriteConflict(error)) {
          throw new ApiError(
            ERROR_CODES.userModified,
            'Another administrator changed this user at the same time. Reload and retry.',
            { status: 409 },
          );
        }
        throw error;
      }
    }
    throw new ApiError(ERROR_CODES.userModified, 'Concurrent modification detected. Reload and retry.', {
      status: 409,
    });
  }

  private async writeAudit(
    tx: TransactionClient,
    entry: {
      actorId: string;
      action: string;
      entityType: string;
      entityId: string;
      requestId: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<void> {
    try {
      await tx.auditLog.create({
        data: {
          actorId: entry.actorId,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId,
          requestId: entry.requestId,
          metadata: (entry.metadata ?? undefined) as never,
        },
      });
    } catch (error) {
      // Security-relevant changes are rolled back if their audit row cannot be
      // written, so a role or status change is never left unrecorded.
      this.logger.error(
        'users.audit_write_failed',
        error instanceof Error ? error.stack : String(error),
        'UsersService',
        { action: entry.action, entityId: entry.entityId },
      );
      throw error;
    }
  }

  private isUniqueViolation(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }

  private isWriteConflict(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034';
  }
}
