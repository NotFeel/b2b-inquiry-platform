'use client';

import { ResourcePage } from '../../../../components/resource-page';
import type { QuoteExportJobSummary } from '@b2b/contracts';
import { JOB_STATUS_TONES, StatusTag } from '@b2b/ui';
import { useSession } from '../../../../components/session-provider';

export default function QuoteExportsPage() {
  const { t, can, locale } = useSession();
  return (
    <ResourcePage<QuoteExportJobSummary>
      title={t('nav.quotes')}
      listPath="/admin/quote-exports"
      deletePath={(row) => `/admin/quote-exports/${row.id}`}
      canDelete={can('quote.delete')}
      deleteWarning={t('documents.deleteExportConfirm')}
      rowKey={(row) => row.id}
      columns={() => [
        { key: 'template', header: t('documents.templateName'), render: (row) => row.templateName ?? '-' },
        { key: 'version', header: t('documents.version'), render: (row) => `v${row.templateVersion}` },
        { key: 'products', header: t('documents.productCount'), render: (row) => row.productCount },
        { key: 'requestedBy', header: t('documents.requestedBy'), render: (row) => row.requestedBy ?? '-' },
        {
          key: 'status',
          header: t('documents.status'),
          render: (row) => <StatusTag value={row.status} label={row.status} toneMap={JOB_STATUS_TONES} />,
        },
        {
          key: 'createdAt',
          header: t('documents.createdAt'),
          render: (row) => new Date(row.createdAt).toLocaleString(locale),
        },
        {
          key: 'file',
          header: t('documents.output'),
          render: (row) =>
            row.fileUrl && row.status === 'succeeded' ? (
              <span className="mono small">{row.fileUrl}</span>
            ) : (
              <span className="muted small">{row.errorCode ?? '-'}</span>
            ),
        },
      ]}
    />
  );
}
