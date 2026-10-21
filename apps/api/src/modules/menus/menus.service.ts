import { Injectable } from '@nestjs/common';
import {
  ALL_PERMISSION_CODES,
  DEFAULT_ADMIN_LOCALE,
  ERROR_CODES,
  SUPPORTED_LOCALES,
  resolveAdminLocale,
} from '@b2b/contracts';
import type { MenuNode, PermissionSummary } from '@b2b/contracts';
import { Prisma, type PrismaClient } from '@b2b/database';
import type {
  CreateMenuInput,
  MenuListQueryInput,
  ReorderMenusInput,
  UpdateMenuInput,
} from '@b2b/validation';
import { ApiError } from '../../common/errors/api-error';
import { JsonLogger } from '../../common/logger.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  assertDepthWithinLimit,
  assertExpectedUpdatedAt,
  assertIconIsAllowed,
  assertMenuIsDeletable,
  assertMenuTranslationsComplete,
  assertParentIsValid,
  assertReorderIsComplete,
  assertRouteIsUnique,
  assertRouteMatchesKind,
  childrenOf,
  collectDescendantIds,
  subtreeHeight,
  toTranslationRows,
} from './menu-policy';

// A missing translation is reported once per process and locale so a broken
// menu cannot flood the logs on every navigation request.
const warnedMissingTranslations = new Set<string>();

type TransactionClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends' | '$use'
>;

interface MenuRow {
  id: string;
  code: string;
  parentId: string | null;
  route: string | null;
  icon: string | null;
  permissionCode: string | null;
  sortOrder: number;
  visible: boolean;
  enabled: boolean;
  external: boolean;
  updatedAt: Date;
  translations: { locale: string; label: string }[];
}

const MENU_SELECT = {
  id: true,
  code: true,
  parentId: true,
  route: true,
  icon: true,
  permissionCode: true,
  sortOrder: true,
  visible: true,
  enabled: true,
  external: true,
  updatedAt: true,
  translations: { select: { locale: true, label: true } },
} as const;

/** Sort orders are renumbered in steps of 10 so a manual insert has room. */
const REORDER_STEP = 10;

