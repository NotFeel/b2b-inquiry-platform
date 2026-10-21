import type { CategoryNode } from '@b2b/contracts';
import type { TreeNode } from '@b2b/ui';

// Pure tree helpers for the category workbench (docs/22 §2.4, §9).
//
// Nothing here mutates the tree returned by the API: the page keeps one flat
// list of visible rows derived from the tree plus the expanded id set, so a
// collapse never loses data and a failed write never leaves a phantom node.

export interface FlatCategoryRow {
  node: CategoryNode;
  depth: number;
  hasChildren: boolean;
}

/** Depth-first flatten, including children only while their parent is expanded. */
export function flattenTree(
  nodes: CategoryNode[],
  expanded: ReadonlySet<string>,
  depth = 0,
): FlatCategoryRow[] {
  const rows: FlatCategoryRow[] = [];
  for (const node of nodes) {
    const hasChildren = node.children.length > 0;
    rows.push({ node, depth, hasChildren });
    if (hasChildren && expanded.has(node.id)) {
      rows.push(...flattenTree(node.children, expanded, depth + 1));
    }
  }
  return rows;
}

export function allNodeIds(nodes: CategoryNode[]): string[] {
  return nodes.flatMap((node) => [node.id, ...allNodeIds(node.children)]);
}

export function countNodes(nodes: CategoryNode[]): number {
  return nodes.reduce((total, node) => total + 1 + countNodes(node.children), 0);
}

export function findNode(nodes: CategoryNode[], id: string): CategoryNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const found = findNode(node.children, id);
    if (found) return found;
  }
  return null;
}

/** The node itself plus every descendant - what a parent selector must exclude. */
export function subtreeIds(node: CategoryNode): string[] {
  return [node.id, ...node.children.flatMap(subtreeIds)];
}

/** Ancestor ids of a node (empty when it is a root or not found). */
export function ancestorIds(nodes: CategoryNode[], id: string): string[] {
  const walk = (list: CategoryNode[], trail: string[]): string[] | null => {
    for (const node of list) {
      if (node.id === id) return trail;
      const found = walk(node.children, [...trail, node.id]);
      if (found !== null) return found;
    }
    return null;
  };
  return walk(nodes, []) ?? [];
}

/** Root → self chain, used for the detail breadcrumb and the search path label. */
export function pathOf(nodes: CategoryNode[], id: string): CategoryNode[] {
  const node = findNode(nodes, id);
  if (!node) return [];
  return [
    ...ancestorIds(nodes, id)
      .map((ancestorId) => findNode(nodes, ancestorId))
      .filter(isNode),
    node,
  ];
}

function isNode(value: CategoryNode | null): value is CategoryNode {
  return value !== null;
}

/**
 * Default expansion (docs/22 §2.4.3).
 *
 * Only top-level branches open on first paint: a deep 8-level tree would
 * otherwise push everything below the fold before the administrator has chosen
 * anything.
 */
export function defaultExpandedIds(nodes: CategoryNode[]): string[] {
  return nodes.filter((node) => node.children.length > 0).map((node) => node.id);
}

export function findSiblings(nodes: CategoryNode[], parentId: string | null): CategoryNode[] {
  if (parentId === null) return nodes;
  return findNode(nodes, parentId)?.children ?? [];
}

/** Suggestion for the next sort order inside a parent (docs/22 §3.2). */
export function nextSortOrder(siblings: CategoryNode[]): number {
  if (siblings.length === 0) return 10;
  return Math.max(...siblings.map((node) => node.sortOrder)) + 10;
}

/**
 * New sibling order after moving one node up or down.
 *
 * Returns `null` at the ends of the list so the caller can keep the button
 * disabled instead of sending a no-op reorder request.
 */
export function moveWithinSiblings(
  nodes: CategoryNode[],
  parentId: string | null,
  id: string,
  direction: 'up' | 'down',
): string[] | null {
  const siblings = findSiblings(nodes, parentId);
  const index = siblings.findIndex((node) => node.id === id);
  if (index < 0) return null;
  const target = direction === 'up' ? index - 1 : index + 1;
  if (target < 0 || target >= siblings.length) return null;

  const ordered = siblings.map((node) => node.id);
  const [moved] = ordered.splice(index, 1);
  if (!moved) return null;
  ordered.splice(target, 0, moved);
  return ordered;
}

