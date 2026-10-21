import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { IconWhatsApp } from '@b2b/ui';
import { DetailActions } from '../../../../components/detail-actions';
import { ProductGallery } from '../../../../components/product-gallery';
import { ApiRequestError, storefrontApi } from '../../../../lib/api';
import { getTranslator, localeHref } from '../../../../lib/i18n';

interface Props {
  params: Promise<{ locale: string; slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  try {
    const { data } = await storefrontApi.getProduct(slug, locale);
    return {
      title: `${data.name} (${data.sku})`,
      description: data.summary ?? undefined,
      alternates: { canonical: `/${locale}/products/${slug}` },
      openGraph: {
        title: data.name,
        description: data.summary ?? undefined,
        type: 'website',
        images: data.coverImage ? [data.coverImage.url] : undefined,
      },
    };
  } catch {
    return { title: 'Product' };
  }
}

export default async function ProductDetailPage({ params }: Props) {
  const { locale, slug } = await params;
  const t = getTranslator(locale).t;

  let product;
  try {
    product = (await storefrontApi.getProduct(slug, locale)).data;
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    throw error;
  }

  const { specs } = product;
  const dimensions =
    specs.lengthMm || specs.widthMm || specs.heightMm
      ? `${formatDimensionCm(specs.lengthMm)} × ${formatDimensionCm(specs.widthMm)} × ${formatDimensionCm(specs.heightMm)} cm`
      : null;
  const cartonSize =
    specs.cartonLengthCm || specs.cartonWidthCm || specs.cartonHeightCm
      ? `${specs.cartonLengthCm ?? '-'} × ${specs.cartonWidthCm ?? '-'} × ${specs.cartonHeightCm ?? '-'} cm`
      : null;
  const specRows = [
    product.category ? { label: t('catalog.categories'), value: product.category.name } : null,
    dimensions ? { label: t('product.dimensions'), value: dimensions } : null,
    specs.weightGrams ? { label: t('product.weight'), value: `${specs.weightGrams} g` } : null,
    cartonSize ? { label: t('product.cartonSize'), value: cartonSize } : null,
    specs.cartonWeightKg
      ? { label: t('product.cartonWeight'), value: `${specs.cartonWeightKg} kg` }
      : null,
    specs.cartonQuantity
      ? { label: t('product.cartonQty'), value: String(specs.cartonQuantity) }
      : null,
  ].filter((row): row is { label: string; value: string } => row !== null);

  const hasPackaging = Boolean(
    specs.packaging || specs.cartonLengthCm || specs.cartonQuantity || specs.cartonWeightKg,
  );
  const publicBaseUrl = process.env.APP_BASE_URL ?? 'http://localhost:3000';

  // Structured data carries catalogue facts only - no price or offer element.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    sku: product.sku,
    description: product.summary ?? undefined,
    image: product.images.map((image) => image.url),
    category: product.category?.name,
    url: `${publicBaseUrl.replace(/\/+$/, '')}/${locale}/products/${product.slug}`,
  };

