'use client';

import { useEffect, useMemo, useState } from 'react';
import type { AdminUserSummary } from '@b2b/contracts';
import {
  Badge,
  Button,
  ConfirmDialog,
  Field,
  Input,
  Modal,
  MultiSelect,
  useToast,
} from '@b2b/ui';
import { AdminApiError } from '../lib/admin-api';
import { translateError } from '../lib/i18n';
import {
  EMPTY_USER_FORM,
  hasErrors,
  isFormDirty,
  mapFieldErrors,
  toRoleOptions,
  toUserFormValues,
  validateUserForm,
  type UserFormErrors,
  type UserFormMode,
  type UserFormValues,
} from '../lib/user-form';
import { usersApi } from '../lib/users-api';
import { useSession } from './session-provider';
import { useAssignableRoles } from './use-assignable-roles';

export interface UserFormDialogProps {
  open: boolean;
  mode: UserFormMode;
  /** Target user for edit mode; null while creating. */
  user: AdminUserSummary | null;
  locale: string;
  onClose: () => void;
  onSaved: (user: AdminUserSummary, generatedPassword: string | null, mode: UserFormMode) => void;
}

/**
 * One dialog for creating and editing a back-office user (docs/17 §3.2).
 *
 * The login account is read-only while editing; display name and role
 * assignments are editable. Roles always come from the roles API as ids - there
 * is no free-text role input anywhere in this component.
 */
