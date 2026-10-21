import type { MenuNode } from '@b2b/contracts';

// Pure tree helpers for the menu management table (docs/19 §2.3, §9).
//
// The page keeps one flat, ordered list of visible rows derived from the tree
// plus the expanded key set; nothing here mutates the tree returned by the API.

export interface FlatMenuRow {
  node: MenuNode;
  depth: number;
  hasChildren: boolean;
}

/** Depth-first flatten, including children only while their parent is expanded. */
export function flattenTree(
  nodes: MenuNode[],
  expanded: ReadonlySet<string>,
  depth = 0,
): FlatMenuRow[] {
  const rows: FlatMenuRow[] = [];
  for (const node of nodes) {
    const hasChildren = node.children.length > 0;
    rows.push({ node, depth, hasChildren });
    if (hasChildren && expanded.has(node.id)) {
      rows.push(...flattenTree(node.children, expanded, depth + 1));
    }
  }
  return rows;
}

/** Every node id, used by "expand all". */
export function allNodeIds(nodes: MenuNode[]): string[] {
  return nodes.flatMap((node) => [node.id, ...allNodeIds(node.children)]);
}

export function countNodes(nodes: MenuNode[]): number {
  return nodes.reduce((total, node) => total + 1 + countNodes(node.children), 0);
}

export function findNode(nodes: MenuNode[], id: string): MenuNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const found = findNode(node.children, id);
    if (found) return found;
  }
  return null;
}

/** The node itself plus every descendant - what a parent selector must exclude. */
export function subtreeIds(node: MenuNode): string[] {
  return [node.id, ...node.children.flatMap(subtreeIds)];
}

export function findSiblings(nodes: MenuNode[], parentId: string | null): MenuNode[] {
  if (parentId === null) return nodes;
  return findNode(nodes, parentId)?.children ?? [];
}

/**
 * New sibling order after moving one node up or down.
 *
 * Returns `null` at the ends of the list so the caller can keep the button
 * disabled instead of sending a no-op reorder request.
 */
export function moveWithinSiblings(
  nodes: MenuNode[],
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

/** Ancestor ids of a node (empty when it is a root or not found). */
export function ancestorIds(nodes: MenuNode[], id: string): string[] {
  const walk = (list: MenuNode[], trail: string[]): string[] | null => {
    for (const node of list) {
      if (node.id === id) return trail;
      const found = walk(node.children, [...trail, node.id]);
      if (found !== null) return found;
    }
    return null;
  };
  return walk(nodes, []) ?? [];
}

export interface ParentOption {
  value: string;
  label: string;
  depth: number;
}

/**
 * Options for the parent selector.
 *
 * `excludedIds` drops the edited node and its descendants, which is what stops
 * the form from offering a choice the API would reject as a cycle; the server
 * re-validates regardless (docs/19 §5.3).
 */
export function parentOptions(
  nodes: MenuNode[],
  options: { excludedIds: ReadonlySet<string>; depth?: number } = { excludedIds: new Set() },
): ParentOption[] {
  const depth = options.depth ?? 0;
  const result: ParentOption[] = [];
  for (const node of nodes) {
    if (options.excludedIds.has(node.id)) continue;
    result.push({ value: node.id, label: node.label, depth });
    result.push(...parentOptions(node.children, { ...options, depth: depth + 1 }));
  }
  return result;
}

