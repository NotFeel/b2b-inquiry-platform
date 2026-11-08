'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  ConfirmDialog,
  Field,
  Input,
  Modal,
  PageHeader,
  Pagination,
  Select,
  TabPanel,
  Tabs,
  Textarea,
  useToast,
} from '@b2b/ui';
import { AdminApiError } from '../../../../lib/admin-api';
import { commercialDocumentsApi } from '../../../../lib/commercial-documents-api';
import type {
  DocumentTemplateConfig,
  DocumentTemplateDetail,
  DocumentTemplateSummary,
  TemplateValidation,
} from '../../../../lib/commercial-documents-api';
import { translateError } from '../../../../lib/i18n';
import {
  documentTemplateListQuery,
  documentTemplateSignature,
  isDocumentTemplateDraftDeletable,
  type DocumentTemplateListFilters as TemplateFilters,
  type DocumentTemplateMeta as TemplateMeta,
} from '../../../../lib/document-template-page';
import { setAdminFormDirty } from '../../../../lib/unsaved-form';
import { useBreadcrumb } from '../../../../components/use-breadcrumb';
import { useSession } from '../../../../components/session-provider';

interface PreviewResult {
  html: string;
  sample: boolean;
  documentType: 'PI' | 'CI';
  locale: string;
  name: string;
  paperSize: string;
  orientation: string;
}

type EditorTab = 'basics' | 'style' | 'fields' | 'columns' | 'terms' | 'publish';
type WorkspaceView = 'edit' | 'preview';
type Action = 'save' | 'validate' | 'preview' | 'publish' | 'status' | 'delete' | 'create' | null;
type DiscardIntent =
  | { kind: 'open'; id: string }
  | { kind: 'copy'; id: string }
  | { kind: 'create' }
  | { kind: 'close' }
  | null;

const EDITOR_TABS: EditorTab[] = ['basics', 'style', 'fields', 'columns', 'terms', 'publish'];

function cloneConfig(config: DocumentTemplateConfig): DocumentTemplateConfig {
  return JSON.parse(JSON.stringify(config)) as DocumentTemplateConfig;
}

function moveItem<T>(items: T[], index: number, delta: number): T[] {
  const target = index + delta;
  if (target < 0 || target >= items.length) return items;
  const next = [...items];
  const [moved] = next.splice(index, 1);
  if (moved === undefined) return items;
  next.splice(target, 0, moved);
  return next;
}

function metaFromTemplate(template: DocumentTemplateDetail): TemplateMeta {
  return {
    name: template.name,
    description: template.description ?? '',
    locale: template.locale,
    paperSize: template.paperSize === 'Letter' ? 'Letter' : 'A4',
    orientation: template.orientation === 'landscape' ? 'landscape' : 'portrait',
    isDefault: template.isDefault,
  };
}

