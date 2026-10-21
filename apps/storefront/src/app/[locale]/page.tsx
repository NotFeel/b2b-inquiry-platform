import type { Metadata } from 'next';
import Link from 'next/link';
import { CategoryArt, IconArrowRight, IconCheck, MediaFrame } from '@b2b/ui';
import { CategoryGrid } from '../../components/category-grid';
import { ProductCard } from '../../components/product-card';
import { WhatsAppCta } from '../../components/whatsapp-cta';
import { storefrontApi } from '../../lib/api';
import { htmlToPlainText } from '../../lib/content';
import { getTranslator, localeHref } from '../../lib/i18n';
import { HOME_HERO_IMAGE_SIZES, imageSrcSet } from '../../lib/image-srcset';

interface Props {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = getTranslator(locale).t;
  const config = await storefrontApi.getSiteConfig();
  const useConfiguredSeo = locale === config.data.defaultLocale;
  const title = useConfiguredSeo ? config.data.seo.title : t('site.seoTitle');
  const description = useConfiguredSeo ? config.data.seo.description : t('site.seoDescription');
  return {
    title,
    description,
    keywords: useConfiguredSeo ? config.data.seo.keywords : undefined,
    alternates: { canonical: `/${locale}` },
    openGraph: {
      title,
      description,
      type: 'website',
      images: config.data.logoUrl ? [config.data.logoUrl] : undefined,
    },
  };
}

