'use client';

import { useParams } from 'next/navigation';
import { getTranslator } from '../../../lib/i18n';

export default function FaqError({ reset }: { error: Error; reset: () => void }) {
  const params = useParams<{ locale?: string | string[] }>();
  const rawLocale = Array.isArray(params.locale) ? params.locale[0] : params.locale;
  const t = getTranslator(rawLocale ?? 'en-US').t;

  return (
    <div className="container-app state-block" style={{ minHeight: '55vh' }}>
      <strong>{t('faq.errorTitle')}</strong>
      <span>{t('faq.errorBody')}</span>
      <button className="btn" type="button" onClick={() => reset()}>
        {t('faq.retry')}
      </button>
    </div>
  );
}
