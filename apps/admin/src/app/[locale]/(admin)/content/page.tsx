'use client';

import { ResourcePage } from '../../../../components/resource-page';
import type { ContentPageSummary } from '@b2b/contracts';
import { PUBLISH_STATUS_TONES, StatusTag } from '@b2b/ui';
import { useSession } from '../../../../components/session-provider';

export default function ContentPageList() {
  const { t, locale } = useSession();
  return (
    <ResourcePage<ContentPageSummary>
      title={t('nav.content')}
      description={t('content.description')}
      listPath="/admin/content/pages"
      rowKey={(row) => row.id}
      columns={() => [
        {
          key: 'slug',
          header: t('content.slug'),
          render: (row) => <span className="mono">{row.slug}</span>,
        },
        { key: 'type', header: t('content.pageType'), render: (row) => row.pageType },
        {
          key: 'title',
          header: t('content.pageTitle'),
          render: (row) => row.translations['en-US']?.title ?? '-',
        },
        {
          key: 'status',
          header: t('documents.status'),
          render: (row) => (
            <StatusTag value={row.status} label={row.status} toneMap={PUBLISH_STATUS_TONES} />
          ),
        },
        {
          key: 'updatedAt',
          header: t('common.updatedAt'),
          render: (row) => new Date(row.updatedAt).toLocaleString(locale),
        },
      ]}
    />
  );
}
