'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { PublicHomepageProductBatch } from '@b2b/contracts';
import { loadMoreHomepageSection } from '../lib/homepage-actions';
import { mergeHomepageProducts } from '../lib/homepage';
import { getTranslator } from '../lib/i18n';
import { ProductCard } from './product-card';

interface BaseProps {
  locale: string;
  sectionId: string;
  title: string;
  subtitle?: string | null;
  initialBatch: PublicHomepageProductBatch;
  displayLimit: number;
  theme?: 'pink' | 'mint' | 'yellow' | 'lavender';
}

type Props = BaseProps &
  (
    | { kind: 'new-arrivals' }
    | {
        kind: 'collection';
        collectionId: string;
        viewAllHref: string;
        viewAllLabel: string;
      }
  );

/**
 * Independent homepage rail with its own cursor, loading, error and retry
 * state. The component only consumes the public price-free product DTO.
 */
export function HomepageProductSection(props: Props) {
  const t = getTranslator(props.locale).t;
  const [products, setProducts] = useState(props.initialBatch.products);
  const [cursor, setCursor] = useState(props.initialBatch.nextCursor);
  const [hasMore, setHasMore] = useState(props.initialBatch.hasMore);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  async function loadMore() {
    if (!cursor || loading || !hasMore) return;
    setLoading(true);
    setFailed(false);

    try {
      const request =
        props.kind === 'new-arrivals'
          ? ({ kind: 'new-arrivals', locale: props.locale, cursor } as const)
          : ({ kind: 'collection', id: props.collectionId, locale: props.locale, cursor } as const);
      const result = await loadMoreHomepageSection(request);
      if (!result.ok) {
        setFailed(true);
        return;
      }

      const merged = mergeHomepageProducts(products, result.batch.products, props.displayLimit);
      setProducts(merged);
      setCursor(result.batch.nextCursor);
      setHasMore(
        result.batch.hasMore &&
          result.batch.nextCursor !== null &&
          result.batch.products.length > 0 &&
          merged.length < props.displayLimit,
      );
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }

  const headingId = `homepage-section-${props.sectionId}`;

  return (
    <section
      className="section homepage-section"
      data-theme={props.theme ?? 'pink'}
      aria-labelledby={headingId}
      aria-busy={loading}
    >
      <div className="container-products">
        <header className="homepage-section-head">
          <h2 className="homepage-section-title" id={headingId}>
            {props.title}
          </h2>
          {props.subtitle ? (
            <p className="homepage-section-subtitle">{props.subtitle}</p>
          ) : null}
          <span className="homepage-section-ornament" aria-hidden="true">
            ✦
          </span>
        </header>

        <div className="product-grid">
          {products.map((product) => (
            <ProductCard key={product.sku} product={product} locale={props.locale} />
          ))}
        </div>

        <div className="homepage-section-actions">
          {failed ? (
            <p className="homepage-section-error" role="alert">
              {t('home.loadMoreError')}
            </p>
          ) : null}

          {hasMore ? (
            <button
              type="button"
              className="btn btn-secondary homepage-load-more"
              onClick={loadMore}
              disabled={loading}
              aria-label={t('home.loadMoreAria', { title: props.title })}
            >
              {loading
                ? t('home.loadingMore')
                : failed
                  ? t('home.retryLoadMore')
                  : t('home.loadMore')}
            </button>
          ) : null}

          {props.kind === 'collection' ? (
            <Link className="btn btn-primary homepage-view-all" href={props.viewAllHref}>
              {props.viewAllLabel}
            </Link>
          ) : null}
        </div>
      </div>
    </section>
  );
}
