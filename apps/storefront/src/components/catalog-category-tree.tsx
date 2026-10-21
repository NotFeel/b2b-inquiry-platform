'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import type { PublicCategoryTreeNode } from '@b2b/contracts';
import { IconChevronDown, IconChevronRight, IconSearch } from '@b2b/ui';
import { getTranslator } from '../lib/i18n';

interface Props {
  nodes: PublicCategoryTreeNode[];
  locale: string;
  selectedSlug: string;
}

interface NodeWithPath {
  node: PublicCategoryTreeNode;
  path: string;
  ancestors: string[];
}

function flattenWithPaths(
  nodes: PublicCategoryTreeNode[],
  trail: PublicCategoryTreeNode[] = [],
): NodeWithPath[] {
  return nodes.flatMap((node) => {
    const nextTrail = [...trail, node];
    return [
      {
        node,
        path: nextTrail.map((entry) => entry.name).join(' / '),
        ancestors: nextTrail.slice(0, -1).map((entry) => entry.id),
      },
      ...flattenWithPaths(node.children, nextTrail),
    ];
  });
}

function filterTree(nodes: PublicCategoryTreeNode[], rawQuery: string): PublicCategoryTreeNode[] {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return nodes;
  return nodes
    .map((node) => {
      const children = filterTree(node.children, query);
      const matches =
        node.name.toLowerCase().includes(query) || node.slug.toLowerCase().includes(query);
      if (!matches && children.length === 0) return null;
      return { ...node, children };
    })
    .filter((node): node is PublicCategoryTreeNode => node !== null);
}

function Highlight({ text, query }: { text: string; query: string }) {
  const needle = query.trim();
  const index = needle ? text.toLowerCase().indexOf(needle.toLowerCase()) : -1;
  if (index === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, index)}
      <mark className="catalog-tree-mark">{text.slice(index, index + needle.length)}</mark>
      {text.slice(index + needle.length)}
    </>
  );
}

export function CatalogCategoryTree({ nodes, locale, selectedSlug }: Props) {
  const t = getTranslator(locale).t;
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const allNodes = useMemo(() => flattenWithPaths(nodes), [nodes]);
  const selected = allNodes.find((entry) => entry.node.slug === selectedSlug);
  const [query, setQuery] = useState('');
  const [manualExpanded, setManualExpanded] = useState<Set<string>>(
    () => new Set(selected?.ancestors ?? []),
  );
  const [searchExpanded, setSearchExpanded] = useState<Set<string>>(
    () => new Set(selected?.ancestors ?? []),
  );

  useEffect(() => {
    const entry = allNodes.find((item) => item.node.slug === selectedSlug);
    if (!entry) return;
    setManualExpanded((current) => new Set([...current, ...entry.ancestors]));
    setSearchExpanded((current) => new Set([...current, ...entry.ancestors]));
  }, [allNodes, selectedSlug]);

  const visibleNodes = useMemo(() => filterTree(nodes, query), [nodes, query]);
  const searchMatchIds = useMemo(() => {
    if (!query.trim()) return new Set<string>();
    return new Set(
      allNodes
        .filter(
          (entry) =>
            entry.node.name.toLowerCase().includes(query.trim().toLowerCase()) ||
            entry.node.slug.toLowerCase().includes(query.trim().toLowerCase()),
        )
        .flatMap((entry) => [...entry.ancestors, entry.node.id]),
    );
  }, [allNodes, query]);
  const expanded = query.trim() ? searchExpanded : manualExpanded;

  const toggle = (id: string) => {
    const setter = query.trim() ? setSearchExpanded : setManualExpanded;
    setter((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const hierarchyHref = (slug?: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (slug) params.set('category', slug);
    else params.delete('category');
    params.delete('page');
    const suffix = params.toString();
    return suffix ? `${pathname}?${suffix}` : pathname;
  };

  const renderNodes = (items: PublicCategoryTreeNode[], depth: number): ReactNode => (
    <ul className={depth === 0 ? 'catalog-tree-root' : 'catalog-tree-children'} role="group">
      {items.map((node) => {
        const hasChildren = node.children.length > 0;
        const isExpanded =
          expanded.has(node.id) || (query.trim() !== '' && searchMatchIds.has(node.id));
        const isSelected = node.slug === selectedSlug;
        return (
          <li key={node.id}>
            <div className="catalog-tree-row" data-selected={isSelected} data-depth={depth}>
              {hasChildren ? (
                <button
                  className="catalog-tree-toggle"
                  type="button"
                  aria-label={
                    isExpanded
                      ? t('catalog.collapseCategory', { name: node.name })
                      : t('catalog.expandCategory', { name: node.name })
                  }
                  aria-expanded={isExpanded}
                  aria-controls={`category-children-${node.id}`}
                  onClick={() => toggle(node.id)}
                >
                  {isExpanded ? <IconChevronDown size={15} /> : <IconChevronRight size={15} />}
                </button>
              ) : (
                <span className="catalog-tree-spacer" aria-hidden="true" />
              )}
              <Link
                className="catalog-tree-link"
                href={hierarchyHref(node.slug)}
                aria-current={isSelected ? 'true' : undefined}
                title={allNodes.find((entry) => entry.node.id === node.id)?.path ?? node.name}
              >
                <span className="truncate">
                  <Highlight text={node.name} query={query} />
                </span>
                <span className="faint small">{node.productCount}</span>
              </Link>
            </div>
            {hasChildren && isExpanded ? (
              <div id={`category-children-${node.id}`}>{renderNodes(node.children, depth + 1)}</div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );

  return (
    <div className="catalog-category-tree">
      <label className="catalog-tree-search">
        <span className="visually-hidden">{t('catalog.searchCategories')}</span>
        <IconSearch size={15} />
        <input
          className="input"
          type="search"
          value={query}
          placeholder={t('catalog.searchCategories')}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <Link
        className="category-tree-link"
        href={hierarchyHref()}
        aria-current={!selectedSlug ? 'true' : undefined}
      >
        <span>{t('catalog.allCategories')}</span>
      </Link>
      {visibleNodes.length > 0 ? (
        <nav aria-label={t('catalog.categories')}>{renderNodes(visibleNodes, 0)}</nav>
      ) : (
        <p className="field-help">{t('catalog.noCategoryMatches')}</p>
      )}
      {selected ? (
        <p className="catalog-selected-path">
          <span>{t('catalog.selectedCategory')}</span>
          <strong>{selected.path}</strong>
        </p>
      ) : null}
    </div>
  );
}
