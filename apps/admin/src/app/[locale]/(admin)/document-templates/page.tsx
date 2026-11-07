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
  Select,
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
import { useBreadcrumb } from '../../../../components/use-breadcrumb';
import { useSession } from '../../../../components/session-provider';

interface TemplateMeta {
  name: string;
  description: string;
  locale: string;
  paperSize: 'A4' | 'Letter';
  orientation: 'portrait' | 'landscape';
  isDefault: boolean;
}

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

export default function DocumentTemplatesPage() {
  const { t, can, locale } = useSession();
  const breadcrumb = useBreadcrumb();
  const toast = useToast();

  const [rows, setRows] = useState<DocumentTemplateSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<DocumentTemplateDetail | null>(null);
  const [meta, setMeta] = useState<TemplateMeta | null>(null);
  const [config, setConfig] = useState<DocumentTemplateConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [validation, setValidation] = useState<TemplateValidation | null>(null);
  const [previewHtml, setPreviewHtml] = useState('');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({
    name: '',
    documentType: 'CI' as 'PI' | 'CI',
    locale: 'en-US',
    paperSize: 'A4' as 'A4' | 'Letter',
    orientation: 'portrait' as 'portrait' | 'landscape',
    isDefault: false,
  });

  const canCreate = can('document_template.create');
  const canUpdate = can('document_template.update');
  const canPublish = can('document_template.publish');

  const documentTypeLabel = (type: string) => t(`documentTemplates.documentTypes.${type}`);
  const localeLabel = (templateLocale: string) => t(`documentTemplates.locales.${templateLocale}`);
  const paperSizeLabel = (size: string) => t(`documentTemplates.paperSizes.${size}`);
  const orientationLabel = (value: string) => t(`documentTemplates.orientations.${value}`);
  const sectionLabel = (key: string) => t(`documentTemplates.sectionNames.${key}`);
  const fieldLabel = (key: string) => t(`documentTemplates.fieldNames.${key}`);
  const columnLabel = (key: string) => t(`documentTemplates.columnNames.${key}`);
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
      const result = await commercialDocumentsApi.templates({ page: 1, pageSize: 100 });
      setRows(result.data);
      setSelected((current) => {
        if (!current) return current;
        const next = result.data.find((row) => row.id === current.id);
        return next ? current : null;
      });
    } catch (cause) {
      setError(
        cause instanceof AdminApiError
          ? translateError(locale, cause.code)
          : t('documentTemplates.loadError'),
      );
    } finally {
      setLoading(false);
    }
  }, [locale, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const openTemplate = async (id: string) => {
    setBusy(true);
    setError(null);
    setValidation(null);
    try {
      const detail = await commercialDocumentsApi.template(id);
      setSelected(detail);
      setMeta({
        name: detail.name,
        description: detail.description ?? '',
        locale: detail.locale,
        paperSize: detail.paperSize === 'Letter' ? 'Letter' : 'A4',
        orientation: detail.orientation === 'landscape' ? 'landscape' : 'portrait',
        isDefault: detail.isDefault,
      });
      setConfig(cloneConfig(detail.draftConfig));
    } catch (cause) {
      setError(
        cause instanceof AdminApiError
          ? translateError(locale, cause.code)
          : t('documentTemplates.loadError'),
      );
    } finally {
      setBusy(false);
    }
  };

  const persistTemplate = async (): Promise<DocumentTemplateDetail | null> => {
    if (!selected || !meta || !config || !canUpdate) return selected;
    const updated = await commercialDocumentsApi.updateTemplate(selected.id, {
      name: meta.name.trim(),
      description: meta.description.trim() || null,
      locale: meta.locale,
      paperSize: meta.paperSize,
      orientation: meta.orientation,
      isDefault: meta.isDefault,
      config,
      expectedUpdatedAt: selected.updatedAt,
    });
    setSelected(updated);
    setConfig(cloneConfig(updated.draftConfig));
    return updated;
  };

  const save = async () => {
    if (!selected || !meta || !config || !canUpdate) return;
    setBusy(true);
    setError(null);
    try {
      await persistTemplate();
      toast.success(t('documentTemplates.saved'));
      await load();
    } catch (cause) {
      setError(
        cause instanceof AdminApiError
          ? translateError(locale, cause.code)
          : t('documentTemplates.loadError'),
      );
    } finally {
      setBusy(false);
    }
  };

  const validate = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const saved = await persistTemplate();
      if (!saved) return;
      const report = await commercialDocumentsApi.validateTemplate(saved.id);
      setValidation(report);
    } catch (cause) {
      toast.error(
        cause instanceof AdminApiError
          ? translateError(locale, cause.code)
          : t('documentTemplates.loadError'),
      );
    } finally {
      setBusy(false);
    }
  };

  const preview = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const saved = await persistTemplate();
      if (!saved) return;
      const result = await commercialDocumentsApi.previewTemplate(saved.id, { config });
      setPreviewHtml(result.html);
      setPreviewOpen(true);
    } catch (cause) {
      toast.error(
        cause instanceof AdminApiError
          ? translateError(locale, cause.code)
          : t('documentTemplates.loadError'),
      );
    } finally {
      setBusy(false);
    }
  };

  const publish = async () => {
    if (!selected || !canPublish) return;
    setBusy(true);
    try {
      const saved = await persistTemplate();
      if (!saved) return;
      const updated = await commercialDocumentsApi.publishTemplate(saved.id);
      setSelected(updated);
      setConfig(cloneConfig(updated.draftConfig));
      setPublishOpen(false);
      toast.success(t('documentTemplates.published'));
      await load();
    } catch (cause) {
      toast.error(
        cause instanceof AdminApiError
          ? translateError(locale, cause.code)
          : t('documentTemplates.loadError'),
      );
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    if (!createForm.name.trim() || !canCreate) return;
    setBusy(true);
    try {
      const created = await commercialDocumentsApi.createTemplate({
        name: createForm.name.trim(),
        documentType: createForm.documentType,
        locale: createForm.locale,
        paperSize: createForm.paperSize,
        orientation: createForm.orientation,
        isDefault: createForm.isDefault,
      });
      setCreateOpen(false);
      setCreateForm((current) => ({ ...current, name: '' }));
      toast.success(t('documentTemplates.created'));
      await load();
      await openTemplate(created.id);
    } catch (cause) {
      toast.error(
        cause instanceof AdminApiError
          ? translateError(locale, cause.code)
          : t('documentTemplates.loadError'),
      );
    } finally {
      setBusy(false);
    }
  };

  const sectionWarning = useMemo(
    () => new Map((validation?.warnings ?? []).map((warning) => [warning, true])),
    [validation],
  );

  return (
    <div className="stack">
      <PageHeader
        breadcrumb={breadcrumb}
        title={t('documentTemplates.title')}
        description={t('documentTemplates.description')}
        actions={
          <div className="row-actions">
            <Button variant="secondary" loading={loading} onClick={() => void load()}>
              {t('commercialDocuments.actions.refresh')}
            </Button>
            {canCreate ? <Button onClick={() => setCreateOpen(true)}>{t('documentTemplates.new')}</Button> : null}
          </div>
        }
      />

      {error ? (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      ) : null}

      <section className="panel table-scroll" aria-live="polite">
        {loading ? (
          <p>{t('common.loading')}</p>
        ) : rows.length === 0 ? (
          <p>{t('common.empty')}</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>{t('documentTemplates.name')}</th>
                <th>{t('documentTemplates.type')}</th>
                <th>{t('documentTemplates.locale')}</th>
                <th>{t('documentTemplates.paper')}</th>
                <th>{t('documentTemplates.orientation')}</th>
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
                  <td>{row.name}</td>
                  <td>{documentTypeLabel(row.documentType)}</td>
                  <td>{localeLabel(row.locale)}</td>
                  <td>{paperSizeLabel(row.paperSize)}</td>
                  <td>{orientationLabel(row.orientation)}</td>
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
                  <td>{row.updatedAt.slice(0, 10)}</td>
                  <td>
                    <Button size="sm" variant="ghost" onClick={() => void openTemplate(row.id)}>
                      {t('documentTemplates.open')}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {selected && meta && config ? (
        <section className="panel stack-sm">
          <div className="row-between">
            <h2>
              {selected.name} · {documentTypeLabel(selected.documentType)}
            </h2>
            <div className="row-actions">
              <Button variant="secondary" loading={busy} onClick={() => void validate()}>
                {t('documentTemplates.validate')}
              </Button>
              <Button variant="secondary" loading={busy} onClick={() => void preview()}>
                {t('documentTemplates.preview')}
              </Button>
              {canUpdate ? (
                <Button loading={busy} onClick={() => void save()}>
                  {t('documentTemplates.save')}
                </Button>
              ) : null}
              {canPublish ? (
                <Button variant="secondary" onClick={() => setPublishOpen(true)}>
                  {t('documentTemplates.publish')}
                </Button>
              ) : null}
              {canUpdate ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    if (!meta) return;
                    void commercialDocumentsApi
                      .updateTemplate(selected.id, {
                        status: selected.status === 'DISABLED' ? 'DRAFT' : 'DISABLED',
                        expectedUpdatedAt: selected.updatedAt,
                      })
                      .then(async (updated) => {
                        setSelected(updated);
                        setConfig(cloneConfig(updated.draftConfig));
                        toast.success(t('documentTemplates.saved'));
                        await load();
                      })
                      .catch((cause: unknown) =>
                        toast.error(
                          cause instanceof AdminApiError
                            ? translateError(locale, cause.code)
                            : t('documentTemplates.loadError'),
                        ),
                      );
                  }}
                >
                  {selected.status === 'DISABLED' ? t('documentTemplates.enable') : t('documentTemplates.disable')}
                </Button>
              ) : null}
            </div>
          </div>

          {validation ? (
            <div className={`alert ${validation.valid ? '' : 'alert-error'}`}>
              {validation.valid
                ? t('common.saved')
                : validation.errors.map(validationErrorLabel).join(', ')}
              {validation.warnings.length > 0 ? (
                <ul>
                  {validation.warnings.map((warning) => (
                    <li key={warning}>
                      {t(`documentTemplates.warnings.${warning}`)}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          <div className="form-grid">
            <Field label={t('documentTemplates.name')}>
              {({ inputId, describedBy }) => (
                <Input
                  inputId={inputId}
                  describedBy={describedBy}
                  value={meta.name}
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
                  onChange={(event) => setMeta({ ...meta, description: event.target.value })}
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
                    setMeta({ ...meta, paperSize: event.target.value as 'A4' | 'Letter' })
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
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={meta.isDefault}
                onChange={(event) => setMeta({ ...meta, isDefault: event.target.checked })}
              />
              <span>{t('documentTemplates.default')}</span>
            </label>
          </div>

          <h3>{t('documentTemplates.theme.title')}</h3>
          <div className="form-grid">
            <Field label={t('documentTemplates.theme.headerTitle')}>
              {({ inputId, describedBy }) => (
                <Input
                  inputId={inputId}
                  describedBy={describedBy}
                  value={config.header.title}
                  onChange={(event) =>
                    setConfig({ ...config, header: { ...config.header, title: event.target.value } })
                  }
                />
              )}
            </Field>
            <Field label={t('documentTemplates.theme.primary')}>
              {({ inputId, describedBy }) => (
                <Input
                  inputId={inputId}
                  describedBy={describedBy}
                  value={config.theme.primaryColor}
                  onChange={(event) =>
                    setConfig({
                      ...config,
                      theme: { ...config.theme, primaryColor: event.target.value },
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
                  value={config.theme.accentColor}
                  onChange={(event) =>
                    setConfig({
                      ...config,
                      theme: { ...config.theme, accentColor: event.target.value },
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
                  options={['Helvetica', 'Arial', 'Times New Roman', 'Georgia', 'Noto Sans', 'DejaVu Sans'].map(
                    (font) => ({ value: font, label: font }),
                  )}
                  onChange={(event) =>
                    setConfig({
                      ...config,
                      theme: { ...config.theme, fontFamily: event.target.value },
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
                    setConfig({
                      ...config,
                      theme: { ...config.theme, fontSizePt: Number(event.target.value) },
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
                      setConfig({
                        ...config,
                        page: {
                          ...config.page,
                          marginMm: {
                            ...config.page.marginMm,
                            [side]: Number(event.target.value),
                          },
                        },
                      })
                    }
                  />
                )}
              </Field>
            ))}
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={config.header.showLogo}
                onChange={(event) =>
                  setConfig({ ...config, header: { ...config.header, showLogo: event.target.checked } })
                }
              />
              <span>{t('documentTemplates.theme.showLogo')}</span>
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={config.header.showDocumentType}
                onChange={(event) =>
                  setConfig({
                    ...config,
                    header: { ...config.header, showDocumentType: event.target.checked },
                  })
                }
              />
              <span>{t('documentTemplates.theme.showDocumentType')}</span>
            </label>
          </div>

          <h3>{t('documentTemplates.sections.fields')}</h3>
          {config.sections.map((section, sectionIndex) => (
            <details key={section.key} className="panel stack-sm">
              <summary>
                {sectionLabel(section.key)}
                {section.title && section.title !== sectionLabel(section.key)
                  ? ` · ${section.title}`
                  : ''}{' '}·{' '}
                {section.fields.filter((field) => field.visible).length}/{section.fields.length}
              </summary>
              <div className="row-actions">
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={section.visible}
                    onChange={(event) => {
                      const next = cloneConfig(config);
                      next.sections[sectionIndex]!.visible = event.target.checked;
                      setConfig(next);
                    }}
                  />
                  <span>{t('documentTemplates.sections.visible')}</span>
                </label>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={sectionIndex === 0}
                  aria-label={t('documentTemplates.accessibility.moveSectionUp', {
                    name: sectionLabel(section.key),
                  })}
                  onClick={() => {
                    const next = cloneConfig(config);
                    next.sections = moveItem(next.sections, sectionIndex, -1);
                    setConfig(next);
                  }}
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
                  onClick={() => {
                    const next = cloneConfig(config);
                    next.sections = moveItem(next.sections, sectionIndex, 1);
                    setConfig(next);
                  }}
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
                    onChange={(event) => {
                      const next = cloneConfig(config);
                      next.sections[sectionIndex]!.title = event.target.value;
                      setConfig(next);
                    }}
                  />
                )}
              </Field>
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>{t('documentTemplates.sections.show')}</th>
                      <th>{t('documentTemplates.sections.field')}</th>
                      <th>{t('documentTemplates.sections.label')}</th>
                      <th>{t('documentTemplates.sections.required')}</th>
                      <th>{t('common.actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {section.fields.map((field, fieldIndex) => (
                      <tr key={field.key}>
                        <td>
                          <input
                            type="checkbox"
                            checked={field.visible}
                            aria-label={t('documentTemplates.accessibility.fieldVisible', {
                              name: fieldLabel(field.key),
                            })}
                            onChange={(event) => {
                              const next = cloneConfig(config);
                              next.sections[sectionIndex]!.fields[fieldIndex]!.visible =
                                event.target.checked;
                              setConfig(next);
                            }}
                          />
                        </td>
                        <td>
                          <span>{fieldLabel(field.key)}</span>
                          <small className="muted mono">{field.key}</small>
                        </td>
                        <td>
                          <Input
                            value={field.label ?? ''}
                            aria-label={t('documentTemplates.accessibility.fieldLabel', {
                              name: fieldLabel(field.key),
                            })}
                            onChange={(event) => {
                              const next = cloneConfig(config);
                              next.sections[sectionIndex]!.fields[fieldIndex]!.label =
                                event.target.value;
                              setConfig(next);
                            }}
                          />
                        </td>
                        <td>
                          <input
                            type="checkbox"
                            checked={field.required}
                            aria-label={t('documentTemplates.accessibility.fieldRequired', {
                              name: fieldLabel(field.key),
                            })}
                            onChange={(event) => {
                              const next = cloneConfig(config);
                              next.sections[sectionIndex]!.fields[fieldIndex]!.required =
                                event.target.checked;
                              setConfig(next);
                            }}
                          />
                        </td>
                        <td>
                          <div className="row-actions">
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={fieldIndex === 0}
                              aria-label={t('documentTemplates.accessibility.moveFieldUp', {
                                name: fieldLabel(field.key),
                              })}
                              onClick={() => {
                                const next = cloneConfig(config);
                                next.sections[sectionIndex]!.fields = moveItem(
                                  next.sections[sectionIndex]!.fields,
                                  fieldIndex,
                                  -1,
                                );
                                setConfig(next);
                              }}
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
                              onClick={() => {
                                const next = cloneConfig(config);
                                next.sections[sectionIndex]!.fields = moveItem(
                                  next.sections[sectionIndex]!.fields,
                                  fieldIndex,
                                  1,
                                );
                                setConfig(next);
                              }}
                            >
                              ↓
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          ))}

          <h3>{t('documentTemplates.columns.column')}</h3>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('documentTemplates.columns.show')}</th>
                  <th>{t('documentTemplates.columns.column')}</th>
                  <th>{t('documentTemplates.columns.label')}</th>
                  <th>{t('documentTemplates.columns.width')}</th>
                  <th>{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {config.itemColumns.map((column, columnIndex) => (
                  <tr key={column.key}>
                    <td>
                      <input
                        type="checkbox"
                        checked={column.visible}
                        aria-label={t('documentTemplates.accessibility.columnVisible', {
                          name: columnLabel(column.key),
                        })}
                        onChange={(event) => {
                          const next = cloneConfig(config);
                          next.itemColumns[columnIndex]!.visible = event.target.checked;
                          setConfig(next);
                        }}
                      />
                    </td>
                    <td>
                      <span>{columnLabel(column.key)}</span>
                      <small className="muted mono">{column.key}</small>
                    </td>
                    <td>
                      <Input
                        value={column.label ?? ''}
                        aria-label={t('documentTemplates.accessibility.columnLabel', {
                          name: columnLabel(column.key),
                        })}
                        onChange={(event) => {
                          const next = cloneConfig(config);
                          next.itemColumns[columnIndex]!.label = event.target.value;
                          setConfig(next);
                        }}
                      />
                    </td>
                    <td>
                      <Input
                        type="number"
                        min={4}
                        max={40}
                        value={String(column.width ?? '')}
                        aria-label={t('documentTemplates.accessibility.columnWidth', {
                          name: columnLabel(column.key),
                        })}
                        onChange={(event) => {
                          const next = cloneConfig(config);
                          next.itemColumns[columnIndex]!.width = Number(event.target.value);
                          setConfig(next);
                        }}
                      />
                    </td>
                    <td>
                      <div className="row-actions">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={columnIndex === 0}
                          aria-label={t('documentTemplates.accessibility.moveColumnUp', {
                            name: columnLabel(column.key),
                          })}
                          onClick={() => {
                            const next = cloneConfig(config);
                            next.itemColumns = moveItem(next.itemColumns, columnIndex, -1);
                            setConfig(next);
                          }}
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
                          onClick={() => {
                            const next = cloneConfig(config);
                            next.itemColumns = moveItem(next.itemColumns, columnIndex, 1);
                            setConfig(next);
                          }}
                        >
                          ↓
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3>{t('documentTemplates.terms.title')}</h3>
          <div className="form-grid">
            <Area label={t('documentTemplates.terms.payment')} value={config.terms.paymentNotice ?? ''} onChange={(value) => setConfig({ ...config, terms: { ...config.terms, paymentNotice: value } })} />
            <Area label={t('documentTemplates.terms.shipment')} value={config.terms.shipmentNotice ?? ''} onChange={(value) => setConfig({ ...config, terms: { ...config.terms, shipmentNotice: value } })} />
            <Area label={t('documentTemplates.terms.authenticity')} value={config.terms.authenticityDeclaration ?? ''} onChange={(value) => setConfig({ ...config, terms: { ...config.terms, authenticityDeclaration: value } })} />
          </div>
          <Area
            label={t('documentTemplates.theme.footer')}
            value={config.footer.text ?? ''}
            onChange={(value) => setConfig({ ...config, footer: { ...config.footer, text: value } })}
          />

          <h3>{t('documentTemplates.versions')}</h3>
          {selected.versions.length === 0 ? (
            <p>{t('documentTemplates.noVersions')}</p>
          ) : (
            <ul className="timeline">
              {selected.versions.map((version) => (
                <li key={version.id}>
                  v{version.version} · {version.publishedAt.slice(0, 10)} · {version.checksum.slice(0, 12)}
                </li>
              ))}
            </ul>
          )}
          {sectionWarning.size > 0 ? <p className="muted">{t('documentTemplates.previewHint')}</p> : null}
        </section>
      ) : null}

      <Modal
        open={createOpen}
        title={t('documentTemplates.new')}
        size="md"
        onClose={() => setCreateOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)} disabled={busy}>
              {t('common.cancel')}
            </Button>
            <Button loading={busy} onClick={() => void create()}>
              {t('documentTemplates.create')}
            </Button>
          </>
        }
      >
        <div className="form-grid">
          <Field label={t('documentTemplates.name')} required>
            {({ inputId, describedBy }) => (
              <Input
                inputId={inputId}
                describedBy={describedBy}
                value={createForm.name}
                onChange={(event) => setCreateForm({ ...createForm, name: event.target.value })}
                maxLength={180}
              />
            )}
          </Field>
          <Field label={t('documentTemplates.type')}>
            {({ inputId, describedBy }) => (
              <Select
                inputId={inputId}
                describedBy={describedBy}
                value={createForm.documentType}
                options={[
                  { value: 'PI', label: documentTypeLabel('PI') },
                  { value: 'CI', label: documentTypeLabel('CI') },
                ]}
                onChange={(event) =>
                  setCreateForm({ ...createForm, documentType: event.target.value as 'PI' | 'CI' })
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
                options={[
                  { value: 'A4', label: paperSizeLabel('A4') },
                  { value: 'Letter', label: paperSizeLabel('Letter') },
                ]}
                onChange={(event) =>
                  setCreateForm({ ...createForm, paperSize: event.target.value as 'A4' | 'Letter' })
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
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={createForm.isDefault}
              onChange={(event) => setCreateForm({ ...createForm, isDefault: event.target.checked })}
            />
            <span>{t('documentTemplates.default')}</span>
          </label>
        </div>
      </Modal>

      <Modal
        open={previewOpen}
        title={t('documentTemplates.previewTitle')}
        size="lg"
        onClose={() => setPreviewOpen(false)}
        footer={
          <Button variant="secondary" onClick={() => setPreviewOpen(false)}>
            {t('common.close')}
          </Button>
        }
      >
        {previewHtml ? (
          <iframe
            className="document-preview-frame"
            title={t('documentTemplates.previewTitle')}
            srcDoc={previewHtml}
            sandbox=""
          />
        ) : (
          <p>{t('common.loading')}</p>
        )}
      </Modal>

      <ConfirmDialog
        open={publishOpen}
        title={t('documentTemplates.publish')}
        description={t('documentTemplates.publishConfirm')}
        confirmLabel={t('documentTemplates.publish')}
        cancelLabel={t('common.cancel')}
        loading={busy}
        onConfirm={() => void publish()}
        onCancel={() => setPublishOpen(false)}
      />
    </div>
  );
}

function Area({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field label={label}>
      {({ inputId, describedBy }) => (
        <Textarea
          inputId={inputId}
          describedBy={describedBy}
          rows={2}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </Field>
  );
}
