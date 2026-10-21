import {
  ERROR_CODES,
  MENU_ICON_NAMES,
  MENU_MAX_DEPTH,
  PROTECTED_MENU_CODES,
  SUPPORTED_LOCALES,
} from '@b2b/contracts';
import { ApiError } from '../../common/errors/api-error';

// Pure tree/route policy for menu management (docs/19 §5.3, §8.2).
//
// Kept free of Prisma so every structural rule can be unit tested directly: the
// service supplies the current rows and runs these checks inside the write
// transaction, so a rejected request never leaves a half-updated tree.

export interface MenuRef {
  id: string;
  code: string;
  parentId: string | null;
  route: string | null;
  enabled: boolean;
}

export function childrenOf(rows: MenuRef[], parentId: string | null): MenuRef[] {
  return rows.filter((row) => row.parentId === parentId);
}

/** Every descendant of `rootId` (children, grandchildren, ...). */
export function collectDescendantIds(rows: MenuRef[], rootId: string): Set<string> {
  const byParent = new Map<string | null, MenuRef[]>();
  for (const row of rows) {
    const bucket = byParent.get(row.parentId) ?? [];
    bucket.push(row);
    byParent.set(row.parentId, bucket);
  }

  const result = new Set<string>();
  const queue = [...(byParent.get(rootId) ?? [])];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || result.has(current.id)) continue;
    result.add(current.id);
    queue.push(...(byParent.get(current.id) ?? []));
  }
  return result;
}

/** Nesting level of a node placed under `parentId`; a root menu is level 1. */
export function levelUnder(rows: MenuRef[], parentId: string | null): number {
  let level = 1;
  let current = parentId;
  const seen = new Set<string>();
  while (current) {
    if (seen.has(current)) break;
    seen.add(current);
    const parent = rows.find((row) => row.id === current);
    if (!parent) break;
    level += 1;
    current = parent.parentId;
  }
  return level;
}

/** Tallest chain of descendants below `rootId` (0 when it has no children). */
export function subtreeHeight(rows: MenuRef[], rootId: string): number {
  const children = childrenOf(rows, rootId);
  if (children.length === 0) return 0;
  return 1 + Math.max(...children.map((child) => subtreeHeight(rows, child.id)));
}

/**
 * Validates the requested parent (docs/19 §5.3).
 *
 * Rejects a missing parent, the node itself and any of its descendants, which is
 * what stops a subtree from being detached into a cycle.
 */
export function assertParentIsValid(params: {
  rows: MenuRef[];
  parentId: string | null;
  selfId?: string;
}): void {
  const { rows, parentId, selfId } = params;
  if (parentId === null) return;

  const parent = rows.find((row) => row.id === parentId);
  if (!parent) {
    throw new ApiError(ERROR_CODES.menuParentInvalid, 'The parent menu does not exist.', {
      status: 400,
      details: { parentId: 'menu.parent.missing' },
    });
  }
  if (!selfId) return;
  if (parentId === selfId) {
    throw new ApiError(ERROR_CODES.menuParentCycle, 'A menu cannot be its own parent.', {
      status: 409,
    });
  }
  if (collectDescendantIds(rows, selfId).has(parentId)) {
    throw new ApiError(ERROR_CODES.menuParentCycle, 'A menu cannot sit under its own descendant.', {
      status: 409,
    });
  }
}

/**
 * Enforces the maximum nesting depth for a node placed under `parentId`, taking
 * the height of the moved subtree into account so a move cannot bury its own
 * descendants below the limit (docs/19 §5.3).
 */
export function assertDepthWithinLimit(params: {
  rows: MenuRef[];
  parentId: string | null;
  subtreeHeight?: number;
}): void {
  const height = params.subtreeHeight ?? 0;
  const deepest = levelUnder(params.rows, params.parentId) + height;
  if (deepest > MENU_MAX_DEPTH) {
    throw new ApiError(
      ERROR_CODES.menuDepthExceeded,
      `Menus can be nested at most ${MENU_MAX_DEPTH} levels deep.`,
      { status: 409, details: { maxDepth: MENU_MAX_DEPTH, requiredDepth: deepest } },
    );
  }
}

/**
 * A menu is either an internal navigation target or an external link.
 *
 * Internal menus use a relative path; grouping menus carry no route at all.
 * External links must be absolute `https:` URLs - `javascript:` and `data:` are
 * rejected by the schema and re-checked here (docs/19 §3.1).
 */
export function assertRouteMatchesKind(params: { external: boolean; route: string | null }): void {
  const { external, route } = params;
  if (route === null) return;
  if (external) {
    if (!route.startsWith('https://')) {
      throw new ApiError(
        ERROR_CODES.menuRouteKindMismatch,
        'An external menu link must be an absolute https:// URL.',
        { status: 400 },
      );
    }
    return;
  }
  if (!route.startsWith('/')) {
    throw new ApiError(
      ERROR_CODES.menuRouteKindMismatch,
      'An internal menu route must start with "/".',
      { status: 400 },
    );
  }
}

