'use client';

import { useEffect, useState } from 'react';
import type { TagSummary } from '@b2b/contracts';
import {
  Button,
  Checkbox,
  ConfirmDialog,
  Drawer,
  Field,
  Input,
  Select,
  TagBadge,
  useToast,
} from '@b2b/ui';
import { AdminApiError } from '../lib/admin-api';
import { tagsApi } from '../lib/tags-api';
import {
  TAG_CODE_MAX,
  TAG_LABEL_MAX,
  emptyTagForm,
  hasTagFormErrors,
  isTagFormDirty,
  mapTagFieldErrors,
  tagColorOptions,
  toTagFormValues,
  toTagPayload,
  validateTagForm,
  type TagFormErrors,
  type TagFormMode,
  type TagFormValues,
} from '../lib/tag-form';
import { ADMIN_LOCALES, translateError } from '../lib/i18n';
import { useSession } from './session-provider';

const ENGLISH_LOCALE = 'en-US';

export interface TagFormDrawerProps {
  open: boolean;
  mode: TagFormMode;
  /** Edit target; null while creating. */
  tag: TagSummary | null;
  onClose: () => void;
  onSaved: (tag: TagSummary, mode: TagFormMode) => void;
}

/**
 * One drawer for creating and editing a tag (docs/23 §4.3).
 *
 * `code` is the stable business key and stays read-only while editing; the label
 * inputs are generated from the locale configuration rather than fixed columns,
 * and the style picker only offers whitelisted tokens with a live preview that
 * uses the same component as the list.
 */
