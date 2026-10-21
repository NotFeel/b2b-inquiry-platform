'use client';

import { useEffect, useState } from 'react';
import type { RoleSummary } from '@b2b/contracts';
import { Button, Field, Input, Modal, Textarea, useToast } from '@b2b/ui';
import { AdminApiError } from '../lib/admin-api';
import { translateError } from '../lib/i18n';
import {
  EMPTY_ROLE_FORM,
  ROLE_DESCRIPTION_MAX,
  ROLE_NAME_MAX,
  hasRoleFormErrors,
  isRoleFormDirty,
  mapRoleFieldErrors,
  toRoleFormValues,
  toRolePayload,
  validateRoleForm,
  type RoleFormErrors,
  type RoleFormMode,
  type RoleFormValues,
} from '../lib/role-form';
import { rolesApi } from '../lib/roles-api';
import { useSession } from './session-provider';

export interface RoleFormDialogProps {
  open: boolean;
  mode: RoleFormMode;
  /** Target role in edit mode; null while creating. */
  role: RoleSummary | null;
  onClose: () => void;
  onSaved: (role: RoleSummary, mode: RoleFormMode) => void;
}

/**
 * One dialog for creating and editing a role's basic information (docs/18 §2.3).
 *
 * The role code is immutable once created, and the permission set is edited in
 * its own drawer so the two capabilities stay separate server-side.
 */
export function RoleFormDialog({ open, mode, role, onClose, onSaved }: RoleFormDialogProps) {
  const { t, locale } = useSession();
  const toast = useToast();

  const [values, setValues] = useState<RoleFormValues>(EMPTY_ROLE_FORM);
  const [initial, setInitial] = useState<RoleFormValues>(EMPTY_ROLE_FORM);
  const [errors, setErrors] = useState<RoleFormErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Re-seed on every open so a previous role can never leak into the next form.
  useEffect(() => {
    if (!open) return;
    const seeded = toRoleFormValues(role);
    setValues(seeded);
    setInitial(seeded);
    setErrors({});
    setServerError(null);
  }, [open, role]);

  const dirty = isRoleFormDirty(values, initial);

  const requestClose = () => {
    if (busy) return;
    onClose();
  };

  const setField = (field: keyof RoleFormValues, value: string) =>
    setValues((current) => ({ ...current, [field]: value }));

  const submit = async () => {
    const validation = validateRoleForm(values, mode);
    setErrors(validation);
    setServerError(null);
    if (hasRoleFormErrors(validation)) return;

    setBusy(true);
    try {
      const payload = toRolePayload(values, mode);
      if (mode === 'create') {
        const created = await rolesApi.create({
          code: payload.code ?? '',
          names: payload.names,
          description: payload.description,
        });
        toast.success(t('roles.createSuccess'));
        onSaved(created, 'create');
      } else if (role) {
        const updated = await rolesApi.update(role.id, {
          names: payload.names,
          description: payload.description,
          expectedUpdatedAt: role.updatedAt,
        });
        toast.success(t('roles.updateSuccess'));
        onSaved(updated, 'edit');
      }
      onClose();
    } catch (caught) {
      if (caught instanceof AdminApiError) {
        const fieldErrors = mapRoleFieldErrors(caught.details);
        if (Object.keys(fieldErrors).length > 0) {
          setErrors(fieldErrors);
        } else {
          // The typed values stay on screen so the administrator can retry.
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
    <Modal
      open={open}
      title={mode === 'create' ? t('roles.create') : t('roles.edit')}
      onClose={requestClose}
      size="lg"
      closeLabel={t('common.close')}
      dismissOnBackdrop={!dirty && !busy}
      footer={
        <>
          <Button variant="secondary" onClick={requestClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button loading={busy} onClick={() => void submit()}>
            {mode === 'create' ? t('roles.createSubmit') : t('roles.editSubmit')}
          </Button>
        </>
      }
    >
      <div className="grid-form">
        <Field
          label={t('roles.code')}
          required={mode === 'create'}
          help={mode === 'create' ? t('roles.codeHelp') : undefined}
          error={errors.code ? t(errors.code) : undefined}
        >
          {({ inputId, describedBy }) => (
            <Input
              inputId={inputId}
              describedBy={describedBy}
              value={values.code}
              // The code is a stable machine identifier: immutable after creation.
              disabled={mode === 'edit' || busy}
              autoComplete="off"
              maxLength={80}
              invalid={Boolean(errors.code)}
              placeholder="sales_apac"
              onChange={(event) => setField('code', event.target.value.trim().toLowerCase())}
            />
          )}
        </Field>

        <Field
          label={t('roles.nameZh')}
          required
          error={errors.nameZh ? t(errors.nameZh) : undefined}
        >
          {({ inputId, describedBy }) => (
            <Input
              inputId={inputId}
              describedBy={describedBy}
              value={values.nameZh}
              disabled={busy}
              maxLength={ROLE_NAME_MAX}
              invalid={Boolean(errors.nameZh)}
              onChange={(event) => setField('nameZh', event.target.value)}
            />
          )}
        </Field>

        <Field
          label={t('roles.nameEn')}
          required
          error={errors.nameEn ? t(errors.nameEn) : undefined}
        >
          {({ inputId, describedBy }) => (
            <Input
              inputId={inputId}
              describedBy={describedBy}
              value={values.nameEn}
              disabled={busy}
              maxLength={ROLE_NAME_MAX}
              invalid={Boolean(errors.nameEn)}
              onChange={(event) => setField('nameEn', event.target.value)}
            />
          )}
        </Field>
      </div>

      <Field label={t('roles.descriptionField')}>
        {({ inputId, describedBy }) => (
          <Textarea
            inputId={inputId}
            describedBy={describedBy}
            value={values.description}
            disabled={busy}
            maxLength={ROLE_DESCRIPTION_MAX}
            rows={3}
            placeholder={t('roles.descriptionPlaceholder')}
            onChange={(event) => setField('description', event.target.value)}
          />
        )}
      </Field>

      {serverError ? (
        <div className="notice notice-danger" role="alert">
          {serverError}
        </div>
      ) : null}
    </Modal>
  );
}
