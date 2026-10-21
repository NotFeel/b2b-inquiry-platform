'use client';

import { PageHeader } from '@b2b/ui';
import { ProductForm } from '../../../../../components/product-form';
import { useBreadcrumb } from '../../../../../components/use-breadcrumb';
import { useSession } from '../../../../../components/session-provider';

/**
 * New product page (docs/24 §3.2).
 *
 * A full page instead of a narrow drawer: the product form has too many
 * grouped fields for a side panel, and the gallery needs room for thumbnails,
 * per-image alt text and its own actions.
 */
export default function NewProductPage() {
  const { t } = useSession();
  const breadcrumb = useBreadcrumb();

  return (
    <div className="stack">
      <PageHeader
        breadcrumb={breadcrumb}
        title={t('products.create')}
        description={t('products.editorHint')}
      />
      <ProductForm mode="create" detail={null} />
    </div>
  );
}
