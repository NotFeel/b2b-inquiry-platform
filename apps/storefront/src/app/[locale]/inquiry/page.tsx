import type { Metadata } from 'next';
import { InquiryPanel } from '../../../components/inquiry-list';
import { storefrontApi } from '../../../lib/api';
import { getTranslator } from '../../../lib/i18n';

interface Props {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = getTranslator(locale).t;
  return {
    title: t('inquiry.title'),
    description: t('inquiry.subtitle'),
    // The inquiry list is a per-visitor tool and must not be indexed.
    robots: { index: false, follow: false },
  };
}

export default async function InquiryPage({ params }: Props) {
  const { locale } = await params;
  const t = getTranslator(locale).t;
  const config = await storefrontApi.getSiteConfig();

  return (
    <div className="container-app stack" style={{ gap: 'var(--space-5)', marginTop: 'var(--space-6)' }}>
      <header>
        <h1 className="section-title">{t('inquiry.title')}</h1>
        <p className="section-subtitle">{t('inquiry.subtitle')}</p>
      </header>
      <InquiryPanel locale={locale} whatsappNumber={config.data.whatsappNumber} />
    </div>
  );
}
