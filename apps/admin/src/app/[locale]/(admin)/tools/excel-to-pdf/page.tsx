'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  EXCEL_PDF_BUSINESS_TYPES,
  type ExcelPdfBusinessType,
  type ExcelPdfConfig,
  type ExcelPdfJobStatus,
  type ExcelPdfJobSummary,
} from '@b2b/contracts';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  DataTable,
  EmptyState,
  LoadingState,
  PageHeader,
  Pagination,
  Select,
  useToast,
  type BadgeTone,
  type DataTableColumn,
} from '@b2b/ui';
import { AdminApiError } from '../../../../../lib/admin-api';
import {
  excelPdfApi,
  validateExcelPdfFile,
  type ExcelPdfUploadProgress,
} from '../../../../../lib/excel-pdf-api';
import { translateError } from '../../../../../lib/i18n';
import { useBreadcrumb } from '../../../../../components/use-breadcrumb';
import { useSession } from '../../../../../components/session-provider';

const STATUS_TONES: Record<ExcelPdfJobStatus, BadgeTone> = {
  queued: 'neutral',
  processing: 'info',
  succeeded: 'success',
  failed: 'danger',
  cancelled: 'warning',
  expired: 'warning',
};

export default function ExcelToPdfPage() {
  const { t, locale, can } = useSession();
  const toast = useToast();
  const breadcrumb = useBreadcrumb();
  const canRead = can('excel_pdf.read');
  const canCreate = can('excel_pdf.create');
  const canDownload = can('excel_pdf.download');
  const canRetry = can('excel_pdf.retry');
  const canDelete = can('excel_pdf.delete');

  const inputRef = useRef<HTMLInputElement | null>(null);
  const uploadAbort = useRef<AbortController | null>(null);
  const activeUploadId = useRef<string | null>(null);
  const progressPhase = useRef<ExcelPdfUploadProgress['phase'] | null>(null);

  const [config, setConfig] = useState<ExcelPdfConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [configError, setConfigError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [businessType, setBusinessType] = useState<ExcelPdfBusinessType>('quotation');
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [progress, setProgress] = useState<ExcelPdfUploadProgress | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);

  const [jobs, setJobs] = useState<ExcelPdfJobSummary[]>([]);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [jobsError, setJobsError] = useState<string | null>(null);
  const [jobsRequestId, setJobsRequestId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | ExcelPdfJobStatus>('all');
  const [businessFilter, setBusinessFilter] = useState<'all' | ExcelPdfBusinessType>('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [pagination, setPagination] = useState({ total: 0, totalPages: 1 });

  const [downloadBusyId, setDownloadBusyId] = useState<string | null>(null);
  const [retryBusyId, setRetryBusyId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ExcelPdfJobSummary | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const loadConfig = useCallback(async () => {
    if (!canRead) {
      setConfigLoading(false);
      return;
    }
    setConfigLoading(true);
    try {
      setConfig(await excelPdfApi.config());
      setConfigError(null);
    } catch (error) {
      setConfigError(
        error instanceof AdminApiError
          ? translateError(locale, error.code)
          : t('excelPdf.errors.config'),
      );
    } finally {
      setConfigLoading(false);
    }
  }, [canRead, locale, t]);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  useEffect(() => () => uploadAbort.current?.abort(), []);

  const loadJobs = useCallback(
    async (signal?: AbortSignal) => {
      if (!canRead || !config?.enabled) return;
      setJobsLoading(true);
      try {
        const result = await excelPdfApi.listJobs(
          { page, pageSize, status: statusFilter, businessType: businessFilter },
          signal,
        );
        setJobs(result.data);
        setPagination(result.pagination);
        setJobsError(null);
        setJobsRequestId(null);
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setJobsError(
          error instanceof AdminApiError
            ? translateError(locale, error.code)
            : t('excelPdf.errors.loadJobs'),
        );
        setJobsRequestId(error instanceof AdminApiError ? (error.requestId ?? null) : null);
      } finally {
        setJobsLoading(false);
      }
    },
    [businessFilter, canRead, config?.enabled, locale, page, pageSize, statusFilter, t],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadJobs(controller.signal);
    return () => controller.abort();
  }, [loadJobs]);

  const selectFile = (selected: File | null) => {
    setFileError(null);
    setFormError(null);
    setRequestId(null);
    if (!selected) {
      setFile(null);
      return;
    }
    const error = validateExcelPdfFile(selected, config?.maxUploadBytes ?? 200 * 1024 * 1024);
    if (error) {
      setFile(null);
      setFileError(t(`excelPdf.errors.${error}`));
      return;
    }
    setFile(selected);
  };

  const startConversion = async () => {
    if (!file || uploading || !canCreate || !config?.enabled) return;
    const controller = new AbortController();
    uploadAbort.current = controller;
    activeUploadId.current = null;
    progressPhase.current = null;
    setUploading(true);
    setProgress(null);
    setFormError(null);
    setRequestId(null);
    try {
      const job = await excelPdfApi.uploadAndConvert(file, businessType, {
        signal: controller.signal,
        onProgress: (current) => {
          activeUploadId.current = current.uploadId;
          progressPhase.current = current.phase;
          setProgress(current);
        },
      });
      if (job.status === 'succeeded') {
        toast.success(t('excelPdf.conversionSucceeded'));
        setFile(null);
      } else if (job.status === 'failed') {
        toast.error(t('excelPdf.conversionFailed'));
        setFormError(translateError(locale, job.errorCode ?? 'EXCEL_PDF_OUTPUT_INVALID'));
      } else if (job.status === 'expired') {
        toast.info(t('excelPdf.status.expired'));
      }
      setPage(1);
      await loadJobs();
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setFormError(
        error instanceof AdminApiError
          ? translateError(locale, error.code)
          : t('excelPdf.errors.convert'),
      );
      setRequestId(error instanceof AdminApiError ? (error.requestId ?? null) : null);
    } finally {
      if (uploadAbort.current === controller) uploadAbort.current = null;
      activeUploadId.current = null;
      progressPhase.current = null;
      setProgress(null);
      setUploading(false);
    }
  };

  const stopCurrentOperation = async () => {
    const uploadId = activeUploadId.current;
    const phase = progressPhase.current;
    uploadAbort.current?.abort();
    if (!uploadId || phase !== 'uploading') return;
    setCancelling(true);
    try {
      await excelPdfApi.cancelUpload(uploadId);
      toast.info(t('excelPdf.cancelled'));
    } catch (error) {
      toast.error(
        error instanceof AdminApiError
          ? translateError(locale, error.code)
          : t('excelPdf.errors.cancel'),
      );
    } finally {
      setCancelling(false);
    }
  };

  const downloadJob = async (job: ExcelPdfJobSummary) => {
    if (!canDownload || downloadBusyId) return;
    setDownloadBusyId(job.id);
    try {
      const result = await excelPdfApi.download(
        job.id,
        `${job.fileName.replace(/\.xlsx$/i, '')}.pdf`,
      );
      const url = URL.createObjectURL(result.blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = result.filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast.success(t('excelPdf.downloadStarted'));
    } catch (error) {
      const message =
        error instanceof AdminApiError
          ? translateError(locale, error.code)
          : t('excelPdf.errors.download');
      toast.error(
        error instanceof AdminApiError && error.requestId
          ? `${message} ${t('quotationExport.requestId', { requestId: error.requestId })}`
          : message,
      );
    } finally {
      setDownloadBusyId(null);
    }
  };

  const retryJob = async (job: ExcelPdfJobSummary) => {
    if (!canRetry || retryBusyId) return;
    setRetryBusyId(job.id);
    try {
      await excelPdfApi.retry(job.id);
      toast.success(t('excelPdf.retryQueued'));
      await loadJobs();
    } catch (error) {
      toast.error(
        error instanceof AdminApiError
          ? translateError(locale, error.code)
          : t('excelPdf.errors.retry'),
      );
    } finally {
      setRetryBusyId(null);
    }
  };

  const deleteJob = async () => {
    if (!pendingDelete || !canDelete || deleteBusy) return;
    setDeleteBusy(true);
    try {
      await excelPdfApi.delete(pendingDelete.id);
      toast.success(t('excelPdf.deleteRequested'));
      setPendingDelete(null);
      await loadJobs();
    } catch (error) {
      toast.error(
        error instanceof AdminApiError
          ? translateError(locale, error.code)
          : t('excelPdf.errors.delete'),
      );
    } finally {
      setDeleteBusy(false);
    }
  };

  const columns = useMemo<DataTableColumn<ExcelPdfJobSummary>[]>(
    () => [
      {
        key: 'file',
        header: t('excelPdf.table.file'),
        render: (job) => (
          <div className="stack-xs">
            <strong className="excel-pdf-file-name" title={job.fileName}>
              {job.fileName}
            </strong>
            <span className="small muted">
              {formatBytes(job.fileSize)} · {t(`excelPdf.businessType.${job.businessType}`)}
            </span>
          </div>
        ),
      },
      {
        key: 'status',
        header: t('excelPdf.table.status'),
        render: (job) => (
          <div className="stack-xs">
            <Badge tone={STATUS_TONES[job.status]} title={job.errorCode ?? undefined}>
              {t(`excelPdf.status.${job.status}`)}
            </Badge>
            {job.errorCode ? (
              <span className="small muted" title={job.errorCode}>
                {translateError(locale, job.errorCode)}
              </span>
            ) : null}
          </div>
        ),
      },
      {
        key: 'output',
        header: t('excelPdf.table.output'),
        render: (job) => (
          <span className="small">
            {job.outputSize === null ? '—' : formatBytes(job.outputSize)}
            {job.pageCount === null ? '' : ` · ${t('excelPdf.pages', { count: job.pageCount })}`}
          </span>
        ),
      },
      {
        key: 'created',
        header: t('excelPdf.table.created'),
        render: (job) => <span className="nowrap small">{formatDate(job.createdAt, locale)}</span>,
      },
      {
        key: 'expires',
        header: t('excelPdf.table.expires'),
        render: (job) => (
          <span className="nowrap small">
            {job.expiresAt ? formatDate(job.expiresAt, locale) : '—'}
          </span>
        ),
      },
      {
        key: 'actions',
        header: t('excelPdf.table.actions'),
        align: 'right',
        width: 300,
        render: (job) => (
          <div className="excel-pdf-row-actions">
            {canDownload && job.canDownload ? (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  loading={downloadBusyId === job.id}
                  aria-label={t('excelPdf.actions.downloadFile', { fileName: job.fileName })}
                  onClick={() => void downloadJob(job)}
                >
                  {t('excelPdf.actions.download')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t('excelPdf.actions.previewFile', { fileName: job.fileName })}
                  onClick={() =>
                    window.open(excelPdfApi.previewUrl(job.id), '_blank', 'noopener,noreferrer')
                  }
                >
                  {t('excelPdf.actions.preview')}
                </Button>
              </>
            ) : null}
            {canRetry && job.status === 'failed' ? (
              <Button
                variant="secondary"
                size="sm"
                loading={retryBusyId === job.id}
                onClick={() => void retryJob(job)}
              >
                {t('excelPdf.actions.retry')}
              </Button>
            ) : null}
            {canDelete ? (
              <Button
                variant="danger"
                size="sm"
                disabled={job.status === 'processing'}
                onClick={() => setPendingDelete(job)}
              >
                {t('excelPdf.actions.delete')}
              </Button>
            ) : null}
          </div>
        ),
      },
    ],
    [canDelete, canDownload, canRetry, downloadBusyId, locale, retryBusyId, t],
  );

  if (!canRead) {
    return (
      <div className="stack">
        <PageHeader breadcrumb={breadcrumb} title={t('excelPdf.title')} />
        <Card>
          <EmptyState
            title={t('excelPdf.noPermission')}
            description={t('excelPdf.noPermissionHelp')}
          />
        </Card>
      </div>
    );
  }

  if (configLoading) {
    return (
      <div className="stack">
        <PageHeader breadcrumb={breadcrumb} title={t('excelPdf.title')} />
        <Card>
          <LoadingState label={t('common.loading')} rows={4} />
        </Card>
      </div>
    );
  }

  if (configError || !config) {
    return (
      <div className="stack">
        <PageHeader breadcrumb={breadcrumb} title={t('excelPdf.title')} />
        <Card>
          <EmptyState
            title={t('excelPdf.errors.configTitle')}
            description={configError ?? t('excelPdf.errors.config')}
            action={
              <Button variant="secondary" onClick={() => void loadConfig()}>
                {t('common.retry')}
              </Button>
            }
          />
        </Card>
      </div>
    );
  }

  if (!config.enabled) {
    return (
      <div className="stack">
        <PageHeader breadcrumb={breadcrumb} title={t('excelPdf.title')} />
        <Card>
          <EmptyState
            title={t('excelPdf.disabledTitle')}
            description={t('excelPdf.disabledHelp')}
          />
        </Card>
      </div>
    );
  }

  const uploadPercent = progress
    ? Math.min(100, Math.round((progress.uploadedBytes / progress.totalBytes) * 100))
    : 0;

  return (
    <div className="stack">
      <PageHeader
        breadcrumb={breadcrumb}
        title={t('excelPdf.title')}
        description={t('excelPdf.description', { maxSize: formatBytes(config.maxUploadBytes) })}
        actions={
          <Button variant="secondary" onClick={() => void loadJobs()}>
            {t('excelPdf.refresh')}
          </Button>
        }
      />

      <Card title={t('excelPdf.upload.title')}>
        <div className="grid-form">
          <div className="field">
            <label className="field-label" htmlFor="excel-pdf-business-type">
              {t('excelPdf.upload.businessType')}
            </label>
            <Select
              inputId="excel-pdf-business-type"
              value={businessType}
              disabled={uploading}
              options={EXCEL_PDF_BUSINESS_TYPES.map((type) => ({
                value: type,
                label: t(`excelPdf.businessType.${type}`),
              }))}
              onChange={(event) => setBusinessType(event.target.value as ExcelPdfBusinessType)}
            />
          </div>
          <div className="field">
            <span className="field-label">{t('excelPdf.upload.limits')}</span>
            <p className="field-help">
              {t('excelPdf.upload.limitDetail', {
                chunkSize: formatBytes(config.chunkBytes),
                outputSize: formatBytes(config.maxOutputBytes),
                pages: config.maxPages,
                days: config.retentionDays,
              })}
            </p>
          </div>
        </div>

        <div
          className={`excel-pdf-dropzone${dragActive ? ' is-dragging' : ''}`}
          role="group"
          aria-label={t('excelPdf.upload.dropLabel')}
          tabIndex={uploading ? -1 : 0}
          onKeyDown={(event) => {
            if (!uploading && (event.key === 'Enter' || event.key === ' ')) {
              event.preventDefault();
              inputRef.current?.click();
            }
          }}
          onDragEnter={(event) => {
            event.preventDefault();
            if (!uploading) setDragActive(true);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null))
              setDragActive(false);
          }}
          onDrop={(event) => {
            event.preventDefault();
            setDragActive(false);
            if (!uploading) selectFile(event.dataTransfer.files[0] ?? null);
          }}
        >
          <input
            ref={inputRef}
            type="file"
            className="visually-hidden"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            disabled={uploading}
            onChange={(event) => selectFile(event.target.files?.[0] ?? null)}
          />
          <strong>{t('excelPdf.upload.dropTitle')}</strong>
          <span className="muted">{t('excelPdf.upload.dropHelp')}</span>
          <Button
            variant="secondary"
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
          >
            {t('excelPdf.upload.choose')}
          </Button>
        </div>

        {file ? (
          <div className="excel-pdf-selected-file">
            <div className="stack-xs">
              <strong className="excel-pdf-file-name">{file.name}</strong>
              <span className="small muted">{formatBytes(file.size)}</span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              disabled={uploading}
              onClick={() => {
                selectFile(null);
                if (inputRef.current) inputRef.current.value = '';
              }}
            >
              {t('common.remove')}
            </Button>
          </div>
        ) : null}
        {fileError ? (
          <p className="form-error" role="alert">
            {fileError}
          </p>
        ) : null}

        {uploading ? (
          <div className="stack-sm" aria-live="polite">
            <div
              className={`upload-progress${progress?.phase === 'converting' ? ' is-indeterminate' : ''}`}
              role="progressbar"
              aria-label={t('excelPdf.upload.progressLabel')}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress?.phase === 'converting' ? undefined : uploadPercent}
            >
              <span
                style={{ width: progress?.phase === 'converting' ? '100%' : `${uploadPercent}%` }}
              />
            </div>
            <p className="small muted" role="status">
              {!progress
                ? t('excelPdf.upload.starting')
                : progress.phase === 'uploading'
                  ? t('excelPdf.upload.progress', {
                      uploaded: progress.uploadedChunks,
                      total: progress.chunkCount,
                      percent: uploadPercent,
                    })
                  : t('excelPdf.upload.converting', {
                      status: progress.jobStatus
                        ? t(`excelPdf.status.${progress.jobStatus}`)
                        : t('excelPdf.status.queued'),
                    })}
            </p>
            {progress?.retryingChunkIndex !== null && progress?.retryingChunkIndex !== undefined ? (
              <p className="small muted">
                {t('excelPdf.upload.retrying', { index: progress.retryingChunkIndex + 1 })}
              </p>
            ) : null}
            <div className="row">
              <Button
                variant="secondary"
                loading={cancelling}
                onClick={() => void stopCurrentOperation()}
              >
                {progress?.phase === 'uploading'
                  ? t('excelPdf.upload.cancel')
                  : t('excelPdf.upload.stopWaiting')}
              </Button>
            </div>
          </div>
        ) : null}

        {formError ? (
          <div className="form-error" role="alert">
            {formError}
            {requestId ? (
              <span className="small"> · {t('quotationExport.requestId', { requestId })}</span>
            ) : null}
          </div>
        ) : null}

        <div className="row">
          <Button
            loading={uploading}
            disabled={!file || uploading || !canCreate}
            onClick={() => void startConversion()}
          >
            {t('excelPdf.upload.start')}
          </Button>
          {!canCreate ? (
            <span className="small muted">{t('excelPdf.upload.createDenied')}</span>
          ) : null}
        </div>
      </Card>

      <Card
        title={t('excelPdf.history.title')}
        actions={
          <Button variant="ghost" size="sm" onClick={() => void loadJobs()}>
            {t('common.refresh')}
          </Button>
        }
      >
        <div className="excel-pdf-filters">
          <label className="field">
            <span className="field-label">{t('excelPdf.filters.status')}</span>
            <Select
              value={statusFilter}
              options={[
                { value: 'all', label: t('common.all') },
                ...(
                  ['queued', 'processing', 'succeeded', 'failed', 'cancelled', 'expired'] as const
                ).map((status) => ({ value: status, label: t(`excelPdf.status.${status}`) })),
              ]}
              onChange={(event) => {
                setStatusFilter(event.target.value as 'all' | ExcelPdfJobStatus);
                setPage(1);
              }}
            />
          </label>
          <label className="field">
            <span className="field-label">{t('excelPdf.filters.businessType')}</span>
            <Select
              value={businessFilter}
              options={[
                { value: 'all', label: t('common.all') },
                ...EXCEL_PDF_BUSINESS_TYPES.map((type) => ({
                  value: type,
                  label: t(`excelPdf.businessType.${type}`),
                })),
              ]}
              onChange={(event) => {
                setBusinessFilter(event.target.value as 'all' | ExcelPdfBusinessType);
                setPage(1);
              }}
            />
          </label>
        </div>

        <DataTable
          columns={columns}
          rows={jobs}
          rowKey={(job) => job.id}
          loading={jobsLoading}
          error={jobsError}
          onRetry={() => void loadJobs()}
          requestId={jobsRequestId}
          labels={{
            empty: t('excelPdf.history.empty'),
            emptyDescription: t('excelPdf.history.emptyHelp'),
            loading: t('common.loading'),
            errorTitle: t('excelPdf.errors.loadJobs'),
            retry: t('common.retry'),
            copy: t('common.copy'),
            copied: t('common.copied'),
          }}
        />
        {jobs.length > 0 ? (
          <Pagination
            page={page}
            pageSize={pageSize}
            total={pagination.total}
            totalPages={pagination.totalPages}
            pageSizeOptions={[20, 50]}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(1);
            }}
            labels={{
              previous: t('common.previous'),
              next: t('common.next'),
              rowsPerPage: t('common.rowsPerPage'),
              range: t('common.range', {
                from: pagination.total === 0 ? 0 : (page - 1) * pageSize + 1,
                to: Math.min(page * pageSize, pagination.total),
                total: pagination.total,
              }),
              first: t('common.first'),
              last: t('common.last'),
            }}
          />
        ) : null}
      </Card>

      <p className="small muted">
        {t('excelPdf.history.retentionHelp', { days: config.retentionDays })}
      </p>

      <ConfirmDialog
        open={pendingDelete !== null}
        title={t('excelPdf.deleteConfirm.title')}
        description={t('excelPdf.deleteConfirm.body', { fileName: pendingDelete?.fileName ?? '' })}
        confirmLabel={t('excelPdf.deleteConfirm.confirm')}
        cancelLabel={t('common.cancel')}
        loading={deleteBusy}
        onConfirm={() => void deleteJob()}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function formatDate(value: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}
