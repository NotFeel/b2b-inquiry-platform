'use client';

import { useEffect, useState } from 'react';
import type { DictionaryItemSummary } from '@b2b/contracts';
import { Button, Checkbox, ConfirmDialog, Drawer, Field, Input, useToast } from '@b2b/ui';
import { AdminApiError } from '../lib/admin-api';
import {
  DICTIONARY_CODE_MAX,
  DICTIONARY_LABEL_MAX,
  DICTIONARY_VALUE_MAX,
  emptyItemForm,
  hasItemFormErrors,
  isItemFormDirty,
  toItemFormValues,
  toItemPayload,
  validateItemForm,
  type DictionaryItemFormErrors,
  type DictionaryItemFormValues,
  type FormMode,
} from '../lib/dictionary-form';
import { dictionaryApi } from '../lib/dictionary-api';
import { invalidateDictionaryOptions } from '../lib/dictionary-options';
import { ADMIN_LOCALES, translateError } from '../lib/i18n';
import { useSession } from './session-provider';

export interface DictionaryItemDrawerProps {
  open: boolean;
  mode: FormMode;
  /** Owning type code; always known while the drawer is open. */
  typeCode: string;
  /** Type label already resolved for display. */
  typeLabel: string;
  item: DictionaryItemSummary | null;
  /** Default sort order for a new item, derived from the current list. */
  suggestedSortOrder: number;
  onClose: () => void;
  onSaved: (saved: DictionaryItemSummary, mode: FormMode) => void;
}

/**
 * Create/edit one dictionary item (docs/20 §5.5).
 *
 * The item code is stable within its type, both locales are required by the
 * form, and `systemLocked` is display-only: an administrator can never switch it
 * off because locked items drive application behaviour.
 */
export function DictionaryItemDrawer({
  open,
  mode,
  typeCode,
  typeLabel,
  item,
  suggestedSortOrder,
  onClose,
  onSaved,
}: DictionaryItemDrawerProps) {
  const { t, locale } = useSession();
  const toast = useToast();

  const [values, setValues] = useState<DictionaryItemFormValues>(() => emptyItemForm(suggestedSortOrder));
  const [initial, setInitial] = useState<DictionaryItemFormValues>(() =>
    emptyItemForm(suggestedSortOrder),
  );
  const [errors, setErrors] = useState<DictionaryItemFormErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);

  const locales = ADMIN_LOCALES;

  useEffect(() => {
    if (!open) return;
    const seeded = item ? toItemFormValues(item, locales) : emptyItemForm(suggestedSortOrder);
    setValues(seeded);
    setInitial(seeded);
    setErrors({});
    setServerError(null);
  }, [open, item, suggestedSortOrder, locales]);

  const dirty = isItemFormDirty(values, initial);
  const locked = Boolean(item?.systemLocked);

  const requestClose = () => {
    if (busy) return;
    if (dirty) {
      setDiscardOpen(true);
      return;
    }
    onClose();
  };

  const submit = async () => {
    const validation = validateItemForm(values, mode, locales);
    setErrors(validation);
    setServerError(null);
    if (hasItemFormErrors(validation)) return;

    setBusy(true);
    try {
      const payload = toItemPayload(values, mode);
      const saved =
        mode === 'create'
          ? await dictionaryApi.createItem(typeCode, {
              code: payload.code ?? '',
              value: payload.value,
              sortOrder: payload.sortOrder,
              enabled: payload.enabled,
              labels: payload.labels,
            })
          : await dictionaryApi.updateItem(item!.id, {
              value: payload.value,
              sortOrder: payload.sortOrder,
              enabled: payload.enabled,
              labels: payload.labels,
              ...(item ? { expectedUpdatedAt: item.updatedAt } : {}),
            });
      // A renamed or reordered option must not linger in a business form.
      invalidateDictionaryOptions(typeCode);
      toast.success(t('dictionary.itemSaved'));
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

  const title = mode === 'create' ? t('dictionary.newItem') : t('dictionary.editItem');

  return (
    <>
      <Drawer
        open={open}
        title={`${title} · ${typeLabel}`}
        onClose={requestClose}
        closeLabel={t('common.close')}
        footer={
          <>
            <Button variant="secondary" onClick={requestClose} disabled={busy}>
              {t('common.cancel')}
            </Button>
            <Button loading={busy} onClick={() => void submit()}>
              {mode === 'create' ? t('dictionary.newItem') : t('common.save')}
            </Button>
          </>
        }
      >
        <div className="stack">
          <Field
            label={t('dictionary.fields.itemCode')}
            required={mode === 'create'}
            help={
              mode === 'create' ? t('dictionary.fields.itemCodeHelp') : t('dictionary.fields.itemCodeLocked')
            }
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
                placeholder="tt-30"
                onChange={(event) =>
                  setValues((current) => ({ ...current, code: event.target.value.trim().toLowerCase() }))
                }
              />
            )}
          </Field>

          {locales.map((targetLocale) => (
            <Field
              key={targetLocale}
              label={t('dictionary.fields.label', { locale: t(`menus.locales.${targetLocale}`) })}
              required
              error={errors.labels?.[targetLocale] ? t(errors.labels[targetLocale]) : undefined}
            >
              {({ inputId, describedBy }) => (
                <Input
                  inputId={inputId}
                  describedBy={describedBy}
                  value={values.labels[targetLocale] ?? ''}
                  disabled={busy}
                  maxLength={DICTIONARY_LABEL_MAX}
                  invalid={Boolean(errors.labels?.[targetLocale])}
                  onChange={(event) =>
                    setValues((current) => ({
                      ...current,
                      labels: { ...current.labels, [targetLocale]: event.target.value },
                    }))
                  }
                />
              )}
            </Field>
          ))}

          <Field
            label={t('dictionary.fields.value')}
            help={t('dictionary.fields.valueHelp')}
            error={errors.value ? t(errors.value) : undefined}
          >
            {({ inputId, describedBy }) => (
              <Input
                inputId={inputId}
                describedBy={describedBy}
                value={values.value}
                disabled={busy}
                maxLength={DICTIONARY_VALUE_MAX}
                invalid={Boolean(errors.value)}
                placeholder={t('dictionary.fields.valuePlaceholder')}
                onChange={(event) => setValues((current) => ({ ...current, value: event.target.value }))}
              />
            )}
          </Field>

          <Field
            label={t('dictionary.fields.sortOrder')}
            error={errors.sortOrder ? t(errors.sortOrder) : undefined}
          >
            {({ inputId, describedBy }) => (
              <Input
                inputId={inputId}
                describedBy={describedBy}
                type="number"
                value={values.sortOrder}
                disabled={busy}
                invalid={Boolean(errors.sortOrder)}
                onChange={(event) => setValues((current) => ({ ...current, sortOrder: event.target.value }))}
              />
            )}
          </Field>

          <Checkbox
            label={t('dictionary.fields.itemEnabled')}
            help={t('dictionary.fields.itemEnabledHelp')}
            checked={values.enabled}
            disabled={busy || locked}
            onChange={(event) => setValues((current) => ({ ...current, enabled: event.target.checked }))}
          />

          {locked ? <div className="notice">{t('dictionary.locked.itemNotice')}</div> : null}

          {serverError ? (
            <div className="notice notice-danger" role="alert">
              {serverError}
            </div>
          ) : null}
        </div>
      </Drawer>

      <ConfirmDialog
        open={discardOpen}
        title={title}
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