  return (
    <div className="container-app has-mobile-cta" style={{ marginTop: 'var(--space-5)' }}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <nav aria-label="Breadcrumb">
        <ol className="breadcrumb">
          <li>
            <Link href={localeHref(locale, '/')}>{t('site.nav.home')}</Link>
          </li>
          <li>
            <Link href={localeHref(locale, '/products')}>{t('site.nav.products')}</Link>
          </li>
          {product.breadcrumb.map((crumb) => (
            <li key={crumb.id}>
              <Link href={localeHref(locale, `/categories/${crumb.slug}`)}>{crumb.name}</Link>
            </li>
          ))}
          <li aria-current="page">{product.name}</li>
        </ol>
      </nav>

      <div className="detail-layout" style={{ marginTop: 'var(--space-5)' }}>
        <ProductGallery
          images={product.images.map((image) => ({
            url: image.url,
            alt: image.alt || product.name,
            width: image.width,
            height: image.height,
            variants: image.variants,
          }))}
          labels={{
            empty: t('product.imageUnavailable'),
            previous: t('product.gallery.previous'),
            next: t('product.gallery.next'),
            zoom: t('product.gallery.zoom'),
            close: t('common.close'),
          }}
        />

        <div className="detail-info">
          <div className="badge-stack">
            {product.isFeatured ? (
              <span className="badge badge-brand">{t('badges.featured')}</span>
            ) : null}
            {product.isNew ? <span className="badge badge-info">{t('badges.new')}</span> : null}
            {product.isPreOrder || product.lifecycleStatus === 'preorder' ? (
              <span className="badge badge-warning">{t('badges.preorder')}</span>
            ) : null}
            {product.tags
              .filter((tag) => !['featured', 'new-arrival', 'preorder'].includes(tag.code))
              .map((tag) => (
                <span key={tag.code} className="badge badge-neutral">
                  {tag.label || tag.code}
                </span>
              ))}
          </div>

          <h1 className="detail-title">{product.name}</h1>

          <span className="detail-sku">
            <span>{t('product.sku')}:</span>
            <code>{product.sku}</code>
          </span>

          {product.summary ? <p className="muted">{product.summary}</p> : null}

          <div className="notice">
            <span className="row-tight">
              <IconWhatsApp size={16} />
              {t('product.priceNotice')}
            </span>
          </div>

          <DetailActions
            locale={locale}
            item={{
              sku: product.sku,
              name: product.name,
              slug: product.slug,
              imageUrl: product.images[0]?.url ?? product.coverImage?.url ?? null,
              imageVariants: product.images[0]?.variants ?? product.coverImage?.variants ?? [],
            }}
          />
        </div>
      </div>

      <div className="detail-sections" style={{ marginTop: 'var(--space-8)' }}>
        {product.description ? (
          <section className="detail-description">
            <h2 className="detail-section-title">{t('product.description')}</h2>
            <div className="prose" dangerouslySetInnerHTML={{ __html: product.description }} />
          </section>
        ) : null}

        <section className="detail-spec-panel">
          <h2 className="detail-section-title">{t('product.specs')}</h2>
          {specRows.length > 0 ? (
            <dl className="spec-list">
              {specRows.map((row) => (
                <div className="spec-row" key={row.label}>
                  <dt>{row.label}</dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="muted small">{t('product.specsEmpty')}</p>
          )}
        </section>

        <section className="detail-packaging-panel detail-description">
          <h2 className="detail-section-title">{t('product.packaging')}</h2>
          {hasPackaging ? (
            <dl className="spec-list">
              {specs.packaging ? (
                <div className="spec-row">
                  <dt>{t('product.packaging')}</dt>
                  <dd>{specs.packaging}</dd>
                </div>
              ) : null}
              {cartonSize ? (
                <div className="spec-row">
                  <dt>{t('product.carton')}</dt>
                  <dd>{cartonSize}</dd>
                </div>
              ) : null}
              {specs.cartonQuantity ? (
                <div className="spec-row">
                  <dt>{t('product.cartonQty')}</dt>
                  <dd>{specs.cartonQuantity} pcs</dd>
                </div>
              ) : null}
              {specs.cartonWeightKg ? (
                <div className="spec-row">
                  <dt>{t('product.cartonWeight')}</dt>
                  <dd>{specs.cartonWeightKg} kg</dd>
                </div>
              ) : null}
            </dl>
          ) : (
            <p className="muted small">{t('product.packagingEmpty')}</p>
          )}
        </section>
      </div>
    </div>
  );
}

/**
 * Product dimensions are persisted as canonical millimetres but presented to
 * customers in centimetres, matching the admin editor (docs/24 §3.3 C).
 */
function formatDimensionCm(value: number | null | undefined): string {
  if (value === null || value === undefined) return '-';
  const centimetres = value / 10;
  return Number.isInteger(centimetres) ? String(centimetres) : centimetres.toFixed(1);
}
