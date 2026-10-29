'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DICTIONARY_TYPES,
  PRODUCT_LIFECYCLE_STATUSES,
  PUBLISH_STATUSES,
  type CategoryNode,
  type ProductImportCommitResult,
  type ProductImportSettings,
  type ProductImportValidationResult,
} from '@b2b/contracts';
import {
  Button,
  Card,
  ConfirmDialog,
  Field,
  MultiSelect,
  PageHeader,
  Select,
  StatCard,
  useToast,
} from '@b2b/ui';
import { AdminApiError } from '../../../../../lib/admin-api';
import { categoriesApi } from '../../../../../lib/categories-api';
import { useDictionaryOptions } from '../../../../../lib/dictionary-options';
import { localeHref, translateError } from '../../../../../lib/i18n';
import {
  productBulkImportApi,
  type ProductImportUploadProgress,
} from '../../../../../lib/product-bulk-import-api';
import { useTagIdSelectOptions } from '../../../../../lib/tag-options';
import { CategoryPicker } from '../../../../../components/category-picker';
import { useBreadcrumb } from '../../../../../components/use-breadcrumb';
import { useSession } from '../../../../../components/session-provider';

const INITIAL_SETTINGS: ProductImportSettings = {
  categoryId: '',
  publishStatus: 'draft',
  lifecycleStatus: 'available',
  tagIds: [],
  templateVersion: 'optimized-v1',
};

