'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { QuoteTemplatePreview, QuoteTemplateSummary, QuoteTemplateType } from '@b2b/contracts';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  DataTable,
  ErrorState,
  Field,
  Input,
  LoadingState,
  PageHeader,
  Select,
  useToast,
  type DataTableColumn,
} from '@b2b/ui';
import { AdminApiError } from '../../../../lib/admin-api';
import { translateError } from '../../../../lib/i18n';
import { formatBytes } from '../../../../lib/product-form';
import {
  QUOTE_TEMPLATE_MAX_BYTES,
  quoteTemplatesApi,
  validateQuoteTemplateFile,
  type QuoteTemplateStatus,
  type QuoteTemplateUploadPhase,
} from '../../../../lib/quote-templates-api';
import { useBreadcrumb } from '../../../../components/use-breadcrumb';
import { useSession } from '../../../../components/session-provider';
import { QuoteTemplatePreviewModal } from '../../../../components/quote-template-preview-modal';

const STATUS_TONES: Record<QuoteTemplateStatus, 'neutral' | 'success' | 'warning'> = {
  draft: 'neutral',
  active: 'success',
  disabled: 'warning',
};

function templateStatus(template: QuoteTemplateSummary): QuoteTemplateStatus {
  return template.status === 'active' || template.status === 'disabled' ? template.status : 'draft';
}

