import type { Metadata } from 'next';
import Link from 'next/link';
import { IconCheck, MediaFrame } from '@b2b/ui';
import { WhatsAppCta } from '../../../components/whatsapp-cta';
import { storefrontApi } from '../../../lib/api';
import { htmlToPlainText } from '../../../lib/content';
import { getTranslator, localeHref } from '../../../lib/i18n';

interface Props {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = getTranslator(locale).t;
  try {
    const content = await storefrontApi.getFactoryContent(locale);
    return {
      title: content.data.page?.seoTitle ?? content.data.page?.title ?? t('factoryPage.title'),
      description:
        content.data.page?.seoDescription ??
        htmlToPlainText(content.data.page?.bodyHtml, 160) ??
        t('factoryPage.subtitle'),
      alternates: { canonical: `/${locale}/factory` },
    };
  } catch {
    return { title: t('factoryPage.title'), description: t('factoryPage.subtitle') };
  }
}

export default async function FactoryPage({ params }: Props) {
  const { locale } = await params;
  const t = getTranslator(locale).t;
  const { data } = await storefrontApi.getFactoryContent(locale);
  const intro = htmlToPlainText(data.page?.bodyHtml, 900);
  const hasContent = Boolean(data.page || data.media.length > 0 || data.process.length > 0);

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
          <li aria-current="page">{t('site.nav.factory')}</li>
        </ol>
      </nav>

      <header className="catalog-hero">
        <div>
          <span className="section-kicker">{t('site.nav.factory')}</span>
          <h1>{data.page?.title ?? t('factoryPage.title')}</h1>
          <p>{intro ?? t('factoryPage.subtitle')}</p>
        </div>
      </header>

      {!hasContent ? (
        <div className="state-block">
          <strong>{t('factoryPage.empty')}</strong>
          <Link className="btn btn-secondary" href={localeHref(locale, '/products')}>
            {t('home.heroCta')}
          </Link>
        </div>
      ) : null}

      {data.media.length > 0 ? (
        <section className="section" style={{ marginTop: 0 }}>
          <div className="section-head">
            <div>
              <span className="section-kicker">{t('home.factoryKicker')}</span>
              <h2 className="section-title">{t('factoryPage.mediaTitle')}</h2>
            </div>
          </div>
          <div className="category-grid">
            {data.media.map((item) => (
              <article className="category-card tone-mint" key={item.id}>
                <div className="category-card-media">
                  {item.mediaType === 'video' && item.videoUrl ? (
                    <video
                      controls
                      preload="metadata"
                      poster={item.coverUrl ?? undefined}
                      aria-label={item.altText ?? item.title}
                    >
                      <source src={item.videoUrl} />
                    </video>
                  ) : (
                    <MediaFrame
                      src={item.imageUrl}
                      alt={item.altText ?? item.title}
                      ratio="16 / 10"
                      loading="lazy"
                      fallbackLabel={t('product.imageUnavailable')}
                      fallbackSeed={item.title}
                    />
                  )}
                </div>
                <div className="category-card-body">
                  <span className="category-card-name">{item.title}</span>
                  {item.description ? (
                    <span className="muted small">{item.description}</span>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {data.process.length > 0 ? (
        <section className="section" style={{ marginTop: 0 }}>
          <div className="section-head">
            <div>
              <span className="section-kicker">{t('home.stepsKicker')}</span>
              <h2 className="section-title">{t('factoryPage.processTitle')}</h2>
            </div>
          </div>
          <div className="steps-grid factory-process-grid">
            {data.process.map((step, index) => (
              <article className="step-card" key={step.id}>
                <span className="step-index">{index + 1}</span>
                {step.imageUrl ? (
                  <MediaFrame
                    src={step.imageUrl}
                    alt={step.altText ?? step.title}
                    ratio="16 / 10"
                    loading="lazy"
                    fallbackLabel={t('product.imageUnavailable')}
                    fallbackSeed={step.title}
                  />
                ) : null}
                <h3>{step.title}</h3>
                {step.description ? <p>{step.description}</p> : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <section className="final-cta">
        <div style={{ maxWidth: '58ch' }}>
          <h2>{t('factoryPage.ctaTitle')}</h2>
          <p>{t('factoryPage.ctaBody')}</p>
          <ul className="trust-list">
            <li>
              <IconCheck size={17} />
              {t('home.factoryPoint1')}
            </li>
            <li>
              <IconCheck size={17} />
              {t('home.factoryPoint2')}
            </li>
          </ul>
        </div>
        <WhatsAppCta
          locale={locale}
          className="btn btn-whatsapp btn-lg"
          label={t('factoryPage.ctaWhatsApp')}
        />
      </section>
    </div>
  );
}
