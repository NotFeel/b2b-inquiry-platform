import type { Metadata } from 'next';
import Link from 'next/link';
import { CategoryGrid } from '../../../components/category-grid';
import { storefrontApi } from '../../../lib/api';
import { getTranslator, localeHref } from '../../../lib/i18n';

interface Props {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = getTranslator(locale).t;
  return {
    title: t('catalog.categoriesTitle'),
    description: t('catalog.categoriesSubtitle'),
    alternates: { canonical: `/${locale}/categories` },
  };
}

export default async function CategoriesIndexPage({ params }: Props) {
  const { locale } = await params;
  const t = getTranslator(locale).t;
  const categories = await storefrontApi.getCategoryTree(locale);
  const visibleCategories = categories.data.filter((category) => category.productCount > 0);

  return (
    <div className="container-app stack" style={{ gap: 'var(--space-6)', marginTop: 'var(--space-5)' }}>
      <nav aria-label="Breadcrumb">
        <ol className="breadcrumb">
          <li>
            <Link href={localeHref(locale, '/')}>{t('site.nav.home')}</Link>
          </li>
          <li aria-current="page">{t('site.nav.categories')}</li>
        </ol>
      </nav>

      <header className="catalog-hero">
        <div>
          <span className="section-kicker">{t('home.categoriesKicker')}</span>
          <h1>{t('catalog.categoriesTitle')}</h1>
          <p>{t('catalog.categoriesSubtitle')}</p>
        </div>
      </header>

      {visibleCategories.length === 0 ? (
        <div className="state-block">
          <strong>{t('catalog.noCategories')}</strong>
          <Link className="btn" href={localeHref(locale, '/products')}>
            {t('home.heroCta')}
          </Link>
        </div>
      ) : (
        <>
          <CategoryGrid categories={visibleCategories} locale={locale} flat />
          <div className="row">
            <Link className="btn btn-secondary" href={localeHref(locale, '/products')}>
              {t('catalog.title')}
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