export default async function HomePage({ params }: Props) {
  const { locale } = await params;
  const t = getTranslator(locale).t;

  const [config, categories, heroAds, featured, newArrivals, preorder, contentPages, homeSections] =
    await Promise.all([
      storefrontApi.getSiteConfig(),
      storefrontApi.getCategoryTree(locale),
      storefrontApi.getAds('home-hero', locale),
      storefrontApi.getProducts({ locale, featured: true, pageSize: 12 }),
      storefrontApi.getProducts({ locale, isNew: true, pageSize: 12 }),
      // The home pre-order rail is curated in the back office via the `preorder`
      // tag, independently from the lifecycle facet.
      storefrontApi.getProducts({ locale, isPreOrder: true, pageSize: 12 }),
      storefrontApi.getContentPages(),
      storefrontApi.getHomeSections(locale),
    ]);

  const publishedSlugs = new Set(contentPages.data.map((page) => page.slug));
  const factory = publishedSlugs.has('factory')
    ? await storefrontApi.getContentPage('factory', locale)
    : null;

  const hero = heroAds.data[0] ?? null;
  // Real product imagery fills the hero visual; the fallback art keeps the
  // layout intact when a product has no photo yet.
  const heroProducts = [...featured.data, ...newArrivals.data]
    .filter(
      (product, index, all) =>
        all.findIndex((candidate) => candidate.sku === product.sku) === index,
    )
    .slice(0, 3);

  // Each tag owns its own home rail. A product with several operational tags
  // must appear in every corresponding rail; only duplicates inside one rail
  // are removed.
  const uniqueRail = (products: typeof featured.data) =>
    products.filter(
      (product, index, all) =>
        all.findIndex((candidate) => candidate.sku === product.sku) === index,
    );
  const sections = [
    {
      key: 'featured',
      kicker: t('home.featuredKicker'),
      title: t('home.featuredTitle'),
      subtitle: t('home.featuredSubtitle'),
      href: localeHref(locale, '/products?tag=featured'),
      products: uniqueRail(featured.data),
    },
    {
      key: 'new',
      kicker: t('home.featuredKicker'),
      title: t('home.newTitle'),
      subtitle: null,
      href: localeHref(locale, '/products?tag=new-arrival'),
      products: uniqueRail(newArrivals.data),
    },
    {
      key: 'preorder',
      kicker: t('home.featuredKicker'),
      title: t('home.preorderTitle'),
      subtitle: null,
      href: localeHref(locale, '/products?tag=preorder'),
      products: uniqueRail(preorder.data),
    },
  ].filter((section) => section.products.length > 0);

  const visibleCategories = categories.data.filter((category) => category.productCount > 0);
  // The factory preview only uses factory content; no About fallback remains
  // now that the public About page has been removed.
  const factoryPage = factory?.data ?? null;
  const factoryHref = factory ? localeHref(locale, '/factory') : null;
  const factorySummary = htmlToPlainText(factoryPage?.bodyHtml) ?? t('home.factorySubtitle');
  const hasStructuredFactorySection = homeSections.data.some(
    (section) => section.code === 'home.factory-preview',
  );

  return (
    <div className="container-app">
      <section className="hero">
        <div className="hero-inner">
          <div className="hero-copy">
            <span className="hero-eyebrow">{t('home.eyebrow')}</span>
            <h1>
              {hero?.title ? (
                hero.title
              ) : (
                <>
                  {t('home.heroTitleTop')}
                  <br />
                  <em>{t('home.heroTitleAccent')}</em>
                </>
              )}
            </h1>
            <p className="hero-lede">{hero?.description ?? t('home.heroSubtitle')}</p>
            <div className="hero-actions">
              <Link className="btn btn-lg" href={localeHref(locale, '/products')}>
                {t('home.heroCta')}
              </Link>
              <WhatsAppCta
                locale={locale}
                className="btn btn-secondary btn-lg"
                label={t('home.heroSecondaryCta')}
              />
            </div>
            <ul className="hero-points">
              <li>
                <IconCheck size={16} />
                {t('home.heroPointCatalogue')}
              </li>
              <li>
                <IconCheck size={16} />
                {t('home.heroPointPackaging')}
              </li>
              <li>
                <IconCheck size={16} />
                {t('home.heroPointReply')}
              </li>
            </ul>
          </div>
          <div className="hero-visual">
            <div className="hero-visual-grid">
              {heroProducts.length > 0 ? (
                heroProducts.map((product, index) => (
                  <div className="hero-tile" key={product.sku}>
                    <MediaFrame
                      src={product.coverImage?.url ?? null}
                      srcSet={imageSrcSet(product.coverImage?.variants)}
                      sizes={HOME_HERO_IMAGE_SIZES}
                      alt={product.coverImage?.alt || product.name}
                      ratio="4 / 3"
                      loading={index === 0 ? 'eager' : 'lazy'}
                      fallbackLabel={t('product.imageUnavailable')}
                      fallbackSeed={`${product.sku} ${product.name}`}
                    />
                    <span className="hero-tile-caption">
                      <strong>{product.name}</strong>
                      {product.sku}
                    </span>
                  </div>
                ))
              ) : (
                <div className="hero-tile" style={{ gridColumn: 'span 2' }}>
                  <MediaFrame
                    src={null}
                    alt={config.data.companyName}
                    ratio="16 / 9"
                    fallbackLabel={t('catalog.categoryImageFallback')}
                    fallbackSeed="catalogue"
                  />
                </div>
              )}
            </div>
            <span className="hero-sticker" aria-hidden="true">
              {t('home.heroSticker')}
            </span>
          </div>
        </div>
      </section>

      {visibleCategories.length > 0 ? (
        <section className="section">
          <div className="section-head">
            <div>
              <span className="section-kicker">{t('home.categoriesKicker')}</span>
              <h2 className="section-title">{t('home.categoriesTitle')}</h2>
              <p className="section-subtitle">{t('home.categoriesSubtitle')}</p>
            </div>
            <Link className="section-link" href={localeHref(locale, '/categories')}>
              {t('site.nav.categories')}
              <IconArrowRight size={15} />
            </Link>
          </div>
          <CategoryGrid categories={visibleCategories} locale={locale} limit={4} />
        </section>
      ) : null}

      {sections.map((section) => (
        <section className="section" key={section.key}>
          <div className="section-head">
            <div>
              <span className="section-kicker">{section.kicker}</span>
              <h2 className="section-title">{section.title}</h2>
              {section.subtitle ? <p className="section-subtitle">{section.subtitle}</p> : null}
            </div>
            <Link className="section-link" href={section.href}>
              {t('catalog.title')}
              <IconArrowRight size={15} />
            </Link>
          </div>
          <div className="product-rail">
            {section.products.map((product) => (
              <ProductCard key={product.sku} product={product} locale={locale} />
            ))}
          </div>
        </section>
      ))}

      {homeSections.data.map((section) => (
        <section className="section" key={section.code}>
          <div className="section-head">
            <div>
              <span className="section-kicker">{t('home.factoryKicker')}</span>
              <h2 className="section-title">{section.title}</h2>
              {section.description ? (
                <p className="section-subtitle">{section.description}</p>
              ) : null}
            </div>
            {section.ctaUrl ? (
              <Link className="section-link" href={section.ctaUrl}>
                {section.ctaLabel ?? t('catalog.explore')}
                <IconArrowRight size={15} />
              </Link>
            ) : null}
          </div>
          <div className="category-grid">
            {section.items.map((item, index) => (
              <Link
                className={`category-card tone-${['pink', 'mint', 'yellow', 'lavender'][index % 4]}`}
                href={section.ctaUrl ?? localeHref(locale, '/')}
                key={item.id}
              >
                <div className="category-card-media">
                  <MediaFrame
                    src={item.imageUrl}
                    alt={item.title}
                    ratio="16 / 10"
                    loading="lazy"
                    fallbackLabel={t('product.imageUnavailable')}
                    fallbackSeed={item.title}
                  />
                </div>
                <div className="category-card-body">
                  <span className="category-card-name">{item.title}</span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      ))}

      {!hasStructuredFactorySection && factoryPage && factoryHref ? (
        <section className="section">
          <div className="trust-panel">
            <div>
              <span className="section-kicker">{t('home.factoryKicker')}</span>
              <h2>{factoryPage.title || t('home.factoryTitle')}</h2>
              <p>{factorySummary}</p>
              <ul className="trust-list">
                <li>
                  <IconCheck size={17} />
                  {t('home.factoryPoint1')}
                </li>
                <li>
                  <IconCheck size={17} />
                  {t('home.factoryPoint2')}
                </li>
                <li>
                  <IconCheck size={17} />
                  {t('home.factoryPoint3')}
                </li>
              </ul>
              <div style={{ marginTop: 'var(--space-5)' }}>
                <Link className="section-link" href={factoryHref}>
                  {t('home.factoryLink')}
                  <IconArrowRight size={15} />
                </Link>
              </div>
            </div>
            <div className="trust-art" aria-hidden="true">
              <div className="trust-tile">
                <CategoryArt seed="product" />
                <span>{t('home.factoryTile1')}</span>
              </div>
              <div className="trust-tile">
                <CategoryArt seed="box" />
                <span>{t('home.factoryTile2')}</span>
              </div>
              <div className="trust-tile">
                <CategoryArt seed="bolt" />
                <span>{t('home.factoryTile3')}</span>
              </div>
              <div className="trust-tile">
                <CategoryArt seed="bearing" />
                <span>{t('home.factoryTile4')}</span>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      <section className="section">
        <div className="section-head">
          <div>
            <span className="section-kicker">{t('home.stepsKicker')}</span>
            <h2 className="section-title">{t('home.stepsTitle')}</h2>
            <p className="section-subtitle">{t('home.stepsSubtitle')}</p>
          </div>
        </div>
        <div className="steps-grid">
          {[1, 2, 3].map((step) => (
            <div className="step-card" key={step}>
              <span className="step-index">{step}</span>
              <h3>{t(`home.step${step}Title`)}</h3>
              <p>{t(`home.step${step}Body`)}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="final-cta">
          <div style={{ maxWidth: '58ch' }}>
            <h2>{t('home.ctaTitle')}</h2>
            <p>{t('home.ctaBody')}</p>
          </div>
          <div className="hero-actions">
            <Link className="btn btn-lg" href={localeHref(locale, '/products')}>
              {t('home.heroCta')}
            </Link>
            <WhatsAppCta
              locale={locale}
              className="btn btn-secondary btn-lg"
              label={t('home.ctaWhatsApp')}
            />
          </div>
        </div>
      </section>
    </div>
  );
}