// Menu administration (docs/19).
//
// `Menu` is navigation configuration only: binding a `permissionCode` to a menu
// never grants anything - authorization stays in `Permission` +
// `RolePermission`. There is no menu-tree cache in this codebase (reads always
// hit the database, same as the session guard's permission lookup), so a change
// is visible on the next request without an explicit invalidation step.
@Injectable()
export class MenusService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: JsonLogger,
  ) {}

  // ---------------------------------------------------------------- rendering

  private label(row: MenuRow, locale: string = DEFAULT_ADMIN_LOCALE): string {
    const exact = row.translations.find(
      (translation) => translation.locale === locale && translation.label.trim().length > 0,
    );
    if (exact) return exact.label;

    this.warnMissingTranslation(row, locale);
    // Never fall back from en-US to Chinese: a missing English label must stay
    // diagnosable and non-Chinese (docs/26 §4.4).
    if (locale === 'en-US') return row.code;
    const english = row.translations.find(
      (translation) => translation.locale === 'en-US' && translation.label.trim().length > 0,
    );
    return english?.label ?? row.code;
  }

  private warnMissingTranslation(row: MenuRow, locale: string): void {
    const key = `${row.code}:${locale}`;
    if (warnedMissingTranslations.has(key)) return;
    warnedMissingTranslations.add(key);
    this.logger.warn(
      'menus.translation_missing',
      { menuId: row.id, code: row.code, locale },
      'MenusService',
    );
  }

  /** Logs incomplete active menus even when the requested locale can fall back. */
  private reportIncompleteTranslations(rows: MenuRow[]): void {
    for (const row of rows) {
      for (const locale of SUPPORTED_LOCALES) {
        const present = row.translations.some(
          (translation) => translation.locale === locale && translation.label.trim().length > 0,
        );
        if (!present) this.warnMissingTranslation(row, locale);
      }
    }
  }

  private toNode(row: MenuRow, locale: string): MenuNode {
    return {
      id: row.id,
      code: row.code,
      label: this.label(row, locale),
      labels: Object.fromEntries(row.translations.map((item) => [item.locale, item.label])),
      parentId: row.parentId,
      route: row.route,
      icon: row.icon,
      permissionCode: row.permissionCode,
      sortOrder: row.sortOrder,
      visible: row.visible,
      enabled: row.enabled,
      external: row.external,
      updatedAt: row.updatedAt.toISOString(),
      children: [],
    };
  }

  private buildTree(rows: MenuRow[], parentId: string | null, locale: string): MenuNode[] {
    return rows
      .filter((row) => row.parentId === parentId)
      .sort(
        (left, right) => left.sortOrder - right.sortOrder || left.code.localeCompare(right.code),
      )
      .map((row) => ({
        ...this.toNode(row, locale),
        children: this.buildTree(rows, row.id, locale),
      }));
  }

  async listTree(
    options: { locale?: string; includeDisabled?: boolean } = {},
  ): Promise<MenuNode[]> {
    const rows = await this.prisma.menu.findMany({
      where: options.includeDisabled ? {} : { enabled: true, visible: true },
      select: MENU_SELECT,
    });
    return this.buildTree(rows, null, options.locale ?? DEFAULT_ADMIN_LOCALE);
  }

  /**
   * Back-office tree for the menu administration page (docs/19 §2.2).
   *
   * Text search keeps a matching node together with its whole subtree and its
   * ancestor path, so the result is never flattened without its parent.
   */
  async listAdminMenus(query: MenuListQueryInput): Promise<MenuNode[]> {
    const rows = await this.prisma.menu.findMany({ select: MENU_SELECT });
    const filtered = this.applyAdminFilters(rows, query);
    if (query.rootOnly) {
      return filtered
        .filter((row) => row.parentId === null)
        .sort(
          (left, right) => left.sortOrder - right.sortOrder || left.code.localeCompare(right.code),
        )
        .map((row) => this.toNode(row, query.locale));
    }
    return this.buildTree(filtered, null, query.locale);
  }

  private applyAdminFilters(rows: MenuRow[], query: MenuListQueryInput): MenuRow[] {
    let candidates = rows;

    if (query.type !== 'all') {
      candidates = candidates.filter((row) => {
        if (query.type === 'external') return row.external;
        if (query.type === 'group') return !row.external && row.route === null;
        return !row.external && row.route !== null;
      });
    }
    if (query.status !== 'all') {
      const wanted = query.status === 'enabled';
      candidates = candidates.filter((row) => row.enabled === wanted);
    }
    if (query.visibility !== 'all') {
      const wanted = query.visibility === 'visible';
      candidates = candidates.filter((row) => row.visible === wanted);
    }

    const needle = query.q?.trim().toLowerCase();
    if (!needle) return candidates;

    const matches = (row: MenuRow): boolean =>
      row.code.toLowerCase().includes(needle) ||
      (row.route ?? '').toLowerCase().includes(needle) ||
      (row.permissionCode ?? '').toLowerCase().includes(needle) ||
      row.translations.some((translation) => translation.label.toLowerCase().includes(needle));

    const byId = new Map(candidates.map((row) => [row.id, row]));
    const keep = new Set<string>();
    for (const row of candidates) {
      if (!matches(row)) continue;
      keep.add(row.id);
      for (const descendantId of collectDescendantIds(candidates, row.id)) keep.add(descendantId);
      let parentId = row.parentId;
      while (parentId) {
        keep.add(parentId);
        parentId = byId.get(parentId)?.parentId ?? null;
      }
    }
    return candidates.filter((row) => keep.has(row.id));
  }

  async detail(id: string): Promise<MenuNode> {
    const row = await this.prisma.menu.findUnique({ where: { id }, select: MENU_SELECT });
    if (!row) throw this.notFound();
    return this.toNode(row, DEFAULT_ADMIN_LOCALE);
  }

  /**
   * Searchable permission dictionary for the menu form's permission picker.
   *
   * Gated by `menu.read` so a menu administrator does not need role-management
   * permissions, and read-only: choosing a code here never grants anything.
   */
  async listPermissionOptions(): Promise<PermissionSummary[]> {
    const rows = await this.prisma.permission.findMany({
      orderBy: [{ module: 'asc' }, { code: 'asc' }],
      select: { code: true, nameKey: true, module: true },
    });
    if (rows.length > 0) return rows;
    // A not-yet-seeded environment still gets a usable picker.
    return ALL_PERMISSION_CODES.map((code) => ({
      code,
      nameKey: `permission.${code}`,
      module: code.split('.')[0] ?? 'misc',
    }));
  }

  /**
   * Navigation for the signed-in administrator: a menu is included when it has
   * no permission requirement or the actor holds that permission. This is a UX
   * filter only - every API endpoint still verifies its own permission.
   */
  async listForPermissions(
    permissions: string[],
    roles: string[],
    locale: string = DEFAULT_ADMIN_LOCALE,
  ): Promise<MenuNode[]> {
    const rows = await this.prisma.menu.findMany({
      where: { enabled: true, visible: true },
      select: MENU_SELECT,
    });
    this.reportIncompleteTranslations(rows);
    const resolvedLocale = resolveAdminLocale(locale);
    const isSuperAdmin = roles.includes('super_admin');
    const allowed = new Set(permissions);
    const byId = new Map(rows.map((row) => [row.id, row]));
    const keep = new Set<string>();
    for (const row of rows) {
      if (!isSuperAdmin && row.permissionCode && !allowed.has(row.permissionCode)) continue;
      keep.add(row.id);
      let parentId = row.parentId;
      while (parentId) {
        keep.add(parentId);
        parentId = byId.get(parentId)?.parentId ?? null;
      }
    }

    // Groups carry no route of their own, so a group whose children were all
    // filtered out would render as an empty heading. Keep only nodes that have a
    // route or at least one surviving child (docs/16 §4.2).
    const candidates = rows.filter((row) => keep.has(row.id));
    const childrenOf = new Map<string, number>();
    for (const row of candidates) {
      if (row.parentId) childrenOf.set(row.parentId, (childrenOf.get(row.parentId) ?? 0) + 1);
    }
    const pruned = candidates.filter(
      (row) => row.route !== null || (childrenOf.get(row.id) ?? 0) > 0,
    );

    return this.buildTree(pruned, null, resolvedLocale);
  }

  // -------------------------------------------------------------- write side

  async create(input: CreateMenuInput, actorId: string, requestId: string): Promise<MenuNode> {
    const createdId = await this.withSerializableTransaction(async (tx) => {
      const rows = await this.loadRows(tx);
      const code = input.code.trim().toLowerCase();
      if (rows.some((row) => row.code === code)) {
        throw new ApiError(ERROR_CODES.menuCodeExists, 'A menu with this code already exists.', {
          details: { code: 'validation.conflict' },
        });
      }

      const parentId = input.parentId ?? null;
      const route = normalizeRoute(input.route);
      this.assertWriteIsValid({
        rows,
        parentId,
        route,
        external: input.external,
        icon: input.icon,
        enabled: input.enabled,
      });
      await this.assertPermissionExists(tx, input.permissionCode);

      const labels = toTranslationRows(input.labels);
      assertMenuTranslationsComplete({
        labels: input.labels,
        enabled: input.enabled,
        visible: input.visible,
      });
      const created = await tx.menu.create({
        data: {
          code,
          parentId,
          route,
          icon: input.icon ?? null,
          permissionCode: input.permissionCode ?? null,
          sortOrder: input.sortOrder,
          visible: input.visible,
          enabled: input.enabled,
          external: input.external,
          translations: { create: labels },
        },
        select: { id: true, updatedAt: true },
      });

      await this.writeAudit(tx, {
        actorId,
        action: 'menu.create',
        entityId: created.id,
        requestId,
        metadata: {
          code,
          parentId,
          route,
          permissionCode: input.permissionCode ?? null,
          enabled: input.enabled,
          visible: input.visible,
          locales: labels.map((label) => label.locale),
        },
      });
      return created.id;
    });

    return this.detail(createdId);
  }

  async update(
    id: string,
    input: UpdateMenuInput,
    actorId: string,
    requestId: string,
  ): Promise<MenuNode> {
    await this.withSerializableTransaction(async (tx) => {
      const rows = await this.loadRows(tx);
      const current = rows.find((row) => row.id === id);
      if (!current) throw this.notFound();
      assertExpectedUpdatedAt(input.expectedUpdatedAt, current.updatedAt);

      const parentId = input.parentId !== undefined ? input.parentId : current.parentId;
      const external = input.external ?? current.external;
      const route = input.route !== undefined ? normalizeRoute(input.route) : current.route;
      const enabled = input.enabled ?? current.enabled;
      const visible = input.visible ?? current.visible;

      this.assertWriteIsValid({
        rows,
        parentId,
        route,
        external,
        icon: input.icon,
        selfId: id,
        enabled,
      });
      // A move must not push the moved subtree past the depth limit.
      assertDepthWithinLimit({ rows, parentId, subtreeHeight: subtreeHeight(rows, id) });
      if (input.permissionCode !== undefined) {
        await this.assertPermissionExists(tx, input.permissionCode);
      }

      const labels = input.labels ? toTranslationRows(input.labels) : [];
      assertMenuTranslationsComplete({
        labels: {
          ...Object.fromEntries(
            current.translations.map((translation) => [translation.locale, translation.label]),
          ),
          ...(input.labels ?? {}),
        },
        enabled,
        visible,
      });
      for (const label of labels) {
        await tx.menuTranslation.upsert({
          where: { menuId_locale: { menuId: id, locale: label.locale } },
          create: { menuId: id, locale: label.locale, label: label.label },
          update: { label: label.label },
        });
      }

      await tx.menu.update({
        where: { id },
        data: {
          parentId,
          route,
          ...(input.icon !== undefined ? { icon: input.icon } : {}),
          ...(input.permissionCode !== undefined ? { permissionCode: input.permissionCode } : {}),
          ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
          visible,
          enabled,
          external,
        },
      });

      await this.writeAudit(tx, {
        actorId,
        action: 'menu.update',
        entityId: id,
        requestId,
        metadata: {
          code: current.code,
          parentChanged: parentId !== current.parentId,
          routeChanged: route !== current.route,
          enabledChanged: enabled !== current.enabled,
          visibleChanged: visible !== current.visible,
          permissionChanged:
            input.permissionCode !== undefined && input.permissionCode !== current.permissionCode,
          locales: labels.map((label) => label.locale),
        },
      });
    });

    return this.detail(id);
  }

  /** Persists a complete sibling order in one transaction (docs/19 §4.4). */
  async reorder(input: ReorderMenusInput, actorId: string, requestId: string) {
    await this.withSerializableTransaction(async (tx) => {
      const rows = await this.loadRows(tx);
      const parentId = input.parentId ?? null;
      assertParentIsValid({ rows, parentId });

      const siblings = childrenOf(rows, parentId);
      assertReorderIsComplete({
        orderedIds: input.orderedIds,
        siblingIds: siblings.map((row) => row.id),
      });

      for (const [index, menuId] of input.orderedIds.entries()) {
        await tx.menu.update({
          where: { id: menuId },
          data: { sortOrder: (index + 1) * REORDER_STEP },
        });
      }

      await this.writeAudit(tx, {
        actorId,
        action: 'menu.reorder',
        entityId: parentId ?? 'root',
        requestId,
        metadata: { parentId, orderedIds: input.orderedIds },
      });
    });

    return { reordered: input.orderedIds.length };
  }

  /**
   * Deleting a menu never touches `Permission` or `RolePermission`: a menu only
   * references a permission code, and role grants stay intact (docs/19 §4.5).
   */
  async remove(id: string, actorId: string, requestId: string) {
    await this.withSerializableTransaction(async (tx) => {
      const rows = await this.loadRows(tx);
      const current = rows.find((row) => row.id === id);
      if (!current) throw this.notFound();

      assertMenuIsDeletable({
        code: current.code,
        childCount: childrenOf(rows, id).length,
      });

      await tx.menu.delete({ where: { id } });

      // The audit row keeps a snapshot so the deletion stays readable afterwards.
      await this.writeAudit(tx, {
        actorId,
        action: 'menu.delete',
        entityId: id,
        requestId,
        metadata: {
          code: current.code,
          route: current.route,
          permissionCode: current.permissionCode,
          labels: Object.fromEntries(current.translations.map((item) => [item.locale, item.label])),
        },
      });
    });

    return { deleted: true };
  }

  // ----------------------------------------------------------------- helpers

  private notFound(): ApiError {
    return new ApiError(ERROR_CODES.notFound, 'Menu not found.', { status: 404 });
  }

  private loadRows(client: TransactionClient | PrismaService = this.prisma): Promise<MenuRow[]> {
    return client.menu.findMany({ select: MENU_SELECT });
  }

  /**
   * Structural validation shared by create and update.
   *
   * Route uniqueness is only checked between *enabled* menus: legacy disabled
   * rows must not block maintaining the live navigation (docs/19 §5.3).
   */
  private assertWriteIsValid(params: {
    rows: MenuRow[];
    parentId: string | null;
    route: string | null;
    external: boolean;
    icon?: string | null;
    selfId?: string;
    enabled?: boolean;
  }): void {
    const { rows, parentId, route, external, icon, selfId, enabled = true } = params;
    assertIconIsAllowed(icon);
    assertParentIsValid({ rows, parentId, selfId });
    assertDepthWithinLimit({ rows, parentId });
    assertRouteMatchesKind({ external, route });
    if (enabled && route !== null) {
      assertRouteIsUnique({
        route,
        conflicts: rows.filter(
          (row) =>
            row.enabled && row.route === route && (selfId === undefined || row.id !== selfId),
        ),
      });
    }
  }

  private async assertPermissionExists(
    client: TransactionClient,
    permissionCode: string | null | undefined,
  ): Promise<void> {
    if (!permissionCode) return;
    const permission = await client.permission.findUnique({
      where: { code: permissionCode },
      select: { code: true },
    });
    if (!permission) {
      throw new ApiError(
        ERROR_CODES.permissionCodeInvalid,
        'The bound permission code does not exist in the permission dictionary.',
        { status: 400, details: { permissionCode } },
      );
    }
  }

  private async withSerializableTransaction<T>(
    work: (tx: TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await this.prisma.$transaction(work, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error) {
        if (attempt === 0 && this.isWriteConflict(error)) continue;
        if (this.isWriteConflict(error)) {
          throw new ApiError(
            ERROR_CODES.menuModified,
            'Another administrator changed this menu at the same time. Reload and retry.',
            { status: 409 },
          );
        }
        throw error;
      }
    }
    throw new ApiError(
      ERROR_CODES.menuModified,
      'Concurrent modification detected. Reload and retry.',
      {
        status: 409,
      },
    );
  }

  private async writeAudit(
    tx: TransactionClient,
    entry: {
      actorId: string;
      action: string;
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
          entityType: 'menu',
          entityId: entry.entityId,
          requestId: entry.requestId,
          metadata: (entry.metadata ?? undefined) as never,
        },
      });
    } catch (error) {
      // A navigation change must never be left unrecorded, so the whole
      // transaction is rolled back when its audit row cannot be written.
      this.logger.error(
        'menus.audit_write_failed',
        error instanceof Error ? error.stack : String(error),
        'MenusService',
        { action: entry.action, entityId: entry.entityId },
      );
      throw error;
    }
  }

  private isWriteConflict(error: unknown): boolean {
    // Only serialization failures are retried; unique violations stay as the
    // business conflict they are.
    if (error instanceof Prisma.PrismaClientKnownRequestError) return error.code === 'P2034';
    const message = error instanceof Error ? error.message : String(error);
    return message.includes('could not serialize access');
  }
}

/** Trims a submitted route; an empty string means "no route". */
function normalizeRoute(route: string | null | undefined): string | null {
  if (route === null || route === undefined) return null;
  const trimmed = route.trim();
  return trimmed.length === 0 ? null : trimmed;
}
