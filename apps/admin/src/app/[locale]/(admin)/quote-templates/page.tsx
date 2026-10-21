'use client';

import { ResourcePage } from '../../../../components/resource-page';
import type { QuoteTemplateSummary } from '@b2b/contracts';
import { useSession } from '../../../../components/session-provider';

// Templates are versioned: a new upload creates the next version so historic
// exports keep pointing at the file they used (docs/08 §2).
export default function QuoteTemplatesPage() {
  const { t, locale } = useSession();
  return (
    <ResourcePage<QuoteTemplateSummary>
      title={t('documents.quoteTemplates')}
      description={t('documents.quoteTemplatesDescription')}
      listPath="/admin/quote-templates"
      rowKey={(row) => row.id}
      columns={() => [
        { key: 'name', header: t('documents.templateName'), render: (row) => row.name },
        { key: 'type', header: t('documents.templateType'), render: (row) => row.templateType },
        { key: 'version', header: t('documents.version'), render: (row) => `v${row.version}` },
        { key: 'status', header: t('documents.status'), render: (row) => row.status },
        {
          key: 'fields',
          header: 'Mapped fields',
          render: (row) => Object.keys(row.fieldMapping ?? {}).length,
        },
        {
          key: 'updatedAt',
          header: t('documents.createdAt'),
          render: (row) => new Date(row.updatedAt).toLocaleString(locale),
        },
      ]}
    />
  );
}
