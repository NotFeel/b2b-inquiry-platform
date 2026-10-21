import type { Metadata } from 'next';
import Link from 'next/link';
import { FaqAccordion } from '../../../components/faq-accordion';
import { WhatsAppCta } from '../../../components/whatsapp-cta';
import { storefrontApi } from '../../../lib/api';
import { buildFaqJsonLd, groupFaqItems } from '../../../lib/faq';
import { getTranslator, localeHref } from '../../../lib/i18n';
import { isPlaceholderSiteValue } from '../../../lib/site-config';

interface Props {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = getTranslator(locale).t;
  try {
    const { data } = await storefrontApi.getSiteConfig();
    const brand = isPlaceholderSiteValue(data.companyName)
      ? t('site.brandFallback')
      : data.companyName;
    const title = `${t('faq.title')} | ${brand}`;
    return {
      title,
      description: t('faq.metaDescription'),
      alternates: { canonical: `/${locale}/faq` },
      openGraph: {
        title,
        description: t('faq.metaDescription'),
        type: 'website',
        url: `/${locale}/faq`,
      },
    };
  } catch {
    return {
      title: t('faq.title'),
      description: t('faq.metaDescription'),
      alternates: { canonical: `/${locale}/faq` },
    };
  }
}

export default async function FaqPage({ params }: Props) {
  const { locale } = await params;
  const t = getTranslator(locale).t;
  const { data } = await storefrontApi.getFaq(locale);
  const groups = groupFaqItems(data);
  const jsonLd = buildFaqJsonLd(data);

  return (
    <div
      className="container-app stack"
      style={{ gap: 'var(--space-6)', marginTop: 'var(--space-5)' }}
    >
      <nav aria-label={t('faq.breadcrumb')}>
        <ol className="breadcrumb">
          <li>
            <Link href={localeHref(locale, '/')}>{t('site.nav.home')}</Link>
          </li>
          <li aria-current="page">{t('site.nav.faq')}</li>
        </ol>
      </nav>

      <header className="catalog-hero faq-hero">
        <div>
          <span className="section-kicker">{t('faq.kicker')}</span>
          <h1>{t('faq.title')}</h1>
          <p>{t('faq.subtitle')}</p>
          <div className="faq-hero-actions">
            <WhatsAppCta
              locale={locale}
              className="btn btn-whatsapp btn-lg"
              label={t('faq.ctaWhatsApp')}
              message={t('faq.whatsappMessage')}
            />
          </div>
        </div>
      </header>

      {data.length === 0 ? (
        <div className="state-block">
          <strong>{t('faq.empty')}</strong>
          <span>{t('faq.emptyHint')}</span>
          <div className="faq-empty-actions">
            <Link className="btn" href={localeHref(locale, '/products')}>
              {t('faq.browseProducts')}
            </Link>
            <WhatsAppCta
              locale={locale}
              className="btn btn-secondary"
              label={t('faq.ctaWhatsApp')}
              message={t('faq.whatsappMessage')}
            />
          </div>
        </div>
      ) : (
        <>
          <nav className="faq-topic-nav" aria-label={t('faq.topicNavigation')}>
            {groups.map((group) => (
              <a key={group.category} href={`#faq-${group.category}`}>
                <span>{t(`faq.category.${group.category}`)}</span>
                <span aria-hidden="true">{group.items.length}</span>
              </a>
            ))}
          </nav>

          <div className="faq-sections">
            {groups.map((group, index) => {
              const headingId = `faq-${group.category}-heading`;
              return (
                <section
                  className="faq-section"
                  id={`faq-${group.category}`}
                  key={group.category}
                  aria-labelledby={headingId}
                >
                  <div className="faq-section-head">
                    <span className="section-kicker">{String(index + 1).padStart(2, '0')}</span>
                    <h2 id={headingId}>{t(`faq.category.${group.category}`)}</h2>
                    <span className="small">
                      {t('faq.questionCount', { count: group.items.length })}
                    </span>
                  </div>
                  <FaqAccordion items={group.items} />
                </section>
              );
            })}
          </div>

          <section className="final-cta">
            <div style={{ maxWidth: '58ch' }}>
              <h2>{t('faq.bottomTitle')}</h2>
              <p>{t('faq.bottomBody')}</p>
            </div>
            <WhatsAppCta
              locale={locale}
              className="btn btn-whatsapp btn-lg"
              label={t('faq.ctaWhatsApp')}
              message={t('faq.whatsappMessage')}
            />
          </section>
        </>
      )}

      {data.length > 0 ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c'),
          }}
        />
      ) : null}
    </div>
  );
}
