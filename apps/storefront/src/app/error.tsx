'use client';

import { usePathname } from 'next/navigation';
import { getTranslator } from '../lib/i18n';

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  const pathname = usePathname() ?? '';
  const locale = pathname.startsWith('/zh-CN') ? 'zh-CN' : 'en-US';
  const t = getTranslator(locale).t;

  return (
    <div className="container-app state-block" style={{ minHeight: '60vh' }}>
      <strong>{t('errors.pageTitle')}</strong>
      <span>{t('errors.pageBody')}</span>
      <button className="btn" type="button" onClick={() => reset()}>
        {t('errors.retry')}
      </button>
    </div>
  );
}
