'use client';

import type { PermissionTreeNode } from '@b2b/contracts';
import { IconChevronDown, IconChevronRight } from '@b2b/ui';
import {
  resolveNodeLabel,
  resolvePermissionLabel,
  summarizeNode,
  toggleNodeSelection,
} from '../lib/permission-tree-state';

export interface PermissionTreeProps {
  nodes: PermissionTreeNode[];
  selected: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
  expanded: ReadonlySet<string>;
  onExpandedChange: (next: Set<string>) => void;
  locale: string;
  translate: (key: string) => string;
  /** Read-only view: system roles and operators without the update capability. */
  disabled?: boolean;
  labels: { menuAccess: string; operations: string; expand: string; collapse: string };
}

// Checkbox tree for role permissions (docs/18 §2.5, §6).
//
// Every node owns a subtree checkbox (its menu access permission, its module's
// action permissions and those of its descendants). A leaf checkbox toggles a
// single permission code. The parent's checked / indeterminate state is always
// derived from the single `selected` set, so the two can never disagree.
export function PermissionTree({
  nodes,
  selected,
  onChange,
  expanded,
  onExpandedChange,
  locale,
  translate,
  disabled = false,
  labels,
}: PermissionTreeProps) {
  if (nodes.length === 0) return null;

  return (
    <ul className="permission-tree" role="tree">
      {nodes.map((node) => (
        <PermissionTreeRow
          key={node.key}
          node={node}
          selected={selected}
          onChange={onChange}
          expanded={expanded}
          onExpandedChange={onExpandedChange}
          locale={locale}
          translate={translate}
          disabled={disabled}
          labels={labels}
          depth={0}
        />
      ))}
    </ul>
  );
}

interface RowProps extends Omit<PermissionTreeProps, 'nodes'> {
  node: PermissionTreeNode;
  depth: number;
}

function PermissionTreeRow({
  node,
  selected,
  onChange,
  expanded,
  onExpandedChange,
  locale,
  translate,
  disabled,
  labels,
  depth,
}: RowProps) {
  const state = summarizeNode(node, selected);
  const isOpen = expanded.has(node.key);
  const hasChildren = node.children.length > 0;
  const label = resolveNodeLabel(node, locale, translate);
  const ownCodes = [
    ...(node.accessPermission ? [{ kind: 'access' as const, permission: node.accessPermission }] : []),
    ...node.permissions.map((permission) => ({ kind: 'operation' as const, permission })),
  ];

  const toggleExpanded = () => {
    const next = new Set(expanded);
    if (isOpen) next.delete(node.key);
    else next.add(node.key);
    onExpandedChange(next);
  };

  return (
    <li className="permission-tree-node" role="treeitem" aria-expanded={hasChildren ? isOpen : undefined}>
      <div className="permission-tree-row" data-depth={depth}>
        {hasChildren ? (
          <button
            type="button"
            className="permission-tree-toggle"
            aria-label={isOpen ? labels.collapse : labels.expand}
            aria-expanded={isOpen}
            onClick={toggleExpanded}
          >
            {isOpen ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
          </button>
        ) : (
          <span className="permission-tree-toggle" aria-hidden="true" />
        )}

        <label className="permission-tree-check">
          <input
            type="checkbox"
            className="permission-tree-subtree"
            checked={state.checked}
            disabled={disabled}
            ref={(element) => {
              if (element) element.indeterminate = state.indeterminate;
            }}
            onChange={() => onChange(toggleNodeSelection(node, selected, !state.checked))}
          />
          <span className="permission-tree-label">
            <span>{label}</span>
            <code className="mono permission-tree-code">{node.code}</code>
          </span>
        </label>
      </div>

      {isOpen ? (
        <div className="permission-tree-body">
          {ownCodes.length > 0 ? (
            <ul className="permission-tree-leaves">
              {ownCodes.map((entry) => {
                const code = entry.permission.code;
                const permissionLabel = resolvePermissionLabel(entry.permission, translate);
                return (
                  <li key={`${entry.kind}:${code}`}>
                    <label className="permission-tree-check permission-tree-check-leaf">
                      <input
                        type="checkbox"
                        checked={selected.has(code)}
                        disabled={disabled}
                        onChange={() => {
                          const next = new Set(selected);
                          if (next.has(code)) next.delete(code);
                          else next.add(code);
                          onChange(next);
                        }}
                      />
                      <span className="permission-tree-label">
                        <span className="permission-tree-kind">
                          {entry.kind === 'access' ? labels.menuAccess : labels.operations}
                        </span>
                        <span>{permissionLabel}</span>
                        <code className="mono permission-tree-code">{code}</code>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          ) : null}

          {hasChildren ? (
            <ul className="permission-tree" role="group">
              {node.children.map((child) => (
                <PermissionTreeRow
                  key={child.key}
                  node={child}
                  selected={selected}
                  onChange={onChange}
                  expanded={expanded}
                  onExpandedChange={onExpandedChange}
                  locale={locale}
                  translate={translate}
                  disabled={disabled}
                  labels={labels}
                  depth={depth + 1}
                />
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
