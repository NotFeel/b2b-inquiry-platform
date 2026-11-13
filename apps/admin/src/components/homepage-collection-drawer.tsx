'use client';

import Image from 'next/image';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CategoryNode, HomepageCollectionDetail } from '@b2b/contracts';
import {
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  Drawer,
  Field,
  Input,
  LoadingState,
  Pagination,
  Textarea,
  useToast,
} from '@b2b/ui';
import { AdminApiError } from '../lib/admin-api';
import {
  HOMEPAGE_SUBTITLE_MAX,
  HOMEPAGE_TITLE_MAX,
  addHomepageProduct,
  emptyHomepageCollectionForm,
  fromHomepageCollectionDetail,
  hasHomepageCollectionFormErrors,
  isHomepageCategoryLocked,
  isHomepageCollectionFormDirty,
  moveHomepageProduct,
  removeHomepageProduct,
  selectedProductsFromDetail,
  shouldReloadHomepageDetailForLocaleChange,
  toCreateCollectionPayload,
  toHomepageProductsPayload,
  toUpdateCollectionPayload,
  validateHomepageCollectionForm,
  type HomepageCollectionFormErrors,
  type HomepageCollectionFormValues,
  type HomepageLocale,
} from '../lib/homepage-form';
import { homepageManagementApi, type HomepageSafeProduct } from '../lib/homepage-management-api';
import { findNode, pathLabel } from '../lib/category-tree-state';
import { translateError } from '../lib/i18n';
import { CategoryPicker } from './category-picker';
import { useSession } from './session-provider';

const PRODUCT_PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 250;

export interface HomepageCollectionDrawerProps {
  open: boolean;
  collectionId: string | null;
  categories: CategoryNode[];
  categoryLoading: boolean;
  categoryError: string | null;
  nextSortOrder: number;
  onRetryCategories: () => void;
  onClose: () => void;
  onSaved: () => void;
  onCreated: (id: string) => void;
  onDirtyChange: (dirty: boolean) => void;
}

interface ProductSearchPage {
  data: HomepageSafeProduct[];
  page: number;
  total: number;
  totalPages: number;
}

const EMPTY_SEARCH_PAGE: ProductSearchPage = {
  data: [],
  page: 1,
  total: 0,
  totalPages: 0,
};

/**
 * Create/edit workbench for one Homepage Collection (docs/45 stage E).
 *
 * Metadata and the complete selected-product order are separate explicit
 * writes. This avoids silently saving an unconfirmed product replacement while
 * still reusing the Stage C endpoints, RBAC checks, transactions and audit log.
 */
