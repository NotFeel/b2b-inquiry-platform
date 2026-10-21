'use client';

import { useParams } from 'next/navigation';
import { Skeleton } from '@b2b/ui';
import { getTranslator } from '../../../lib/i18n';

export default function FaqLoading() {
  const params = useParams<{ locale?: string | string[] }>();
  const rawLocale = Array.isArray(params.locale) ? params.locale[0] : params.locale;
  const t = getTranslator(rawLocale ?? 'en-US').t;

  return (
    <div
      className="container-app stack"
      style={{ gap: 'var(--space-6)', marginTop: 'var(--space-5)' }}
      aria-busy="true"
      aria-live="polite"
    >
      <span className="visually-hidden">{t('faq.loading')}</span>
      <Skeleton height={24} width="32%" />
      <div className="catalog-hero">
        <div className="stack" style={{ width: '100%' }}>
          <Skeleton height={16} width="18%" />
          <Skeleton height={44} width="48%" />
          <Skeleton height={18} width="72%" />
          <Skeleton height={18} width="58%" />
        </div>
      </div>
      {[0, 1, 2, 3].map((item) => (
        <Skeleton key={item} height={68} />
      ))}
    </div>
  );
}
