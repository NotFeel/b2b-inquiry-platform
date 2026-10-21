import type { Metadata } from 'next';
import Link from 'next/link';
import { MediaFrame } from '@b2b/ui';
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
    const content = await storefrontApi.getQualityContent(locale);
    return {
      title: content.data.page?.seoTitle ?? content.data.page?.title ?? t('qualityPage.title'),
      description:
        content.data.page?.seoDescription ??
        htmlToPlainText(content.data.page?.bodyHtml, 160) ??
        t('qualityPage.subtitle'),
      alternates: { canonical: `/${locale}/quality` },
    };
  } catch {
    return { title: t('qualityPage.title'), description: t('qualityPage.subtitle') };
  }
}

export default async function QualityPage({ params }: Props) {
  const { locale } = await params;
  const t = getTranslator(locale).t;
  const { data } = await storefrontApi.getQualityContent(locale);
  const intro = htmlToPlainText(data.page?.bodyHtml, 900);

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
          <li aria-current="page">{t('site.nav.quality')}</li>
        </ol>
      </nav>

      <header className="catalog-hero">
        <div>
          <span className="section-kicker">{t('site.nav.quality')}</span>
          <h1>{data.page?.title ?? t('qualityPage.title')}</h1>
          <p>{intro ?? t('qualityPage.subtitle')}</p>
        </div>
      </header>

      {data.credentials.length === 0 ? (
        <div className="state-block">
          <strong>{t('qualityPage.empty')}</strong>
        </div>
      ) : (
        <section className="section" style={{ marginTop: 0 }}>
          <div className="section-head">
            <div>
              <span className="section-kicker">{t('qualityPage.credentialsTitle')}</span>
              <h2 className="section-title">{t('qualityPage.credentialsTitle')}</h2>
            </div>
          </div>
          <div className="grid-cards quality-grid">
            {data.credentials.map((credential) => (
              <article className="panel stack-sm quality-card" key={credential.id}>
                <MediaFrame
                  src={credential.imageUrl}
                  alt={credential.name}
                  ratio="4 / 3"
                  loading="lazy"
                  fallbackLabel={t('product.imageUnavailable')}
                  fallbackSeed={credential.name}
                />
                {!credential.imageUrl && credential.documentUrl ? (
                  <a
                    className="section-link quality-card-link"
                    href={credential.documentUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {t('qualityPage.openDocument')}
                  </a>
                ) : null}
                <span className="badge badge-neutral">{credential.credentialTypeLabel}</span>
                <h2 className="quality-card-title">{credential.name}</h2>
                {credential.issuer ? (
                  <p className="muted small">
                    {t('qualityPage.issuer')}: {credential.issuer}
                  </p>
                ) : null}
                {credential.description ? <p>{credential.description}</p> : null}
                <p className="small">
                  {t('qualityPage.validity')}:{' '}
                  {credential.validityType === 'perpetual'
                    ? t('qualityPage.perpetual')
                    : credential.validUntil
                      ? `${credential.validFrom ?? '—'} → ${credential.validUntil}`
                      : t('qualityPage.notSpecified')}
                </p>
                {credential.expired ? (
                  <span className="badge badge-warning">{t('qualityPage.expired')}</span>
                ) : null}
                {credential.verificationUrl ? (
                  <a
                    className="section-link quality-card-link"
                    href={credential.verificationUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {credential.verificationLabel ?? t('qualityPage.verify')}
                  </a>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
