import { Injectable } from '@nestjs/common';
import {
  ALL_PERMISSION_CODES,
  ERROR_CODES,
  SYSTEM_ROLE_SUPER_ADMIN,
} from '@b2b/contracts';
import type {
  PermissionSummary,
  PermissionTree,
  RolePermissionGrant,
  RoleSummary,
  RoleUserSummary,
} from '@b2b/contracts';
import { Prisma, type PrismaClient } from '@b2b/database';
import type {
  CreateRoleInput,
  ReplaceRolePermissionsInput,
  RoleListQueryInput,
  UpdateRoleInput,
} from '@b2b/validation';
import { ApiError } from '../../common/errors/api-error';
import { JsonLogger } from '../../common/logger.service';
import { PrismaService } from '../../prisma/prisma.service';
import { buildAssignableRoleOptions } from '../users/user-role-policy';
import {
  buildPermissionTree,
  serializePermissionTree,
  type MenuTreeRow,
  type PermissionRow,
} from './permission-tree';
import {
  assertExpectedUpdatedAt,
  assertPermissionSelectionIsValid,
  assertRoleIsDeletable,
  assertRoleIsWritable,
  diffPermissionSets,
  type ActorScope,
} from './role-permission-policy';

type TransactionClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends' | '$use'
>;

/** Minimal actor shape needed for authorization decisions in this module. */
export interface RoleActor {
  id: string;
  roles: readonly string[];
  permissions: ReadonlySet<string>;
}

const ROLE_SELECT = {
  id: true,
  code: true,
  nameKey: true,
  description: true,
  isSystem: true,
  updatedAt: true,
  translations: { select: { locale: true, name: true } },
  permissions: { select: { permissionCode: true } },
  _count: { select: { userRoles: true } },
} as const;

const ROLE_USERS_SELECT = {
  id: true,
  username: true,
  displayName: true,
  status: true,
} as const;

type RoleRow = {
  id: string;
  code: string;
  nameKey: string;
  description: string | null;
  isSystem: boolean;
  updatedAt: Date;
  translations: { locale: string; name: string }[];
  permissions: { permissionCode: string }[];
  _count: { userRoles: number };
};

