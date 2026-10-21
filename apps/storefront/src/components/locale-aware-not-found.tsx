'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { getTranslator, localeHref } from '../lib/i18n';

export function LocaleAwareNotFound() {
  const pathname = usePathname() ?? '';
  const locale = pathname.startsWith('/zh-CN') ? 'zh-CN' : 'en-US';
  const t = getTranslator(locale).t;

  return (
    <div className="container-app state-block" style={{ minHeight: '60vh' }}>
      <strong>{t('errors.notFoundTitle')}</strong>
      <span>{t('errors.notFoundBody')}</span>
      <div className="state-actions">
        <Link className="btn" href={localeHref(locale, '/')}>
          {t('errors.backHome')}
        </Link>
        <Link className="btn btn-secondary" href={localeHref(locale, '/products')}>
          {t('catalog.title')}
        </Link>
      </div>
    </div>
  );
}
