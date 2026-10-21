import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { PublicCategoryTreeNode } from '@b2b/contracts';
import { IconArrowRight } from '@b2b/ui';
import { ProductCard } from '../../../../components/product-card';
import { storefrontApi } from '../../../../lib/api';
import { getTranslator, localeHref, productCountLabel } from '../../../../lib/i18n';

interface Props {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function findPath(
  nodes: PublicCategoryTreeNode[],
  slug: string,
  trail: PublicCategoryTreeNode[] = [],
): PublicCategoryTreeNode[] | null {
  for (const node of nodes) {
    const nextTrail = [...trail, node];
    if (node.slug === slug) return nextTrail;
    const childPath = findPath(node.children, slug, nextTrail);
    if (childPath) return childPath;
  }
  return null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  const categories = await storefrontApi.getCategoryTree(locale);
  const flatten = (nodes: typeof categories.data): typeof categories.data =>
    nodes.flatMap((node) => [node, ...flatten(node.children)]);
  const category = flatten(categories.data).find((node) => node.slug === slug);
  return {
    title: category ? category.name : 'Category',
    description: category?.description ?? undefined,
    alternates: { canonical: `/${locale}/categories/${slug}` },
  };
}

export default async function CategoryPage({ params, searchParams }: Props) {
  const { locale, slug } = await params;
  const query = await searchParams;
  const t = getTranslator(locale).t;
  const page = Number.parseInt(String(query.page ?? '1'), 10) || 1;

  const [categories, products] = await Promise.all([
    storefrontApi.getCategoryTree(locale),
    storefrontApi.getProducts({ locale, category: slug, page, pageSize: 12 }),
  ]);

  const flatten = (nodes: typeof categories.data): typeof categories.data =>
    nodes.flatMap((node) => [node, ...flatten(node.children)]);
  const all = flatten(categories.data);
  const category = all.find((node) => node.slug === slug);
  if (!category) notFound();
  const path = findPath(categories.data, slug) ?? [category];

  return (
    <div
      className="container-app stack"
      style={{ gap: 'var(--space-6)', marginTop: 'var(--space-5)' }}
    >
      <nav aria-label="Breadcrumb">
        <ol className="breadcrumb">
          <li>
            <Link href={localeHref(locale, '/')}>{t('site.nav.home')}</Link>
          </li>
          <li>
            <Link href={localeHref(locale, '/products')}>{t('site.nav.products')}</Link>
          </li>
          {path.map((node) => (
            <li key={node.id} aria-current={node.slug === category.slug ? 'page' : undefined}>
              {node.slug === category.slug ? (
                node.name
              ) : (
                <Link href={localeHref(locale, `/categories/${node.slug}`)}>{node.name}</Link>
              )}
            </li>
          ))}
        </ol>
      </nav>

      <header className="catalog-hero">
        <div>
          <span className="section-kicker">{t('catalog.shopByCategory')}</span>
          <h1>{category.name}</h1>
          {category.description ? <p>{category.description}</p> : null}
        </div>
        <span className="catalog-hero-count">
          {productCountLabel(t, products.pagination.total)}
        </span>
      </header>

      {category.children.length > 0 ? (
        <section>
          <div className="section-head" style={{ marginBottom: 'var(--space-3)' }}>
            <h2 className="section-title" style={{ fontSize: 'var(--text-xl)' }}>
              {t('catalog.categories')}
            </h2>
          </div>
          <div className="row">
            {category.children.map((child) => (
              <Link
                key={child.id}
                className="filter-chip"
                href={localeHref(locale, `/categories/${child.slug}`)}
              >
                {child.name}
                <span className="faint">{child.productCount}</span>
                <IconArrowRight size={13} />
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {products.data.length === 0 ? (
        <div className="state-block">
          <strong>{t('catalog.empty')}</strong>
          <span>{t('catalog.emptyHint')}</span>
        </div>
      ) : (
        <div className="grid-cards">
          {products.data.map((product) => (
            <ProductCard key={product.sku} product={product} locale={locale} />
          ))}
        </div>
      )}

      {products.pagination.totalPages > 1 ? (
        <nav className="pagination" aria-label="pagination">
          <span className="pagination-status">
            {products.pagination.page} / {products.pagination.totalPages}
          </span>
          <div className="pagination-controls">
            {products.pagination.page > 1 ? (
              <Link
                className="btn btn-secondary btn-sm"
                href={`${localeHref(locale, `/categories/${slug}`)}?page=${products.pagination.page - 1}`}
              >
                {t('common.previous')}
              </Link>
            ) : null}
            {products.pagination.page < products.pagination.totalPages ? (
              <Link
                className="btn btn-secondary btn-sm"
                href={`${localeHref(locale, `/categories/${slug}`)}?page=${products.pagination.page + 1}`}
              >
                {t('common.next')}
              </Link>
            ) : null}
          </div>
        </nav>
      ) : null}
    </div>
  );
}