export default function ProductBulkImportPage() {
  const { t, locale, can } = useSession();
  const toast = useToast();
  const breadcrumb = useBreadcrumb();
  const [settings, setSettings] = useState<ProductImportSettings>(INITIAL_SETTINGS);
  const [categoryNodes, setCategoryNodes] = useState<CategoryNode[]>([]);
  const [categoryLoading, setCategoryLoading] = useState(false);
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [validating, setValidating] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<ProductImportUploadProgress | null>(null);
  const [committing, setCommitting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [validation, setValidation] = useState<ProductImportValidationResult | null>(null);
  const [committed, setCommitted] = useState<ProductImportCommitResult | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const uploadAbort = useRef<AbortController | null>(null);
  const activeUploadId = useRef<string | null>(null);

  const publish = useDictionaryOptions(DICTIONARY_TYPES.productPublishStatus, {
    locale,
    fallback: PUBLISH_STATUSES.map((code) => ({ value: code, label: code })),
  });
  const lifecycle = useDictionaryOptions(DICTIONARY_TYPES.productLifecycle, {
    locale,
    fallback: PRODUCT_LIFECYCLE_STATUSES.map((code) => ({ value: code, label: code })),
  });
  const tags = useTagIdSelectOptions(locale, t('tags.statusOptions.disabled'));
  const canImport = can('product.import') && can('product.create');

  const loadCategories = useCallback(async () => {
    if (!can('category.read')) return;
    setCategoryLoading(true);
    try {
      setCategoryNodes(await categoriesApi.tree({ locale }));
      setCategoryError(null);
    } catch (error) {
      setCategoryError(
        error instanceof AdminApiError
          ? translateError(locale, error.code)
          : t('productsImport.errors.loadOptions'),
      );
    } finally {
      setCategoryLoading(false);
    }
  }, [can, locale, t]);

  useEffect(() => {
    void loadCategories();
  }, [loadCategories]);

  useEffect(() => () => uploadAbort.current?.abort(), []);

  const invalidate = useCallback(() => {
    setValidation(null);
    setCommitted(null);
  }, []);

  const updateSettings = <K extends keyof ProductImportSettings>(
    key: K,
    value: ProductImportSettings[K],
  ) => {
    setSettings((current) => ({ ...current, [key]: value }));
    invalidate();
  };

  const errorText = (code: string): string =>
    code.startsWith('products.') ? t(code) : translateError(locale, code);

  const validate = async () => {
    if (!file || !settings.categoryId) return;
    uploadAbort.current?.abort();
    const controller = new AbortController();
    uploadAbort.current = controller;
    setValidating(true);
    setUploadProgress(null);
    setRequestError(null);
    setCommitted(null);
    try {
      const status = await productBulkImportApi.uploadAndValidate(file, settings, {
        signal: controller.signal,
        onProgress: (progress) => {
          activeUploadId.current = progress.uploadId;
          setUploadProgress(progress);
        },
      });
      const result = status.validation;
      setValidation(result);
      if (status.status === 'VALIDATED' && result?.validationId) {
        toast.success(t('productsImport.validationPassed'));
      } else if (status.status === 'INVALID') {
        toast.error(t('productsImport.validationFailed'));
      } else {
        setRequestError(translateError(locale, status.errorCode ?? 'IMPORT_PROCESSING_FAILED'));
      }
    } catch (error) {
      setValidation(null);
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setRequestError(
        error instanceof AdminApiError
          ? translateError(locale, error.code)
          : t('productsImport.errors.validate'),
      );
    } finally {
      if (uploadAbort.current === controller) {
        uploadAbort.current = null;
        activeUploadId.current = null;
      }
      setUploadProgress(null);
      setValidating(false);
    }
  };

  const cancelUpload = async () => {
    const uploadId = activeUploadId.current;
    uploadAbort.current?.abort();
    if (!uploadId) return;
    setCancelling(true);
    try {
      await productBulkImportApi.cancelUpload(uploadId);
      toast.info(t('productsImport.upload.cancelled'));
    } catch (error) {
      toast.error(
        error instanceof AdminApiError
          ? translateError(locale, error.code)
          : t('productsImport.upload.cancelFailed'),
      );
    } finally {
      setCancelling(false);
    }
  };

  const commit = async () => {
    if (!validation?.validationId) return;
    setCommitting(true);
    setRequestError(null);
    try {
      const result = await productBulkImportApi.commit(validation.validationId);
      setCommitted(result);
      setConfirmOpen(false);
      setValidation(null);
      toast.success(t('productsImport.commitSuccess', { count: result.createdCount }));
    } catch (error) {
      setRequestError(
        error instanceof AdminApiError
          ? translateError(locale, error.code)
          : t('productsImport.errors.commit'),
      );
    } finally {
      setCommitting(false);
    }
  };

  const summary = useMemo(() => validation?.summary ?? null, [validation]);
  const uploadPercent = uploadProgress
    ? Math.min(100, Math.round((uploadProgress.uploadedBytes / uploadProgress.totalBytes) * 100))
    : 0;

  const downloadErrors = () => {
    if (!validation) return;
    const csvCell = (value: string) => {
      const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
      return `"${safe.replace(/"/g, '""')}"`;
    };
    const lines = [
      ['rowNumber', 'sku', 'field', 'code', 'message'].map(csvCell).join(','),
      ...validation.errors.map((issue) =>
        [
          String(issue.rowNumber ?? ''),
          issue.sku ?? '',
          issue.field,
          issue.code,
          errorText(issue.messageKey),
        ]
          .map(csvCell)
          .join(','),
      ),
    ];
    const blob = new Blob([`\uFEFF${lines.join('\r\n')}`], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'product-import-errors.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  if (!canImport) {
    return (
      <div className="stack">
        <PageHeader breadcrumb={breadcrumb} title={t('productsImport.title')} />
        <Card>
          <p>{t('productsImport.noPermission')}</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="stack">
      <PageHeader
        breadcrumb={breadcrumb}
        title={t('productsImport.title')}
        description={t('productsImport.description')}
        actions={
          <a className="btn btn-secondary btn-md" href={productBulkImportApi.templateUrl()}>
            {t('productsImport.downloadTemplate')}
          </a>
        }
      />

      <Card title={t('productsImport.settings.title')}>
        <div className="grid-form">
          <Field label={t('productsImport.settings.category')} required>
            {({ inputId, describedBy }) => (
              <CategoryPicker
                nodes={categoryNodes}
                value={settings.categoryId || null}
                mode="product"
                inputId={inputId}
                describedBy={describedBy}
                loading={categoryLoading}
                errorLabel={categoryError}
                onRetry={() => void loadCategories()}
                onChange={(categoryId) => updateSettings('categoryId', categoryId ?? '')}
              />
            )}
          </Field>
          <Field label={t('productsImport.settings.publishStatus')} required>
            {({ inputId, describedBy }) => (
              <Select
                inputId={inputId}
                describedBy={describedBy}
                value={settings.publishStatus}
                options={publish.options}
                onChange={(event) =>
                  updateSettings(
                    'publishStatus',
                    event.target.value as ProductImportSettings['publishStatus'],
                  )
                }
              />
            )}
          </Field>
          <Field label={t('productsImport.settings.lifecycle')} required>
            {({ inputId, describedBy }) => (
              <Select
                inputId={inputId}
                describedBy={describedBy}
                value={settings.lifecycleStatus}
                options={lifecycle.options}
                onChange={(event) =>
                  updateSettings(
                    'lifecycleStatus',
                    event.target.value as ProductImportSettings['lifecycleStatus'],
                  )
                }
              />
            )}
          </Field>
          <Field
            label={t('productsImport.settings.tags')}
            help={t('productsImport.settings.tagsHelp')}
          >
            {({ inputId, describedBy }) => (
              <MultiSelect
                inputId={inputId}
                describedBy={describedBy}
                value={settings.tagIds}
                options={tags.options}
                loading={tags.loading}
                error={tags.error}
                onChange={(tagIds) => updateSettings('tagIds', tagIds)}
                placeholder={t('productsImport.settings.tagsPlaceholder')}
                searchPlaceholder={t('common.search')}
                emptyLabel={t('common.empty')}
                noMatchLabel={t('common.noResults')}
                loadingLabel={t('common.loading')}
                retryLabel={t('common.retry')}
                removeLabel={(label) => `${t('common.remove')} ${label}`}
              />
            )}
          </Field>
        </div>
      </Card>

      <Card title={t('productsImport.file.title')}>
        <Field label={t('productsImport.file.label')} help={t('productsImport.file.help')} required>
          {({ inputId, describedBy }) => (
            <input
              id={inputId}
              aria-describedby={describedBy}
              type="file"
              disabled={validating}
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
                invalidate();
              }}
            />
          )}
        </Field>
        {file ? (
          <p className="small muted">
            {file.name} · {formatFileSize(file.size)}
          </p>
        ) : null}
        {validating ? (
          <div className="stack-sm">
            <div
              className="upload-progress"
              role="progressbar"
              aria-label={t('productsImport.upload.progressLabel')}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={uploadPercent}
            >
              <span style={{ width: `${uploadPercent}%` }} />
            </div>
            <p className="small muted" role="status" aria-live="polite">
              {uploadProgress
                ? t(
                    uploadProgress.phase === 'uploading'
                      ? 'productsImport.upload.uploading'
                      : 'productsImport.upload.validating',
                    {
                      uploaded: uploadProgress.uploadedChunks,
                      total: uploadProgress.chunkCount,
                      percent: uploadPercent,
                    },
                  )
                : t('productsImport.upload.starting')}
            </p>
            {uploadProgress?.retryingChunkIndex !== null &&
            uploadProgress?.retryingChunkIndex !== undefined ? (
              <p className="small muted" role="status">
                {t('productsImport.upload.retrying', {
                  index: uploadProgress.retryingChunkIndex + 1,
                })}
              </p>
            ) : null}
            {uploadProgress?.phase === 'uploading' ? (
              <div className="row">
                <Button
                  variant="secondary"
                  loading={cancelling}
                  onClick={() => void cancelUpload()}
                >
                  {t('productsImport.upload.cancel')}
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="row">
          <Button
            loading={validating}
            disabled={!file || !settings.categoryId || validating}
            onClick={() => void validate()}
          >
            {t('productsImport.validate')}
          </Button>
        </div>
      </Card>

      {requestError ? (
        <div className="form-error" role="alert">
          {requestError}
        </div>
      ) : null}

      {summary ? (
        <Card title={t('productsImport.summary.title')}>
          <div className="stats-grid">
            <StatCard label={t('productsImport.summary.total')} value={String(summary.totalRows)} />
            <StatCard label={t('productsImport.summary.valid')} value={String(summary.validRows)} />
            <StatCard
              label={t('productsImport.summary.invalid')}
              value={String(summary.invalidRows)}
            />
            <StatCard
              label={t('productsImport.summary.images')}
              value={String(summary.imageCount)}
            />
          </div>
          {validation && validation.errors.length > 0 ? (
            <>
              <div className="row">
                <Button variant="secondary" onClick={downloadErrors}>
                  {t('productsImport.downloadErrors')}
                </Button>
              </div>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>{t('productsImport.errors.row')}</th>
                      <th>{t('productsImport.errors.sku')}</th>
                      <th>{t('productsImport.errors.field')}</th>
                      <th>{t('productsImport.errors.message')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {validation.errors.slice(0, 50).map((issue, index) => (
                      <tr key={`${issue.rowNumber}-${issue.field}-${issue.code}-${index}`}>
                        <td>{issue.rowNumber ?? '—'}</td>
                        <td className="mono">{issue.sku ?? '—'}</td>
                        <td>{issue.field}</td>
                        <td>{errorText(issue.messageKey)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
          <div className="row">
            <Button
              variant="secondary"
              onClick={() => window.location.assign(localeHref(locale, '/products'))}
            >
              {t('productsImport.back')}
            </Button>
            <Button
              disabled={!validation?.validationId || validating}
              onClick={() => setConfirmOpen(true)}
            >
              {t('productsImport.commit', { count: summary.validRows })}
            </Button>
          </div>
        </Card>
      ) : null}

      {committed ? (
        <Card title={t('productsImport.completed')}>
          <p>{t('productsImport.commitSuccess', { count: committed.createdCount })}</p>
          <p className="small muted">
            {t('productsImport.batchId')}: <span className="mono">{committed.batchId}</span>
          </p>
          <a className="btn btn-primary btn-md" href={localeHref(locale, '/products')}>
            {t('productsImport.openProducts')}
          </a>
        </Card>
      ) : null}

      <ConfirmDialog
        open={confirmOpen}
        title={t('productsImport.confirmTitle')}
        description={t('productsImport.confirmBody', { count: summary?.validRows ?? 0 })}
        confirmLabel={t('productsImport.commit', { count: summary?.validRows ?? 0 })}
        cancelLabel={t('common.cancel')}
        loading={committing}
        onConfirm={() => void commit()}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}
