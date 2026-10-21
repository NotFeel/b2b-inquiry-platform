'use client';

import { useCallback } from 'react';
import { useParams } from 'next/navigation';
import type { ProductAdminDetail } from '@b2b/contracts';
import { ErrorState, PageHeader, Skeleton } from '@b2b/ui';
import { ProductForm } from '../../../../../../components/product-form';
import { useBreadcrumb } from '../../../../../../components/use-breadcrumb';
import { useSession } from '../../../../../../components/session-provider';
import { translateError } from '../../../../../../lib/i18n';
import { productsApi } from '../../../../../../lib/products-api';
import { useResource } from '../../../../../../lib/use-resource';

/**
 * Product edit page (docs/24 §3.2).
 *
 * The page loads the record - translations, specification fields, tags, gallery
 * and delete states - in one request and hands it to the shared editor. Loading,
 * error and missing states are explicit, so an operator never edits a blank form
 * believing it is the stored product.
 */
export default function EditProductPage() {
  const { t, locale } = useSession();
  const breadcrumb = useBreadcrumb();
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';

  const loader = useCallback(() => productsApi.detail(id), [id]);
  const resource = useResource<ProductAdminDetail>(loader, [id], locale);

  if (resource.loading && !resource.data) {
    return (
      <div className="stack">
        <PageHeader breadcrumb={breadcrumb} title={t('products.edit')} />
        <Skeleton height={240} />
        <Skeleton height={240} />
      </div>
    );
  }

  if (resource.error || !resource.data) {
    return (
      <div className="stack">
        <PageHeader breadcrumb={breadcrumb} title={t('products.edit')} />
        <ErrorState
          title={t('common.error')}
          description={
            resource.error ? translateError(locale, resource.error) : t('errors.NOT_FOUND')
          }
          retryLabel={t('common.retry')}
          onRetry={resource.reload}
          requestId={resource.requestId}
        />
      </div>
    );
  }

  return (
    <div className="stack">
      <PageHeader
        breadcrumb={breadcrumb}
        title={resource.data.name}
        description={`${resource.data.sku} · ${t('products.editorHint')}`}
      />
      <ProductForm mode="edit" detail={resource.data} />
    </div>
  );
}
