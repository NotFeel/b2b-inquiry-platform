import type { PermissionTree, PermissionTreeNode, PermissionTreePermission } from '@b2b/contracts';

// Builds the configurable permission tree (docs/18 §2.5, §3.1).
//
// The tree mirrors the real `Menu` structure so the back office never hardcodes
// menu labels or permission codes, and it is built server-side from database
// rows only.
//
// Two kinds of checkbox live in one tree:
//   * `accessPermission` - the page-access permission declared by
//     `Menu.permissionCode`; shown on every node that declares one.
//   * `permissions` - the action permissions of a `Permission.module`, attached
//     to exactly one node per module (the deepest menu that references that
//     module, so operations hang off a leaf rather than a grouping heading).
// Modules that no menu references are appended as `module` groups.

export interface MenuTreeRow {
  id: string;
  code: string;
  parentId: string | null;
  permissionCode: string | null;
  sortOrder: number;
  translations: { locale: string; label: string }[];
}

export interface PermissionRow {
  code: string;
  nameKey: string;
  module: string;
}

export interface PermissionTreeDraftNode {
  key: string;
  kind: 'menu' | 'module';
  code: string;
  labels: Record<string, string>;
  labelKey: string;
  accessPermission: PermissionTreePermission | null;
  permissions: PermissionTreePermission[];
  children: PermissionTreeDraftNode[];
  depth: number;
  /** Depth-first position, used to break ties deterministically. */
  order: number;
}

export interface PermissionTreeDraft {
  items: PermissionTreeDraftNode[];
  allPermissionCodes: string[];
}

/** `product.read` -> `product`. Permission codes are `<module>.<action>`. */
export function moduleOfPermissionCode(code: string): string {
  const [head] = code.split('.');
  return head && head.length > 0 ? head : code;
}

/** i18n key for a synthesized module group label (`permissionModules.file`). */
export function moduleLabelKey(module: string): string {
  return `permissionModules.${module}`;
}

/** i18n key used when a menu row has no translation for the active locale. */
export function menuLabelKey(menuCode: string): string {
  return `menuLabels.${menuCode}`;
}

function toPermission(row: PermissionRow): PermissionTreePermission {
  return { code: row.code, nameKey: row.nameKey, module: row.module };
}

function buildMenuNodes(rows: MenuTreeRow[]): PermissionTreeDraftNode[] {
  const sorted = [...rows].sort(
    (left, right) => left.sortOrder - right.sortOrder || left.code.localeCompare(right.code),
  );
  const childrenOf = new Map<string | null, MenuTreeRow[]>();
  for (const row of sorted) {
    const bucket = childrenOf.get(row.parentId) ?? [];
    bucket.push(row);
    childrenOf.set(row.parentId, bucket);
  }

  let order = 0;
  const visit = (row: MenuTreeRow, depth: number): PermissionTreeDraftNode => {
    const node: PermissionTreeDraftNode = {
      key: `menu:${row.code}`,
      kind: 'menu',
      code: row.code,
      labels: Object.fromEntries(row.translations.map((item) => [item.locale, item.label])),
      labelKey: menuLabelKey(row.code),
      accessPermission: null,
      permissions: [],
      children: [],
      depth,
      order: order++,
    };
    node.children = (childrenOf.get(row.id) ?? []).map((child) => visit(child, depth + 1));
    return node;
  };

  return (childrenOf.get(null) ?? []).map((row) => visit(row, 0));
}

function flatten(nodes: PermissionTreeDraftNode[]): PermissionTreeDraftNode[] {
  const result: PermissionTreeDraftNode[] = [];
  for (const node of nodes) {
    result.push(node);
    result.push(...flatten(node.children));
  }
  return result;
}

export function buildPermissionTree(
  menus: MenuTreeRow[],
  permissions: PermissionRow[],
): PermissionTreeDraft {
  const items = buildMenuNodes(menus);
  const flat = flatten(items);
  const byCode = new Map(flat.map((node) => [node.key, node]));

  // Access permission: every node that declares one keeps its own checkbox so
  // the UI can explain exactly which page a menu requires.
  for (const row of menus) {
    if (!row.permissionCode) continue;
    const node = byCode.get(`menu:${row.code}`);
    if (!node) continue;
    node.accessPermission = toPermission({
      code: row.permissionCode,
      nameKey: `permission.${row.permissionCode}`,
      module: moduleOfPermissionCode(row.permissionCode),
    });
  }

  // Action permissions: one owner per module, chosen as the deepest node that
  // references the module so operations attach to a leaf menu.
  const byModule = new Map<string, PermissionRow[]>();
  for (const permission of permissions) {
    const bucket = byModule.get(permission.module) ?? [];
    bucket.push(permission);
    byModule.set(permission.module, bucket);
  }

  const ownerCandidates = flat.filter((node) => node.accessPermission !== null);
  const claimedModules = new Set<string>();

  for (const [module, rows] of byModule) {
    const owner = ownerCandidates
      .filter((node) => node.accessPermission?.module === module)
      .sort((left, right) => right.depth - left.depth || left.order - right.order)[0];
    const permissionsOfModule = rows
      .map(toPermission)
      .sort((left, right) => left.code.localeCompare(right.code));
    if (owner) {
      owner.permissions.push(...permissionsOfModule);
      claimedModules.add(module);
    }
  }

  // Anything no menu references stays configurable through a module group, so a
  // permission can never become invisible in the editor.
  const orphans = [...byModule.keys()].filter((module) => !claimedModules.has(module)).sort();
  for (const module of orphans) {
    const rows = byModule.get(module) ?? [];
    items.push({
      key: `module:${module}`,
      kind: 'module',
      code: module,
      labels: {},
      labelKey: moduleLabelKey(module),
      accessPermission: null,
      permissions: rows.map(toPermission).sort((left, right) => left.code.localeCompare(right.code)),
      children: [],
      depth: 0,
      order: Number.MAX_SAFE_INTEGER,
    });
  }

  return {
    items,
    allPermissionCodes: permissions.map((permission) => permission.code).sort(),
  };
}

/**
 * Every permission code reachable from the tree, used to verify that a stored
 * grant is still representable in the editor.
 */
export function collectTreePermissionCodes(nodes: PermissionTreeDraftNode[]): string[] {
  const codes = new Set<string>();
  for (const node of flatten(nodes)) {
    if (node.accessPermission) codes.add(node.accessPermission.code);
    for (const permission of node.permissions) codes.add(permission.code);
  }
  return [...codes].sort();
}

/** Drops the layout-only fields (`depth`, `order`) before the response leaves the API. */
export function serializePermissionTree(draft: PermissionTreeDraft): PermissionTree {
  const strip = (node: PermissionTreeDraftNode): PermissionTreeNode => ({
    key: node.key,
    kind: node.kind,
    code: node.code,
    labels: node.labels,
    labelKey: node.labelKey,
    accessPermission: node.accessPermission,
    permissions: node.permissions,
    children: node.children.map(strip),
  });
  return {
    items: draft.items.map(strip),
    allPermissionCodes: draft.allPermissionCodes,
  };
}