@Injectable()
export class RbacService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: JsonLogger,
  ) {}

  // --------------------------------------------------------------- read side

  /** Explicit projection: the ORM row is never serialised directly (docs/18 §4.1). */
  private toSummary(role: RoleRow): RoleSummary {
    const permissions = role.permissions.map((permission) => permission.permissionCode).sort();
    return {
      id: role.id,
      code: role.code,
      nameKey: role.nameKey,
      names: Object.fromEntries(role.translations.map((item) => [item.locale, item.name])),
      description: role.description,
      isSystem: role.isSystem,
      permissions,
      permissionCount: permissions.length,
      userCount: role._count.userRoles,
      updatedAt: role.updatedAt.toISOString(),
    };
  }

  async listRoles(query: RoleListQueryInput) {
    const keyword = query.keyword?.trim();
    const where: Prisma.RoleWhereInput = {
      ...(query.type === 'system' ? { isSystem: true } : {}),
      ...(query.type === 'custom' ? { isSystem: false } : {}),
      ...(keyword
        ? {
            OR: [
              { code: { contains: keyword, mode: 'insensitive' } },
              { description: { contains: keyword, mode: 'insensitive' } },
              { translations: { some: { name: { contains: keyword, mode: 'insensitive' } } } },
            ],
          }
        : {}),
    };

    const [total, roles] = await this.prisma.$transaction([
      this.prisma.role.count({ where }),
      this.prisma.role.findMany({
        where,
        orderBy: [{ isSystem: 'desc' }, { code: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: ROLE_SELECT,
      }),
    ]);

    return {
      data: roles.map((role) => this.toSummary(role)),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      },
    };
  }

  async getRole(id: string): Promise<RoleSummary> {
    return this.toSummary(await this.loadRoleOrThrow(id));
  }

  /**
   * Role options for the user form (docs/17 §5.1).
   *
   * Returns every role with an `assignable` flag derived from the actor's own
   * roles, so an existing assignment the actor cannot change stays visible and
   * marked instead of vanishing from the form. The flag is a UI hint: the write
   * path re-validates every submitted role id.
   */
  async listAssignableRoles(actorRoles: string[]) {
    const roles = await this.prisma.role.findMany({
      orderBy: [{ isSystem: 'desc' }, { code: 'asc' }],
      select: {
        id: true,
        code: true,
        nameKey: true,
        description: true,
        isSystem: true,
        translations: { select: { locale: true, name: true } },
      },
    });
    return buildAssignableRoleOptions(
      roles.map((role) => ({
        id: role.id,
        code: role.code,
        nameKey: role.nameKey,
        description: role.description,
        isSystem: role.isSystem,
        translations: role.translations,
      })),
      actorRoles,
    );
  }

  /** Flat permission inventory (docs/05 §4). The editor uses the tree endpoint. */
  async listPermissions(): Promise<PermissionSummary[]> {
    return this.knownPermissions();
  }

  /**
   * Editable menu/module permission tree (docs/18 §4.2).
   *
   * Built from real `Menu` + `Permission` rows; no menu label or permission code
   * is hardcoded in the back office.
   */
  async getPermissionTree(): Promise<PermissionTree> {
    const [menus, permissions] = await this.prisma.$transaction([
      this.prisma.menu.findMany({
        orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
        select: {
          id: true,
          code: true,
          parentId: true,
          permissionCode: true,
          sortOrder: true,
          enabled: true,
          translations: { select: { locale: true, label: true } },
        },
      }),
      this.prisma.permission.findMany({ select: { code: true, nameKey: true, module: true } }),
    ]);

    const enabledMenus: MenuTreeRow[] = menus
      .filter((menu) => menu.enabled)
      .map((menu) => ({
        id: menu.id,
        code: menu.code,
        parentId: menu.parentId,
        permissionCode: menu.permissionCode,
        sortOrder: menu.sortOrder,
        translations: menu.translations,
      }));

    return serializePermissionTree(
      buildPermissionTree(enabledMenus, this.withPermissionFallback(permissions)),
    );
  }

  async getRolePermissions(id: string): Promise<RolePermissionGrant> {
    const role = await this.loadRoleOrThrow(id);
    return {
      roleId: role.id,
      code: role.code,
      nameKey: role.nameKey,
      names: Object.fromEntries(role.translations.map((item) => [item.locale, item.name])),
      isSystem: role.isSystem,
      permissionCodes: role.permissions.map((permission) => permission.permissionCode).sort(),
      updatedAt: role.updatedAt.toISOString(),
    };
  }

  /** Users holding this role; drives the delete-impact explanation (docs/18 §2.2). */
  async listRoleUsers(id: string): Promise<RoleUserSummary[]> {
    await this.loadRoleOrThrow(id);
    const users = await this.prisma.adminUser.findMany({
      where: { userRoles: { some: { roleId: id } } },
      orderBy: [{ status: 'asc' }, { username: 'asc' }],
      select: ROLE_USERS_SELECT,
    });
    return users.map((user) => ({
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      status: user.status === 'ACTIVE' ? 'active' : 'disabled',
    }));
  }

  // -------------------------------------------------------------- write side

  /**
   * Creates a custom role with zero permissions.
   *
   * `isSystem`, `userCount` and `permissionCount` are never accepted from the
   * client; permissions are granted afterwards through the permission editor
   * (docs/18 §5.1).
   */
  async createRole(input: CreateRoleInput, actorId: string, requestId: string): Promise<RoleSummary> {
    const code = input.code.trim().toLowerCase();

    try {
      const created = await this.withSerializableTransaction(async (tx) => {
        const existing = await tx.role.findUnique({ where: { code }, select: { id: true } });
        if (existing) {
          throw new ApiError(ERROR_CODES.conflict, 'A role with this code already exists.', {
            details: { code: 'validation.conflict' },
          });
        }

        const role = await tx.role.create({
          data: {
            code,
            // Keeps the seeded convention: `role.<code>` is a translation key,
            // never the display text itself (docs/18 §2.4).
            nameKey: `role.${code}`,
            description: input.description ?? null,
            isSystem: false,
            translations: {
              create: Object.entries(input.names).map(([locale, name]) => ({ locale, name })),
            },
          },
        });

        await this.writeAudit(tx, {
          actorId,
          action: 'role.create',
          entityType: 'role',
          entityId: role.id,
          requestId,
          metadata: { code: role.code, names: input.names, permissionCount: 0 },
        });

        return role.id;
      });

      return this.getRole(created);
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ApiError(ERROR_CODES.conflict, 'A role with this code already exists.', {
          details: { code: 'validation.conflict' },
        });
      }
      throw error;
    }
  }

  /**
   * Updates role basics only; the permission set has its own endpoint so a
   * read-only role viewer can never change authorization (docs/18 §5.2).
   */
  async updateRole(
    id: string,
    input: UpdateRoleInput,
    actorId: string,
    requestId: string,
  ): Promise<RoleSummary> {
    await this.withSerializableTransaction(async (tx) => {
      const role = await tx.role.findUnique({
        where: { id },
        select: { id: true, code: true, isSystem: true, updatedAt: true },
      });
      if (!role) throw this.notFound();
      assertRoleIsWritable(role);
      assertExpectedUpdatedAt(input.expectedUpdatedAt, role.updatedAt);

      for (const [locale, name] of Object.entries(input.names ?? {})) {
        if (typeof name !== 'string') continue;
        await tx.roleTranslation.upsert({
          where: { roleId_locale: { roleId: id, locale } },
          create: { roleId: id, locale, name },
          update: { name },
        });
      }

      await tx.role.update({
        where: { id },
        data: {
          ...(input.description !== undefined ? { description: input.description } : {}),
        },
      });

      await this.writeAudit(tx, {
        actorId,
        action: 'role.update',
        entityType: 'role',
        entityId: id,
        requestId,
        metadata: {
          code: role.code,
          fields: {
            ...(input.names ? { names: Object.keys(input.names) } : {}),
            ...(input.description !== undefined ? { description: true } : {}),
          },
        },
      });
    });

    return this.getRole(id);
  }

  /**
   * Full replacement of a role's permission set (docs/18 §4.3).
   *
   * Validates the actor, the target role, every submitted code and the grantable
   * scope, replaces `RolePermission` inside one transaction, writes an audit row
   * with the added/removed diff and returns the canonical saved list.
   */
  async replaceRolePermissions(
    id: string,
    input: ReplaceRolePermissionsInput,
    actor: RoleActor,
    requestId: string,
  ): Promise<RolePermissionGrant> {
    const actorScope: ActorScope = {
      isSuperAdmin: actor.roles.includes(SYSTEM_ROLE_SUPER_ADMIN),
      permissions: actor.permissions,
    };

    await this.withSerializableTransaction(async (tx) => {
      const role = await tx.role.findUnique({
        where: { id },
        select: {
          id: true,
          code: true,
          isSystem: true,
          updatedAt: true,
          permissions: { select: { permissionCode: true } },
        },
      });
      if (!role) throw this.notFound();
      assertRoleIsWritable(role);
      assertExpectedUpdatedAt(input.expectedUpdatedAt, role.updatedAt);

      const known = this.withPermissionFallback(
        await tx.permission.findMany({ select: { code: true, nameKey: true, module: true } }),
      );
      const current = role.permissions.map((permission) => permission.permissionCode);
      const next = assertPermissionSelectionIsValid({
        requested: input.permissionCodes,
        known: known.map((permission) => permission.code),
        current,
        actor: actorScope,
      });

      const diff = diffPermissionSets(current, next);
      if (diff.added.length === 0 && diff.removed.length === 0) return;

      await tx.rolePermission.deleteMany({ where: { roleId: id } });
      if (next.length > 0) {
        await tx.rolePermission.createMany({
          data: next.map((code) => ({ roleId: id, permissionCode: code })),
          skipDuplicates: true,
        });
      }
      // Bump the role timestamp so the list ordering/updated column reflects a
      // permission change and stale editors are rejected by the concurrency guard.
      await tx.role.update({ where: { id }, data: { updatedAt: new Date() } });

      await this.writeAudit(tx, {
        actorId: actor.id,
        action: 'role.permissions_changed',
        entityType: 'role',
        entityId: id,
        requestId,
        metadata: {
          code: role.code,
          added: diff.added,
          removed: diff.removed,
          beforeCount: diff.before.length,
          afterCount: diff.after.length,
        },
      });
    });

    // Permissions are read from the database on every request by the session
    // guard, so there is no permission cache to invalidate: the new set applies
    // to the next request of every session that holds this role.
    return this.getRolePermissions(id);
  }

  /** Deletes a custom role that no account holds (docs/18 §5.3). */
  async removeRole(id: string, actorId: string, requestId: string) {
    await this.withSerializableTransaction(async (tx) => {
      const role = await tx.role.findUnique({
        where: { id },
        select: {
          id: true,
          code: true,
          nameKey: true,
          isSystem: true,
          translations: { select: { locale: true, name: true } },
          _count: { select: { userRoles: true } },
        },
      });
      if (!role) throw this.notFound();

      assertRoleIsDeletable(role, role._count.userRoles);

      const permissionCount = await tx.rolePermission.count({ where: { roleId: id } });
      await tx.role.delete({ where: { id } });

      // The audit row keeps a snapshot so the deletion stays readable afterwards.
      await this.writeAudit(tx, {
        actorId,
        action: 'role.delete',
        entityType: 'role',
        entityId: id,
        requestId,
        metadata: {
          code: role.code,
          nameKey: role.nameKey,
          names: Object.fromEntries(role.translations.map((item) => [item.locale, item.name])),
          permissionCount,
        },
      });
    });

    return { deleted: true };
  }

  // ----------------------------------------------------------------- helpers

  private notFound(): ApiError {
    return new ApiError(ERROR_CODES.roleNotFound, 'Role not found.', { status: 404 });
  }

  private async loadRoleOrThrow(id: string): Promise<RoleRow> {
    const role = await this.prisma.role.findUnique({ where: { id }, select: ROLE_SELECT });
    if (!role) throw this.notFound();
    return role;
  }

  /**
   * Permission dictionary with a contracts fallback, so a not-yet-seeded
   * environment still returns a usable tree instead of an empty editor.
   */
  private withPermissionFallback(rows: PermissionRow[]): PermissionRow[] {
    if (rows.length > 0) return rows;
    return ALL_PERMISSION_CODES.map((code) => ({
      code,
      nameKey: `permission.${code}`,
      module: code.split('.')[0] ?? 'misc',
    }));
  }

  private async knownPermissions(): Promise<PermissionSummary[]> {
    const permissions = this.withPermissionFallback(
      await this.prisma.permission.findMany({
        orderBy: [{ module: 'asc' }, { code: 'asc' }],
        select: { code: true, nameKey: true, module: true },
      }),
    );
    return permissions.map((permission) => ({
      code: permission.code,
      nameKey: permission.nameKey,
      module: permission.module,
    }));
  }

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
            ERROR_CODES.concurrentRoleUpdate,
            'Another administrator changed this role at the same time. Reload and retry.',
            { status: 409 },
          );
        }
        throw error;
      }
    }
    throw new ApiError(
      ERROR_CODES.concurrentRoleUpdate,
      'Concurrent modification detected. Reload and retry.',
      { status: 409 },
    );
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
      // A role or permission change must never be left unrecorded, so the whole
      // transaction is rolled back when its audit row cannot be written.
      this.logger.error(
        'rbac.audit_write_failed',
        error instanceof Error ? error.stack : String(error),
        'RbacService',
        { action: entry.action, entityId: entry.entityId },
      );
      throw error;
    }
  }

  private isUniqueViolation(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }

  private isWriteConflict(error: unknown): boolean {
    // Only serialization failures are retried. A unique violation is a business
    // conflict (duplicate role code) and must reach the caller unchanged.
    if (error instanceof Prisma.PrismaClientKnownRequestError) return error.code === 'P2034';
    const message = error instanceof Error ? error.message : String(error);
    return message.includes('could not serialize access');
  }
}