export default function DocumentTemplatesPage() {
  const { t, can, locale } = useSession();
  const breadcrumb = useBreadcrumb();
  const toast = useToast();

  const [rows, setRows] = useState<DocumentTemplateSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [pagination, setPagination] = useState({
    page: 1,
    pageSize: 20,
    total: 0,
    totalPages: 1,
  });
  const [filters, setFilters] = useState<TemplateFilters>({
    q: '',
    type: 'all',
    status: 'all',
    locale: '',
  });

  const [selected, setSelected] = useState<DocumentTemplateDetail | null>(null);
  const [meta, setMeta] = useState<TemplateMeta | null>(null);
  const [config, setConfig] = useState<DocumentTemplateConfig | null>(null);
  const [baseline, setBaseline] = useState('');
  const [action, setAction] = useState<Action>(null);
  const [validation, setValidation] = useState<TemplateValidation | null>(null);
  const [previewResult, setPreviewResult] = useState<PreviewResult | null>(null);
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>('edit');
  const [editorTab, setEditorTab] = useState<EditorTab>('basics');

  const [createOpen, setCreateOpen] = useState(false);
  const [createSourceId, setCreateSourceId] = useState('');
  const [createForm, setCreateForm] = useState({
    name: '',
    description: '',
    documentType: 'CI' as 'PI' | 'CI',
    locale: 'en-US',
    paperSize: 'A4' as 'A4' | 'Letter',
    orientation: 'portrait' as 'portrait' | 'landscape',
  });

  const [publishOpen, setPublishOpen] = useState(false);
  const [statusConfirm, setStatusConfirm] = useState<'enable' | 'disable' | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DocumentTemplateSummary | null>(null);
  const [hideAllSection, setHideAllSection] = useState<number | null>(null);
  const [discardIntent, setDiscardIntent] = useState<DiscardIntent>(null);
  const [copyingId, setCopyingId] = useState<string | null>(null);

  const canCreate = can('document_template.create');
  const canUpdate = can('document_template.update');
  const canPublish = can('document_template.publish');
  const canDelete = can('document_template.delete');

  const documentTypeLabel = (type: string) => t(`documentTemplates.documentTypes.${type}`);
  const localeLabel = (templateLocale: string) => t(`documentTemplates.locales.${templateLocale}`);
  const paperSizeLabel = (size: string) => t(`documentTemplates.paperSizes.${size}`);
  const orientationLabel = (value: string) => t(`documentTemplates.orientations.${value}`);
  const sectionLabel = (key: string) => t(`documentTemplates.sectionNames.${key}`);
  const fieldLabel = (key: string) => t(`documentTemplates.fieldNames.${key}`);
  const columnLabel = (key: string) => t(`documentTemplates.columnNames.${key}`);

  const currentSignature = meta && config ? documentTemplateSignature(meta, config) : '';
  const dirty = Boolean(selected && baseline && currentSignature !== baseline);
  const warningCount = validation?.warnings.length ?? 0;

  const errorMessage = useCallback(
    (cause: unknown, fallback = 'documentTemplates.loadError') =>
      cause instanceof AdminApiError ? translateError(locale, cause.code) : t(fallback),
    [locale, t],
  );

  const validationErrorLabel = (message: string) => {
    const duplicateSection = /^Duplicate section (.+)\.$/.exec(message);
    if (duplicateSection?.[1]) {
      return t('documentTemplates.validation.duplicateSection', {
        name: sectionLabel(duplicateSection[1]),
      });
    }
    const duplicateField = /^Duplicate field (.+)\.$/.exec(message);
    if (duplicateField?.[1]) {
      return t('documentTemplates.validation.duplicateField', {
        name: fieldLabel(duplicateField[1]),
      });
    }
    const invalidSection = /^Field (.+) belongs to (.+), not (.+)\.$/.exec(message);
    if (invalidSection?.[1] && invalidSection[2] && invalidSection[3]) {
      return t('documentTemplates.validation.fieldInWrongSection', {
        name: fieldLabel(invalidSection[1]),
        expected: sectionLabel(invalidSection[2]),
        actual: sectionLabel(invalidSection[3]),
      });
    }
    const duplicateColumn = /^Duplicate item column (.+)\.$/.exec(message);
    if (duplicateColumn?.[1]) {
      return t('documentTemplates.validation.duplicateColumn', {
        name: columnLabel(duplicateColumn[1]),
      });
    }
    if (message === 'The description column is required.') {
      return t('documentTemplates.validation.descriptionColumnRequired');
    }
    if (message === 'The amount column is required.') {
      return t('documentTemplates.validation.amountColumnRequired');
    }
    return t('documentTemplates.validation.invalidConfig');
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await commercialDocumentsApi.templates(
        documentTemplateListQuery(filters, page, pageSize),
      );
      setRows(result.data);
      setPagination(result.pagination);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [errorMessage, filters, page, pageSize]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!dirty) return undefined;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  useEffect(() => {
    setAdminFormDirty(dirty);
    return () => setAdminFormDirty(false);
  }, [dirty]);

  const mutateConfig = (mutator: (draft: DocumentTemplateConfig) => void) => {
    setConfig((current) => {
      if (!current) return current;
      const next = cloneConfig(current);
      mutator(next);
      return next;
    });
    setValidation(null);
  };

  const resetEditor = () => {
    setSelected(null);
    setMeta(null);
    setConfig(null);
    setBaseline('');
    setValidation(null);
    setPreviewResult(null);
    setWorkspaceView('edit');
    setEditorTab('basics');
    setPublishOpen(false);
    setStatusConfirm(null);
    setDeleteTarget(null);
  };

  const applyTemplate = (detail: DocumentTemplateDetail) => {
    const nextMeta = metaFromTemplate(detail);
    const nextConfig = cloneConfig(detail.draftConfig);
    setSelected(detail);
    setMeta(nextMeta);
    setConfig(nextConfig);
    setBaseline(documentTemplateSignature(nextMeta, nextConfig));
    setValidation(null);
    setPreviewResult(null);
    setWorkspaceView('edit');
    setEditorTab('basics');
  };

  const openTemplate = async (id: string) => {
    setAction('save');
    setError(null);
    try {
      const detail = await commercialDocumentsApi.template(id);
      applyTemplate(detail);
    } catch (cause) {
      toast.error(errorMessage(cause));
    } finally {
      setAction(null);
    }
  };

  const requestOpenTemplate = (id: string) => {
    if (selected?.id === id) return;
    if (dirty) {
      setDiscardIntent({ kind: 'open', id });
      return;
    }
    resetEditor();
    void openTemplate(id);
  };

  const requestCreate = () => {
    if (dirty) {
      setDiscardIntent({ kind: 'create' });
      return;
    }
    setCreateOpen(true);
  };

  const requestCloseEditor = () => {
    if (dirty) {
      setDiscardIntent({ kind: 'close' });
      return;
    }
    resetEditor();
  };

  const persistTemplate = async (): Promise<DocumentTemplateDetail | null> => {
    if (!selected || !meta || !config || !canUpdate) return selected;
    const updated = await commercialDocumentsApi.updateTemplate(selected.id, {
      name: meta.name.trim(),
      description: meta.description.trim() || null,
      locale: meta.locale,
      paperSize: meta.paperSize,
      orientation: meta.orientation,
      isDefault: selected.status === 'ACTIVE' ? meta.isDefault : false,
      config,
      expectedUpdatedAt: selected.updatedAt,
    });
    applyTemplate(updated);
    return updated;
  };

  const save = async () => {
    if (!selected || !meta || !config || !canUpdate) return;
    setAction('save');
    setError(null);
    try {
      await persistTemplate();
      toast.success(t('documentTemplates.saved'));
      await load();
    } catch (cause) {
      const message = errorMessage(cause);
      setError(message);
      toast.error(message);
    } finally {
      setAction(null);
    }
  };

  const validate = async () => {
    if (!selected || !meta || !config) return;
    setAction('validate');
    try {
      const report = await commercialDocumentsApi.validateTemplate(selected.id, {
        config,
        documentType: selected.documentType,
        locale: meta.locale,
      });
      setValidation(report);
      setEditorTab('publish');
      setWorkspaceView('edit');
    } catch (cause) {
      toast.error(errorMessage(cause));
    } finally {
      setAction(null);
    }
  };

  const preview = async () => {
    if (!selected || !meta || !config) return;
    setAction('preview');
    try {
      const report = await commercialDocumentsApi.previewTemplate(selected.id, {
        config,
        documentType: selected.documentType,
        locale: meta.locale,
      });
      setPreviewResult({
        html: report.html,
        sample: report.sample,
        documentType: report.documentType,
        locale: report.locale,
        name: meta.name,
        paperSize: meta.paperSize,
        orientation: meta.orientation,
      });
      setWorkspaceView('preview');
    } catch (cause) {
      toast.error(errorMessage(cause));
    } finally {
      setAction(null);
    }
  };

  const publish = async () => {
    if (!selected || !canPublish) return;
    setAction('publish');
    try {
      const saved = await persistTemplate();
      if (!saved) return;
      const updated = await commercialDocumentsApi.publishTemplate(saved.id);
      applyTemplate(updated);
      setPublishOpen(false);
      toast.success(t('documentTemplates.published'));
      await load();
    } catch (cause) {
      toast.error(errorMessage(cause));
    } finally {
      setAction(null);
    }
  };

  const changeStatus = async () => {
    if (!selected || !statusConfirm || !canUpdate) return;
    setAction('status');
    try {
      const updated = await commercialDocumentsApi.updateTemplate(selected.id, {
        status: statusConfirm === 'disable' ? 'DISABLED' : 'DRAFT',
        expectedUpdatedAt: selected.updatedAt,
      });
      applyTemplate(updated);
      setStatusConfirm(null);
      toast.success(
        t(
          statusConfirm === 'disable'
            ? 'documentTemplates.disabledSuccess'
            : 'documentTemplates.enabledSuccess',
        ),
      );
      await load();
    } catch (cause) {
      toast.error(errorMessage(cause));
    } finally {
      setAction(null);
    }
  };

  const removeDraft = async () => {
    if (!deleteTarget || !canDelete) return;
    setAction('delete');
    try {
      await commercialDocumentsApi.deleteTemplate(deleteTarget.id);
      if (selected?.id === deleteTarget.id) resetEditor();
      setDeleteTarget(null);
      toast.success(t('documentTemplates.deleted'));
      if (rows.length === 1 && page > 1) {
        setPage((current) => Math.max(1, current - 1));
      } else {
        await load();
      }
    } catch (cause) {
      toast.error(errorMessage(cause));
    } finally {
      setAction(null);
    }
  };

  const copyTemplate = async (source: DocumentTemplateSummary) => {
    if (!canCreate) return;
    setCopyingId(source.id);
    try {
      const created = await commercialDocumentsApi.createTemplate({
        name: `${source.name} ${t('documentTemplates.copySuffix')}`.slice(0, 180),
        description: source.description,
        documentType: source.documentType,
        locale: source.locale,
        paperSize: source.paperSize,
        orientation: source.orientation,
        isDefault: false,
        config: source.draftConfig,
      });
      toast.success(t('documentTemplates.copied'));
      await load();
      requestOpenTemplate(created.id);
    } catch (cause) {
      toast.error(errorMessage(cause));
    } finally {
      setCopyingId(null);
    }
  };

  const requestCopy = (row: DocumentTemplateSummary) => {
    if (dirty) {
      setDiscardIntent({ kind: 'copy', id: row.id });
      return;
    }
    void copyTemplate(row);
  };

  const create = async () => {
    if (!createForm.name.trim() || !canCreate) return;
    setAction('create');
    try {
      const source = rows.find((row) => row.id === createSourceId);
      const created = await commercialDocumentsApi.createTemplate({
        name: createForm.name.trim(),
        description: createForm.description.trim() || null,
        documentType: createForm.documentType,
        locale: createForm.locale,
        paperSize: createForm.paperSize,
        orientation: createForm.orientation,
        isDefault: false,
        ...(source ? { config: source.draftConfig } : {}),
      });
      setCreateOpen(false);
      setCreateSourceId('');
      setCreateForm({
        name: '',
        description: '',
        documentType: 'CI',
        locale: 'en-US',
        paperSize: 'A4',
        orientation: 'portrait',
      });
      toast.success(t('documentTemplates.created'));
      await load();
      requestOpenTemplate(created.id);
    } catch (cause) {
      toast.error(errorMessage(cause));
    } finally {
      setAction(null);
    }
  };

  const confirmDiscard = () => {
    const intent = discardIntent;
    setBaseline(currentSignature);
    setDiscardIntent(null);
    if (!intent) return;
    if (intent.kind === 'open') {
      resetEditor();
      void openTemplate(intent.id);
      return;
    }
    if (intent.kind === 'copy') {
      const row = rows.find((candidate) => candidate.id === intent.id);
      resetEditor();
      if (row) void copyTemplate(row);
      return;
    }
    if (intent.kind === 'create') {
      resetEditor();
      setCreateOpen(true);
      return;
    }
    resetEditor();
  };

  const currentRange = useMemo(() => {
    if (pagination.total === 0) return t('documentTemplates.noResults');
    const start = (pagination.page - 1) * pagination.pageSize + 1;
    const end = Math.min(pagination.total, pagination.page * pagination.pageSize);
    return t('documentTemplates.range', { start, end, total: pagination.total });
  }, [pagination, t]);

  const createSource = rows.find((row) => row.id === createSourceId);

  return (
    <div className="stack">
      <PageHeader
        breadcrumb={breadcrumb}
        title={selected ? selected.name : t('documentTemplates.title')}
        description={
          selected ? t('documentTemplates.editorDescription') : t('documentTemplates.description')
        }
        actions={
          <div className="row-actions">
            {selected ? (
              <Button variant="secondary" onClick={requestCloseEditor} disabled={Boolean(action)}>
                {t('documentTemplates.backToList')}
              </Button>
            ) : (
              <Button variant="secondary" loading={loading} onClick={() => void load()}>
                {t('commercialDocuments.actions.refresh')}
              </Button>
            )}
            {!selected && canCreate ? (
              <Button onClick={requestCreate}>{t('documentTemplates.new')}</Button>
            ) : null}
          </div>
        }
      />

      {error ? (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      ) : null}

      {!selected ? (
        <>
          <section className="panel stack-sm" aria-label={t('documentTemplates.filters')}>
            <div className="template-filters">
              <Field label={t('documentTemplates.search')}>
                {({ inputId, describedBy }) => (
                  <Input
                    inputId={inputId}
                    describedBy={describedBy}
                    type="search"
                    value={filters.q}
                    placeholder={t('documentTemplates.searchPlaceholder')}
                    maxLength={120}
                    onChange={(event) => {
                      setPage(1);
                      setFilters({ ...filters, q: event.target.value });
                    }}
                  />
                )}
              </Field>
              <Field label={t('documentTemplates.type')}>
                {({ inputId, describedBy }) => (
                  <Select
                    inputId={inputId}
                    describedBy={describedBy}
                    value={filters.type}
                    options={[
                      { value: 'all', label: t('documentTemplates.allTypes') },
                      { value: 'PI', label: documentTypeLabel('PI') },
                      { value: 'CI', label: documentTypeLabel('CI') },
                    ]}
                    onChange={(event) => {
                      setPage(1);
                      setFilters({
                        ...filters,
                        type: event.target.value as TemplateFilters['type'],
                      });
                    }}
                  />
                )}
              </Field>
              <Field label={t('documentTemplates.status')}>
                {({ inputId, describedBy }) => (
                  <Select
                    inputId={inputId}
                    describedBy={describedBy}
                    value={filters.status}
                    options={[
                      { value: 'all', label: t('documentTemplates.statuses.all') },
                      { value: 'DRAFT', label: t('documentTemplates.statuses.DRAFT') },
                      { value: 'ACTIVE', label: t('documentTemplates.statuses.ACTIVE') },
                      { value: 'DISABLED', label: t('documentTemplates.statuses.DISABLED') },
                    ]}
                    onChange={(event) => {
                      setPage(1);
                      setFilters({
                        ...filters,
                        status: event.target.value as TemplateFilters['status'],
                      });
                    }}
                  />
                )}
              </Field>
              <Field label={t('documentTemplates.locale')}>
                {({ inputId, describedBy }) => (
                  <Select
                    inputId={inputId}
                    describedBy={describedBy}
                    value={filters.locale}
                    options={[
                      { value: '', label: t('documentTemplates.allLocales') },
                      { value: 'en-US', label: localeLabel('en-US') },
                      { value: 'zh-CN', label: localeLabel('zh-CN') },
                    ]}
                    onChange={(event) => {
                      setPage(1);
                      setFilters({
                        ...filters,
                        locale: event.target.value as TemplateFilters['locale'],
                      });
                    }}
                  />
                )}
              </Field>
              <div className="template-filter-clear">
                <Button
                  variant="ghost"
                  onClick={() => {
                    setPage(1);
                    setFilters({ q: '', type: 'all', status: 'all', locale: '' });
                  }}
                  disabled={
                    !filters.q &&
                    filters.type === 'all' &&
                    filters.status === 'all' &&
                    !filters.locale
                  }
                >
                  {t('documentTemplates.clearFilters')}
                </Button>
              </div>
            </div>
          </section>

          <section className="panel table-scroll" aria-live="polite">
            {loading ? (
              <p>{t('common.loading')}</p>
            ) : rows.length === 0 ? (
              <p>{t('documentTemplates.emptyList')}</p>
            ) : (
              <>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>{t('documentTemplates.name')}</th>
                      <th>{t('documentTemplates.type')}</th>
                      <th>{t('documentTemplates.locale')}</th>
                      <th>{t('documentTemplates.paper')}</th>
                      <th>{t('documentTemplates.status')}</th>
                      <th>{t('documentTemplates.default')}</th>
                      <th>{t('documentTemplates.version')}</th>
                      <th>{t('documentTemplates.updatedAt')}</th>
                      <th>{t('documentTemplates.actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id}>
                        <td>
                          <div className="template-name-cell">
                            <strong>{row.name}</strong>
                            <small className="muted mono">{row.code}</small>
                          </div>
                        </td>
                        <td>{documentTypeLabel(row.documentType)}</td>
                        <td>{localeLabel(row.locale)}</td>
                        <td>
                          {paperSizeLabel(row.paperSize)} · {orientationLabel(row.orientation)}
                        </td>
                        <td>
                          <Badge
                            tone={
                              row.status === 'ACTIVE'
                                ? 'success'
                                : row.status === 'DISABLED'
                                  ? 'warning'
                                  : 'neutral'
                            }
                          >
                            {t(`documentTemplates.statuses.${row.status}`)}
                          </Badge>
                        </td>
                        <td>{row.isDefault ? t('common.yes') : '—'}</td>
                        <td>{row.currentVersion ? `v${row.currentVersion.version}` : '—'}</td>
                        <td>{new Date(row.updatedAt).toLocaleDateString(locale)}</td>
                        <td>
                          <div className="row-actions template-row-actions">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => requestOpenTemplate(row.id)}
                            >
                              {t('documentTemplates.open')}
                            </Button>
                            {canCreate ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                loading={copyingId === row.id}
                                disabled={Boolean(copyingId) && copyingId !== row.id}
                                onClick={() => requestCopy(row)}
                              >
                                {t('documentTemplates.copy')}
                              </Button>
                            ) : null}
                            {canDelete && isDocumentTemplateDraftDeletable(row) ? (
                              <Button
                                size="sm"
                                variant="danger"
                                onClick={() => setDeleteTarget(row)}
                              >
                                {t('documentTemplates.deleteDraft')}
                              </Button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="template-list-footer">
                  <span className="muted">
                    {t('documentTemplates.resultCount', {
                      count: pagination.total,
                    })}
                  </span>
                  <Pagination
                    page={pagination.page}
                    pageSize={pagination.pageSize}
                    total={pagination.total}
                    totalPages={pagination.totalPages}
                    pageSizeOptions={[10, 20, 50, 100]}
                    onPageChange={setPage}
                    onPageSizeChange={(nextPageSize) => {
                      setPage(1);
                      setPageSize(nextPageSize);
                    }}
                    labels={{
                      previous: t('documentTemplates.previousPage'),
                      next: t('documentTemplates.nextPage'),
                      rowsPerPage: t('documentTemplates.rowsPerPage'),
                      range: currentRange,
                    }}
                  />
                </div>
              </>
            )}
          </section>
        </>
      ) : meta && config ? (
        <section
          className="panel stack-sm template-editor"
          aria-label={t('documentTemplates.editor')}
        >
          <div className="template-editor-heading">
            <div className="stack-sm">
              <div className="row-actions">
                <Badge
                  tone={
                    selected.status === 'ACTIVE'
                      ? 'success'
                      : selected.status === 'DISABLED'
                        ? 'warning'
                        : 'neutral'
                  }
                >
                  {t(`documentTemplates.statuses.${selected.status}`)}
                </Badge>
                <span className="muted">
                  {documentTypeLabel(selected.documentType)} · {localeLabel(meta.locale)} ·{' '}
                  {paperSizeLabel(meta.paperSize)} · {orientationLabel(meta.orientation)}
                </span>
                {dirty ? (
                  <span className="notice notice-warning" role="status">
                    {t('documentTemplates.unsaved')}
                  </span>
                ) : (
                  <span className="muted">{t('documentTemplates.allSaved')}</span>
                )}
              </div>
              <small className="muted mono">{selected.code}</small>
            </div>
            <div className="row-actions template-primary-actions">
              <Button
                variant="secondary"
                loading={action === 'validate'}
                disabled={Boolean(action) && action !== 'validate'}
                onClick={() => void validate()}
              >
                {t('documentTemplates.validate')}
              </Button>
              <Button
                variant="secondary"
                loading={action === 'preview'}
                disabled={Boolean(action) && action !== 'preview'}
                onClick={() => void preview()}
              >
                {t('documentTemplates.preview')}
              </Button>
              {canUpdate ? (
                <Button
                  loading={action === 'save'}
                  disabled={Boolean(action) && action !== 'save'}
                  onClick={() => void save()}
                >
                  {t('documentTemplates.save')}
                </Button>
              ) : null}
            </div>
          </div>

          <div className="template-workspace-switch">
            <Tabs
              items={[
                { id: 'edit', label: t('documentTemplates.workspaceEdit') },
                { id: 'preview', label: t('documentTemplates.workspacePreview') },
              ]}
              activeId={workspaceView}
              onChange={(id) => setWorkspaceView(id as WorkspaceView)}
              ariaLabel={t('documentTemplates.workspace')}
            />
          </div>

          {workspaceView === 'preview' ? (
            <div className="template-preview-workspace">
              <div className="template-preview-meta">
                <div>
                  <strong>{t('documentTemplates.samplePreview')}</strong>
                  <p className="muted">{t('documentTemplates.samplePreviewHint')}</p>
                </div>
                {previewResult ? (
                  <p className="muted">
                    {previewResult.name} · {documentTypeLabel(previewResult.documentType)} ·{' '}
                    {localeLabel(previewResult.locale)} · {paperSizeLabel(previewResult.paperSize)}{' '}
                    · {orientationLabel(previewResult.orientation)}
                  </p>
                ) : null}
                <div className="row-actions">
                  <Button
                    loading={action === 'preview'}
                    disabled={Boolean(action) && action !== 'preview'}
                    onClick={() => void preview()}
                  >
                    {t('documentTemplates.preview')}
                  </Button>
                  <Button variant="secondary" onClick={() => setWorkspaceView('edit')}>
                    {t('documentTemplates.backToEdit')}
                  </Button>
                </div>
              </div>
              {previewResult ? (
                <iframe
                  className="document-preview-frame template-preview-large"
                  title={t('documentTemplates.samplePreview')}
                  srcDoc={previewResult.html}
                  sandbox=""
                />
              ) : (
                <div className="template-preview-empty">
                  <p>{t('documentTemplates.previewEmpty')}</p>
                </div>
              )}
            </div>
          ) : (
            <>
              <Tabs
                items={EDITOR_TABS.map((tab) => ({
                  id: tab,
                  label: t(`documentTemplates.tabs.${tab}`),
                  ...(tab === 'publish' && warningCount > 0 ? { badge: String(warningCount) } : {}),
                }))}
                activeId={editorTab}
                onChange={(id) => setEditorTab(id as EditorTab)}
                ariaLabel={t('documentTemplates.editorTabs')}
              />

              <TabPanel id="basics" activeId={editorTab}>
                <div className="stack-sm">
                  <h3>{t('documentTemplates.tabs.basics')}</h3>
                  <div className="form-grid">
                    <Field label={t('documentTemplates.name')} required>
                      {({ inputId, describedBy }) => (
                        <Input
                          inputId={inputId}
                          describedBy={describedBy}
                          value={meta.name}
                          maxLength={180}
                          onChange={(event) => setMeta({ ...meta, name: event.target.value })}
                        />
                      )}
                    </Field>
                    <Field label={t('documentTemplates.descriptionField')}>
                      {({ inputId, describedBy }) => (
                        <Input
                          inputId={inputId}
                          describedBy={describedBy}
                          value={meta.description}
                          maxLength={500}
                          onChange={(event) =>
                            setMeta({ ...meta, description: event.target.value })
                          }
                        />
                      )}
                    </Field>
                    <Field label={t('documentTemplates.type')}>
                      {({ inputId, describedBy }) => (
                        <Input
                          inputId={inputId}
                          describedBy={describedBy}
                          value={documentTypeLabel(selected.documentType)}
                          disabled
                        />
                      )}
                    </Field>
                    <Field label={t('documentTemplates.locale')}>
                      {({ inputId, describedBy }) => (
                        <Select
                          inputId={inputId}
                          describedBy={describedBy}
                          value={meta.locale}
                          options={[
                            { value: 'en-US', label: localeLabel('en-US') },
                            { value: 'zh-CN', label: localeLabel('zh-CN') },
                          ]}
                          onChange={(event) => setMeta({ ...meta, locale: event.target.value })}
                        />
                      )}
                    </Field>
                    <Field label={t('documentTemplates.paper')}>
                      {({ inputId, describedBy }) => (
                        <Select
                          inputId={inputId}
                          describedBy={describedBy}
                          value={meta.paperSize}
                          options={[
                            { value: 'A4', label: paperSizeLabel('A4') },
                            { value: 'Letter', label: paperSizeLabel('Letter') },
                          ]}
                          onChange={(event) =>
                            setMeta({
                              ...meta,
                              paperSize: event.target.value as 'A4' | 'Letter',
                            })
                          }
                        />
                      )}
                    </Field>
                    <Field label={t('documentTemplates.orientation')}>
                      {({ inputId, describedBy }) => (
                        <Select
                          inputId={inputId}
                          describedBy={describedBy}
                          value={meta.orientation}
                          options={[
                            { value: 'portrait', label: orientationLabel('portrait') },
                            { value: 'landscape', label: orientationLabel('landscape') },
                          ]}
                          onChange={(event) =>
                            setMeta({
                              ...meta,
                              orientation: event.target.value as 'portrait' | 'landscape',
                            })
                          }
                        />
                      )}
                    </Field>
                  </div>
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={meta.isDefault}
                      disabled={selected.status !== 'ACTIVE' || !canUpdate}
                      onChange={(event) => setMeta({ ...meta, isDefault: event.target.checked })}
                    />
                    <span>{t('documentTemplates.default')}</span>
                  </label>
                  <p className="muted">
                    {t(
                      selected.status === 'ACTIVE'
                        ? 'documentTemplates.defaultScopeHint'
                        : 'documentTemplates.defaultRequiresActive',
                    )}
                  </p>
                </div>
              </TabPanel>

              <TabPanel id="style" activeId={editorTab}>
                <div className="stack-sm">
                  <h3>{t('documentTemplates.theme.title')}</h3>
                  <div className="form-grid">
                    <Field label={t('documentTemplates.theme.headerTitle')}>
                      {({ inputId, describedBy }) => (
                        <Input
                          inputId={inputId}
                          describedBy={describedBy}
                          value={config.header.title}
                          onChange={(event) =>
                            mutateConfig((draft) => {
                              draft.header.title = event.target.value;
                            })
                          }
                        />
                      )}
                    </Field>
                    <Field label={t('documentTemplates.theme.headerSubtitle')}>
                      {({ inputId, describedBy }) => (
                        <Input
                          inputId={inputId}
                          describedBy={describedBy}
                          value={config.header.subtitle ?? ''}
                          onChange={(event) =>
                            mutateConfig((draft) => {
                              draft.header.subtitle = event.target.value || undefined;
                            })
                          }
                        />
                      )}
                    </Field>
                    <Field label={t('documentTemplates.theme.primary')}>
                      {({ inputId, describedBy }) => (
                        <Input
                          inputId={inputId}
                          describedBy={describedBy}
                          type="color"
                          value={config.theme.primaryColor}
                          onChange={(event) =>
                            mutateConfig((draft) => {
                              draft.theme.primaryColor = event.target.value;
                            })
                          }
                        />
                      )}
                    </Field>
                    <Field label={t('documentTemplates.theme.accent')}>
                      {({ inputId, describedBy }) => (
                        <Input
                          inputId={inputId}
                          describedBy={describedBy}
                          type="color"
                          value={config.theme.accentColor}
                          onChange={(event) =>
                            mutateConfig((draft) => {
                              draft.theme.accentColor = event.target.value;
                            })
                          }
                        />
                      )}
                    </Field>
                    <Field label={t('documentTemplates.theme.font')}>
                      {({ inputId, describedBy }) => (
                        <Select
                          inputId={inputId}
                          describedBy={describedBy}
                          value={config.theme.fontFamily}
                          options={[
                            'Helvetica',
                            'Arial',
                            'Times New Roman',
                            'Georgia',
                            'Noto Sans',
                            'DejaVu Sans',
                          ].map((font) => ({ value: font, label: font }))}
                          onChange={(event) =>
                            mutateConfig((draft) => {
                              draft.theme.fontFamily = event.target.value;
                            })
                          }
                        />
                      )}
                    </Field>
                    <Field label={t('documentTemplates.theme.fontSize')}>
                      {({ inputId, describedBy }) => (
                        <Input
                          inputId={inputId}
                          describedBy={describedBy}
                          type="number"
                          min={8}
                          max={14}
                          value={String(config.theme.fontSizePt)}
                          onChange={(event) =>
                            mutateConfig((draft) => {
                              draft.theme.fontSizePt = Number(event.target.value);
                            })
                          }
                        />
                      )}
                    </Field>
                    {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
                      <Field
                        key={side}
                        label={`${t('documentTemplates.theme.margins')} · ${t(`documentTemplates.marginSides.${side}`)}`}
                      >
                        {({ inputId, describedBy }) => (
                          <Input
                            inputId={inputId}
                            describedBy={describedBy}
                            type="number"
                            min={8}
                            max={30}
                            value={String(config.page.marginMm[side])}
                            onChange={(event) =>
                              mutateConfig((draft) => {
                                draft.page.marginMm[side] = Number(event.target.value);
                              })
                            }
                          />
                        )}
                      </Field>
                    ))}
                  </div>
                  <div className="template-toggle-grid">
                    <label className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={config.header.showLogo}
                        onChange={(event) =>
                          mutateConfig((draft) => {
                            draft.header.showLogo = event.target.checked;
                          })
                        }
                      />
                      <span>{t('documentTemplates.theme.showLogo')}</span>
                    </label>
                    <label className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={config.header.showStamp}
                        onChange={(event) =>
                          mutateConfig((draft) => {
                            draft.header.showStamp = event.target.checked;
                          })
                        }
                      />
                      <span>{t('documentTemplates.theme.showStamp')}</span>
                    </label>
                    <label className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={config.header.showDocumentType}
                        onChange={(event) =>
                          mutateConfig((draft) => {
                            draft.header.showDocumentType = event.target.checked;
                          })
                        }
                      />
                      <span>{t('documentTemplates.theme.showDocumentType')}</span>
                    </label>
                    <label className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={config.footer.showText}
                        onChange={(event) =>
                          mutateConfig((draft) => {
                            draft.footer.showText = event.target.checked;
                          })
                        }
                      />
                      <span>{t('documentTemplates.theme.showFooter')}</span>
                    </label>
                  </div>
                  <Area
                    label={t('documentTemplates.theme.footer')}
                    value={config.footer.text ?? ''}
                    disabled={!config.footer.showText}
                    onChange={(value) =>
                      mutateConfig((draft) => {
                        draft.footer.text = value || undefined;
                      })
                    }
                  />
                </div>
              </TabPanel>

              <TabPanel id="fields" activeId={editorTab}>
                <div className="stack-sm">
                  <div className="row-between">
                    <div>
                      <h3>{t('documentTemplates.sections.fields')}</h3>
                      <p className="muted">{t('documentTemplates.fieldsHint')}</p>
                    </div>
                  </div>
                  {config.sections.map((section, sectionIndex) => (
                    <details key={section.key} className="panel stack-sm">
                      <summary>
                        {sectionLabel(section.key)}
                        {section.title && section.title !== sectionLabel(section.key)
                          ? ` · ${section.title}`
                          : ''}
                        {' · '}
                        {section.fields.filter((field) => field.visible).length}/
                        {section.fields.length}
                      </summary>
                      <div className="row-actions">
                        <label className="checkbox-row">
                          <input
                            type="checkbox"
                            checked={section.visible}
                            onChange={(event) =>
                              mutateConfig((draft) => {
                                draft.sections[sectionIndex]!.visible = event.target.checked;
                              })
                            }
                          />
                          <span>{t('documentTemplates.sections.visible')}</span>
                        </label>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            mutateConfig((draft) => {
                              draft.sections[sectionIndex]!.fields.forEach((field) => {
                                field.visible = true;
                              });
                            })
                          }
                        >
                          {t('documentTemplates.showAllFields')}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setHideAllSection(sectionIndex)}
                        >
                          {t('documentTemplates.hideAllFields')}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={sectionIndex === 0}
                          aria-label={t('documentTemplates.accessibility.moveSectionUp', {
                            name: sectionLabel(section.key),
                          })}
                          onClick={() =>
                            mutateConfig((draft) => {
                              draft.sections = moveItem(draft.sections, sectionIndex, -1);
                            })
                          }
                        >
                          ↑
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={sectionIndex === config.sections.length - 1}
                          aria-label={t('documentTemplates.accessibility.moveSectionDown', {
                            name: sectionLabel(section.key),
                          })}
                          onClick={() =>
                            mutateConfig((draft) => {
                              draft.sections = moveItem(draft.sections, sectionIndex, 1);
                            })
                          }
                        >
                          ↓
                        </Button>
                      </div>
                      <Field label={t('documentTemplates.sections.title')}>
                        {({ inputId, describedBy }) => (
                          <Input
                            inputId={inputId}
                            describedBy={describedBy}
                            value={section.title ?? ''}
                            onChange={(event) =>
                              mutateConfig((draft) => {
                                draft.sections[sectionIndex]!.title =
                                  event.target.value || undefined;
                              })
                            }
                          />
                        )}
                      </Field>
                      <div className="template-field-list">
                        {section.fields.map((field, fieldIndex) => (
                          <article className="template-field-card" key={field.key}>
                            <div className="template-field-card-head">
                              <label className="checkbox-row">
                                <input
                                  type="checkbox"
                                  checked={field.visible}
                                  aria-label={t('documentTemplates.accessibility.fieldVisible', {
                                    name: fieldLabel(field.key),
                                  })}
                                  onChange={(event) =>
                                    mutateConfig((draft) => {
                                      draft.sections[sectionIndex]!.fields[fieldIndex]!.visible =
                                        event.target.checked;
                                    })
                                  }
                                />
                                <strong>{fieldLabel(field.key)}</strong>
                              </label>
                              <small className="muted mono">{field.key}</small>
                            </div>
                            <Field label={t('documentTemplates.sections.label')}>
                              {({ inputId, describedBy }) => (
                                <Input
                                  inputId={inputId}
                                  describedBy={describedBy}
                                  value={field.label ?? ''}
                                  aria-label={t('documentTemplates.accessibility.fieldLabel', {
                                    name: fieldLabel(field.key),
                                  })}
                                  onChange={(event) =>
                                    mutateConfig((draft) => {
                                      draft.sections[sectionIndex]!.fields[fieldIndex]!.label =
                                        event.target.value;
                                    })
                                  }
                                />
                              )}
                            </Field>
                            <div className="row-between">
                              <label className="checkbox-row">
                                <input
                                  type="checkbox"
                                  checked={field.required}
                                  disabled={!field.visible}
                                  aria-label={t('documentTemplates.accessibility.fieldRequired', {
                                    name: fieldLabel(field.key),
                                  })}
                                  onChange={(event) =>
                                    mutateConfig((draft) => {
                                      draft.sections[sectionIndex]!.fields[fieldIndex]!.required =
                                        event.target.checked;
                                    })
                                  }
                                />
                                <span>{t('documentTemplates.sections.required')}</span>
                              </label>
                              <div className="row-actions">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  disabled={fieldIndex === 0}
                                  aria-label={t('documentTemplates.accessibility.moveFieldUp', {
                                    name: fieldLabel(field.key),
                                  })}
                                  onClick={() =>
                                    mutateConfig((draft) => {
                                      draft.sections[sectionIndex]!.fields = moveItem(
                                        draft.sections[sectionIndex]!.fields,
                                        fieldIndex,
                                        -1,
                                      );
                                    })
                                  }
                                >
                                  ↑
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  disabled={fieldIndex === section.fields.length - 1}
                                  aria-label={t('documentTemplates.accessibility.moveFieldDown', {
                                    name: fieldLabel(field.key),
                                  })}
                                  onClick={() =>
                                    mutateConfig((draft) => {
                                      draft.sections[sectionIndex]!.fields = moveItem(
                                        draft.sections[sectionIndex]!.fields,
                                        fieldIndex,
                                        1,
                                      );
                                    })
                                  }
                                >
                                  ↓
                                </Button>
                              </div>
                            </div>
                          </article>
                        ))}
                      </div>
                    </details>
                  ))}
                </div>
              </TabPanel>

              <TabPanel id="columns" activeId={editorTab}>
                <div className="stack-sm">
                  <div>
                    <h3>{t('documentTemplates.columns.column')}</h3>
                    <p className="muted">{t('documentTemplates.columnsHint')}</p>
                  </div>
                  <div className="template-field-list">
                    {config.itemColumns.map((column, columnIndex) => (
                      <article className="template-field-card" key={column.key}>
                        <div className="template-field-card-head">
                          <label className="checkbox-row">
                            <input
                              type="checkbox"
                              checked={column.visible}
                              aria-label={t('documentTemplates.accessibility.columnVisible', {
                                name: columnLabel(column.key),
                              })}
                              onChange={(event) =>
                                mutateConfig((draft) => {
                                  draft.itemColumns[columnIndex]!.visible = event.target.checked;
                                })
                              }
                            />
                            <strong>{columnLabel(column.key)}</strong>
                          </label>
                          <small className="muted mono">{column.key}</small>
                        </div>
                        <div className="form-grid compact-form-grid">
                          <Field label={t('documentTemplates.columns.label')}>
                            {({ inputId, describedBy }) => (
                              <Input
                                inputId={inputId}
                                describedBy={describedBy}
                                value={column.label ?? ''}
                                aria-label={t('documentTemplates.accessibility.columnLabel', {
                                  name: columnLabel(column.key),
                                })}
                                onChange={(event) =>
                                  mutateConfig((draft) => {
                                    draft.itemColumns[columnIndex]!.label = event.target.value;
                                  })
                                }
                              />
                            )}
                          </Field>
                          <Field label={t('documentTemplates.columns.width')}>
                            {({ inputId, describedBy }) => (
                              <Input
                                inputId={inputId}
                                describedBy={describedBy}
                                type="number"
                                min={4}
                                max={40}
                                value={String(column.width ?? '')}
                                aria-label={t('documentTemplates.accessibility.columnWidth', {
                                  name: columnLabel(column.key),
                                })}
                                onChange={(event) =>
                                  mutateConfig((draft) => {
                                    draft.itemColumns[columnIndex]!.width = Number(
                                      event.target.value,
                                    );
                                  })
                                }
                              />
                            )}
                          </Field>
                        </div>
                        <div className="row-actions">
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={columnIndex === 0}
                            aria-label={t('documentTemplates.accessibility.moveColumnUp', {
                              name: columnLabel(column.key),
                            })}
                            onClick={() =>
                              mutateConfig((draft) => {
                                draft.itemColumns = moveItem(draft.itemColumns, columnIndex, -1);
                              })
                            }
                          >
                            ↑
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={columnIndex === config.itemColumns.length - 1}
                            aria-label={t('documentTemplates.accessibility.moveColumnDown', {
                              name: columnLabel(column.key),
                            })}
                            onClick={() =>
                              mutateConfig((draft) => {
                                draft.itemColumns = moveItem(draft.itemColumns, columnIndex, 1);
                              })
                            }
                          >
                            ↓
                          </Button>
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
              </TabPanel>

              <TabPanel id="terms" activeId={editorTab}>
                <div className="stack-sm">
                  <h3>{t('documentTemplates.terms.title')}</h3>
                  <div className="template-toggle-grid">
                    <label className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={config.terms.showPaymentNotice}
                        onChange={(event) =>
                          mutateConfig((draft) => {
                            draft.terms.showPaymentNotice = event.target.checked;
                          })
                        }
                      />
                      <span>{t('documentTemplates.terms.showPayment')}</span>
                    </label>
                    <label className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={config.terms.showShipmentNotice}
                        onChange={(event) =>
                          mutateConfig((draft) => {
                            draft.terms.showShipmentNotice = event.target.checked;
                          })
                        }
                      />
                      <span>{t('documentTemplates.terms.showShipment')}</span>
                    </label>
                    <label className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={config.terms.showAuthenticityDeclaration}
                        onChange={(event) =>
                          mutateConfig((draft) => {
                            draft.terms.showAuthenticityDeclaration = event.target.checked;
                          })
                        }
                      />
                      <span>{t('documentTemplates.terms.showAuthenticity')}</span>
                    </label>
                    <label className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={config.notes.visible}
                        onChange={(event) =>
                          mutateConfig((draft) => {
                            draft.notes.visible = event.target.checked;
                          })
                        }
                      />
                      <span>{t('documentTemplates.terms.showNotes')}</span>
                    </label>
                  </div>
                  <div className="form-grid">
                    <Area
                      label={t('documentTemplates.terms.payment')}
                      value={config.terms.paymentNotice ?? ''}
                      disabled={!config.terms.showPaymentNotice}
                      onChange={(value) =>
                        mutateConfig((draft) => {
                          draft.terms.paymentNotice = value || undefined;
                        })
                      }
                    />
                    <Area
                      label={t('documentTemplates.terms.shipment')}
                      value={config.terms.shipmentNotice ?? ''}
                      disabled={!config.terms.showShipmentNotice}
                      onChange={(value) =>
                        mutateConfig((draft) => {
                          draft.terms.shipmentNotice = value || undefined;
                        })
                      }
                    />
                    <Area
                      label={t('documentTemplates.terms.authenticity')}
                      value={config.terms.authenticityDeclaration ?? ''}
                      disabled={!config.terms.showAuthenticityDeclaration}
                      onChange={(value) =>
                        mutateConfig((draft) => {
                          draft.terms.authenticityDeclaration = value || undefined;
                        })
                      }
                    />
                    <Field label={t('documentTemplates.terms.notesTitle')}>
                      {({ inputId, describedBy }) => (
                        <Input
                          inputId={inputId}
                          describedBy={describedBy}
                          value={config.notes.title ?? ''}
                          disabled={!config.notes.visible}
                          onChange={(event) =>
                            mutateConfig((draft) => {
                              draft.notes.title = event.target.value || undefined;
                            })
                          }
                        />
                      )}
                    </Field>
                  </div>
                  <p className="muted">{t('documentTemplates.terms.notesHint')}</p>
                </div>
              </TabPanel>

              <TabPanel id="publish" activeId={editorTab}>
                <div className="stack-sm">
                  <h3>{t('documentTemplates.tabs.publish')}</h3>
                  <div className="template-publish-grid">
                    <div className="panel stack-sm">
                      <h4>{t('documentTemplates.validationTitle')}</h4>
                      {validation ? (
                        <div className={`alert ${validation.valid ? '' : 'alert-error'}`}>
                          <strong>
                            {validation.valid
                              ? t('documentTemplates.validationPassed')
                              : t('documentTemplates.validationFailed')}
                          </strong>
                          {validation.errors.length > 0 ? (
                            <ul>
                              {validation.errors.map((message) => (
                                <li key={message}>{validationErrorLabel(message)}</li>
                              ))}
                            </ul>
                          ) : null}
                          {validation.warnings.length > 0 ? (
                            <ul>
                              {validation.warnings.map((warning) => (
                                <li key={warning}>{t(`documentTemplates.warnings.${warning}`)}</li>
                              ))}
                            </ul>
                          ) : (
                            <p>{t('documentTemplates.noWarnings')}</p>
                          )}
                        </div>
                      ) : (
                        <p className="muted">{t('documentTemplates.validationEmpty')}</p>
                      )}
                      <Button
                        variant="secondary"
                        loading={action === 'validate'}
                        onClick={() => void validate()}
                      >
                        {t('documentTemplates.validateCurrent')}
                      </Button>
                    </div>
                    <div className="panel stack-sm">
                      <h4>{t('documentTemplates.previewTitle')}</h4>
                      <p className="muted">{t('documentTemplates.previewHintNew')}</p>
                      <div className="row-actions">
                        <Button
                          variant="secondary"
                          loading={action === 'preview'}
                          onClick={() => void preview()}
                        >
                          {t('documentTemplates.previewCurrent')}
                        </Button>
                      </div>
                    </div>
                  </div>

                  <div className="panel stack-sm">
                    <div className="row-between">
                      <div>
                        <h4>{t('documentTemplates.publish')}</h4>
                        <p className="muted">{t('documentTemplates.publishHint')}</p>
                      </div>
                      {canPublish ? (
                        <Button
                          variant="danger"
                          disabled={Boolean(action) || (!canUpdate && dirty)}
                          onClick={() => setPublishOpen(true)}
                        >
                          {t('documentTemplates.publish')}
                        </Button>
                      ) : null}
                    </div>
                  </div>

                  <div className="panel stack-sm">
                    <h4>{t('documentTemplates.versions')}</h4>
                    {selected.versions.length === 0 ? (
                      <p>{t('documentTemplates.noVersions')}</p>
                    ) : (
                      <ul className="timeline">
                        {selected.versions.map((version) => (
                          <li key={version.id}>
                            v{version.version} ·{' '}
                            {new Date(version.publishedAt).toLocaleDateString(locale)} ·{' '}
                            <span className="mono">{version.checksum.slice(0, 12)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="template-danger-zone">
                    <div>
                      <strong>{t('documentTemplates.dangerZone')}</strong>
                      <p className="muted">
                        {selected.status === 'DISABLED'
                          ? t('documentTemplates.disabledHint')
                          : t('documentTemplates.disableHint')}
                      </p>
                    </div>
                    <div className="row-actions">
                      {canUpdate ? (
                        <Button
                          variant="secondary"
                          loading={action === 'status'}
                          disabled={Boolean(action) && action !== 'status'}
                          onClick={() =>
                            setStatusConfirm(selected.status === 'DISABLED' ? 'enable' : 'disable')
                          }
                        >
                          {selected.status === 'DISABLED'
                            ? t('documentTemplates.enable')
                            : t('documentTemplates.disable')}
                        </Button>
                      ) : null}
                      {canDelete && isDocumentTemplateDraftDeletable(selected) ? (
                        <Button
                          variant="danger"
                          disabled={Boolean(action)}
                          onClick={() => setDeleteTarget(selected)}
                        >
                          {t('documentTemplates.deleteDraft')}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </div>
              </TabPanel>
            </>
          )}
        </section>
      ) : null}

      <Modal
        open={createOpen}
        title={t('documentTemplates.new')}
        size="lg"
        onClose={() => !action && setCreateOpen(false)}
        dismissOnBackdrop={false}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setCreateOpen(false)}
              disabled={action === 'create'}
            >
              {t('common.cancel')}
            </Button>
            <Button
              loading={action === 'create'}
              disabled={!createForm.name.trim() || action === 'create'}
              onClick={() => void create()}
            >
              {t('documentTemplates.create')}
            </Button>
          </>
        }
      >
        <div className="stack-sm">
          <p className="notice">{t('documentTemplates.createDefaultHint')}</p>
          <div className="form-grid">
            <Field label={t('documentTemplates.name')} required>
              {({ inputId, describedBy }) => (
                <Input
                  inputId={inputId}
                  describedBy={describedBy}
                  value={createForm.name}
                  maxLength={180}
                  onChange={(event) => setCreateForm({ ...createForm, name: event.target.value })}
                />
              )}
            </Field>
            <Field label={t('documentTemplates.descriptionField')}>
              {({ inputId, describedBy }) => (
                <Input
                  inputId={inputId}
                  describedBy={describedBy}
                  value={createForm.description}
                  maxLength={500}
                  onChange={(event) =>
                    setCreateForm({ ...createForm, description: event.target.value })
                  }
                />
              )}
            </Field>
            <Field label={t('documentTemplates.copyFrom')}>
              {({ inputId, describedBy }) => (
                <Select
                  inputId={inputId}
                  describedBy={describedBy}
                  value={createSourceId}
                  options={[
                    { value: '', label: t('documentTemplates.startBlank') },
                    ...rows.map((row) => ({
                      value: row.id,
                      label: `${row.name} · ${documentTypeLabel(row.documentType)} · ${localeLabel(row.locale)}`,
                    })),
                  ]}
                  onChange={(event) => {
                    const sourceId = event.target.value;
                    const source = rows.find((row) => row.id === sourceId);
                    setCreateSourceId(sourceId);
                    if (source) {
                      setCreateForm({
                        ...createForm,
                        documentType: source.documentType,
                        locale: source.locale,
                        paperSize: source.paperSize === 'Letter' ? 'Letter' : 'A4',
                        orientation: source.orientation === 'landscape' ? 'landscape' : 'portrait',
                      });
                    }
                  }}
                />
              )}
            </Field>
            <Field label={t('documentTemplates.type')}>
              {({ inputId, describedBy }) => (
                <Select
                  inputId={inputId}
                  describedBy={describedBy}
                  value={createForm.documentType}
                  disabled={Boolean(createSource)}
                  options={[
                    { value: 'PI', label: documentTypeLabel('PI') },
                    { value: 'CI', label: documentTypeLabel('CI') },
                  ]}
                  onChange={(event) =>
                    setCreateForm({
                      ...createForm,
                      documentType: event.target.value as 'PI' | 'CI',
                    })
                  }
                />
              )}
            </Field>
            <Field label={t('documentTemplates.locale')}>
              {({ inputId, describedBy }) => (
                <Select
                  inputId={inputId}
                  describedBy={describedBy}
                  value={createForm.locale}
                  disabled={Boolean(createSource)}
                  options={[
                    { value: 'en-US', label: localeLabel('en-US') },
                    { value: 'zh-CN', label: localeLabel('zh-CN') },
                  ]}
                  onChange={(event) => setCreateForm({ ...createForm, locale: event.target.value })}
                />
              )}
            </Field>
            <Field label={t('documentTemplates.paper')}>
              {({ inputId, describedBy }) => (
                <Select
                  inputId={inputId}
                  describedBy={describedBy}
                  value={createForm.paperSize}
                  disabled={Boolean(createSource)}
                  options={[
                    { value: 'A4', label: paperSizeLabel('A4') },
                    { value: 'Letter', label: paperSizeLabel('Letter') },
                  ]}
                  onChange={(event) =>
                    setCreateForm({
                      ...createForm,
                      paperSize: event.target.value as 'A4' | 'Letter',
                    })
                  }
                />
              )}
            </Field>
            <Field label={t('documentTemplates.orientation')}>
              {({ inputId, describedBy }) => (
                <Select
                  inputId={inputId}
                  describedBy={describedBy}
                  value={createForm.orientation}
                  disabled={Boolean(createSource)}
                  options={[
                    { value: 'portrait', label: orientationLabel('portrait') },
                    { value: 'landscape', label: orientationLabel('landscape') },
                  ]}
                  onChange={(event) =>
                    setCreateForm({
                      ...createForm,
                      orientation: event.target.value as 'portrait' | 'landscape',
                    })
                  }
                />
              )}
            </Field>
          </div>
          {createSource ? (
            <p className="muted">
              {t('documentTemplates.copySourceHint', { name: createSource.name })}
            </p>
          ) : null}
        </div>
      </Modal>

      <ConfirmDialog
        open={publishOpen}
        title={t('documentTemplates.publish')}
        description={
          <div className="stack-sm">
            <p>{t('documentTemplates.publishConfirm')}</p>
            <p className="muted">
              {selected?.name} · {selected ? documentTypeLabel(selected.documentType) : ''} ·{' '}
              {selected ? localeLabel(selected.locale) : ''}
            </p>
          </div>
        }
        confirmLabel={t('documentTemplates.publish')}
        cancelLabel={t('common.cancel')}
        destructive
        loading={action === 'publish'}
        onConfirm={() => void publish()}
        onCancel={() => setPublishOpen(false)}
      />

      <ConfirmDialog
        open={statusConfirm !== null}
        title={
          statusConfirm === 'disable'
            ? t('documentTemplates.disable')
            : t('documentTemplates.enable')
        }
        description={t(
          statusConfirm === 'disable'
            ? 'documentTemplates.disableConfirm'
            : 'documentTemplates.enableConfirm',
        )}
        confirmLabel={
          statusConfirm === 'disable'
            ? t('documentTemplates.disable')
            : t('documentTemplates.enable')
        }
        cancelLabel={t('common.cancel')}
        destructive={statusConfirm === 'disable'}
        loading={action === 'status'}
        onConfirm={() => void changeStatus()}
        onCancel={() => setStatusConfirm(null)}
      />

      <ConfirmDialog
        open={hideAllSection !== null}
        title={t('documentTemplates.hideAllFields')}
        description={
          hideAllSection !== null && config
            ? t('documentTemplates.hideAllConfirm', {
                name: sectionLabel(config.sections[hideAllSection]?.key ?? ''),
              })
            : ''
        }
        confirmLabel={t('documentTemplates.hideAllFields')}
        cancelLabel={t('common.cancel')}
        onConfirm={() => {
          if (hideAllSection === null) return;
          mutateConfig((draft) => {
            draft.sections[hideAllSection]!.fields.forEach((field) => {
              field.visible = false;
            });
          });
          setHideAllSection(null);
        }}
        onCancel={() => setHideAllSection(null)}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        title={t('documentTemplates.deleteDraft')}
        description={
          deleteTarget ? (
            <div className="stack-sm">
              <p>{t('documentTemplates.deleteConfirm')}</p>
              <dl className="template-confirm-details">
                <div>
                  <dt>{t('documentTemplates.name')}</dt>
                  <dd>{deleteTarget.name}</dd>
                </div>
                <div>
                  <dt>{t('documentTemplates.type')}</dt>
                  <dd>{documentTypeLabel(deleteTarget.documentType)}</dd>
                </div>
                <div>
                  <dt>{t('documentTemplates.locale')}</dt>
                  <dd>{localeLabel(deleteTarget.locale)}</dd>
                </div>
                <div>
                  <dt>{t('documentTemplates.status')}</dt>
                  <dd>{t(`documentTemplates.statuses.${deleteTarget.status}`)}</dd>
                </div>
              </dl>
              <p className="muted">{t('documentTemplates.deleteImpact')}</p>
            </div>
          ) : null
        }
        confirmLabel={t('documentTemplates.deleteDraft')}
        cancelLabel={t('common.cancel')}
        destructive
        loading={action === 'delete'}
        onConfirm={() => void removeDraft()}
        onCancel={() => setDeleteTarget(null)}
      />

      <ConfirmDialog
        open={discardIntent !== null}
        title={t('documentTemplates.unsavedTitle')}
        description={t('documentTemplates.unsavedConfirm')}
        confirmLabel={t('documentTemplates.discardChanges')}
        cancelLabel={t('common.cancel')}
        destructive
        onConfirm={confirmDiscard}
        onCancel={() => setDiscardIntent(null)}
      />
    </div>
  );
}

function Area({
  label,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <Field label={label}>
      {({ inputId, describedBy }) => (
        <Textarea
          inputId={inputId}
          describedBy={describedBy}
          rows={3}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </Field>
  );
}