/**
 * Only one *enabled* menu may own a route.
 *
 * Disabled rows are ignored on purpose: legacy rows that are switched off no
 * longer navigate anywhere, and blocking edits because of them would leave the
 * administrator stuck (docs/19 §5.3).
 */
export function assertRouteIsUnique(params: { route: string | null; conflicts: MenuRef[] }): void {
  if (params.route === null) return;
  if (params.conflicts.length > 0) {
    throw new ApiError(
      ERROR_CODES.menuRouteExists,
      'Another enabled menu already uses this route.',
      {
        status: 409,
        details: { codes: params.conflicts.map((row) => row.code).join(',') },
      },
    );
  }
}

export function assertIconIsAllowed(icon: string | null | undefined): void {
  if (icon === null || icon === undefined || icon === '') return;
  if (!(MENU_ICON_NAMES as readonly string[]).includes(icon)) {
    throw new ApiError(ERROR_CODES.menuIconInvalid, 'Unknown menu icon.', {
      status: 400,
      details: { icon },
    });
  }
}

/**
 * Protected menus are the product's own navigation skeleton: their code maps to
 * a seeded translation, a route and the API permission a role grant points at,
 * so deleting one would silently break navigation (docs/19 §4.5, §8.1).
 */
export function isProtectedMenuCode(code: string): boolean {
  return PROTECTED_MENU_CODES.includes(code);
}

export function assertMenuIsDeletable(params: { code: string; childCount: number }): void {
  if (params.childCount > 0) {
    throw new ApiError(ERROR_CODES.menuHasChildren, 'This menu still has child menus.', {
      status: 409,
      details: { childrenCount: params.childCount },
    });
  }
  if (isProtectedMenuCode(params.code)) {
    throw new ApiError(
      ERROR_CODES.menuSystemProtected,
      'This menu belongs to the back-office navigation and cannot be deleted.',
      { status: 409, details: { code: params.code } },
    );
  }
}

/**
 * A reorder request must describe the complete sibling set, otherwise the
 * unlisted siblings would keep an order that contradicts the submitted one
 * (docs/19 §4.4).
 */
export function assertReorderIsComplete(params: {
  orderedIds: string[];
  siblingIds: string[];
}): void {
  const requested = new Set(params.orderedIds);
  const siblings = new Set(params.siblingIds);
  const missing = params.siblingIds.filter((id) => !requested.has(id));
  const unknown = params.orderedIds.filter((id) => !siblings.has(id));
  if (missing.length > 0 || unknown.length > 0 || requested.size !== params.orderedIds.length) {
    throw ApiError.validation('The reorder request must list every sibling exactly once.', {
      missing: missing.join(','),
      unknown: unknown.join(','),
    });
  }
}

export interface MenuTranslationRow {
  locale: string;
  label: string;
}

/** Normalises submitted labels into sorted `(locale, label)` rows. */
export function toTranslationRows(labels: Record<string, string>): MenuTranslationRow[] {
  return Object.entries(labels)
    .filter(
      (entry): entry is [string, string] =>
        typeof entry[1] === 'string' && entry[1].trim().length > 0,
    )
    .map(([locale, label]) => ({ locale, label: label.trim() }))
    .sort((left, right) => left.locale.localeCompare(right.locale));
}

/**
 * Enabled + visible navigation must be complete in every supported locale.
 * Hidden/disabled legacy rows may be repaired before being switched on.
 */
export function missingMenuTranslationLocales(
  labels: Record<string, string> | MenuTranslationRow[],
): string[] {
  const entries = Array.isArray(labels)
    ? labels
    : Object.entries(labels).map(([locale, label]) => ({ locale, label }));
  const present = new Set(
    entries
      .filter((entry) => typeof entry.label === 'string' && entry.label.trim().length > 0)
      .map((entry) => entry.locale),
  );
  return SUPPORTED_LOCALES.filter((locale) => !present.has(locale));
}

export function assertMenuTranslationsComplete(params: {
  labels: Record<string, string> | MenuTranslationRow[];
  enabled: boolean;
  visible: boolean;
}): void {
  if (!params.enabled || !params.visible) return;
  const missing = missingMenuTranslationLocales(params.labels);
  if (missing.length > 0) {
    throw new ApiError(
      ERROR_CODES.menuTranslationMissing,
      'Enabled and visible menus require a label in every supported locale.',
      { details: { locales: missing.join(',') } },
    );
  }
}

/**
 * Optimistic concurrency guard for menu edits (docs/19 §10.1.12). Omitting the
 * timestamp keeps the request valid for clients that do not track it.
 */
export function assertExpectedUpdatedAt(expected: string | undefined, actual: Date): void {
  if (!expected) return;
  const expectedTime = Date.parse(expected);
  if (Number.isNaN(expectedTime)) {
    throw ApiError.validation('The concurrency token is not a valid timestamp.');
  }
  if (expectedTime !== actual.getTime()) {
    throw new ApiError(ERROR_CODES.menuModified, 'The menu was changed by another administrator.', {
      status: 409,
      details: { updatedAt: actual.toISOString() },
    });
  }
}
