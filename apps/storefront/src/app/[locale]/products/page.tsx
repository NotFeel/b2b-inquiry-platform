import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { PublicCategoryTreeNode } from '@b2b/contracts';
import { CatalogCategoryTree } from '../../../components/catalog-category-tree';
import { CatalogFilters } from '../../../components/catalog-filters';
import { CatalogSortSelect } from '../../../components/catalog-sort-select';
import { CatalogTagFilters } from '../../../components/catalog-tag-filters';
import { ProductCard } from '../../../components/product-card';
import { storefrontApi } from '../../../lib/api';
import { getTranslator, localeHref, productCountLabel } from '../../../lib/i18n';

interface Props {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function firstValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function flattenTree(nodes: PublicCategoryTreeNode[]): PublicCategoryTreeNode[] {
  return nodes.flatMap((node) => [node, ...flattenTree(node.children)]);
}

function findCategoryPath(
  nodes: PublicCategoryTreeNode[],
  slug: string,
  trail: string[] = [],
): string[] | null {
  for (const node of nodes) {
    const next = [...trail, node.name];
    if (node.slug === slug) return next;
    const found = findCategoryPath(node.children, slug, next);
    if (found) return found;
  }
  return null;
}

function filterPublicTree(nodes: PublicCategoryTreeNode[]): PublicCategoryTreeNode[] {
  return nodes
    .map((node) => ({ ...node, children: filterPublicTree(node.children) }))
    .filter((node) => node.productCount > 0 || node.children.length > 0);
}

function paginationItems(current: number, total: number): (number | 'ellipsis')[] {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
  const pages = new Set<number>([1, total, current - 1, current, current + 1]);
  if (current <= 3) pages.add(2).add(3).add(4);
  if (current >= total - 2)
    pages
      .add(total - 1)
      .add(total - 2)
      .add(total - 3);
  const sorted = [...pages].filter((page) => page >= 1 && page <= total).sort((a, b) => a - b);
  const result: (number | 'ellipsis')[] = [];
  for (let index = 0; index < sorted.length; index += 1) {
    const page = sorted[index]!;
    if (index > 0 && page - sorted[index - 1]! > 1) result.push('ellipsis');
    result.push(page);
  }
  return result;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = getTranslator(locale).t;
  return {
    title: t('catalog.title'),
    description: t('catalog.subtitle'),
    alternates: { canonical: `/${locale}/products` },
  };
}

export default async function ProductsPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const query = await searchParams;
  const t = getTranslator(locale).t;

  const page = Math.max(1, Number.parseInt(firstValue(query.page) ?? '1', 10) || 1);
  const search = firstValue(query.q)?.trim() ?? '';
  const category = firstValue(query.category) ?? '';
  const sortBy = firstValue(query.sortBy) ?? 'sort_order';
  const tag = firstValue(query.tag) ?? '';

