'use client';

import { useMemo, useState } from 'react';

export interface TreeNode {
  id: string;
  label: string;
  disabled?: boolean;
  hint?: string;
  children?: TreeNode[];
}

export interface TreeSelectProps {
  nodes: TreeNode[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  searchPlaceholder: string;
  clearLabel: string;
  ariaLabel: string;
  /** When true (admin category tree) the user can pick "no parent" as root. */
  allowClear?: boolean;
  /** Ids that must not be selectable, e.g. the node being moved or its descendants. */
  blockedIds?: string[];
  emptyLabel: string;
}

function matches(node: TreeNode, term: string): boolean {
  if (!term) return true;
  const haystack = `${node.label} ${node.id}`.toLowerCase();
  if (haystack.includes(term)) return true;
  return (node.children ?? []).some((child) => matches(child, term));
}

export function TreeSelect({
  nodes,
  selectedId,
  onSelect,
  searchPlaceholder,
  clearLabel,
  ariaLabel,
  allowClear = false,
  blockedIds = [],
  emptyLabel,
}: TreeSelectProps) {
  const [term, setTerm] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const filtered = useMemo(() => {
    const normalized = term.trim().toLowerCase();
    const prune = (list: TreeNode[]): TreeNode[] =>
      list
        .filter((node) => matches(node, normalized))
        .map((node) => ({ ...node, children: node.children ? prune(node.children) : undefined }));
    return prune(nodes);
  }, [nodes, term]);

  const renderNodes = (list: TreeNode[], depth = 0) => (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0 }} role={depth === 0 ? 'tree' : 'group'}>
      {list.map((node) => {
        const blocked = blockedIds.includes(node.id);
        const isOpen = !collapsed[node.id];
        const hasChildren = Boolean(node.children && node.children.length > 0);
        return (
          <li
            key={node.id}
            role="treeitem"
            aria-selected={selectedId === node.id}
            aria-expanded={hasChildren ? isOpen : undefined}
          >
            <div className="tree-node" aria-current={selectedId === node.id ? 'true' : undefined}>
              {hasChildren ? (
                <button
                  type="button"
                  className="tree-node-toggle"
                  aria-label={isOpen ? 'collapse' : 'expand'}
                  onClick={(event) => {
                    event.stopPropagation();
                    setCollapsed((current) => ({ ...current, [node.id]: isOpen }));
                  }}
                >
                  {isOpen ? '▾' : '▸'}
                </button>
              ) : (
                <span className="tree-node-toggle" aria-hidden="true" />
              )}
              <button
                type="button"
                className="tree-node-label"
                style={{
                  background: 'none',
                  border: 0,
                  textAlign: 'left',
                  cursor: blocked ? 'not-allowed' : 'pointer',
                  color: blocked ? 'var(--color-text-muted)' : 'inherit',
                  fontWeight: selectedId === node.id ? 700 : 500,
                }}
                aria-current={selectedId === node.id}
                disabled={blocked || node.disabled}
                title={blocked ? node.hint : undefined}
                onClick={() => onSelect(node.id)}
              >
                {node.label}
              </button>
            </div>
            {hasChildren && isOpen ? (
              <div className="tree-children">{renderNodes(node.children ?? [], depth + 1)}</div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );

  return (
    <div className="stack-sm" aria-label={ariaLabel}>
      <input
        className="input"
        type="search"
        value={term}
        placeholder={searchPlaceholder}
        onChange={(event) => setTerm(event.target.value)}
        aria-label={searchPlaceholder}
      />
      <div className="tree-select">
        {allowClear ? (
          <div className="tree-node">
            <span className="tree-node-toggle" aria-hidden="true" />
            <button
              type="button"
              className="tree-node-label"
              style={{ background: 'none', border: 0, textAlign: 'left', cursor: 'pointer' }}
              aria-current={selectedId === null}
              onClick={() => onSelect(null)}
            >
              {clearLabel}
            </button>
          </div>
        ) : null}
        {filtered.length === 0 ? <p className="field-help">{emptyLabel}</p> : renderNodes(filtered)}
      </div>
    </div>
  );
}