export function HomepageCollectionDrawer({
  open,
  collectionId,
  categories,
  categoryLoading,
  categoryError,
  nextSortOrder,
  onRetryCategories,
  onClose,
  onSaved,
  onCreated,
  onDirtyChange,
}: HomepageCollectionDrawerProps) {
  const { t, locale, can } = useSession();
  const toast = useToast();
  const canReadCategories = can('category.read');
  const canReadProducts = can('product.read');
  const canCreate = can('homepage.collection.create');
  const canUpdate = can('homepage.collection.update');
  const canUpdateProducts = can('homepage.product.update');

  const [detail, setDetail] = useState<HomepageCollectionDetail | null>(null);
  const [values, setValues] = useState<HomepageCollectionFormValues>(() =>
    emptyHomepageCollectionForm(),
  );
  const [initialValues, setInitialValues] = useState<HomepageCollectionFormValues>(() =>
    emptyHomepageCollectionForm(),
  );
  const [selectedProducts, setSelectedProducts] = useState<HomepageSafeProduct[]>([]);
  const [initialProductIds, setInitialProductIds] = useState<string[]>([]);
  const [expectedUpdatedAt, setExpectedUpdatedAt] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadRequestId, setLoadRequestId] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [errors, setErrors] = useState<HomepageCollectionFormErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [conflicted, setConflicted] = useState(false);
  const [metadataBusy, setMetadataBusy] = useState(false);
  const [productsBusy, setProductsBusy] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);

  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [searchPage, setSearchPage] = useState(1);
  const [searchResult, setSearchResult] = useState<ProductSearchPage>(EMPTY_SEARCH_PAGE);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selectionError, setSelectionError] = useState<string | null>(null);

  const loadedLocaleRef = useRef<string | null>(null);
  const sessionRef = useRef<{
    open: boolean;
    collectionId: string | null;
    reloadToken: number;
  } | null>(null);

  const metadataDirty = isHomepageCollectionFormDirty(values, initialValues);
  const currentProductIds = selectedProducts.map((product) => product.id);
  const productsDirty =
    currentProductIds.length !== initialProductIds.length ||
    currentProductIds.some((id, index) => id !== initialProductIds[index]);
  const draftDirty = metadataDirty || productsDirty;
  const draftDirtyRef = useRef(draftDirty);
  draftDirtyRef.current = draftDirty;

  const applyLoadedDetail = useCallback((loaded: HomepageCollectionDetail) => {
    const nextValues = fromHomepageCollectionDetail(loaded);
    setDetail(loaded);
    setValues(nextValues);
    setInitialValues(nextValues);
    setSelectedProducts(selectedProductsFromDetail(loaded));
    setInitialProductIds(loaded.products.map((product) => product.productId));
    setExpectedUpdatedAt(loaded.updatedAt);
  }, []);

  useEffect(() => {
    if (!open) {
      sessionRef.current = null;
      loadedLocaleRef.current = null;
      return undefined;
    }

    const previousSession = sessionRef.current;
    const localeOnlyRefresh =
      previousSession?.open === true &&
      previousSession.collectionId === collectionId &&
      previousSession.reloadToken === reloadToken &&
      !shouldReloadHomepageDetailForLocaleChange({
        loadedLocale: loadedLocaleRef.current,
        nextLocale: locale,
        draftDirty: draftDirtyRef.current,
      });
    sessionRef.current = { open, collectionId, reloadToken };

    if (localeOnlyRefresh) {
      // The Page resource refreshes category labels for the new locale. Keep
      // metadata, selected IDs, ordering, search state and concurrency token.
      loadedLocaleRef.current = locale;
      return undefined;
    }

    setErrors({});
    setServerError(null);
    setRequestId(null);
    setConflicted(false);
    setSelectionError(null);
    setQuery('');
    setDebouncedQuery('');
    setSearchPage(1);
    setSearchResult(EMPTY_SEARCH_PAGE);
    setSearchError(null);

    if (!collectionId) {
      const empty = emptyHomepageCollectionForm();
      setDetail(null);
      setValues(empty);
      setInitialValues(empty);
      setSelectedProducts([]);
      setInitialProductIds([]);
      setExpectedUpdatedAt(null);
      setLoading(false);
      setLoadError(null);
      setLoadRequestId(null);
      loadedLocaleRef.current = locale;
      return undefined;
    }

    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setLoadRequestId(null);
    void homepageManagementApi
      .getCollection(collectionId, locale)
      .then((loaded) => {
        if (!cancelled) {
          applyLoadedDetail(loaded);
          loadedLocaleRef.current = locale;
        }
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setLoadError(caught instanceof AdminApiError ? caught.code : 'INTERNAL_ERROR');
        setLoadRequestId(caught instanceof AdminApiError ? (caught.requestId ?? null) : null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [applyLoadedDetail, collectionId, locale, open, reloadToken]);

  useEffect(() => {
    onDirtyChange(open && draftDirty);
  }, [draftDirty, onDirtyChange, open]);

  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  useEffect(() => {
    if (!open) return undefined;
    const timer = window.setTimeout(() => {
      setDebouncedQuery(query.trim());
      setSearchPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [open, query]);

  useEffect(() => {
    if (!open || !detail?.id || !detail.categoryId || !canReadProducts) {
      setSearchLoading(false);
      setSearchResult(EMPTY_SEARCH_PAGE);
      return undefined;
    }

    let cancelled = false;
    setSearchLoading(true);
    setSearchError(null);
    void homepageManagementApi
      .searchProducts({
        categoryId: detail.categoryId,
        q: debouncedQuery,
        page: searchPage,
        pageSize: PRODUCT_PAGE_SIZE,
      })
      .then((result) => {
        if (cancelled) return;
        setSearchResult({
          data: result.data,
          page: result.pagination.page,
          total: result.pagination.total,
          totalPages: result.pagination.totalPages,
        });
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setSearchError(caught instanceof AdminApiError ? caught.code : 'INTERNAL_ERROR');
      })
      .finally(() => {
        if (!cancelled) setSearchLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [canReadProducts, debouncedQuery, detail?.categoryId, detail?.id, open, searchPage]);

  const selectedIds = useMemo(
    () => new Set(selectedProducts.map((product) => product.id)),
    [selectedProducts],
  );

  const categoryLocked = isHomepageCategoryLocked(
    detail?.products.length ?? 0,
    selectedProducts.length,
  );
  const selectedCategory = values.categoryId ? findNode(categories, values.categoryId) : null;
  const selectedCategoryPath = values.categoryId
    ? pathLabel(categories, values.categoryId, locale)
    : null;

  const setTranslation = (
    targetLocale: HomepageLocale,
    field: 'title' | 'subtitle',
    value: string,
  ) => {
    setValues((current) => ({
      ...current,
      translations: {
        ...current.translations,
        [targetLocale]: {
          ...current.translations[targetLocale],
          [field]: value,
        },
      },
    }));
  };

  const requestClose = () => {
    if (metadataBusy || productsBusy) return;
    if (metadataDirty || productsDirty) {
      setDiscardOpen(true);
      return;
    }
    onClose();
  };

  const reloadServerVersion = () => {
    setDiscardOpen(false);
    setReloadToken((token) => token + 1);
  };

  const handleFailure = (caught: unknown) => {
    if (caught instanceof AdminApiError) {
      const isConflict =
        caught.code === 'HOMEPAGE_COLLECTION_CONCURRENT_UPDATE' ||
        caught.code === 'HOMEPAGE_CONFIG_CONCURRENT_UPDATE';
      setConflicted(isConflict);
      setServerError(translateError(locale, caught.code));
      setRequestId(caught.requestId ?? null);
      return;
    }
    setConflicted(false);
    setServerError(t('errors.INTERNAL_ERROR'));
    setRequestId(null);
  };

  const submitMetadata = async () => {
    if (!canReadCategories || !canReadProducts) return;
    if (collectionId ? !canUpdate : !canCreate) return;

    const validation = validateHomepageCollectionForm(values, {
      selectedProductCount: selectedProducts.length,
    });
    if (categoryLocked && values.categoryId !== initialValues.categoryId) {
      validation.categoryId = 'homepage.validation.categoryLocked';
    }
    setErrors(validation);
    setServerError(null);
    setRequestId(null);
    if (hasHomepageCollectionFormErrors(validation)) return;
    if (collectionId && !expectedUpdatedAt) {
      setServerError(t('homepage.validation.concurrentTokenMissing'));
      return;
    }

    setMetadataBusy(true);
    try {
      if (!detail?.id) {
        const created = await homepageManagementApi.createCollection(
          toCreateCollectionPayload(values, nextSortOrder),
        );
        applyLoadedDetail(created);
        toast.success(t('homepage.collection.created'));
        onCreated(created.id);
        onSaved();
      } else {
        const updated = await homepageManagementApi.updateCollection(detail.id, {
          ...toUpdateCollectionPayload(values, expectedUpdatedAt!, initialValues.categoryId),
        });
        const normalized = fromHomepageCollectionDetail(updated);
        setDetail(updated);
        setValues(normalized);
        setInitialValues(normalized);
        setExpectedUpdatedAt(updated.updatedAt);
        toast.success(t('homepage.collection.updated'));
        onSaved();
      }
      setErrors({});
    } catch (caught) {
      handleFailure(caught);
    } finally {
      setMetadataBusy(false);
    }
  };

  const saveProducts = async () => {
    if (!detail?.id || !canUpdateProducts) return;
    if (selectedProducts.length > detail.productLimit) {
      setSelectionError('homepage.validation.productLimitExceeded');
      return;
    }
    if (!expectedUpdatedAt) {
      setServerError(t('homepage.validation.concurrentTokenMissing'));
      return;
    }

    setProductsBusy(true);
    setServerError(null);
    setRequestId(null);
    setSelectionError(null);
    try {
      const updated = await homepageManagementApi.updateProducts(
        detail.id,
        toHomepageProductsPayload(selectedProducts, expectedUpdatedAt),
      );
      const nextProducts = selectedProductsFromDetail(updated);
      setDetail(updated);
      setSelectedProducts(nextProducts);
      setInitialProductIds(nextProducts.map((product) => product.id));
      setExpectedUpdatedAt(updated.updatedAt);
      toast.success(t('homepage.products.saved'));
      onSaved();
    } catch (caught) {
      handleFailure(caught);
    } finally {
      setProductsBusy(false);
    }
  };

  const toggleSearchedProduct = (product: HomepageSafeProduct, checked: boolean) => {
    setSelectionError(null);
    if (!checked) {
      setSelectedProducts((current) => removeHomepageProduct(current, product.id));
      return;
    }
    const limit = detail?.productLimit ?? 0;
    setSelectedProducts((current) => {
      const result = addHomepageProduct(current, product, limit);
      setSelectionError(result.error);
      return result.products;
    });
  };

  const removeProduct = (productId: string) => {
    setSelectionError(null);
    setSelectedProducts((current) => removeHomepageProduct(current, productId));
  };

  const moveProduct = (productId: string, direction: 'up' | 'down') => {
    setSelectedProducts((current) => moveHomepageProduct(current, productId, direction) ?? current);
  };

  const editorDisabled = loading || loadError !== null;
  const metadataReadOnly = collectionId ? !canUpdate : !canCreate;
  const canEditProducts =
    Boolean(detail?.id) && canUpdateProducts && canReadProducts && !conflicted;
  const atProductLimit = Boolean(detail && selectedProducts.length >= detail.productLimit);

  const translationFields = (targetLocale: HomepageLocale) => {
    const translation = values.translations[targetLocale];
    const localeLabel =
      targetLocale === 'en-US' ? t('homepage.locale.en-US') : t('homepage.locale.zh-CN');
    const translationError = errors.translations?.[targetLocale];
    return (
      <fieldset key={targetLocale} className="homepage-translation-fieldset">
        <legend>{localeLabel}</legend>
        <Field
          label={t('homepage.collection.fields.title', { locale: localeLabel })}
          required={targetLocale === 'en-US'}
          error={translationError?.title ? t(translationError.title) : undefined}
        >
          {({ inputId, describedBy }) => (
            <Input
              inputId={inputId}
              describedBy={describedBy}
              value={translation.title}
              maxLength={HOMEPAGE_TITLE_MAX}
              disabled={editorDisabled || metadataReadOnly}
              invalid={Boolean(translationError?.title)}
              onChange={(event) => setTranslation(targetLocale, 'title', event.target.value)}
            />
          )}
        </Field>
        <Field
          label={t('homepage.collection.fields.subtitle', { locale: localeLabel })}
          error={translationError?.subtitle ? t(translationError.subtitle) : undefined}
        >
          {({ inputId, describedBy }) => (
            <Textarea
              inputId={inputId}
              describedBy={describedBy}
              rows={2}
              value={translation.subtitle}
              maxLength={HOMEPAGE_SUBTITLE_MAX}
              disabled={editorDisabled || metadataReadOnly}
              invalid={Boolean(translationError?.subtitle)}
              onChange={(event) => setTranslation(targetLocale, 'subtitle', event.target.value)}
            />
          )}
        </Field>
      </fieldset>
    );
  };

  return (
    <>
      <Drawer
        open={open}
        title={collectionId ? t('homepage.collection.edit') : t('homepage.collection.create')}
        onClose={requestClose}
        closeLabel={t('common.close')}
        size="xl"
        resizable
        maximizable
        labels={{
          maximize: t('homepage.drawer.maximize'),
          restore: t('homepage.drawer.restore'),
          resize: t('homepage.drawer.resize'),
        }}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={requestClose}
              disabled={metadataBusy || productsBusy}
            >
              {t('common.close')}
            </Button>
            <Button
              loading={metadataBusy}
              disabled={
                loading ||
                Boolean(loadError) ||
                metadataReadOnly ||
                !canReadCategories ||
                !canReadProducts ||
                conflicted ||
                (Boolean(collectionId) && !metadataDirty)
              }
              onClick={() => void submitMetadata()}
            >
              {detail
                ? t('homepage.collection.saveMetadata')
                : t('homepage.collection.createSubmit')}
            </Button>
          </>
        }
      >
        {loading ? (
          <LoadingState label={t('homepage.collection.loadingDetail')} rows={8} />
        ) : loadError ? (
          <div className="notice notice-danger stack-sm" role="alert">
            <strong>{t('homepage.collection.loadDetailError')}</strong>
            <span>{translateError(locale, loadError)}</span>
            {loadRequestId ? <span className="mono small">requestId: {loadRequestId}</span> : null}
            <div className="row">
              <Button variant="secondary" onClick={() => setReloadToken((token) => token + 1)}>
                {t('common.retry')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="homepage-collection-drawer stack">
            {conflicted ? (
              <div className="notice notice-danger stack-sm" role="alert">
                <strong>{t('homepage.collection.conflictTitle')}</strong>
                <span>{serverError}</span>
                <span>{t('homepage.collection.conflictHint')}</span>
                {requestId ? <span className="mono small">requestId: {requestId}</span> : null}
                <div className="row">
                  <Button variant="secondary" onClick={reloadServerVersion}>
                    {t('homepage.collection.reloadServer')}
                  </Button>
                </div>
              </div>
            ) : serverError ? (
              <div className="notice notice-danger stack-sm" role="alert">
                <span>{serverError}</span>
                {requestId ? <span className="mono small">requestId: {requestId}</span> : null}
              </div>
            ) : null}

            {!canReadCategories || !canReadProducts ? (
              <div className="notice notice-warning" role="alert">
                {!canReadCategories ? t('homepage.permissions.categoryRequired') : null}{' '}
                {!canReadProducts ? t('homepage.permissions.productRequired') : null}
              </div>
            ) : null}

            <section className="stack" aria-labelledby="homepage-collection-basics-heading">
              <div>
                <h2 id="homepage-collection-basics-heading" className="section-title">
                  {t('homepage.collection.basicsTitle')}
                </h2>
                <p className="muted">{t('homepage.collection.basicsDescription')}</p>
              </div>

              <Field
                label={t('homepage.collection.fields.category')}
                required
                help={t('homepage.collection.fields.categoryHelp')}
                error={errors.categoryId ? t(errors.categoryId) : undefined}
              >
                {({ inputId, describedBy }) => (
                  <CategoryPicker
                    nodes={categories}
                    value={values.categoryId || null}
                    mode="product"
                    inputId={inputId}
                    describedBy={describedBy}
                    invalid={Boolean(errors.categoryId)}
                    disabled={
                      editorDisabled ||
                      metadataReadOnly ||
                      !canReadCategories ||
                      categoryLocked ||
                      conflicted
                    }
                    loading={categoryLoading}
                    errorLabel={categoryError ? translateError(locale, categoryError) : null}
                    onRetry={onRetryCategories}
                    fallbackLabel={detail?.categoryName ?? selectedCategoryPath}
                    allowDisabledSelection
                    onChange={(categoryId) =>
                      setValues((current) => ({ ...current, categoryId: categoryId ?? '' }))
                    }
                  />
                )}
              </Field>

              {categoryLocked ? (
                <div className="notice notice-warning">
                  {t('homepage.collection.categoryLockedHint')}
                </div>
              ) : null}
              {selectedCategory && !selectedCategory.enabled ? (
                <div className="notice notice-warning" role="status">
                  {t('homepage.collection.categoryDisabledWarning')}
                </div>
              ) : null}
              {selectedCategory && !selectedCategory.visible ? (
                <div className="notice notice-warning" role="status">
                  {t('homepage.collection.categoryHiddenWarning')}
                </div>
              ) : null}
              {detail && !selectedCategory && values.categoryId ? (
                <div className="notice notice-warning" role="status">
                  {detail.categoryEnabled ? null : t('homepage.collection.categoryDisabledWarning')}{' '}
                  {detail.categoryVisible ? null : t('homepage.collection.categoryHiddenWarning')}
                </div>
              ) : null}

              <div className="homepage-translation-grid">
                {(['en-US', 'zh-CN'] as const).map(translationFields)}
              </div>

              <div className="form-grid">
                <Field
                  label={t('homepage.collection.fields.productLimit')}
                  required
                  help={t('homepage.collection.fields.productLimitHelp')}
                  error={errors.productLimit ? t(errors.productLimit) : undefined}
                >
                  {({ inputId, describedBy }) => (
                    <Input
                      inputId={inputId}
                      describedBy={describedBy}
                      type="number"
                      inputMode="numeric"
                      min={6}
                      step={6}
                      value={values.productLimit}
                      disabled={editorDisabled || metadataReadOnly || conflicted}
                      invalid={Boolean(errors.productLimit)}
                      onChange={(event) => {
                        setValues((current) => ({
                          ...current,
                          productLimit: event.target.value,
                        }));
                        setErrors((current) => ({ ...current, productLimit: undefined }));
                      }}
                    />
                  )}
                </Field>
                <div className="stack-sm">
                  <Checkbox
                    id="homepage-collection-enabled"
                    label={t('homepage.collection.fields.enabled')}
                    help={t('homepage.collection.fields.enabledHelp')}
                    checked={values.enabled}
                    disabled={editorDisabled || metadataReadOnly || conflicted}
                    onChange={(event) =>
                      setValues((current) => ({ ...current, enabled: event.target.checked }))
                    }
                  />
                  <span className="field-help">
                    {t('homepage.collection.fields.productLimitRange')}
                  </span>
                </div>
              </div>
            </section>

            <section className="stack" aria-labelledby="homepage-collection-products-heading">
              <div className="row-between">
                <div>
                  <h2 id="homepage-collection-products-heading" className="section-title">
                    {t('homepage.products.title')}
                  </h2>
                  <p className="muted">{t('homepage.products.description')}</p>
                </div>
                <Badge tone={atProductLimit ? 'warning' : 'neutral'}>
                  {detail
                    ? t('homepage.products.count', {
                        count: selectedProducts.length,
                        limit: detail.productLimit,
                      })
                    : t('homepage.products.createFirst')}
                </Badge>
              </div>

              {!detail?.id ? (
                <div className="notice">{t('homepage.products.createFirst')}</div>
              ) : !canReadProducts ? (
                <div className="notice notice-warning">
                  {t('homepage.permissions.productRequired')}
                </div>
              ) : (
                <>
                  {!canUpdateProducts ? (
                    <div className="notice notice-warning">
                      {t('homepage.permissions.productUpdateRequired')}
                    </div>
                  ) : null}
                  {productsDirty ? (
                    <div className="notice notice-warning">{t('homepage.products.unsaved')}</div>
                  ) : null}
                  {selectionError ? (
                    <div className="notice notice-danger" role="alert">
                      {t(selectionError)}
                    </div>
                  ) : null}

                  <div className="homepage-product-search">
                    <Field label={t('homepage.products.search')}>
                      {({ inputId }) => (
                        <Input
                          inputId={inputId}
                          type="search"
                          value={query}
                          maxLength={120}
                          placeholder={t('homepage.products.searchPlaceholder')}
                          disabled={!canEditProducts}
                          onChange={(event) => setQuery(event.target.value)}
                        />
                      )}
                    </Field>

                    {searchError ? (
                      <div className="notice notice-danger" role="alert">
                        {translateError(locale, searchError)}
                      </div>
                    ) : searchLoading ? (
                      <LoadingState label={t('homepage.products.searching')} rows={3} />
                    ) : searchResult.data.length === 0 ? (
                      <div className="state-block" role="status">
                        <strong>{t('homepage.products.noResults')}</strong>
                        <span>{t('homepage.products.noResultsHint')}</span>
                      </div>
                    ) : (
                      <div className="homepage-product-results" role="list">
                        {searchResult.data.map((product) => {
                          const checked = selectedIds.has(product.id);
                          return (
                            <div
                              key={product.id}
                              className="homepage-product-result"
                              role="listitem"
                            >
                              <label className="homepage-product-check">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  disabled={!canEditProducts || (!checked && atProductLimit)}
                                  onChange={(event) =>
                                    toggleSearchedProduct(product, event.target.checked)
                                  }
                                  aria-label={t('homepage.products.selectSku', {
                                    sku: product.sku,
                                  })}
                                />
                                <span className="visually-hidden">
                                  {t('homepage.products.selectSku', { sku: product.sku })}
                                </span>
                              </label>
                              <ProductThumbnail product={product} />
                              <div className="homepage-product-copy">
                                <strong>{product.name}</strong>
                                <span className="mono small">{product.sku}</span>
                                <span className="homepage-product-status">
                                  <Badge tone="neutral">{product.publishStatus}</Badge>
                                  <Badge tone="neutral">{product.lifecycleStatus}</Badge>
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {searchResult.totalPages > 1 ? (
                      <Pagination
                        page={searchResult.page}
                        pageSize={PRODUCT_PAGE_SIZE}
                        total={searchResult.total}
                        totalPages={searchResult.totalPages}
                        onPageChange={setSearchPage}
                        labels={{
                          previous: t('common.previous'),
                          next: t('common.next'),
                          rowsPerPage: t('homepage.products.pageSize'),
                          range: t('homepage.products.range', {
                            from: (searchResult.page - 1) * PRODUCT_PAGE_SIZE + 1,
                            to: Math.min(searchResult.page * PRODUCT_PAGE_SIZE, searchResult.total),
                            total: searchResult.total,
                          }),
                        }}
                      />
                    ) : null}
                  </div>

                  <div className="homepage-selected-products" aria-live="polite">
                    <div className="row-between">
                      <h3 className="section-title">{t('homepage.products.selectedTitle')}</h3>
                      <span className="muted small">{t('homepage.products.orderHint')}</span>
                    </div>
                    {selectedProducts.length === 0 ? (
                      <p className="muted">{t('homepage.products.selectedEmpty')}</p>
                    ) : (
                      <ol className="homepage-selected-list">
                        {selectedProducts.map((product, index) => (
                          <li key={product.id} className="homepage-selected-row">
                            <span className="mono small homepage-selected-index">{index + 1}</span>
                            <ProductThumbnail product={product} />
                            <div className="homepage-product-copy">
                              <strong>{product.name}</strong>
                              <span className="mono small">{product.sku}</span>
                              <span className="homepage-product-status">
                                <Badge tone="neutral">{product.publishStatus}</Badge>
                                <Badge tone="neutral">{product.lifecycleStatus}</Badge>
                              </span>
                            </div>
                            <div className="data-table-actions">
                              <Button
                                size="sm"
                                variant="ghost"
                                aria-label={t('homepage.products.moveUp', { sku: product.sku })}
                                disabled={!canEditProducts || index === 0}
                                onClick={() => moveProduct(product.id, 'up')}
                              >
                                ↑
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                aria-label={t('homepage.products.moveDown', { sku: product.sku })}
                                disabled={!canEditProducts || index === selectedProducts.length - 1}
                                onClick={() => moveProduct(product.id, 'down')}
                              >
                                ↓
                              </Button>
                              <Button
                                size="sm"
                                variant="danger"
                                aria-label={t('homepage.products.removeSku', { sku: product.sku })}
                                disabled={!canEditProducts}
                                onClick={() => removeProduct(product.id)}
                              >
                                {t('common.remove')}
                              </Button>
                            </div>
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>

                  <div className="row" style={{ justifyContent: 'flex-end' }}>
                    <Button
                      loading={productsBusy}
                      disabled={!canEditProducts || !productsDirty || conflicted}
                      onClick={() => void saveProducts()}
                    >
                      {t('homepage.products.save')}
                    </Button>
                  </div>
                </>
              )}
            </section>
          </div>
        )}
      </Drawer>

      <ConfirmDialog
        open={discardOpen}
        title={t('homepage.collection.discardTitle')}
        description={t('homepage.collection.discardDescription')}
        confirmLabel={t('homepage.collection.discardConfirm')}
        cancelLabel={t('common.cancel')}
        destructive
        onConfirm={() => {
          setDiscardOpen(false);
          onClose();
        }}
        onCancel={() => setDiscardOpen(false)}
      />
    </>
  );
}

function ProductThumbnail({ product }: { product: HomepageSafeProduct }) {
  const { t } = useSession();
  if (!product.coverImageUrl) {
    return (
      <span
        className="homepage-product-thumbnail homepage-product-thumbnail-empty"
        aria-hidden="true"
      >
        {t('homepage.products.noImage')}
      </span>
    );
  }
  return (
    <Image
      className="homepage-product-thumbnail"
      src={product.coverImageUrl}
      alt={product.coverImageAlt ?? product.name}
      width={48}
      height={48}
      unoptimized
    />
  );
}