  const buildHref = (patch: Record<string, string | number | undefined>) => {
    const next = new URLSearchParams();
    if (search) next.set('q', search);
    if (category) next.set('category', category);
    if (tag) next.set('tag', tag);
    if (sortBy !== 'sort_order') next.set('sortBy', sortBy);
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined || value === '') next.delete(key);
      else next.set(key, String(value));
    }
    const queryString = next.toString();
    return `${localeHref(locale, '/products')}${queryString ? `?${queryString}` : ''}`;
  };

  const [categoryResult, tagResult, products] = await Promise.all([
    storefrontApi.getCategoryTree(locale).catch(() => null),
    storefrontApi.getTags(locale).catch(() => null),
    storefrontApi.getProducts({
      locale,
      page,
      pageSize: 12,
      q: search || undefined,
      category: category || undefined,
      sortBy,
      tag: tag || undefined,
    }),
  ]);
  const categories = categoryResult?.data ?? [];
  const tags = tagResult?.data.filter((item) => item.productCount > 0) ?? [];

  if (products.pagination.totalPages > 0 && page > products.pagination.totalPages) {
    redirect(buildHref({ page: products.pagination.totalPages }));
  }

  const activeCategory = category
    ? (flattenTree(categories).find((node) => node.slug === category) ?? null)
    : null;
  const activeCategoryPath = category ? findCategoryPath(categories, category) : null;
  const visibleTree = filterPublicTree(categories);
  const activeTagLabel = tags.find((item) => item.code === tag)?.label ?? tag;
  const invalidCategory = Boolean(category && !activeCategory);
  const invalidTag = Boolean(tag && tagResult && !tags.some((item) => item.code === tag));
  const hasFilters = Boolean(search || category || tag);
  const pages = paginationItems(products.pagination.page, products.pagination.totalPages);

  const filters = (
    <div className="catalog-filter-stack">
      <section className="catalog-sidebar-section">
        <h3 className="catalog-sidebar-title">{t('catalog.categories')}</h3>
        {categoryResult ? (
          <CatalogCategoryTree nodes={visibleTree} locale={locale} selectedSlug={category} />
        ) : (
          <div className="catalog-filter-error" role="alert">
            <span>{t('catalog.categoriesLoadFailed')}</span>
            <Link className="btn-link" href={buildHref({})}>
              {t('common.retry')}
            </Link>
          </div>
        )}
      </section>

      <section className="catalog-sidebar-section">
        <h3 className="catalog-sidebar-title">{t('catalog.tags')}</h3>
        {tagResult ? (
          <CatalogTagFilters tags={tags} selectedCode={tag} locale={locale} />
        ) : (
          <div className="catalog-filter-error" role="alert">
            <span>{t('catalog.tagsLoadFailed')}</span>
            <Link className="btn-link" href={buildHref({})}>
              {t('common.retry')}
            </Link>
          </div>
        )}
      </section>

      {hasFilters ? (
        <Link className="btn btn-secondary btn-sm btn-block" href={localeHref(locale, '/products')}>
          {t('catalog.clearFilters')}
        </Link>
      ) : null}
    </div>
  );

  const sortControl = (
    <CatalogSortSelect
      locale={locale}
      value={sortBy}
      options={[
        { value: 'sort_order', label: t('catalog.sortOptions.sort_order') },
        { value: 'newest', label: t('catalog.sortOptions.newest') },
        { value: 'name', label: t('catalog.sortOptions.name') },
        { value: 'sku', label: t('catalog.sortOptions.sku') },
      ]}
    />
  );

  return (
    <div className="container-app" style={{ marginTop: 'var(--space-5)' }}>
      <nav aria-label="Breadcrumb">
        <ol className="breadcrumb">
          <li>
            <Link href={localeHref(locale, '/')}>{t('site.nav.home')}</Link>
          </li>
          {activeCategory ? (
            <li>
              <Link href={localeHref(locale, '/products')}>{t('catalog.title')}</Link>
            </li>
          ) : null}
          <li aria-current="page">{activeCategory?.name ?? t('catalog.title')}</li>
        </ol>
      </nav>

      <header className="catalog-hero" style={{ marginTop: 'var(--space-4)' }}>
        <div>
          <span className="section-kicker">{t('catalog.shopByCategory')}</span>
          <h1>{activeCategory?.name ?? t('catalog.title')}</h1>
          <p>{activeCategory?.description ?? t('catalog.subtitle')}</p>
          {activeCategoryPath && activeCategoryPath.length > 1 ? (
            <p className="catalog-path-note">
              {t('catalog.selectedCategory')}: {activeCategoryPath.join(' / ')}
            </p>
          ) : null}
        </div>
        <span className="catalog-hero-count">
          {productCountLabel(t, products.pagination.total)}
        </span>
      </header>

      <div className="catalog-layout">
        <CatalogFilters
          locale={locale}
          activeCount={[search, category, tag].filter(Boolean).length}
        >
          {filters}
        </CatalogFilters>

        <div>
          <div className="catalog-toolbar">
            <span className="catalog-toolbar-note">
              {search ? t('catalog.searchingFor', { query: search }) : t('catalog.keyboardHint')}
            </span>
            {sortControl}
          </div>

          {hasFilters ? (
            <div className="catalog-active-filters" aria-label={t('catalog.activeFilters')}>
              {search ? (
                <Link className="filter-chip" href={buildHref({ q: undefined, page: undefined })}>
                  {t('site.search.label')}: “{search}” <span aria-hidden="true">×</span>
                </Link>
              ) : null}
              {activeCategory ? (
                <Link
                  className="filter-chip"
                  href={buildHref({ category: undefined, page: undefined })}
                >
                  {activeCategoryPath?.join(' / ') ?? activeCategory.name}{' '}
                  <span aria-hidden="true">×</span>
                </Link>
              ) : null}
              {tag ? (
                <Link className="filter-chip" href={buildHref({ tag: undefined, page: undefined })}>
                  {activeTagLabel} <span aria-hidden="true">×</span>
                </Link>
              ) : null}
              <Link
                className="filter-chip filter-chip-clear"
                href={localeHref(locale, '/products')}
              >
                {t('catalog.clearFilters')}
              </Link>
            </div>
          ) : null}

          {invalidCategory || invalidTag ? (
            <div className="notice notice-warning" role="alert">
              {invalidCategory ? t('catalog.invalidCategoryFilter') : t('catalog.invalidTagFilter')}
            </div>
          ) : null}

          {products.data.length === 0 ? (
            <div className="state-block">
              <strong>{t('catalog.empty')}</strong>
              <span>{t('catalog.emptyHint')}</span>
              <div className="state-actions">
                <Link className="btn btn-secondary" href={localeHref(locale, '/products')}>
                  {t('catalog.clearFilters')}
                </Link>
                <Link className="btn btn-whatsapp" href={localeHref(locale, '/inquiry')}>
                  {t('catalog.emptyCta')}
                </Link>
              </div>
            </div>
          ) : (
            <div className="product-grid">
              {products.data.map((product) => (
                <ProductCard key={product.sku} product={product} locale={locale} />
              ))}
            </div>
          )}

          {products.pagination.totalPages > 1 ? (
            <nav className="catalog-pagination" aria-label={t('catalog.pagination')}>
              <span className="pagination-range">
                {t('catalog.showingRange', {
                  from: (products.pagination.page - 1) * products.pagination.pageSize + 1,
                  to: Math.min(
                    products.pagination.page * products.pagination.pageSize,
                    products.pagination.total,
                  ),
                  total: products.pagination.total,
                })}
              </span>
              <div className="pagination-controls pagination-desktop">
                {products.pagination.page > 1 ? (
                  <Link
                    className="btn btn-secondary btn-sm"
                    href={buildHref({ page: products.pagination.page - 1 })}
                  >
                    {t('common.previous')}
                  </Link>
                ) : (
                  <span className="btn btn-secondary btn-sm" aria-disabled="true">
                    {t('common.previous')}
                  </span>
                )}
                {pages.map((item, index) =>
                  item === 'ellipsis' ? (
                    <span className="pagination-ellipsis" key={`ellipsis-${index}`}>
                      …
                    </span>
                  ) : (
                    <Link
                      key={item}
                      className="btn btn-secondary btn-sm pagination-number"
                      href={buildHref({ page: item })}
                      aria-current={item === products.pagination.page ? 'page' : undefined}
                    >
                      {item}
                    </Link>
                  ),
                )}
                {products.pagination.page < products.pagination.totalPages ? (
                  <Link
                    className="btn btn-secondary btn-sm"
                    href={buildHref({ page: products.pagination.page + 1 })}
                  >
                    {t('common.next')}
                  </Link>
                ) : (
                  <span className="btn btn-secondary btn-sm" aria-disabled="true">
                    {t('common.next')}
                  </span>
                )}
              </div>
              <div className="pagination-controls pagination-mobile">
                {products.pagination.page > 1 ? (
                  <Link
                    className="btn btn-secondary btn-sm"
                    href={buildHref({ page: products.pagination.page - 1 })}
                  >
                    {t('common.previous')}
                  </Link>
                ) : (
                  <span className="btn btn-secondary btn-sm" aria-disabled="true">
                    {t('common.previous')}
                  </span>
                )}
                <span className="pagination-page-status">
                  {t('catalog.pageOf', {
                    page: products.pagination.page,
                    total: products.pagination.totalPages,
                  })}
                </span>
                {products.pagination.page < products.pagination.totalPages ? (
                  <Link
                    className="btn btn-secondary btn-sm"
                    href={buildHref({ page: products.pagination.page + 1 })}
                  >
                    {t('common.next')}
                  </Link>
                ) : (
                  <span className="btn btn-secondary btn-sm" aria-disabled="true">
                    {t('common.next')}
                  </span>
                )}
              </div>
            </nav>
          ) : null}
        </div>
      </div>
    </div>
  );
}
