'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import type { PublicTagFilter } from '@b2b/contracts';
import { getTranslator } from '../lib/i18n';

const HIGHLIGHT_CODES = new Set(['new-arrival', 'featured', 'preorder']);

export function CatalogTagFilters({
  tags,
  selectedCode,
  locale,
}: {
  tags: PublicTagFilter[];
  selectedCode: string;
  locale: string;
}) {
  const t = getTranslator(locale).t;
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [expanded, setExpanded] = useState(false);
  const highlights = tags.filter((tag) => HIGHLIGHT_CODES.has(tag.code));
  const operational = tags.filter((tag) => !HIGHLIGHT_CODES.has(tag.code));
  const visibleOperational = expanded ? operational : operational.slice(0, 6);

  const hrefFor = (code?: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (code) params.set('tag', code);
    else params.delete('tag');
    params.delete('page');
    const suffix = params.toString();
    return suffix ? `${pathname}?${suffix}` : pathname;
  };

  const renderTag = (tag: PublicTagFilter) => (
    <Link
      key={tag.code}
      className="catalog-tag-chip"
      href={hrefFor(selectedCode === tag.code ? undefined : tag.code)}
      aria-current={selectedCode === tag.code ? 'true' : undefined}
    >
      <span>{tag.label || tag.code}</span>
      <span className="faint small">{tag.productCount}</span>
    </Link>
  );

  return (
    <div className="catalog-tag-filters">
      {highlights.length > 0 ? (
        <div className="catalog-filter-group">
          <h4 className="catalog-sidebar-title">{t('catalog.highlights')}</h4>
          <div className="catalog-tag-list">{highlights.map(renderTag)}</div>
        </div>
      ) : null}
      {operational.length > 0 ? (
        <div className="catalog-filter-group">
          <h4 className="catalog-sidebar-title">{t('catalog.tags')}</h4>
          <div className="catalog-tag-list">{visibleOperational.map(renderTag)}</div>
          {operational.length > 6 ? (
            <button
              type="button"
              className="btn-link catalog-show-more"
              aria-expanded={expanded}
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? t('catalog.showLessTags') : t('catalog.showAllTags')}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