export function UserFormDialog({ open, mode, user, locale, onClose, onSaved }: UserFormDialogProps) {
  const { t, can } = useSession();
  const toast = useToast();
  const canAssignRoles = can('user.role.assign');
  const { roles, loading: rolesLoading, error: rolesError, reload } = useAssignableRoles(locale, open);

  const initialValues = useMemo(() => toUserFormValues(user), [user]);
  const [values, setValues] = useState<UserFormValues>(initialValues);
  const [errors, setErrors] = useState<UserFormErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);

  // Re-seed whenever the dialog opens for a different user so the previous
  // selection can never leak into the next form (docs/17 §4.3).
  useEffect(() => {
    if (!open) return;
    setValues(initialValues);
    setErrors({});
    setServerError(null);
  }, [open, initialValues]);

  const roleOptions = useMemo(
    () =>
      toRoleOptions(roles, t, {
        systemSuffix: t('users.systemRoleSuffix'),
        notAssignable: t('users.roleNotAssignable'),
      }, locale),
    [roles, t, locale],
  );

  const dirty = isFormDirty(values, initialValues);
  const noAssignableRoles = !rolesLoading && !rolesError && roles.length === 0;
  const submitDisabled = busy || rolesLoading || Boolean(rolesError) || noAssignableRoles;

  const requestClose = () => {
    if (busy) return;
    if (dirty) {
      setDiscardOpen(true);
      return;
    }
    onClose();
  };

  const submit = async () => {
    const validation = validateUserForm(values, mode);
    setErrors(validation);
    setServerError(null);
    if (hasErrors(validation)) return;

    setBusy(true);
    try {
      if (mode === 'create') {
        const result = await usersApi.create({
          username: values.username.trim(),
          displayName: values.displayName.trim(),
          roleIds: values.roleIds,
        });
        toast.success(t('users.createSuccess'));
        onSaved(result.data, result.generatedPassword, 'create');
      } else if (user) {
        const result = await usersApi.update(user.id, {
          displayName: values.displayName.trim(),
          // Only send roleIds when the actor may assign roles; the server also
          // re-validates, so omitting the field is the safest signal.
          ...(canAssignRoles ? { roleIds: values.roleIds } : {}),
          expectedUpdatedAt: user.updatedAt,
        });
        toast.success(t('users.updateSuccess'));
        onSaved(result.data, null, 'edit');
      }
      onClose();
    } catch (caught) {
      if (caught instanceof AdminApiError) {
        const fieldErrors = mapFieldErrors(caught.details);
        if (Object.keys(fieldErrors).length > 0) {
          setErrors(fieldErrors);
        } else {
          // Keep the typed values and explain the failure; a conflict asks the
          // administrator to reload rather than silently overwriting.
          setServerError(translateError(locale, caught.code));
        }
      } else {
        setServerError(t('errors.INTERNAL_ERROR'));
      }
    } finally {
      setBusy(false);
    }
  };

  const title = mode === 'create' ? t('users.create') : t('users.edit');

  return (
    <>
      <Modal
        open={open}
        title={title}
        onClose={requestClose}
        size="lg"
        closeLabel={t('common.close')}
        footer={
          <>
            <Button variant="secondary" onClick={requestClose} disabled={busy}>
              {t('common.cancel')}
            </Button>
            <Button loading={busy} disabled={submitDisabled} onClick={() => void submit()}>
              {mode === 'create' ? t('users.createSubmit') : t('common.save')}
            </Button>
          </>
        }
      >
        <div className="grid-form">
          <Field label={t('users.loginAccount')} required error={errors.username ? t(errors.username) : undefined}>
            {({ inputId, describedBy }) => (
              <Input
                inputId={inputId}
                describedBy={describedBy}
                value={values.username}
                disabled={mode === 'edit' || busy}
                autoComplete="off"
                maxLength={80}
                invalid={Boolean(errors.username)}
                onChange={(event) =>
                  setValues((current) => ({ ...current, username: event.target.value.toLowerCase() }))
                }
              />
            )}
          </Field>

          <Field
            label={t('users.displayName')}
            required
            error={errors.displayName ? t(errors.displayName) : undefined}
          >
            {({ inputId, describedBy }) => (
              <Input
                inputId={inputId}
                describedBy={describedBy}
                value={values.displayName}
                disabled={busy}
                maxLength={120}
                invalid={Boolean(errors.displayName)}
                onChange={(event) => setValues((current) => ({ ...current, displayName: event.target.value }))}
              />
            )}
          </Field>
        </div>

        {canAssignRoles ? (
          <Field
            label={t('users.roles')}
            required
            help={t('users.rolesHelp')}
            error={errors.roleIds ? t(errors.roleIds) : undefined}
          >
            {({ inputId, describedBy }) => (
              <MultiSelect
                inputId={inputId}
                describedBy={describedBy}
                invalid={Boolean(errors.roleIds)}
                options={roleOptions}
                value={values.roleIds}
                onChange={(next) =>
                  setValues((current) => ({ ...current, roleIds: next }))
                }
                placeholder={t('users.rolesPlaceholder')}
                searchPlaceholder={t('users.searchRoles')}
                emptyLabel={t('users.noAssignableRoles')}
                noMatchLabel={t('users.noRoleMatch')}
                loading={rolesLoading}
                loadingLabel={t('users.rolesLoading')}
                error={rolesError ? t('users.rolesLoadFailed') : null}
                onRetry={reload}
                retryLabel={t('common.retry')}
                removeLabel={(label) => t('users.removeRole', { name: label })}
                disabled={busy}
              />
            )}
          </Field>
        ) : (
          <div className="notice">{t('users.rolesNoPermission')}</div>
        )}

        {serverError ? (
          <div className="notice notice-danger" role="alert">
            {serverError}
          </div>
        ) : null}

        {mode === 'edit' && user ? (
          <div className="form-section">
            <h3>{t('users.readOnlyInfo')}</h3>
            <dl className="definition-list">
              <dt>{t('users.statusLabel')}</dt>
              <dd>
                <Badge tone={user.status === 'active' ? 'success' : 'neutral'}>
                  {user.status === 'active' ? t('users.statusActive') : t('users.statusDisabled')}
                </Badge>
              </dd>
              <dt>{t('users.createdAt')}</dt>
              <dd>{new Date(user.createdAt).toLocaleString(locale)}</dd>
              <dt>{t('system.lastLogin')}</dt>
              <dd>{user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString(locale) : '-'}</dd>
            </dl>
          </div>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={discardOpen}
        title={t('users.discardTitle')}
        description={t('users.discardChanges')}
        confirmLabel={t('users.discardConfirm')}
        cancelLabel={t('common.cancel')}
        destructive
        onConfirm={() => {
          setDiscardOpen(false);
          setValues(EMPTY_USER_FORM);
          onClose();
        }}
        onCancel={() => setDiscardOpen(false)}
      />
    </>
  );
}