export function TagFormDrawer({ open, mode, tag, onClose, onSaved }: TagFormDrawerProps) {
  const { t, locale } = useSession();
  const toast = useToast();

  const [values, setValues] = useState<TagFormValues>(() => emptyTagForm());
  const [initial, setInitial] = useState<TagFormValues>(() => emptyTagForm());
  const [errors, setErrors] = useState<TagFormErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [expectedUpdatedAt, setExpectedUpdatedAt] = useState<string | undefined>(undefined);

  const locales = ADMIN_LOCALES;

  // Re-seeded on every open so a previously edited tag can never leak into the
  // next form (docs/23 §11).
  useEffect(() => {
    if (!open) return undefined;

    if (mode === 'create') {
      const seeded = emptyTagForm();
      setValues(seeded);
      setInitial(seeded);
      setExpectedUpdatedAt(undefined);
      setErrors({});
      setServerError(null);
      setLoadError(null);
      return undefined;
    }

    if (!tag) return undefined;
    // Editing re-reads the tag so the form carries fresh values plus the
    // concurrency token of the version the administrator actually edits.
    let cancelled = false;
    setLoading(true);
    tagsApi
      .detail(tag.id, locale)
      .then((detail) => {
        if (cancelled) return;
        const seeded = toTagFormValues(detail, locales);
        setValues(seeded);
        setInitial(seeded);
        setExpectedUpdatedAt(detail.updatedAt);
        setErrors({});
        setServerError(null);
        setLoadError(null);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setLoadError(caught instanceof AdminApiError ? caught.code : 'INTERNAL_ERROR');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, mode, tag, locale, locales]);

  const dirty = isTagFormDirty(values, initial);

  const setField = <K extends keyof TagFormValues>(key: K, value: TagFormValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }));

  const setLabel = (targetLocale: string, label: string) =>
    setValues((current) => ({ ...current, labels: { ...current.labels, [targetLocale]: label } }));

  const requestClose = () => {
    if (busy) return;
    if (dirty) {
      setDiscardOpen(true);
      return;
    }
    onClose();
  };

  const submit = async () => {
    const validation = validateTagForm(values, mode, locales, ENGLISH_LOCALE);
    setErrors(validation);
    setServerError(null);
    if (hasTagFormErrors(validation)) return;

    setBusy(true);
    try {
      const payload = toTagPayload(values, mode);
      if (mode === 'create') {
        const created = await tagsApi.create({
          code: payload.code ?? '',
          colorToken: payload.colorToken,
          enabled: payload.enabled,
          translations: payload.translations,
        });
        toast.success(t('tags.createSuccess'));
        onSaved(created, mode);
      } else if (tag) {
        const updated = await tagsApi.update(tag.id, {
          colorToken: payload.colorToken,
          enabled: payload.enabled,
          translations: payload.translations,
          ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}),
        });
        toast.success(t('tags.updateSuccess'));
        onSaved(updated, mode);
      }
      onClose();
    } catch (caught) {
      if (caught instanceof AdminApiError) {
        const fieldErrors = mapTagFieldErrors(caught.details, ENGLISH_LOCALE);
        if (hasTagFormErrors(fieldErrors)) setErrors(fieldErrors);
        else setServerError(translateError(locale, caught.code));
      } else {
        setServerError(t('errors.INTERNAL_ERROR'));
      }
    } finally {
      setBusy(false);
    }
  };

  const title = mode === 'create' ? t('tags.create') : t('tags.edit');
  // Live preview of what a shopper will see (docs/23 §4.2).
  const previewLabel =
    values.labels[ENGLISH_LOCALE]?.trim() ||
    values.labels['zh-CN']?.trim() ||
    t('tags.previewPlaceholder');

  return (
    <>
      <Drawer
        open={open}
        title={title}
        onClose={requestClose}
        closeLabel={t('common.close')}
        footer={
          <>
            <Button variant="secondary" onClick={requestClose} disabled={busy}>
              {t('common.cancel')}
            </Button>
            <Button loading={busy} disabled={loading} onClick={() => void submit()}>
              {mode === 'create' ? t('tags.createSubmit') : t('common.save')}
            </Button>
          </>
        }
      >
        {loading ? (
          <p className="muted">{t('tags.detailLoading')}</p>
        ) : loadError ? (
          <div className="notice notice-danger" role="alert">
            {translateError(locale, loadError)}
          </div>
        ) : (
          <div className="stack">
            <Field
              label={t('tags.fields.code')}
              required={mode === 'create'}
              help={mode === 'create' ? t('tags.fields.codeHelp') : t('tags.fields.codeLocked')}
              error={errors.code ? t(errors.code) : undefined}
            >
              {({ inputId, describedBy }) => (
                <Input
                  inputId={inputId}
                  describedBy={describedBy}
                  value={values.code}
                  disabled={mode === 'edit' || busy}
                  autoComplete="off"
                  maxLength={TAG_CODE_MAX}
                  invalid={Boolean(errors.code)}
                  placeholder="oem"
                  onChange={(event) => setField('code', event.target.value.trim().toLowerCase())}
                />
              )}
            </Field>

            {locales.map((targetLocale) => (
              <Field
                key={targetLocale}
                label={t('tags.fields.label', { locale: t(`tags.locales.${targetLocale}`) })}
                required={targetLocale === ENGLISH_LOCALE}
                help={
                  targetLocale === ENGLISH_LOCALE
                    ? t('tags.fields.labelEnHelp')
                    : t('tags.fields.labelZhHelp')
                }
                error={errors.labels?.[targetLocale] ? t(errors.labels[targetLocale]) : undefined}
              >
                {({ inputId, describedBy }) => (
                  <Input
                    inputId={inputId}
                    describedBy={describedBy}
                    value={values.labels[targetLocale] ?? ''}
                    disabled={busy}
                    maxLength={TAG_LABEL_MAX}
                    invalid={Boolean(errors.labels?.[targetLocale])}
                    onChange={(event) => setLabel(targetLocale, event.target.value)}
                  />
                )}
              </Field>
            ))}

            <Field
              label={t('tags.fields.colorToken')}
              help={t('tags.fields.colorTokenHelp')}
              hint={
                <span className="tag-preview">
                  <TagBadge label={previewLabel} colorToken={values.colorToken || null} />
                  <span className="muted small">
                    {values.colorToken || t('tags.colorOptions.none')}
                  </span>
                </span>
              }
            >
              {({ inputId, describedBy }) => (
                <Select
                  inputId={inputId}
                  describedBy={describedBy}
                  value={values.colorToken}
                  disabled={busy}
                  options={tagColorOptions(t)}
                  onChange={(event) => setField('colorToken', event.target.value)}
                />
              )}
            </Field>

            <div className="checkbox-stack">
              <Checkbox
                label={t('tags.fields.enabled')}
                help={t('tags.fields.enabledHelp')}
                checked={values.enabled}
                disabled={busy}
                onChange={(event) => setField('enabled', event.target.checked)}
              />
            </div>

            {mode === 'edit' && tag && tag.productCount > 0 ? (
              <div className="notice">{t('tags.usageImpact', { count: tag.productCount })}</div>
            ) : null}

            {serverError ? (
              <div className="notice notice-danger" role="alert">
                {serverError}
              </div>
            ) : null}
          </div>
        )}
      </Drawer>

      <ConfirmDialog
        open={discardOpen}
        title={title}
        description={t('tags.discardMessage')}
        confirmLabel={t('tags.discardConfirm')}
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
