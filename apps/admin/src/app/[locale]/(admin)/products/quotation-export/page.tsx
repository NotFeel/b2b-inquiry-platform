'use client';

import Link from 'next/link';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type {
  CategoryNode,
  QuotationExportConfig,
  QuotationExportHeader,
  QuotationExportPricing,
  QuotationExportPricingPreview,
  QuotationExportProduct,
  QuotationExportProductList,
  QuotationExportRequest,
  QuotationExportTemplateOption,
} from '@b2b/contracts';
import {
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  DataTable,
  Field,
  Input,
  PageHeader,
  Select,
  useToast,
  type DataTableColumn,
} from '@b2b/ui';
import { AdminApiError } from '../../../../../lib/admin-api';
import { categoriesApi } from '../../../../../lib/categories-api';
import { localeHref, translateError } from '../../../../../lib/i18n';
import { quotationExportApi } from '../../../../../lib/quotation-export-api';
import {
  filterQuotationProducts,
  quotationIssueTranslationKey,
  selectQuotationTemplate,
  setQuotationSelection,
} from '../../../../../lib/quotation-export-selection';
import { CategoryPicker } from '../../../../../components/category-picker';
import { useBreadcrumb } from '../../../../../components/use-breadcrumb';
import { useSession } from '../../../../../components/session-provider';

const DEFAULT_HEADER: QuotationExportHeader = {
  companyName: '',
  contactPerson: '',
  email: '',
  phone: '',
  quotationTitle: '',
};

const EMPTY_PRODUCT_LIST: QuotationExportProductList = {
  items: [],
  totalCount: 0,
  limitExceeded: false,
  maxProducts: 200,
};

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/**
 * Dynamic quotation export (docs/36). Product and price authority stays on the
 * API: the exact CNY cost is returned only to actors with product.cost.read,
 * while final customer prices are always calculated on the server.
 */
