'use client';

import { useState } from 'react';
import { Button, Field, Input, useToast } from '@b2b/ui';
import { AdminApiError, adminApi } from '../lib/admin-api';
import { getTranslator, translateError } from '../lib/i18n';
import { useSession } from './session-provider';

interface FormProps {
  locale: string;
  onDone?: () => void;
}

// Shared form used by the forced-change gate and by the user menu.
export function ChangePasswordForm({ locale, onDone }: FormProps) {
  const t = getTranslator(locale).t;
  const toast = useToast();
  const { refresh } = useSession();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [repeatPassword, setRepeatPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (newPassword !== repeatPassword) {
      setError(t('changePassword.mismatch'));
      return;
    }
    setBusy(true);
    try {
      await adminApi.changePassword(currentPassword, newPassword);
      await refresh();
      toast.success(t('common.saved'));
      onDone?.();
    } catch (caught) {
      setError(
        caught instanceof AdminApiError ? translateError(locale, caught.code) : t('errors.INTERNAL_ERROR'),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="stack" onSubmit={submit}>
      <p className="field-help">{t('changePassword.hint')}</p>
      <Field label={t('changePassword.current')} required>
        {({ inputId, describedBy }) => (
          <Input
            inputId={inputId}
            describedBy={describedBy}
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            required
            onChange={(event) => setCurrentPassword(event.target.value)}
          />
        )}
      </Field>
      <Field label={t('changePassword.next')} required>
        {({ inputId, describedBy }) => (
          <Input
            inputId={inputId}
            describedBy={describedBy}
            type="password"
            autoComplete="new-password"
            value={newPassword}
            required
            onChange={(event) => setNewPassword(event.target.value)}
          />
        )}
      </Field>
      <Field label={t('changePassword.repeat')} required error={error ?? undefined}>
        {({ inputId, describedBy }) => (
          <Input
            inputId={inputId}
            describedBy={describedBy}
            type="password"
            autoComplete="new-password"
            value={repeatPassword}
            required
            onChange={(event) => setRepeatPassword(event.target.value)}
          />
        )}
      </Field>
      <Button type="submit" loading={busy} block>
        {t('changePassword.submit')}
      </Button>
    </form>
  );
}

// Full-page gate shown while the account still carries a temporary password.
// The API rejects every other management endpoint until this succeeds.
export function ChangePasswordScreen() {
  const { locale, signOut, user } = useSession();
  const t = getTranslator(locale).t;
  return (
    <div className="login-page">
      <div className="login-card stack">
        <div className="login-brand">
          <span className="admin-brand-mark" aria-hidden="true">
            {t('shell.brandShort')}
          </span>
          <span className="admin-brand-name">{t('shell.brandName')}</span>
        </div>
        <div className="stack-sm">
          <h1 style={{ fontSize: 'var(--text-2xl)' }}>{t('changePassword.title')}</h1>
          <p className="muted small">
            {t('shell.signedInAs')}: {user?.username}
          </p>
        </div>
        <ChangePasswordForm locale={locale} />
        <Button variant="ghost" onClick={() => void signOut()}>
          {t('nav.signOut')}
        </Button>
      </div>
    </div>
  );
}