function hasPassedTemplateCheck(template: QuoteTemplateSummary): boolean {
  return template.validationReport?.requiredFieldsPresent === true;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export default function QuoteTemplatesPage() {
  const { t, locale, can } = useSession();
  const toast = useToast();
  const breadcrumb = useBreadcrumb();
  const canRead = can('quote.read');
  const canManage = can('quote.export');
  const canUpload = canManage && can('file.upload');
  const canDelete = can('quote.delete');

  const [templates, setTemplates] = useState<QuoteTemplateSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadRequestId, setLoadRequestId] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [templateType, setTemplateType] = useState<QuoteTemplateType>('product_quote');
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [formRequestId, setFormRequestId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [uploadPhase, setUploadPhase] = useState<QuoteTemplateUploadPhase | null>(null);
  const submitLock = useRef(false);

  const [pendingActivation, setPendingActivation] = useState<QuoteTemplateSummary | null>(null);
  const [statusBusyId, setStatusBusyId] = useState<string | null>(null);
  const [pendingDeletion, setPendingDeletion] = useState<QuoteTemplateSummary | null>(null);
  const [deletionBusyId, setDeletionBusyId] = useState<string | null>(null);
  const [downloadBusyId, setDownloadBusyId] = useState<string | null>(null);
  const [previewTarget, setPreviewTarget] = useState<QuoteTemplateSummary | null>(null);
  const [preview, setPreview] = useState<QuoteTemplatePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewRequestId, setPreviewRequestId] = useState<string | null>(null);
  const previewSequence = useRef(0);

  const loadTemplates = useCallback(async () => {
    if (!canRead) {
      setTemplates([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setTemplates(await quoteTemplatesApi.list());
      setLoadError(null);
      setLoadRequestId(null);
    } catch (error) {
      setLoadError(
        error instanceof AdminApiError
          ? translateError(locale, error.code)
          : t('quoteTemplateManagement.loadFailed'),
      );
      setLoadRequestId(error instanceof AdminApiError ? (error.requestId ?? null) : null);
    } finally {
      setLoading(false);
    }
  }, [canRead, locale, t]);

  useEffect(() => {
    void loadTemplates();
  }, [loadTemplates]);

  const selectFile = (selected: File | null) => {
    setFileError(null);
    setFormError(null);
    setFormRequestId(null);
    if (!selected) {
      setFile(null);
      return;
    }
    const validationError = validateQuoteTemplateFile(selected);
    if (validationError) {
      setFile(null);
      setFileError(t(`quoteTemplateManagement.errors.${validationError}`));
      return;
    }
    setFile(selected);
  };

  const submit = async () => {
    if (!file || !name.trim() || submitLock.current || !canUpload) return;
    submitLock.current = true;
    setSubmitting(true);
    setUploadPhase('uploading');
    setFormError(null);
    setFormRequestId(null);
    try {
      await quoteTemplatesApi.uploadAndRegister(
        file,
        { name: name.trim(), templateType },
        setUploadPhase,
      );
      toast.success(t('quoteTemplateManagement.uploaded'));
      setName('');
      setFile(null);
      setFileError(null);
      await loadTemplates();
    } catch (error) {
      setFormError(
        error instanceof AdminApiError
          ? translateError(locale, error.code)
          : t('quoteTemplateManagement.uploadFailed'),
      );
      setFormRequestId(error instanceof AdminApiError ? (error.requestId ?? null) : null);
    } finally {
      submitLock.current = false;
      setUploadPhase(null);
      setSubmitting(false);
    }
  };

  const changeStatus = async (template: QuoteTemplateSummary, status: QuoteTemplateStatus) => {
    if (!canManage || statusBusyId) return;
    setStatusBusyId(template.id);
    try {
      await quoteTemplatesApi.setStatus(template.id, status);
      toast.success(
        t(
          status === 'active'
            ? 'quoteTemplateManagement.activated'
            : 'quoteTemplateManagement.disabled',
        ),
      );
      setPendingActivation(null);
      await loadTemplates();
    } catch (error) {
      toast.error(
        error instanceof AdminApiError
          ? translateError(locale, error.code)
          : t('quoteTemplateManagement.statusFailed'),
      );
    } finally {
      setStatusBusyId(null);
    }
  };

  const downloadTemplate = async (template: QuoteTemplateSummary) => {
    if (!canRead || downloadBusyId) return;
    setDownloadBusyId(template.id);
    try {
      const file = await quoteTemplatesApi.download(
        template.id,
        template.fileName ?? `${template.name}-v${template.version}.xlsx`,
      );
      downloadBlob(file.blob, file.filename);
      toast.success(t('quoteTemplateManagement.downloaded'));
    } catch (error) {
      const message =
        error instanceof AdminApiError
          ? translateError(locale, error.code)
          : t('quoteTemplateManagement.downloadFailed');
      const requestId = error instanceof AdminApiError ? error.requestId : null;
      toast.error(
        requestId ? `${message} ${t('quotationExport.requestId', { requestId })}` : message,
      );
    } finally {
      setDownloadBusyId(null);
    }
  };

  const loadPreview = async (template: QuoteTemplateSummary) => {
    const sequence = ++previewSequence.current;
    setPreview(null);
    setPreviewError(null);
    setPreviewRequestId(null);
    setPreviewLoading(true);
    try {
      const result = await quoteTemplatesApi.preview(template.id);
      if (sequence !== previewSequence.current) return;
      setPreview(result);
    } catch (error) {
      if (sequence !== previewSequence.current) return;
      setPreviewError(
        error instanceof AdminApiError
          ? translateError(locale, error.code)
          : t('quoteTemplateManagement.previewFailed'),
      );
      setPreviewRequestId(error instanceof AdminApiError ? (error.requestId ?? null) : null);
    } finally {
      if (sequence === previewSequence.current) setPreviewLoading(false);
    }
  };

  const openPreview = (template: QuoteTemplateSummary) => {
    if (!canRead) return;
    setPreviewTarget(template);
    void loadPreview(template);
  };

  const closePreview = () => {
    previewSequence.current += 1;
    setPreviewTarget(null);
    setPreview(null);
    setPreviewError(null);
    setPreviewRequestId(null);
    setPreviewLoading(false);
  };

  const deleteTemplate = async (template: QuoteTemplateSummary) => {
    if (!canDelete || deletionBusyId) return;
    setDeletionBusyId(template.id);
    try {
      await quoteTemplatesApi.remove(template.id);
      toast.success(t('quoteTemplateManagement.deletionPending'));
      setPendingDeletion(null);
      await loadTemplates();
    } catch (error) {
      toast.error(
        error instanceof AdminApiError
          ? translateError(locale, error.code)
          : t('quoteTemplateManagement.deleteFailed'),
      );
    } finally {
      setDeletionBusyId(null);
    }
  };

  const columns = useMemo<DataTableColumn<QuoteTemplateSummary>[]>(
    () => [
      {
        key: 'name',
        header: t('documents.templateName'),
        render: (template) => (
          <div className="stack-xs">
            <strong>{template.name}</strong>
            <span className="small muted">
              {template.fileName ?? t('quoteTemplateManagement.fileUnavailable')}
              {template.fileSizeBytes ? ` · ${formatBytes(Number(template.fileSizeBytes))}` : ''}
            </span>
          </div>
        ),
      },
      {
        key: 'type',
        header: t('documents.templateType'),
        render: (template) => t(`quoteTemplateManagement.types.${template.templateType}`),
      },
      {
        key: 'version',
        header: t('documents.version'),
        render: (template) => `v${template.version}`,
      },
      {
        key: 'status',
        header: t('documents.status'),
        render: (template) => {
          const status = templateStatus(template);
          return (
            <Badge tone={STATUS_TONES[status]}>
              {t(`quoteTemplateManagement.statuses.${status}`)}
            </Badge>
          );
        },
      },
      {
        key: 'mapping',
        header: t('quoteTemplateManagement.columns.mapping'),
        render: (template) => (
          <div className="stack-xs">
            <span>
              {t('quoteTemplateManagement.mappedCount', {
                count: Object.keys(template.fieldMapping ?? {}).length,
              })}
            </span>
            {template.sheetName ? <span className="small muted">{template.sheetName}</span> : null}
          </div>
        ),
      },
      {
        key: 'updatedAt',
        header: t('documents.createdAt'),
        render: (template) => new Date(template.updatedAt).toLocaleString(locale),
      },
      {
        key: 'actions',
        header: t('common.actions'),
        align: 'right',
        render: (template) => {
          const status = templateStatus(template);
          return (
            <div className="data-table-actions quote-template-actions">
              <Button
                size="sm"
                variant="secondary"
                loading={downloadBusyId === template.id}
                disabled={downloadBusyId !== null && downloadBusyId !== template.id}
                onClick={() => void downloadTemplate(template)}
              >
                {t('quoteTemplateManagement.download')}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => openPreview(template)}>
                {t('quoteTemplateManagement.preview')}
              </Button>
              {canManage && template.deletionState !== 'failed' ? (
                status === 'active' ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={statusBusyId === template.id}
                    onClick={() => void changeStatus(template, 'disabled')}
                  >
                    {t('documents.disable')}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={statusBusyId === template.id}
                    disabled={!hasPassedTemplateCheck(template)}
                    onClick={() => setPendingActivation(template)}
                  >
                    {t('documents.activate')}
                  </Button>
                )
              ) : null}
              {canDelete ? (
                <Button
                  size="sm"
                  variant="danger"
                  loading={deletionBusyId === template.id}
                  disabled={deletionBusyId !== null && deletionBusyId !== template.id}
                  onClick={() => setPendingDeletion(template)}
                >
                  {template.deletionState === 'failed'
                    ? t('quoteTemplateManagement.retryDelete')
                    : t('quoteTemplateManagement.delete')}
                </Button>
              ) : null}
            </div>
          );
        },
      },
    ],
    [canDelete, canManage, canRead, deletionBusyId, downloadBusyId, locale, statusBusyId, t],
  );

  if (!canRead) {
    return (
      <main className="stack">
        <PageHeader
          breadcrumb={breadcrumb}
          title={t('documents.quoteTemplates')}
          description={t('documents.quoteTemplatesDescription')}
        />
        <ErrorState title={t('quoteTemplateManagement.permissionDenied')} />
      </main>
    );
  }

  return (
    <main className="stack">
      <PageHeader
        breadcrumb={breadcrumb}
        title={t('documents.quoteTemplates')}
        description={t('documents.quoteTemplatesDescription')}
      />

      <Card title={t('quoteTemplateManagement.uploadTitle')}>
        <p className="muted">{t('quoteTemplateManagement.uploadDescription')}</p>
        <div className="form-grid">
          <Field label={t('documents.templateName')} required>
            {({ inputId, describedBy }) => (
              <Input
                inputId={inputId}
                describedBy={describedBy}
                value={name}
                maxLength={180}
                disabled={!canUpload || submitting}
                onChange={(event) => {
                  setName(event.target.value);
                  setFormError(null);
                }}
              />
            )}
          </Field>

          <Field label={t('documents.templateType')} required>
            {({ inputId, describedBy }) => (
              <Select
                inputId={inputId}
                describedBy={describedBy}
                value={templateType}
                disabled={!canUpload || submitting}
                options={[
                  {
                    value: 'product_quote',
                    label: t('quoteTemplateManagement.types.product_quote'),
                  },
                  { value: 'pi', label: t('quoteTemplateManagement.types.pi') },
                ]}
                onChange={(event) => setTemplateType(event.target.value as QuoteTemplateType)}
              />
            )}
          </Field>

          <Field
            label={t('quoteTemplateManagement.fileLabel')}
            help={t('quoteTemplateManagement.fileHelp', {
              size: Math.round(QUOTE_TEMPLATE_MAX_BYTES / (1024 * 1024)),
            })}
            error={fileError ?? undefined}
            required
          >
            {({ inputId, describedBy }) => (
              <input
                id={inputId}
                aria-describedby={describedBy}
                className="input"
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                disabled={!canUpload || submitting}
                onChange={(event) => {
                  selectFile(event.target.files?.[0] ?? null);
                  event.target.value = '';
                }}
              />
            )}
          </Field>
        </div>

        {file ? (
          <p className="small muted">
            {file.name} · {formatBytes(file.size)}
          </p>
        ) : null}

        {submitting && uploadPhase ? (
          <div className="stack-sm" role="status" aria-live="polite">
            <span className="small">
              {t(
                uploadPhase === 'uploading'
                  ? 'quoteTemplateManagement.uploading'
                  : 'quoteTemplateManagement.registering',
              )}
            </span>
            <span className="upload-progress" aria-hidden="true">
              <span style={{ width: uploadPhase === 'uploading' ? '55%' : '90%' }} />
            </span>
          </div>
        ) : null}

        {!canUpload ? (
          <p className="field-help">{t('quoteTemplateManagement.uploadPermissionRequired')}</p>
        ) : null}

        {formError ? (
          <div className="state-error" role="alert">
            <span className="field-error">{formError}</span>
            {formRequestId ? (
              <span className="small mono">
                {t('quotationExport.requestId', { requestId: formRequestId })}
              </span>
            ) : null}
          </div>
        ) : null}

        <div className="row">
          <Button
            loading={submitting}
            disabled={!canUpload || !file || !name.trim()}
            onClick={() => void submit()}
          >
            {submitting
              ? t('quoteTemplateManagement.submitting')
              : t('quoteTemplateManagement.submit')}
          </Button>
          <span className="field-help">{t('quoteTemplateManagement.versioningHelp')}</span>
        </div>
      </Card>

      <Card title={t('quoteTemplateManagement.listTitle')}>
        {loading && templates.length === 0 ? (
          <LoadingState label={t('common.loading')} />
        ) : loadError && templates.length === 0 ? (
          <ErrorState
            title={t('quoteTemplateManagement.loadFailed')}
            description={loadError}
            retryLabel={t('quotationExport.retry')}
            onRetry={() => void loadTemplates()}
            requestId={loadRequestId}
          />
        ) : (
          <DataTable
            columns={columns}
            rows={templates}
            rowKey={(template) => template.id}
            labels={{
              empty: t('quoteTemplateManagement.empty'),
              emptyDescription: t('quoteTemplateManagement.emptyDescription'),
              loading: t('common.loading'),
              errorTitle: t('quoteTemplateManagement.loadFailed'),
              retry: t('quotationExport.retry'),
            }}
            loading={loading}
            error={loadError}
            onRetry={() => void loadTemplates()}
            requestId={loadRequestId}
          />
        )}
      </Card>

      <ConfirmDialog
        open={pendingActivation !== null}
        title={t('quoteTemplateManagement.activateTitle')}
        description={t('quoteTemplateManagement.activateDescription', {
          name: pendingActivation?.name ?? '',
          type: pendingActivation
            ? t(`quoteTemplateManagement.types.${pendingActivation.templateType}`)
            : '',
        })}
        confirmLabel={t('documents.activate')}
        cancelLabel={t('common.cancel')}
        loading={pendingActivation !== null && statusBusyId === pendingActivation.id}
        onCancel={() => setPendingActivation(null)}
        onConfirm={() => {
          if (pendingActivation) void changeStatus(pendingActivation, 'active');
        }}
      />

      <ConfirmDialog
        open={pendingDeletion !== null}
        title={t('quoteTemplateManagement.deleteTitle')}
        description={t('quoteTemplateManagement.deleteDescription', {
          name: pendingDeletion?.name ?? '',
          version: pendingDeletion?.version ?? '',
        })}
        confirmLabel={
          pendingDeletion?.deletionState === 'failed'
            ? t('quoteTemplateManagement.retryDelete')
            : t('quoteTemplateManagement.deleteConfirm')
        }
        cancelLabel={t('common.cancel')}
        destructive
        loading={pendingDeletion !== null && deletionBusyId === pendingDeletion.id}
        onCancel={() => setPendingDeletion(null)}
        onConfirm={() => {
          if (pendingDeletion) void deleteTemplate(pendingDeletion);
        }}
      />

      <QuoteTemplatePreviewModal
        target={previewTarget}
        preview={preview}
        loading={previewLoading}
        error={previewError}
        requestId={previewRequestId}
        downloading={previewTarget !== null && downloadBusyId === previewTarget.id}
        onClose={closePreview}
        onRetry={() => {
          if (previewTarget) void loadPreview(previewTarget);
        }}
        onDownload={() => {
          if (previewTarget) void downloadTemplate(previewTarget);
        }}
      />
    </main>
  );
}
