import type { Metadata } from 'next';
import Link from 'next/link';
import type { PublicHomepage } from '@b2b/contracts';
import { CategoryArt, IconArrowRight, IconCheck, MediaFrame } from '@b2b/ui';
import { HomepageProductSection } from '../../components/homepage-product-section';
import { WhatsAppCta } from '../../components/whatsapp-cta';
import { storefrontApi } from '../../lib/api';
import { htmlToPlainText } from '../../lib/content';
import { collectionProductsHref, homepageHeroProducts } from '../../lib/homepage';
import { getTranslator, localeHref } from '../../lib/i18n';
import { HOME_HERO_IMAGE_SIZES, imageSrcSet } from '../../lib/image-srcset';

interface Props {
  params: Promise<{ locale: string }>;
}

const COLLECTION_THEMES = ['pink', 'mint', 'yellow', 'lavender'] as const;

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

  const [config, heroAds, homepage, contentPages, homeSections] = await Promise.all([
    storefrontApi.getSiteConfig(),
    storefrontApi.getAds('home-hero', locale),
    storefrontApi
      .getHomepage(locale)
      .then((result) => result.data)
      .catch((): PublicHomepage | null => null),
    storefrontApi.getContentPages(),
    storefrontApi.getHomeSections(locale),
  ]);

  const publishedSlugs = new Set(contentPages.data.map((page) => page.slug));
  const factory = publishedSlugs.has('factory')
    ? await storefrontApi.getContentPage('factory', locale)
    : null;

  const hero = heroAds.data[0] ?? null;
  // The hero only borrows real product imagery from the public homepage DTO.
  const heroProducts = homepageHeroProducts(homepage);
  const newArrivals = homepage?.newArrivals ?? null;
  const collections = (homepage?.collections ?? []).filter(
    (collection) => collection.products.length > 0,
  );

  // Structured factory content takes precedence, while the published factory
  // page remains a safe fallback when no curated preview exists.
  const factoryPage = factory?.data ?? null;
  const factorySection =
    homeSections.data.find((section) => section.code === 'home.factory-preview') ?? null;
  const factoryHref = factory ? localeHref(locale, '/factory') : null;
  const factoryTitle = factorySection?.title ?? factoryPage?.title ?? t('home.factoryTitle');
  const factorySummary =
    factorySection?.description ??
    htmlToPlainText(factoryPage?.bodyHtml) ??
    t('home.factorySubtitle');
  const factoryCtaHref = factorySection?.ctaUrl ?? factoryHref;
  const factoryCtaLabel = factorySection?.ctaLabel ?? t('home.factoryLink');
  const factoryMedia = factorySection?.items.slice(0, 4) ?? [];
  const showFactory = Boolean(factorySection || (factoryPage && factoryHref));

  return (
    <div className="homepage-page">
      <div className="container-app">
        <section className="hero" aria-labelledby="home-hero-title">
          <div className="hero-inner">
            <div className="hero-copy">
              <span className="hero-eyebrow">{t('home.eyebrow')}</span>
              <h1 id="home-hero-title">
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
                <Link className="btn btn-lg hero-browse-cta" href={localeHref(locale, '/products')}>
                  {t('home.heroCta')}
                  <IconArrowRight size={17} />
                </Link>
                <WhatsAppCta
                  locale={locale}
                  className="btn btn-secondary btn-lg hero-whatsapp-cta"
                  label={t('home.heroSecondaryCta')}
                />
              </div>
              <ul className="hero-points">
                <li>
                  <IconCheck size={15} />
                  {t('home.heroPointFactory')}
                </li>
                <li>
                  <IconCheck size={15} />
                  {t('home.heroPointOem')}
                </li>
                <li>
                  <IconCheck size={15} />
                  {t('home.heroPointPackaging')}
                </li>
              </ul>
            </div>
            <div className="hero-visual">
              <div
                className="hero-collage"
                data-count={Math.max(1, Math.min(heroProducts.length, 4))}
              >
                {heroProducts.length > 0 ? (
                  heroProducts.map((product, index) => (
                    <Link
                      className="hero-tile"
                      href={localeHref(locale, `/products/${product.slug}`)}
                      aria-label={t('home.heroProductLink', { name: product.name })}
                      key={product.sku}
                    >
                      <MediaFrame
                        src={product.coverImage?.url ?? null}
                        srcSet={imageSrcSet(product.coverImage?.variants)}
                        sizes={HOME_HERO_IMAGE_SIZES}
                        alt={product.coverImage?.alt || product.name}
                        ratio="4 / 3"
                        fit="contain"
                        loading={index === 0 ? 'eager' : 'lazy'}
                        fallbackLabel={t('product.imageUnavailable')}
                        fallbackSeed={`${product.sku} ${product.name}`}
                      />
                      <span className="hero-tile-caption">
                        {product.category ? (
                          <span className="hero-tile-category">{product.category.name}</span>
                        ) : null}
                        <strong>{product.name}</strong>
                      </span>
                    </Link>
                  ))
                ) : (
                  <div className="hero-tile hero-tile-fallback">
                    <MediaFrame
                      src={null}
                      alt={config.data.companyName}
                      ratio="4 / 3"
                      fit="contain"
                      loading="eager"
                      fallbackLabel={t('catalog.categoryImageFallback')}
                      fallbackSeed="catalogue"
                    />
                  </div>
                )}
              </div>
              <span className="hero-sticker" aria-hidden="true">
                <span>{t('home.heroStickerKicker')}</span>
                <strong>{t('home.heroSticker')}</strong>
              </span>
            </div>
          </div>
        </section>
      </div>

      {newArrivals && newArrivals.products.length > 0 ? (
        <HomepageProductSection
          key={`new-arrivals:${locale}`}
          kind="new-arrivals"
          sectionId="new-arrivals"
          locale={locale}
          kicker={t('home.newArrivalsKicker')}
          title={t('home.newTitle')}
          subtitle={t('home.newArrivalsSubtitle')}
          initialBatch={newArrivals}
          displayLimit={newArrivals.limit}
          theme="pink"
        />
      ) : null}

      {collections.map((collection, index) => (
        <HomepageProductSection
          key={`${collection.id}:${locale}`}
          kind="collection"
          sectionId={collection.id}
          collectionId={collection.id}
          locale={locale}
          kicker={t('home.collectionKicker')}
          title={collection.title}
          subtitle={collection.subtitle}
          initialBatch={collection}
          displayLimit={collection.productLimit}
          theme={COLLECTION_THEMES[index % COLLECTION_THEMES.length]}
          viewAllHref={collectionProductsHref(locale, collection.categorySlug)}
          viewAllLabel={t('home.collectionViewAll', { title: collection.title })}
        />
      ))}

      {!homepage ? (
        <section className="section homepage-section" aria-labelledby="homepage-data-error">
          <div className="container-products">
            <div className="state-block homepage-data-error" role="alert">
              <strong id="homepage-data-error">{t('home.homepageUnavailable')}</strong>
              <span>{t('home.homepageUnavailableHint')}</span>
              <div className="state-actions">
                <Link className="btn btn-secondary" href={localeHref(locale, '/')}>
                  {t('common.retry')}
                </Link>
                <Link className="btn btn-primary" href={localeHref(locale, '/products')}>
                  {t('catalog.title')}
                </Link>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      <div className="container-app">
        {showFactory ? (
          <section className="section">
            <div className="trust-panel">
              <div>
                <span className="section-kicker">{t('home.factoryKicker')}</span>
                <h2>{factoryTitle}</h2>
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
                {factoryCtaHref ? (
                  <div style={{ marginTop: 'var(--space-5)' }}>
                    <Link className="section-link" href={factoryCtaHref}>
                      {factoryCtaLabel}
                      <IconArrowRight size={15} />
                    </Link>
                  </div>
                ) : null}
              </div>
              <div className={factoryMedia.length > 0 ? 'trust-art trust-art-media' : 'trust-art'}>
                {factoryMedia.length > 0
                  ? factoryMedia.map((item) => (
                      <div className="trust-tile trust-tile-media" key={item.id}>
                        <MediaFrame
                          src={item.imageUrl}
                          alt={item.title}
                          ratio="4 / 3"
                          loading="lazy"
                          fallbackLabel={t('product.imageUnavailable')}
                          fallbackSeed={item.title}
                        />
                        <span>{item.title}</span>
                      </div>
                    ))
                  : [
                      <div className="trust-tile" key="product">
                        <CategoryArt seed="product" />
                        <span>{t('home.factoryTile1')}</span>
                      </div>,
                      <div className="trust-tile" key="box">
                        <CategoryArt seed="box" />
                        <span>{t('home.factoryTile2')}</span>
                      </div>,
                      <div className="trust-tile" key="bolt">
                        <CategoryArt seed="bolt" />
                        <span>{t('home.factoryTile3')}</span>
                      </div>,
                      <div className="trust-tile" key="bearing">
                        <CategoryArt seed="bearing" />
                        <span>{t('home.factoryTile4')}</span>
                      </div>,
                    ]}
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
    </div>
  );
}