export default function QuotationExportPage() {
  const { t, locale, can, status } = useSession();
  const toast = useToast();
  const breadcrumb = useBreadcrumb();
  const descendantId = useId();

  const canRead = can('quotation.export.read');
  const canCreate = can('quotation.export.create');

  const [config, setConfig] = useState<QuotationExportConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [configError, setConfigError] = useState<string | null>(null);
  const [configRequestId, setConfigRequestId] = useState<string | null>(null);

  const [templates, setTemplates] = useState<QuotationExportTemplateOption[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [templatesRequestId, setTemplatesRequestId] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState<string | null>(null);

  const [categoryNodes, setCategoryNodes] = useState<CategoryNode[]>([]);
  const [categoryLoading, setCategoryLoading] = useState(true);
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [includeDescendants, setIncludeDescendants] = useState(true);

  const [productList, setProductList] = useState<QuotationExportProductList>(EMPTY_PRODUCT_LIST);
  const [productsLoading, setProductsLoading] = useState(false);
  const [productsError, setProductsError] = useState<string | null>(null);
  const [productsRequestId, setProductsRequestId] = useState<string | null>(null);
  const [productsReloadNonce, setProductsReloadNonce] = useState(0);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [search, setSearch] = useState('');

  const [header, setHeader] = useState<QuotationExportHeader>(DEFAULT_HEADER);
  const [pricing, setPricing] = useState<QuotationExportPricing>({
    markupPercent: '15',
    currencyCode: 'USD',
    exchangeRate: '',
  });

  const [preview, setPreview] = useState<QuotationExportPricingPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewRequestId, setPreviewRequestId] = useState<string | null>(null);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportRequestId, setExportRequestId] = useState<string | null>(null);

  const productLoadSequence = useRef(0);
  const previewSequence = useRef(0);

  const loadConfig = useCallback(async () => {
    if (!canRead) return;
    setConfigLoading(true);
    try {
      const loaded = await quotationExportApi.config();
      setConfig(loaded);
      setPricing((current) => ({
        ...current,
        markupPercent: loaded.defaultMarkupPercent,
        currencyCode: loaded.currencies.includes('USD') ? 'USD' : (loaded.currencies[0] ?? 'CNY'),
        exchangeRate: '',
      }));
      setConfigError(null);
      setConfigRequestId(null);
    } catch (error) {
      setConfigError(
        error instanceof AdminApiError
          ? translateError(locale, error.code)
          : t('quotationExport.productLoadFailed'),
      );
      setConfigRequestId(error instanceof AdminApiError ? (error.requestId ?? null) : null);
    } finally {
      setConfigLoading(false);
    }
  }, [canRead, locale, t]);

  const loadCategories = useCallback(async () => {
    if (!canRead) return;
    setCategoryLoading(true);
    try {
      setCategoryNodes(await categoriesApi.tree({ locale, status: 'enabled' }));
      setCategoryError(null);
    } catch (error) {
      setCategoryError(
        error instanceof AdminApiError
          ? translateError(locale, error.code)
          : t('quotationExport.categoryLoadFailed'),
      );
    } finally {
      setCategoryLoading(false);
    }
  }, [canRead, locale, t]);

  const loadTemplates = useCallback(async () => {
    if (!canRead) return;
    setTemplatesLoading(true);
    try {
      const loaded = await quotationExportApi.templates();
      setTemplates(loaded);
      setTemplateId((current) => selectQuotationTemplate(loaded, current));
      setTemplatesError(null);
      setTemplatesRequestId(null);
    } catch (error) {
      setTemplates([]);
      setTemplateId(null);
      setTemplatesError(
        error instanceof AdminApiError
          ? translateError(locale, error.code)
          : t('quotationExport.templateLoadFailed'),
      );
      setTemplatesRequestId(error instanceof AdminApiError ? (error.requestId ?? null) : null);
    } finally {
      setTemplatesLoading(false);
    }
  }, [canRead, locale, t]);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  useEffect(() => {
    void loadCategories();
  }, [loadCategories]);

  useEffect(() => {
    void loadTemplates();
  }, [loadTemplates]);

  useEffect(() => {
    const sequence = ++productLoadSequence.current;
    setSelectedIds(new Set());
    setSearch('');
    setProductsError(null);
    setProductsRequestId(null);

    if (!canRead || !categoryId) {
      setProductList(EMPTY_PRODUCT_LIST);
      setProductsLoading(false);
      return;
    }

    setProductsLoading(true);
    quotationExportApi
      .products({ categoryId, includeDescendants, locale })
      .then((result) => {
        if (sequence !== productLoadSequence.current) return;
        setProductList(result);
        setSelectedIds(
          result.limitExceeded ? new Set() : new Set(result.items.map((item) => item.id)),
        );
      })
      .catch((error: unknown) => {
        if (sequence !== productLoadSequence.current) return;
        setProductList(EMPTY_PRODUCT_LIST);
        setProductsError(
          error instanceof AdminApiError
            ? translateError(locale, error.code)
            : t('quotationExport.productLoadFailed'),
        );
        setProductsRequestId(error instanceof AdminApiError ? (error.requestId ?? null) : null);
      })
      .finally(() => {
        if (sequence === productLoadSequence.current) setProductsLoading(false);
      });
  }, [canRead, categoryId, includeDescendants, locale, productsReloadNonce, t]);

  const selectedProducts = useMemo(
    () => productList.items.filter((product) => selectedIds.has(product.id)),
    [productList.items, selectedIds],
  );
  const selectedKey = useMemo(
    () =>
      selectedProducts
        .map((product) => product.id)
        .sort()
        .join(','),
    [selectedProducts],
  );
  const filteredProducts = useMemo(
    () => filterQuotationProducts(productList.items, search),
    [productList.items, search],
  );
  const productById = useMemo(
    () => new Map(productList.items.map((product) => [product.id, product])),
    [productList.items],
  );
  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === templateId) ?? null,
    [templateId, templates],
  );
  const previewErrors = useMemo(() => {
    const grouped = new Map<string, string[]>();
    for (const issue of preview?.errors ?? []) {
      if (!issue.productId) continue;
      const messages = grouped.get(issue.productId) ?? [];
      messages.push(t(quotationIssueTranslationKey(issue.code)));
      grouped.set(issue.productId, messages);
    }
    return grouped;
  }, [preview, t]);

  const selectedIssueCount = selectedProducts.reduce(
    (count, product) =>
      count + Math.max(product.eligibilityCodes.length, previewErrors.get(product.id)?.length ?? 0),
    0,
  );
  const headerComplete = Object.values(header).every((value) => value.trim().length > 0);
  const pricingReady =
    preview !== null &&
    preview.errors.length === 0 &&
    !previewLoading &&
    pricing.exchangeRate.trim().length > 0;
  const exportReady =
    canCreate &&
    templateId !== null &&
    categoryId !== null &&
    selectedProducts.length > 0 &&
    !productList.limitExceeded &&
    selectedIssueCount === 0 &&
    headerComplete &&
    pricingReady;

  useEffect(() => {
    const sequence = ++previewSequence.current;
    setPreview(null);
    setPreviewError(null);
    setPreviewRequestId(null);
    setExportError(null);
    setExportRequestId(null);

    if (
      !canCreate ||
      !categoryId ||
      selectedProducts.length === 0 ||
      productList.limitExceeded ||
      !pricing.exchangeRate.trim()
    ) {
      setPreviewLoading(false);
      return;
    }

    const timer = window.setTimeout(() => {
      if (sequence !== previewSequence.current) return;
      setPreviewLoading(true);
      quotationExportApi
        .preview({
          categoryId,
          includeDescendants,
          productIds: selectedProducts.map((product) => product.id),
          markupPercent: pricing.markupPercent,
          currencyCode: pricing.currencyCode,
          exchangeRate: pricing.exchangeRate,
        })
        .then((result) => {
          if (sequence !== previewSequence.current) return;
          setPreview(result);
          setPreviewError(null);
          setPreviewRequestId(null);
        })
        .catch((error: unknown) => {
          if (sequence !== previewSequence.current) return;
          setPreviewError(
            error instanceof AdminApiError
              ? translateError(locale, error.code)
              : t('quotationExport.previewFailed'),
          );
          setPreviewRequestId(error instanceof AdminApiError ? (error.requestId ?? null) : null);
        })
        .finally(() => {
          if (sequence === previewSequence.current) setPreviewLoading(false);
        });
    }, 400);

    return () => window.clearTimeout(timer);
  }, [
    canCreate,
    categoryId,
    includeDescendants,
    locale,
    pricing.currencyCode,
    pricing.exchangeRate,
    pricing.markupPercent,
    productList.limitExceeded,
    selectedKey,
    selectedProducts,
    t,
  ]);

  const toggleProduct = (productId: string, checked: boolean) => {
    setSelectedIds((current) => setQuotationSelection(current, [productId], checked));
  };

  const selectVisible = () => {
    setSelectedIds((current) =>
      setQuotationSelection(
        current,
        filteredProducts.map((product) => product.id),
        true,
      ),
    );
  };

  const restoreDefaultSelection = () => {
    setSelectedIds(new Set(productList.items.map((product) => product.id)));
  };

  const selectCategory = (value: string | null) => {
    setCategoryId(value);
    setSelectedIds(new Set());
    setPreview(null);
  };

  const setCurrency = (currencyCode: string) => {
    if (!config?.currencies.includes(currencyCode as QuotationExportPricing['currencyCode'])) {
      return;
    }
    setPricing((current) => ({
      ...current,
      currencyCode: currencyCode as QuotationExportPricing['currencyCode'],
      exchangeRate:
        currencyCode === 'CNY' ? '1' : current.currencyCode === 'CNY' ? '' : current.exchangeRate,
    }));
  };

  const exportQuotation = async () => {
    if (!categoryId || !templateId || !exportReady) return;
    const request: QuotationExportRequest = {
      templateId,
      categoryId,
      includeDescendants,
      productIds: selectedProducts.map((product) => product.id),
      header,
      pricing: {
        markupPercent: pricing.markupPercent,
        currencyCode: pricing.currencyCode,
        exchangeRate: pricing.exchangeRate,
      },
    };

    setExporting(true);
    setExportError(null);
    setExportRequestId(null);
    try {
      const file = await quotationExportApi.export(request);
      downloadBlob(file.blob, file.filename);
      setConfirmOpen(false);
      toast.success(t('quotationExport.exportSuccess'));
    } catch (error) {
      const message =
        error instanceof AdminApiError
          ? translateError(locale, error.code)
          : t('quotationExport.exportFailed');
      setExportError(message);
      setExportRequestId(error instanceof AdminApiError ? (error.requestId ?? null) : null);
      toast.error(message);
    } finally {
      setExporting(false);
    }
  };

  const columns = useMemo<DataTableColumn<QuotationExportProduct>[]>(
    () => [
      {
        key: 'select',
        header: t('quotationExport.columns.select'),
        width: 64,
        render: (product) => (
          <input
            type="checkbox"
            checked={selectedIds.has(product.id)}
            aria-label={t('quotationExport.selectProduct', { sku: product.sku })}
            disabled={productList.limitExceeded}
            onChange={(event) => toggleProduct(product.id, event.target.checked)}
          />
        ),
      },
      {
        key: 'image',
        header: t('quotationExport.columns.image'),
        width: 72,
        render: (product) =>
          product.thumbnailUrl ? (
            <img
              className="product-thumb"
              src={product.thumbnailUrl}
              alt={`${t('quotationExport.columns.image')} ${product.sku}`}
              loading="lazy"
            />
          ) : (
            <span className="product-thumb product-thumb-empty" aria-hidden="true">
              —
            </span>
          ),
      },
      {
        key: 'sku',
        header: t('quotationExport.columns.sku'),
        render: (product) => <span className="mono small">{product.sku}</span>,
      },
      {
        key: 'name',
        header: t('quotationExport.columns.name'),
        render: (product) => (
          <span className="stack-xs">
            <span>{product.englishName ?? '—'}</span>
            {product.categoryPath ? (
              <span className="tiny muted">{product.categoryPath}</span>
            ) : null}
          </span>
        ),
      },
      {
        key: 'cost',
        header: t('quotationExport.columns.cost'),
        render: (product) => (
          <span className="stack-xs">
            {product.costCny !== null ? (
              <span className="mono">{product.costCny} CNY</span>
            ) : null}
            <Badge tone={product.hasCost ? 'success' : 'danger'}>
              {product.costCny !== null
                ? t('quotationExport.costReady')
                : product.hasCost
                  ? t('quotationExport.costHidden')
                  : t('quotationExport.costMissing')}
            </Badge>
          </span>
        ),
      },
      {
        key: 'packing',
        header: t('quotationExport.columns.packing'),
        render: (product) => product.cartonQuantity ?? '—',
      },
      {
        key: 'dimensions',
        header: t('quotationExport.columns.dimensions'),
        render: (product) => (
          <span className="stack-xs">
            <span>{product.cartonDimensions ?? '—'}</span>
            {product.cartonGrossWeightKg ? (
              <span className="tiny muted">{product.cartonGrossWeightKg} kg</span>
            ) : null}
          </span>
        ),
      },
      {
        key: 'eligibility',
        header: t('quotationExport.columns.eligibility'),
        render: (product) => {
          const messages = [
            ...product.eligibilityCodes.map((code) => t(quotationIssueTranslationKey(code))),
            ...(previewErrors.get(product.id) ?? []),
          ];
          return (
            <Badge tone={messages.length === 0 ? 'success' : 'danger'} title={messages.join(' ')}>
              {messages.length === 0 ? t('quotationExport.ready') : t('quotationExport.notReady')}
            </Badge>
          );
        },
      },
    ],
    [previewErrors, productList.limitExceeded, selectedIds, t],
  );

  const previewItems = useMemo(
    () =>
      (preview?.items ?? []).slice(0, 5).map((item) => ({
        ...item,
        product: productById.get(item.productId) ?? null,
      })),
    [preview, productById],
  );

  const denied = status === 'authenticated' && !canRead;

  return (
    <div className="stack">
      <PageHeader
        breadcrumb={breadcrumb}
        title={t('quotationExport.title')}
        description={t('quotationExport.description')}
      />

      {denied ? (
        <div className="notice notice-danger" role="alert">
          {t('quotationExport.permissionDenied')}
        </div>
      ) : (
        <>
          {!canCreate && status === 'authenticated' ? (
            <div className="notice notice-warning" role="status">
              {t('quotationExport.readOnly')}
            </div>
          ) : null}

          <section className="panel stack-sm" aria-labelledby="quotation-template-title">
            <div>
              <h2 id="quotation-template-title">{t('quotationExport.templateSectionTitle')}</h2>
              <p className="small muted">{t('quotationExport.templateHelp')}</p>
            </div>
            <Field label={t('quotationExport.templateLabel')} required>
              {({ inputId, describedBy }) => (
                <Select
                  inputId={inputId}
                  describedBy={describedBy}
                  value={templateId ?? ''}
                  placeholder={t('quotationExport.templateSelectPlaceholder')}
                  disabled={templatesLoading || templates.length === 0}
                  options={templates.map((template) => ({
                    value: template.id,
                    label: t('quotationExport.templateOption', {
                      name: template.name,
                      version: template.version,
                    }),
                  }))}
                  onChange={(event) => setTemplateId(event.target.value || null)}
                />
              )}
            </Field>
            {selectedTemplate ? (
              <div className="row-between">
                <div className="row">
                  <Badge tone="success">
                    {t('quotationExport.templateVersion', { version: selectedTemplate.version })}
                  </Badge>
                  {selectedTemplate.fileName ? (
                    <span className="small muted mono">{selectedTemplate.fileName}</span>
                  ) : null}
                </div>
                <Link
                  className="btn btn-secondary btn-sm"
                  href={localeHref(locale, '/quote-templates')}
                >
                  {t('quotationExport.openQuoteTemplates')}
                </Link>
              </div>
            ) : null}
            {templatesLoading ? <p role="status">{t('quotationExport.templateLoading')}</p> : null}
            {templatesError ? (
              <div className="notice notice-danger" role="alert">
                <div className="row-between">
                  <span>{templatesError}</span>
                  <Button size="sm" variant="secondary" onClick={() => void loadTemplates()}>
                    {t('quotationExport.retry')}
                  </Button>
                </div>
                {templatesRequestId ? (
                  <span className="tiny">
                    {t('quotationExport.requestId', { requestId: templatesRequestId })}
                  </span>
                ) : null}
              </div>
            ) : null}
            {!templatesLoading && !templatesError && templates.length === 0 ? (
              <div className="notice notice-warning" role="status">
                <p>{t('quotationExport.templatesEmpty')}</p>
                <Link
                  className="btn btn-secondary btn-sm"
                  href={localeHref(locale, '/quote-templates')}
                >
                  {t('quotationExport.openQuoteTemplates')}
                </Link>
              </div>
            ) : null}
          </section>

          <section className="panel stack-sm" aria-labelledby="quotation-scope-title">
            <div>
              <h2 id="quotation-scope-title">{t('quotationExport.scopeTitle')}</h2>
              <p className="small muted">{t('quotationExport.scopeHelp')}</p>
            </div>
            <div className="grid-form">
              <Field label={t('products.filters.category')} required>
                {({ inputId, describedBy }) => (
                  <CategoryPicker
                    mode="filter"
                    inputId={inputId}
                    describedBy={describedBy}
                    nodes={categoryNodes}
                    value={categoryId}
                    loading={categoryLoading}
                    errorLabel={categoryError}
                    onRetry={() => void loadCategories()}
                    onChange={selectCategory}
                  />
                )}
              </Field>
              <div className="field">
                <span className="field-label">{t('quotationExport.includeDescendants')}</span>
                <Checkbox
                  id={descendantId}
                  checked={includeDescendants}
                  disabled={!categoryId}
                  label={t('quotationExport.includeDescendants')}
                  onChange={(event) => setIncludeDescendants(event.target.checked)}
                />
              </div>
            </div>
            {configError ? (
              <div className="notice notice-danger" role="alert">
                <div className="row-between">
                  <span>{configError}</span>
                  <Button size="sm" variant="secondary" onClick={() => void loadConfig()}>
                    {t('quotationExport.retry')}
                  </Button>
                </div>
                {configRequestId ? (
                  <span className="tiny">
                    {t('quotationExport.requestId', { requestId: configRequestId })}
                  </span>
                ) : null}
              </div>
            ) : null}
          </section>

          <section className="panel stack-sm" aria-labelledby="quotation-products-title">
            <div className="row-between">
              <div>
                <h2 id="quotation-products-title">{t('quotationExport.productsTitle')}</h2>
                <p className="small muted">
                  {t('quotationExport.total', { count: productList.totalCount })} ·{' '}
                  {t('quotationExport.selected', {
                    selected: selectedIds.size,
                    total: productList.totalCount,
                  })}
                </p>
              </div>
              <div className="row">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={
                    !categoryId ||
                    productsLoading ||
                    productList.limitExceeded ||
                    filteredProducts.length === 0
                  }
                  onClick={selectVisible}
                >
                  {t('quotationExport.selectAll')}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={selectedIds.size === 0}
                  onClick={() => setSelectedIds(new Set())}
                >
                  {t('quotationExport.clearAll')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={
                    productsLoading || productList.limitExceeded || productList.items.length === 0
                  }
                  onClick={restoreDefaultSelection}
                >
                  {t('quotationExport.restoreDefault')}
                </Button>
              </div>
            </div>

            <Field label={t('quotationExport.searchLabel')}>
              {({ inputId, describedBy }) => (
                <Input
                  inputId={inputId}
                  describedBy={describedBy}
                  type="search"
                  value={search}
                  placeholder={t('quotationExport.searchPlaceholder')}
                  disabled={!categoryId || productsLoading}
                  onChange={(event) => setSearch(event.target.value)}
                />
              )}
            </Field>

            {productList.limitExceeded ? (
              <div className="notice notice-warning" role="alert">
                {t('quotationExport.limitExceeded', { count: productList.maxProducts })}
              </div>
            ) : null}

            <DataTable
              columns={columns}
              rows={filteredProducts}
              rowKey={(product) => product.id}
              labels={{
                empty: search.trim()
                  ? t('quotationExport.emptySearch')
                  : t('quotationExport.emptyProducts'),
                loading: t('common.loading'),
                errorTitle: t('common.error'),
                retry: t('quotationExport.retry'),
                caption: t('quotationExport.productsTitle'),
              }}
              loading={productsLoading || categoryLoading}
              error={productsError}
              requestId={productsRequestId}
              onRetry={() => setProductsReloadNonce((value) => value + 1)}
            />
          </section>

          <section className="panel stack-sm" aria-labelledby="quotation-header-title">
            <h2 id="quotation-header-title">{t('quotationExport.headerTitle')}</h2>
            <div className="grid-form">
              <Field label={t('quotationExport.fields.companyName')} required>
                {({ inputId, describedBy }) => (
                  <Input
                    inputId={inputId}
                    describedBy={describedBy}
                    value={header.companyName}
                    maxLength={120}
                    autoComplete="organization"
                    onChange={(event) =>
                      setHeader((current) => ({ ...current, companyName: event.target.value }))
                    }
                  />
                )}
              </Field>
              <Field label={t('quotationExport.fields.contactPerson')} required>
                {({ inputId, describedBy }) => (
                  <Input
                    inputId={inputId}
                    describedBy={describedBy}
                    value={header.contactPerson}
                    maxLength={80}
                    autoComplete="name"
                    onChange={(event) =>
                      setHeader((current) => ({ ...current, contactPerson: event.target.value }))
                    }
                  />
                )}
              </Field>
              <Field label={t('quotationExport.fields.email')} required>
                {({ inputId, describedBy }) => (
                  <Input
                    inputId={inputId}
                    describedBy={describedBy}
                    type="email"
                    value={header.email}
                    maxLength={254}
                    autoComplete="email"
                    onChange={(event) =>
                      setHeader((current) => ({ ...current, email: event.target.value }))
                    }
                  />
                )}
              </Field>
              <Field label={t('quotationExport.fields.phone')} required>
                {({ inputId, describedBy }) => (
                  <Input
                    inputId={inputId}
                    describedBy={describedBy}
                    type="tel"
                    value={header.phone}
                    maxLength={40}
                    autoComplete="tel"
                    onChange={(event) =>
                      setHeader((current) => ({ ...current, phone: event.target.value }))
                    }
                  />
                )}
              </Field>
              <Field label={t('quotationExport.fields.quotationTitle')} required>
                {({ inputId, describedBy }) => (
                  <Input
                    inputId={inputId}
                    describedBy={describedBy}
                    value={header.quotationTitle}
                    maxLength={160}
                    onChange={(event) =>
                      setHeader((current) => ({ ...current, quotationTitle: event.target.value }))
                    }
                  />
                )}
              </Field>
            </div>
          </section>

          <section className="panel stack-sm" aria-labelledby="quotation-pricing-title">
            <h2 id="quotation-pricing-title">{t('quotationExport.pricingTitle')}</h2>
            <div className="grid-form">
              <Field
                label={t('quotationExport.fields.markupPercent')}
                help={t('quotationExport.markupHelp')}
              >
                {({ inputId, describedBy }) => (
                  <Input
                    inputId={inputId}
                    describedBy={describedBy}
                    inputMode="decimal"
                    value={pricing.markupPercent}
                    unit="%"
                    onChange={(event) =>
                      setPricing((current) => ({ ...current, markupPercent: event.target.value }))
                    }
                  />
                )}
              </Field>
              <Field label={t('quotationExport.fields.currency')} required>
                {({ inputId, describedBy }) => (
                  <Select
                    inputId={inputId}
                    describedBy={describedBy}
                    value={pricing.currencyCode}
                    disabled={configLoading || !config}
                    options={(config?.currencies ?? []).map((code) => ({
                      value: code,
                      label: code,
                    }))}
                    onChange={(event) => setCurrency(event.target.value)}
                  />
                )}
              </Field>
              <Field
                label={t('quotationExport.fields.exchangeRate', { currency: pricing.currencyCode })}
                help={t('quotationExport.exchangeRateHelp')}
                required
              >
                {({ inputId, describedBy }) => (
                  <Input
                    inputId={inputId}
                    describedBy={describedBy}
                    inputMode="decimal"
                    value={pricing.exchangeRate}
                    disabled={pricing.currencyCode === 'CNY'}
                    onChange={(event) =>
                      setPricing((current) => ({ ...current, exchangeRate: event.target.value }))
                    }
                  />
                )}
              </Field>
            </div>
            {pricing.currencyCode === 'CNY' ? (
              <p className="small muted">{t('quotationExport.cnyRateLocked')}</p>
            ) : null}
          </section>

          <section className="panel stack-sm" aria-labelledby="quotation-preview-title">
            <h2 id="quotation-preview-title">{t('quotationExport.previewTitle')}</h2>
            {previewLoading ? <p role="status">{t('quotationExport.previewPending')}</p> : null}
            {previewError ? (
              <div className="notice notice-danger" role="alert">
                <span>{previewError}</span>
                {previewRequestId ? (
                  <span className="tiny">
                    {' '}
                    {t('quotationExport.requestId', { requestId: previewRequestId })}
                  </span>
                ) : null}
              </div>
            ) : null}
            {!previewLoading && !previewError && !preview ? (
              <p className="small muted">{t('quotationExport.previewEmpty')}</p>
            ) : null}
            {preview && preview.items.length > 0 ? (
              <>
                <p className="small">
                  {t('quotationExport.previewReady', { count: preview.itemCount })}
                </p>
                <div className="table-wrap">
                  <table className="data-table" style={{ minWidth: 480 }}>
                    <caption>{t('quotationExport.previewTitle')}</caption>
                    <thead>
                      <tr>
                        <th scope="col">{t('quotationExport.columns.sku')}</th>
                        <th scope="col">{t('quotationExport.columns.name')}</th>
                        <th scope="col">{t('quotationExport.serverPrice')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewItems.map((item) => (
                        <tr key={item.productId}>
                          <td className="mono small">{item.sku}</td>
                          <td>{item.product?.englishName ?? '—'}</td>
                          <td>
                            {item.currencyCode} {item.finalUnitPrice}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="tiny muted">{t('quotationExport.previewNote')}</p>
              </>
            ) : null}

            <div className="notice" role="status">
              <strong>{t('quotationExport.validationTitle')}</strong>
              <p className="small">
                {selectedProducts.length === 0
                  ? t('quotationExport.notSelected')
                  : selectedIssueCount === 0
                    ? t('quotationExport.validationClean')
                    : t('quotationExport.issueProductCount', { count: selectedIssueCount })}
              </p>
            </div>

            {exportError ? (
              <div className="notice notice-danger" role="alert">
                <span>{exportError}</span>
                {exportRequestId ? (
                  <span className="tiny">
                    {' '}
                    {t('quotationExport.requestId', { requestId: exportRequestId })}
                  </span>
                ) : null}
              </div>
            ) : null}

            <div className="row-between">
              <p className="small muted">
                {t('quotationExport.selected', {
                  selected: selectedProducts.length,
                  total: productList.totalCount,
                })}
              </p>
              <Button
                onClick={() => setConfirmOpen(true)}
                loading={exporting}
                loadingLabel={t('quotationExport.exporting')}
                disabled={!exportReady}
              >
                {t('quotationExport.export')}
              </Button>
            </div>
          </section>
        </>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title={t('quotationExport.confirmTitle')}
        description={
          <div className="stack-sm">
            <p>{t('quotationExport.confirmDescription')}</p>
            <dl className="stack-xs">
              <div>
                <dt className="tiny muted">{t('quotationExport.templateLabel')}</dt>
                <dd>
                  {selectedTemplate
                    ? t('quotationExport.templateOption', {
                        name: selectedTemplate.name,
                        version: selectedTemplate.version,
                      })
                    : t('quotationExport.templateUnavailable')}
                </dd>
              </div>
              <div>
                <dt className="tiny muted">{t('quotationExport.productsTitle')}</dt>
                <dd>{selectedProducts.length}</dd>
              </div>
              <div>
                <dt className="tiny muted">{t('quotationExport.fields.currency')}</dt>
                <dd>{pricing.currencyCode}</dd>
              </div>
              <div>
                <dt className="tiny muted">{t('quotationExport.fields.markupPercent')}</dt>
                <dd>{pricing.markupPercent}%</dd>
              </div>
              <div>
                <dt className="tiny muted">
                  {t('quotationExport.fields.exchangeRate', { currency: pricing.currencyCode })}
                </dt>
                <dd>{pricing.exchangeRate}</dd>
              </div>
            </dl>
          </div>
        }
        confirmLabel={t('quotationExport.export')}
        cancelLabel={t('common.cancel')}
        loading={exporting}
        onConfirm={() => void exportQuotation()}
        onCancel={() => {
          if (!exporting) setConfirmOpen(false);
        }}
      />
    </div>
  );
}
