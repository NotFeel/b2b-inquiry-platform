'use client';

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import type { CategoryNode } from '@b2b/contracts';
import { Button, Input, Select } from '@b2b/ui';
import { CategoryPicker } from './category-picker';
import { useSession } from './session-provider';
import { categoriesApi } from '../lib/categories-api';
import { quotationOrderApi, type CalculatorProduct } from '../lib/quotation-order-api';

export function QuotationProductPickerDialog({
  alreadyAddedIds,
  publishStatusOptions,
  lifecycleStatusOptions,
  onClose,
  onAdd,
}: {
  alreadyAddedIds: ReadonlySet<string>;
  publishStatusOptions: { code: string; label: string }[];
  lifecycleStatusOptions: { code: string; label: string }[];
  onClose: () => void;
  onAdd: (products: CalculatorProduct[]) => void;
}) {
  const { locale, t } = useSession();
  const [categories, setCategories] = useState<CategoryNode[]>([]);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [publishStatus, setPublishStatus] = useState<'published' | 'unpublished' | ''>('');
  const [products, setProducts] = useState<CalculatorProduct[]>([]);
  const [selected, setSelected] = useState<Map<string, CalculatorProduct>>(new Map());
  const [loading, setLoading] = useState(true);
  const [categoryLoading, setCategoryLoading] = useState(true);
  const [retryCount, setRetryCount] = useState(0);
  const [error, setError] = useState('');
  const [categoryError, setCategoryError] = useState('');

  useEffect(() => {
    let active = true;
    setCategoryLoading(true);
    void categoriesApi
      // Keep disabled ancestors in the tree as context; the picker marks them
      // unselectable while still allowing enabled descendants to be chosen.
      .tree({ locale, status: 'all' })
      .then((rows) => {
        if (active) setCategories(rows);
      })
      .catch((cause: unknown) => {
        if (active)
          setCategoryError(cause instanceof Error ? cause.message : t('quotationCenter.loadError'));
      })
      .finally(() => {
        if (active) setCategoryLoading(false);
      });
    return () => {
      active = false;
    };
  }, [locale, t]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    const timer = window.setTimeout(() => {
      void quotationOrderApi
        .products(locale, query.trim(), categoryId, publishStatus || undefined)
        .then((rows) => {
          if (active) setProducts(rows);
        })
        .catch((cause: unknown) => {
          if (active)
            setError(cause instanceof Error ? cause.message : t('quotationCenter.loadError'));
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [categoryId, locale, publishStatus, query, retryCount, t]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const selectedCount = selected.size;
  const publishStatusLabels = useMemo(
    () => new Map(publishStatusOptions.map((option) => [option.code, option.label])),
    [publishStatusOptions],
  );
  const lifecycleStatusLabels = useMemo(
    () => new Map(lifecycleStatusOptions.map((option) => [option.code, option.label])),
    [lifecycleStatusOptions],
  );
  const selectablePublishStatuses = useMemo(
    () => publishStatusOptions.filter((option) => option.code !== 'draft'),
    [publishStatusOptions],
  );

  const toggleProduct = (product: CalculatorProduct, checked: boolean) => {
    setSelected((current) => {
      const next = new Map(current);
      if (checked) next.set(product.id, product);
      else next.delete(product.id);
      return next;
    });
  };

  return (
    <div
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        // The shared CategoryPicker portals its popover at the modal layer.
        // Keep this dialog one layer below so the category tree can render and
        // receive pointer events above this dialog.
        zIndex: 'calc(var(--z-modal) - 1)',
        display: 'grid',
        placeItems: 'center',
        background: 'rgb(0 0 0 / 45%)',
        padding: '12px',
      }}
    >
      <section
        aria-labelledby="quotation-product-picker-title"
        aria-modal="true"
        role="dialog"
        className="panel stack-sm"
        style={{
          width: 'min(100%, 1080px)',
          maxHeight: 'min(92dvh, 900px)',
          overflow: 'auto',
          boxShadow: 'var(--shadow-popover)',
        }}
      >
        <div className="row-between">
          <h2 id="quotation-product-picker-title">{t('quotationCenter.productPickerTitle')}</h2>
          <Button
            variant="secondary"
            onClick={onClose}
            aria-label={t('quotationCenter.closePicker')}
          >
            {t('quotationCenter.closePicker')}
          </Button>
        </div>
        <div className="form-grid">
          <label className="field">
            <span className="field-label">{t('quotationCenter.categoryFilter')}</span>
            <CategoryPicker
              nodes={categories}
              value={categoryId}
              mode="filter"
              loading={categoryLoading}
              errorLabel={categoryError || null}
              onRetry={() => {
                setCategoryLoading(true);
                setCategoryError('');
                void categoriesApi
                  .tree({ locale, status: 'all' })
                  .then(setCategories)
                  .catch((cause: unknown) =>
                    setCategoryError(
                      cause instanceof Error ? cause.message : t('quotationCenter.loadError'),
                    ),
                  )
                  .finally(() => setCategoryLoading(false));
              }}
              onChange={setCategoryId}
            />
          </label>
          <label className="field">
            <span className="field-label">{t('quotationCenter.productSearch')}</span>
            <Input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('quotationCenter.productSearchPlaceholder')}
              aria-label={t('quotationCenter.productSearch')}
              maxLength={120}
            />
          </label>
          <label className="field">
            <span className="field-label">{t('quotationCenter.publishStatusFilter')}</span>
            <Select
              value={publishStatus}
              options={[
                { value: '', label: t('quotationCenter.allNonDraftProducts') },
                ...selectablePublishStatuses.map((option) => ({
                  value: option.code,
                  label: option.label,
                })),
              ]}
              onChange={(event) =>
                setPublishStatus(event.target.value as 'published' | 'unpublished' | '')
              }
            />
          </label>
        </div>
        {error ? (
          <div role="alert" className="alert alert-error">
            <p>{error}</p>
            <Button variant="secondary" onClick={() => setRetryCount((count) => count + 1)}>
              {t('quotationCenter.retryProducts')}
            </Button>
          </div>
        ) : null}
        <div className="table-scroll" style={{ maxHeight: '55dvh', overflow: 'auto' }}>
          <table style={{ minWidth: '720px', width: '100%' }}>
            <thead>
              <tr>
                <th scope="col">
                  <span className="sr-only">{t('quotationCenter.selectProduct')}</span>
                </th>
                <th scope="col">{t('quotationCenter.productImage')}</th>
                <th scope="col">SKU</th>
                <th scope="col">{t('quotationCenter.productName')}</th>
                <th scope="col">{t('quotationCenter.internalPrice')}</th>
                <th scope="col">{t('quotationCenter.publishStatusLabel')}</th>
                <th scope="col">{t('quotationCenter.lifecycleStatusLabel')}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} aria-live="polite">
                    {t('quotationCenter.loadingProducts')}
                  </td>
                </tr>
              ) : products.length === 0 ? (
                <tr>
                  <td colSpan={7}>{t('quotationCenter.noProducts')}</td>
                </tr>
              ) : (
                products.map((product) => {
                  const alreadyAdded = alreadyAddedIds.has(product.id);
                  const checked = alreadyAdded || selected.has(product.id);
                  return (
                    <tr key={product.id}>
                      <td>
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={alreadyAdded}
                          onChange={(event) => toggleProduct(product, event.target.checked)}
                          aria-label={t('quotationCenter.selectSku', { sku: product.sku })}
                        />
                      </td>
                      <td>
                        {product.imageUrl ? (
                          <Image
                            src={product.imageUrl}
                            alt={product.imageAlt}
                            width={48}
                            height={48}
                            unoptimized
                            style={{ objectFit: 'cover', borderRadius: 'var(--radius-sm)' }}
                          />
                        ) : (
                          <span aria-label={t('quotationCenter.noImage')}>—</span>
                        )}
                      </td>
                      <td>{product.sku}</td>
                      <td>{product.name}</td>
                      <td>{product.costCny === null ? '—' : `¥${product.costCny}`}</td>
                      <td>
                        {publishStatusLabels.get(product.publishStatus) ?? product.publishStatus}
                      </td>
                      <td>
                        {lifecycleStatusLabels.get(product.lifecycleStatus) ??
                          product.lifecycleStatus}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="row-between">
          <p aria-live="polite">
            {t('quotationCenter.selectedProducts', { count: selectedCount })}
          </p>
          <div className="button-row">
            <Button variant="secondary" onClick={onClose}>
              {t('quotationCenter.cancelPicker')}
            </Button>
            <Button
              disabled={selectedCount === 0}
              onClick={() => {
                onAdd([...selected.values()]);
                onClose();
              }}
            >
              {t('quotationCenter.addSelected')}
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
