'use client';

import { useEffect, useState } from 'react';
import type { DictionaryTypeSummary } from '@b2b/contracts';
import { Button, Checkbox, ConfirmDialog, Drawer, Field, Input, Textarea, useToast } from '@b2b/ui';
import { AdminApiError } from '../lib/admin-api';
import {
  DICTIONARY_CODE_MAX,
  DICTIONARY_NAME_KEY_MAX,
  EMPTY_TYPE_FORM,
  hasTypeFormErrors,
  isTypeFormDirty,
  toTypeFormValues,
  toTypePayload,
  validateTypeForm,
  type DictionaryTypeFormErrors,
  type DictionaryTypeFormValues,
  type FormMode,
} from '../lib/dictionary-form';
import { dictionaryApi } from '../lib/dictionary-api';
import { translateError } from '../lib/i18n';
import { useSession } from './session-provider';

export interface DictionaryTypeDrawerProps {
  open: boolean;
  mode: FormMode;
  type: DictionaryTypeSummary | null;
  onClose: () => void;
  onSaved: (saved: DictionaryTypeSummary, mode: FormMode) => void;
}

/**
 * Create/edit a dictionary type (docs/20 §5.4).
 *
 * The type code is a stable machine key: it is writable only while creating and
 * read-only afterwards, and the display name is resolved from the i18n resource
 * through `nameKey` rather than stored as free text.
 */
export function DictionaryTypeDrawer({ open, mode, type, onClose, onSaved }: DictionaryTypeDrawerProps) {
  const { t, locale } = useSession();
  const toast = useToast();

  const [values, setValues] = useState<DictionaryTypeFormValues>(EMPTY_TYPE_FORM);
  const [initial, setInitial] = useState<DictionaryTypeFormValues>(EMPTY_TYPE_FORM);
  const [errors, setErrors] = useState<DictionaryTypeFormErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const seeded = toTypeFormValues(type);
    setValues(seeded);
    setInitial(seeded);
    setErrors({});
    setServerError(null);
  }, [open, type]);

  const dirty = isTypeFormDirty(values, initial);
  const nameKey = values.nameKey.trim();
  const resolvedLabel = nameKey.length > 0 && t(nameKey) !== nameKey ? t(nameKey) : null;

  const requestClose = () => {
    if (busy) return;
    if (dirty) {
      setDiscardOpen(true);
      return;
    }
    onClose();
  };

  const submit = async () => {
    const validation = validateTypeForm(values, mode);
    setErrors(validation);
    setServerError(null);
    if (hasTypeFormErrors(validation)) return;

    setBusy(true);
    try {
      const payload = toTypePayload(values, mode);
      const saved =
        mode === 'create'
          ? await dictionaryApi.createType({
              code: payload.code ?? '',
              nameKey: payload.nameKey,
              description: payload.description,
              enabled: payload.enabled,
            })
          : await dictionaryApi.updateType(type!.id, {
              nameKey: payload.nameKey,
              description: payload.description,
              enabled: payload.enabled,
            });
      toast.success(t('dictionary.typeSaved'));
      onSaved(saved, mode);
      onClose();
    } catch (caught) {
      if (caught instanceof AdminApiError) {
        if (caught.details && typeof caught.details.code === 'string') {
          setErrors({ code: 'dictionary.errors.codeTaken' });
        } else {
          setServerError(translateError(locale, caught.code));
        }
      } else {
        setServerError(t('errors.INTERNAL_ERROR'));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Drawer
        open={open}
        title={mode === 'create' ? t('dictionary.newType') : t('dictionary.editType')}
        onClose={requestClose}
        closeLabel={t('common.close')}
        footer={
          <>
            <Button variant="secondary" onClick={requestClose} disabled={busy}>
              {t('common.cancel')}
            </Button>
            <Button loading={busy} onClick={() => void submit()}>
              {mode === 'create' ? t('dictionary.newType') : t('common.save')}
            </Button>
          </>
        }
      >
        <div className="stack">
          <Field
            label={t('dictionary.fields.typeCode')}
            required={mode === 'create'}
            help={mode === 'create' ? t('dictionary.fields.typeCodeHelp') : t('dictionary.fields.typeCodeLocked')}
            error={errors.code ? t(errors.code) : undefined}
          >
            {({ inputId, describedBy }) => (
              <Input
                inputId={inputId}
                describedBy={describedBy}
                value={values.code}
                disabled={mode === 'edit' || busy}
                maxLength={DICTIONARY_CODE_MAX}
                invalid={Boolean(errors.code)}
                placeholder="payment_terms"
                onChange={(event) =>
                  setValues((current) => ({ ...current, code: event.target.value.trim().toLowerCase() }))
                }
              />
            )}
          </Field>

          <Field
            label={t('dictionary.fields.nameKey')}
            required
            help={t('dictionary.fields.nameKeyHelp')}
            error={errors.nameKey ? t(errors.nameKey) : undefined}
            hint={
              <span className="field-hint-inline">
                {resolvedLabel
                  ? t('dictionary.fields.nameKeyResolved', { label: resolvedLabel })
                  : t('dictionary.fields.nameKeyMissing')}
              </span>
            }
          >
            {({ inputId, describedBy }) => (
              <Input
                inputId={inputId}
                describedBy={describedBy}
                value={values.nameKey}
                disabled={busy}
                maxLength={DICTIONARY_NAME_KEY_MAX}
                invalid={Boolean(errors.nameKey)}
                placeholder="dictionary.payment_terms"
                onChange={(event) => setValues((current) => ({ ...current, nameKey: event.target.value }))}
              />
            )}
          </Field>

          <Field label={t('dictionary.fields.description')}>
            {({ inputId, describedBy }) => (
              <Textarea
                inputId={inputId}
                describedBy={describedBy}
                value={values.description}
                disabled={busy}
                rows={3}
                maxLength={500}
                onChange={(event) => setValues((current) => ({ ...current, description: event.target.value }))}
              />
            )}
          </Field>

          <Checkbox
            label={t('dictionary.fields.typeEnabled')}
            help={t('dictionary.fields.typeEnabledHelp')}
            checked={values.enabled}
            disabled={busy || Boolean(type?.systemLocked)}
            onChange={(event) => setValues((current) => ({ ...current, enabled: event.target.checked }))}
          />

          {type?.systemLocked ? <div className="notice">{t('dictionary.locked.typeNotice')}</div> : null}

          {serverError ? (
            <div className="notice notice-danger" role="alert">
              {serverError}
            </div>
          ) : null}
        </div>
      </Drawer>

      <ConfirmDialog
        open={discardOpen}
        title={mode === 'create' ? t('dictionary.newType') : t('dictionary.editType')}
        description={t('dictionary.discardMessage')}
        confirmLabel={t('dictionary.discardConfirm')}
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
