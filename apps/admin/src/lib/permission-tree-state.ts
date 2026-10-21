import type { PermissionTreeNode, PermissionTreePermission } from '@b2b/contracts';

// Pure state helpers for the permission tree (docs/18 §6).
//
// The single source of truth is a `Set<permissionCode>`: parent checked /
// indeterminate states are derived from it, and search filtering is a pure view
// concern that can never mutate the selection.

export interface TreeCheckState {
  checked: boolean;
  indeterminate: boolean;
}

/** Codes owned by this node itself (its menu access permission and actions). */
export function nodeOwnCodes(node: PermissionTreeNode): string[] {
  // A menu access permission can also appear in `permissions` when the menu's
  // module owns it, so the list is deduplicated.
  const codes = new Set<string>();
  if (node.accessPermission) codes.add(node.accessPermission.code);
  for (const permission of node.permissions) codes.add(permission.code);
  return Array.from(codes);
}

/** Codes owned by this node and every descendant - what a parent checkbox controls. */
export function nodeCodes(node: PermissionTreeNode): string[] {
  const codes = new Set<string>(nodeOwnCodes(node));
  for (const child of node.children) {
    for (const code of nodeCodes(child)) codes.add(code);
  }
  return Array.from(codes);
}

export function summarizeNode(node: PermissionTreeNode, selected: ReadonlySet<string>): TreeCheckState {
  const codes = nodeCodes(node);
  if (codes.length === 0) return { checked: false, indeterminate: false };
  const chosen = codes.filter((code) => selected.has(code)).length;
  return {
    checked: chosen === codes.length,
    indeterminate: chosen > 0 && chosen < codes.length,
  };
}

/** Adds or removes a whole subtree; returns a new set so React state updates. */
export function toggleNodeSelection(
  node: PermissionTreeNode,
  selected: ReadonlySet<string>,
  select: boolean,
): Set<string> {
  const next = new Set(selected);
  for (const code of nodeCodes(node)) {
    if (select) next.add(code);
    else next.delete(code);
  }
  return next;
}

export function countSelected(nodes: PermissionTreeNode[], selected: ReadonlySet<string>): number {
  const visible = new Set<string>();
  for (const node of nodes) {
    for (const code of nodeCodes(node)) {
      if (selected.has(code)) visible.add(code);
    }
  }
  return visible.size;
}

export function allPermissionCodes(nodes: PermissionTreeNode[]): string[] {
  const codes = new Set<string>();
  for (const node of nodes) {
    for (const code of nodeCodes(node)) codes.add(code);
  }
  return Array.from(codes).sort();
}

/**
 * Label for a menu/module node.
 *
 * Menu labels arrive from `MenuTranslation`; a module group falls back to the
 * `permissionModules.<module>` translation and finally to the stable code.
 */
export function resolveNodeLabel(
  node: PermissionTreeNode,
  locale: string,
  translate: (key: string) => string,
): string {
  const fromDatabase = node.labels[locale] ?? node.labels['en-US'] ?? Object.values(node.labels)[0];
  if (fromDatabase && fromDatabase.length > 0) return fromDatabase;
  const translated = translate(node.labelKey);
  if (translated !== node.labelKey) return translated;
  return node.code;
}

/** Permission labels always come from the i18n dictionary, never from the code's shape. */
export function resolvePermissionLabel(
  permission: PermissionTreePermission,
  translate: (key: string) => string,
): string {
  const translated = translate(permission.nameKey);
  return translated === permission.nameKey ? permission.code : translated;
}

function nodeMatches(
  node: PermissionTreeNode,
  term: string,
  locale: string,
  translate: (key: string) => string,
): boolean {
  const parts = [node.code, resolveNodeLabel(node, locale, translate)];
  if (node.accessPermission) {
    parts.push(node.accessPermission.code, resolvePermissionLabel(node.accessPermission, translate));
  }
  for (const permission of node.permissions) {
    parts.push(permission.code, resolvePermissionLabel(permission, translate));
  }
  return parts.join(' ').toLowerCase().includes(term);
}

/**
 * View-only search filter.
 *
 * A node survives when it matches on its own, or when any descendant matches; a
 * matching node keeps its whole subtree so actions stay reachable. The selection
 * set is never touched, so hidden-but-selected permissions cannot be lost.
 */
export function filterPermissionTree(
  nodes: PermissionTreeNode[],
  term: string,
  locale: string,
  translate: (key: string) => string,
): PermissionTreeNode[] {
  const needle = term.trim().toLowerCase();
  if (needle.length === 0) return nodes;

  const visit = (node: PermissionTreeNode): PermissionTreeNode | null => {
    if (nodeMatches(node, needle, locale, translate)) return node;
    const children = node.children
      .map(visit)
      .filter((child): child is PermissionTreeNode => child !== null);
    return children.length > 0 ? { ...node, children } : null;
  };

  return nodes.map(visit).filter((node): node is PermissionTreeNode => node !== null);
}

/** Every key in the tree, used to expand the whole tree. */
export function allNodeKeys(nodes: PermissionTreeNode[]): string[] {
  const keys: string[] = [];
  const visit = (node: PermissionTreeNode) => {
    keys.push(node.key);
    node.children.forEach(visit);
  };
  nodes.forEach(visit);
  return keys;
}
