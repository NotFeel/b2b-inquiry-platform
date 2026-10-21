'use client';

import Link from 'next/link';
import type { PublicProductCard } from '@b2b/contracts';
import { CopyButton, IconArrowRight, MediaFrame } from '@b2b/ui';
import { getTranslator, localeHref } from '../lib/i18n';
import { SelectProductButton, useInquiry } from './inquiry-list';

interface Props {
  product: PublicProductCard;
  locale: string;
}

// Catalogue card (docs/16 §6.5): square image, badges, multi-select checkbox,
// 2-line title, SKU with copy, 2-line summary, key meta line, two light actions.
// Rendering a price is impossible here: PublicProductCard has no price field.
export function ProductCard({ product, locale }: Props) {
  const t = getTranslator(locale).t;
  const { has } = useInquiry();
  const selected = has(product.sku);

  const badges = [
    product.isFeatured
      ? { key: 'featured', label: t('badges.featured'), tone: 'badge-brand' }
      : null,
    product.isNew ? { key: 'new', label: t('badges.new'), tone: 'badge-info' } : null,
    product.isPreOrder || product.lifecycleStatus === 'preorder'
      ? { key: 'preorder', label: t('badges.preorder'), tone: 'badge-warning' }
      : null,
  ].filter((badge): badge is { key: string; label: string; tone: string } => badge !== null);

  const extraTags = product.tags.filter(
    (tag) => !['featured', 'new-arrival', 'preorder'].includes(tag.code),
  );
  const allBadges = [
    ...badges,
    ...extraTags.map((tag) => ({
      key: tag.code,
      label: tag.label || tag.code,
      tone: 'badge-neutral',
    })),
  ];
  // Two labels plus an overflow counter stay readable in two-column mobile cards.
  const visibleBadges = allBadges.slice(0, 2);
  const remainingBadges = Math.max(0, allBadges.length - visibleBadges.length);

  const inquiryItem = {
    sku: product.sku,
    name: product.name,
    slug: product.slug,
    imageUrl: product.coverImage?.url ?? null,
  };

  return (
    <article className="product-card" data-selected={selected}>
      <div className="product-card-media">
        <MediaFrame
          src={product.coverImage?.url ?? null}
          alt={product.coverImage?.alt || product.name}
          ratio="1 / 1"
          fit="contain"
          loading="lazy"
          fallbackLabel={t('product.imageUnavailable')}
          fallbackSeed={`${product.sku} ${product.name}`}
        />
        <div className="product-card-badges">
          {visibleBadges.map((badge) => (
            <span key={badge.key} className={`badge ${badge.tone}`}>
              {badge.label}
            </span>
          ))}
          {remainingBadges > 0 ? (
            <span
              className="badge badge-neutral"
              title={allBadges.map((badge) => badge.label).join(', ')}
            >
              +{remainingBadges}
            </span>
          ) : null}
        </div>
        <span className="product-card-check" aria-hidden="true">
          <span className={selected ? 'product-card-check-dot is-on' : 'product-card-check-dot'} />
        </span>
      </div>

      <div className="product-card-body">
        <h3 className="product-card-title clamp-2">
          <Link href={localeHref(locale, `/products/${product.slug}`)} title={product.name}>
            {product.name}
          </Link>
        </h3>

        <span className="product-card-sku">
          <code title={product.sku}>{product.sku}</code>
          <CopyButton
            value={product.sku}
            label={t('product.copySku')}
            copiedLabel={t('product.copied')}
            size={14}
          />
        </span>

        {product.summary ? <p className="product-card-summary clamp-2">{product.summary}</p> : null}

        <div className="product-card-meta">
          {product.category ? <span>{product.category.name}</span> : null}
          {product.isPreOrder || product.lifecycleStatus === 'preorder' ? (
            <span>{t('badges.preorder')}</span>
          ) : null}
        </div>
      </div>

      <div className="product-card-actions">
        <Link
          className="btn btn-secondary btn-sm"
          href={localeHref(locale, `/products/${product.slug}`)}
        >
          <span>{t('product.details')}</span>
          <IconArrowRight size={15} />
        </Link>
        <SelectProductButton item={inquiryItem} variant="primary" />
      </div>
    </article>
  );
}
