import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ApiRequestError, storefrontApi } from '../../../lib/api';
import { getTranslator, localeHref } from '../../../lib/i18n';
import { WhatsAppCta } from '../../../components/whatsapp-cta';

// Renders the administrator-managed privacy page and any future public page.
// Unknown slugs fall through to the 404 page instead of leaking route structure.
const PAGE_TITLE_KEYS: Record<string, string> = {
  factory: 'site.nav.factory',
  quality: 'site.nav.quality',
  privacy: 'site.nav.privacy',
};
const SUPPORTED_PAGES = new Set(Object.keys(PAGE_TITLE_KEYS));

interface Props {
  params: Promise<{ locale: string; page: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, page } = await params;
  const t = getTranslator(locale).t;
  if (!SUPPORTED_PAGES.has(page)) return { title: t('errors.notFoundTitle') };
  try {
    const { data } = await storefrontApi.getContentPage(page, locale);
    return {
      title: data.seoTitle ?? data.title,
      description: data.seoDescription ?? undefined,
      alternates: { canonical: `/${locale}/${page}` },
    };
  } catch {
    return { title: t(PAGE_TITLE_KEYS[page] ?? 'errors.notFoundTitle') };
  }
}

export default async function ContentPage({ params }: Props) {
  const { locale, page } = await params;
  if (!SUPPORTED_PAGES.has(page)) notFound();
  const t = getTranslator(locale).t;

  let content;
  try {
    content = (await storefrontApi.getContentPage(page, locale)).data;
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    throw error;
  }

  const showCta = page !== 'privacy';
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
          <li aria-current="page">{content.title}</li>
        </ol>
      </nav>

      <header className="catalog-hero">
        <div>
          <span className="section-kicker">{t(PAGE_TITLE_KEYS[page] ?? 'site.nav.privacy')}</span>
          <h1>{content.title}</h1>
        </div>
      </header>

      <article className="panel">
        {content.bodyHtml ? (
          <div className="prose" dangerouslySetInnerHTML={{ __html: content.bodyHtml }} />
        ) : (
          <p className="muted">{t('content.empty')}</p>
        )}
      </article>

      {showCta ? (
        <section className="final-cta">
          <div style={{ maxWidth: '58ch' }}>
            <h2>{t('content.ctaTitle')}</h2>
            <p>{t('content.ctaBody')}</p>
          </div>
          <WhatsAppCta
            locale={locale}
            className="btn btn-whatsapp btn-lg"
            label={t('content.ctaWhatsApp')}
          />
        </section>
      ) : null}
    </div>
  );
}