/** Display name for the active locale, with the same fallback the API uses. */
export function localizedName(node: CategoryNode, locale: string): string {
  return node.names[locale] ?? node.names['en-US'] ?? node.code;
}

/**
 * Parent selector options (docs/22 §3.2).
 *
 * `blockedIds` carries the edited node and its descendants: the picker greys
 * them out instead of hiding them, so the administrator can see why a branch is
 * unavailable - and the API rejects a cycle regardless.
 */
export function toParentTreeNodes(nodes: CategoryNode[], locale: string): TreeNode[] {
  return nodes.map((node) => ({
    id: node.id,
    label: localizedName(node, locale),
    hint: node.code,
    children: toParentTreeNodes(node.children, locale),
  }));
}

export interface HighlightPart {
  text: string;
  match: boolean;
}

/** Split a label around the search term so the match can be highlighted. */
export function highlightParts(text: string, needle: string): HighlightPart[] {
  const term = needle.trim();
  if (term.length === 0) return [{ text, match: false }];
  const parts: HighlightPart[] = [];
  const haystack = text.toLowerCase();
  const target = term.toLowerCase();
  let cursor = 0;
  while (cursor < text.length) {
    const index = haystack.indexOf(target, cursor);
    if (index < 0) {
      parts.push({ text: text.slice(cursor), match: false });
      break;
    }
    if (index > cursor) parts.push({ text: text.slice(cursor, index), match: false });
    parts.push({ text: text.slice(index, index + target.length), match: true });
    cursor = index + target.length;
  }
  return parts.length > 0 ? parts : [{ text, match: false }];
}

/** Ancestor path label, e.g. "Product catalog / Toys / Model toys". */
export function pathLabel(nodes: CategoryNode[], id: string, locale: string): string | null {
  const path = pathOf(nodes, id);
  if (path.length === 0) return null;
  return path.map((node) => localizedName(node, locale)).join(' / ');
}

export interface CategoryPickerRow {
  node: CategoryNode;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
  /** True when the node itself matches the active search term. */
  matched: boolean;
}

/**
 * Search predicate for the product category picker.
 *
 * The backend's tree filter only looks at the requested locale; the picker also
 * matches the other stored translation and the stable code/slug, so an operator
 * who knows either name can find the node without changing the admin language.
 */
export function categoryMatchesSearch(node: CategoryNode, term: string): boolean {
  const needle = term.trim().toLowerCase();
  if (needle.length === 0) return true;
  const haystack = [node.name, node.code, node.slug, ...Object.values(node.names)]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join(' ')
    .toLowerCase();
  return haystack.includes(needle);
}

/**
 * Rows visible in the picker.
 *
 * Without a search term only expanded branches are emitted. With a term, every
 * matching node is emitted with its complete ancestor path, and matching
 * branches are opened so a deep hit is never hidden behind a collapsed parent.
 */
export function categoryPickerRows(
  nodes: CategoryNode[],
  options: {
    term: string;
    expandedIds: ReadonlySet<string>;
    /** Search results auto-open matching branches unless explicitly collapsed. */
    collapsedIds?: ReadonlySet<string>;
  },
): CategoryPickerRow[] {
  const term = options.term.trim();
  const collapsedIds = options.collapsedIds ?? new Set<string>();

  const walk = (
    list: CategoryNode[],
    depth: number,
  ): { rows: CategoryPickerRow[]; branchMatches: boolean } => {
    const rows: CategoryPickerRow[] = [];
    let branchMatches = false;

    for (const node of list) {
      const selfMatches = term.length > 0 && categoryMatchesSearch(node, term);
      const childResult = walk(node.children, depth + 1);
      const hasChildren = node.children.length > 0;
      const visible = term.length === 0 || selfMatches || childResult.branchMatches;
      if (!visible) continue;

      branchMatches = true;
      const expanded =
        hasChildren &&
        (options.expandedIds.has(node.id) ||
          (term.length > 0 && childResult.branchMatches && !collapsedIds.has(node.id)));
      rows.push({
        node,
        depth,
        hasChildren,
        expanded,
        matched: selfMatches,
      });
      if (expanded) rows.push(...childResult.rows);
    }

    return { rows, branchMatches };
  };

  return walk(nodes, 0).rows;
}
