'use client';

import { useEffect, useState } from 'react';
import type { GlobalSettingSummary } from '@b2b/contracts';
import { SETTING_VALUE_TYPES } from '@b2b/contracts';
import { Button, Checkbox, Field, Input, Modal, Select, Textarea, useToast } from '@b2b/ui';
import { AdminApiError } from '../lib/admin-api';
import { translateError } from '../lib/i18n';
import { settingsApi } from '../lib/settings-api';
import { useSession } from './session-provider';

export interface SettingDraft {
  key: string;
  groupCode: string;
  valueType: string;
  value: string;
  isPublic: boolean;
  isSecret: boolean;
  isRequired: boolean;
  sortOrder: string;
  labelZh: string;
  labelEn: string;
  descriptionZh: string;
  descriptionEn: string;
}

const EMPTY: SettingDraft = {
  key: '',
  groupCode: 'custom',
  valueType: 'string',
  value: '',
  isPublic: false,
  isSecret: false,
  isRequired: false,
  sortOrder: '0',
  labelZh: '',
  labelEn: '',
  descriptionZh: '',
  descriptionEn: '',
};

function toDraft(setting: GlobalSettingSummary | null): SettingDraft {
  if (!setting) return { ...EMPTY };
  return {
    ...EMPTY,
    key: setting.key,
    groupCode: setting.groupCode,
    valueType: setting.valueType,
    // A secret is never echoed back: the field stays empty and empty means
    // "keep the stored secret" (docs/21 §4.2).
    value: setting.isSecret ? '' : formatValue(setting.value),
    isPublic: setting.isPublic,
    isSecret: setting.isSecret,
    isRequired: setting.isRequired,
    sortOrder: String(setting.sortOrder),
    labelZh: setting.label.startsWith('settings.') ? '' : setting.label,
    labelEn: '',
  };
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** One drawer for creating and editing a setting (docs/21 §4.1-§4.2). */
export function SettingFormModal({
  mode,
  setting,
  groupOptions,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit';
  setting: GlobalSettingSummary | null;
  groupOptions: { value: string; label: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t, locale } = useSession();
  const toast = useToast();
  const [draft, setDraft] = useState<SettingDraft>(() => toDraft(setting));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setDraft(toDraft(setting)), [setting]);

  const set = <K extends keyof SettingDraft>(field: K, value: SettingDraft[K]) =>
    setDraft((current) => ({ ...current, [field]: value }));

  const submit = async () => {
    setBusy(true);
    setError(null);
    const translations = [
      ...(draft.labelZh.trim() ? [{ locale: 'zh-CN', label: draft.labelZh.trim(), description: draft.descriptionZh.trim() || null }] : []),
      ...(draft.labelEn.trim() ? [{ locale: 'en-US', label: draft.labelEn.trim(), description: draft.descriptionEn.trim() || null }] : []),
    ];
    try {
      if (mode === 'create') {
        await settingsApi.create({
          key: draft.key.trim().toLowerCase(),
          groupCode: draft.groupCode,
          valueType: draft.valueType,
          value: draft.value,
          isPublic: draft.isPublic,
          isSecret: draft.isSecret,
          isRequired: draft.isRequired,
          sortOrder: Number(draft.sortOrder) || 0,
          translations,
          locale,
        });
        toast.success(t('settings.created'));
      } else if (setting) {
        await settingsApi.update(setting.key, {
          // An empty field keeps the stored value; secrets are only replaced when
          // something was actually typed.
          ...(draft.value.length > 0 ? { value: draft.value } : {}),
          isPublic: draft.isPublic,
          isRequired: draft.isRequired,
          sortOrder: Number(draft.sortOrder) || 0,
          ...(setting.isSystem ? {} : { groupCode: draft.groupCode, valueType: draft.valueType }),
          ...(translations.length > 0 ? { translations } : {}),
          expectedRevision: setting.revision,
          locale,
        });
        toast.success(t('settings.saved'));
      }
      onSaved();
    } catch (caught) {
      setError(
        caught instanceof AdminApiError ? translateError(locale, caught.code) : t('errors.INTERNAL_ERROR'),
      );
    } finally {
      setBusy(false);
    }
  };

  const title = mode === 'create' ? t('settings.create') : `${t('common.edit')} · ${setting?.key ?? ''}`;
  const lockedSecret = Boolean(setting?.isSecret);

  return (
    <Modal
      open
      title={title}
      size="lg"
      onClose={onClose}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button loading={busy} onClick={() => void submit()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="stack">
        <div className="grid-form">
          <Field label={t('settings.fields.key')} required={mode === 'create'} help={mode === 'edit' ? t('settings.fields.keyLocked') : undefined}>
            {({ inputId, describedBy }) => (
              <Input
                inputId={inputId}
                describedBy={describedBy}
                value={draft.key}
                disabled={mode === 'edit' || busy}
                placeholder="site.newSetting"
                onChange={(event) => set('key', event.target.value.trim().toLowerCase())}
              />
            )}
          </Field>
          <Field label={t('settings.fields.group')}>
            {({ inputId, describedBy }) => (
              <Select
                inputId={inputId}
                describedBy={describedBy}
                value={draft.groupCode}
                disabled={busy || Boolean(setting?.isSystem)}
                options={groupOptions}
                onChange={(event) => set('groupCode', event.target.value)}
              />
            )}
          </Field>
          <Field label={t('settings.fields.valueType')}>
            {({ inputId, describedBy }) => (
              <Select
                inputId={inputId}
                describedBy={describedBy}
                value={draft.valueType}
                disabled={busy || Boolean(setting?.isSystem)}
                options={SETTING_VALUE_TYPES.map((type) => ({ value: type, label: type }))}
                onChange={(event) => set('valueType', event.target.value)}
              />
            )}
          </Field>
          <Field label={t('settings.fields.sortOrder')}>
            {({ inputId, describedBy }) => (
              <Input
                inputId={inputId}
                describedBy={describedBy}
                type="number"
                value={draft.sortOrder}
                disabled={busy}
                onChange={(event) => set('sortOrder', event.target.value)}
              />
            )}
          </Field>
        </div>

        <Field
          label={lockedSecret ? t('settings.fields.replaceSecret') : t('settings.fields.value')}
          help={lockedSecret ? t('settings.fields.secretHelp') : t('settings.fields.valueHelp')}
        >
          {({ inputId, describedBy }) =>
            draft.valueType === 'text' || draft.valueType === 'json' || draft.valueType === 'objectList' ? (
              <Textarea
                inputId={inputId}
                describedBy={describedBy}
                rows={4}
                value={draft.value}
                disabled={busy}
                onChange={(event) => set('value', event.target.value)}
              />
            ) : (
              <Input
                inputId={inputId}
                describedBy={describedBy}
                autoComplete={lockedSecret ? 'new-password' : 'off'}
                value={draft.value}
                disabled={busy}
                onChange={(event) => set('value', event.target.value)}
              />
            )
          }
        </Field>

        <div className="grid-form">
          <Field label={t('settings.fields.labelZh')} required={mode === 'create'}>
            {({ inputId, describedBy }) => (
              <Input inputId={inputId} describedBy={describedBy} value={draft.labelZh} disabled={busy} onChange={(event) => set('labelZh', event.target.value)} />
            )}
          </Field>
          <Field label={t('settings.fields.labelEn')}>
            {({ inputId, describedBy }) => (
              <Input inputId={inputId} describedBy={describedBy} value={draft.labelEn} disabled={busy} onChange={(event) => set('labelEn', event.target.value)} />
            )}
          </Field>
        </div>

        <div className="checkbox-stack">
          <Checkbox
            label={t('settings.fields.isPublic')}
            help={t('settings.fields.isPublicHelp')}
            checked={draft.isPublic}
            disabled={busy || lockedSecret}
            onChange={(event) => set('isPublic', event.target.checked)}
          />
          {mode === 'create' ? (
            <Checkbox
              label={t('settings.fields.isSecret')}
              help={t('settings.fields.isSecretHelp')}
              checked={draft.isSecret}
              disabled={busy}
              onChange={(event) => {
                set('isSecret', event.target.checked);
                if (event.target.checked) set('isPublic', false);
              }}
            />
          ) : null}
          <Checkbox
            label={t('settings.fields.isRequired')}
            checked={draft.isRequired}
            disabled={busy}
            onChange={(event) => set('isRequired', event.target.checked)}
          />
        </div>

        {error ? (
          <div className="notice notice-danger" role="alert">
            {error}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
