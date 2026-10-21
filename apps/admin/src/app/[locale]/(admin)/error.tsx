'use client';

import { useParams } from 'next/navigation';
import { ErrorState } from '@b2b/ui';
import { getTranslator } from '../../../lib/i18n';

interface Props {
  error: Error & { digest?: string };
  reset: () => void;
}

/**
 * A page-level failure must not remove the shared Admin Shell (docs/16 §3.2).
 * This boundary sits below the protected layout, so navigation remains usable
 * while the current page reports a recoverable error.
 */
export default function AdminRouteError({ error, reset }: Props) {
  const params = useParams<{ locale?: string | string[] }>();
  const rawLocale = Array.isArray(params.locale) ? params.locale[0] : params.locale;
  const { t } = getTranslator(rawLocale ?? 'zh-CN');

  return (
    <ErrorState
      title={t('shell.pageErrorTitle')}
      description={t('shell.pageErrorBody')}
      retryLabel={t('common.retry')}
      onRetry={reset}
      requestId={error.digest}
      copyLabel={t('list.copy')}
      copiedLabel={t('list.copied')}
    />
  );
}
