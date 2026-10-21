'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Field, Input, useToast } from '@b2b/ui';
import { AdminApiError } from '../lib/admin-api';
import { getTranslator, translateError } from '../lib/i18n';
import { sanitizeReturnTo } from '../lib/layout-state';
import { useSession } from './session-provider';

interface Props {
  locale: string;
  /** Internal path to land on after a successful sign-in. */
  returnTo: string;
}

// Uses the shared session provider so the shell receives the user immediately
// after sign-in; the redirect target is sanitised by the page and again here.
export function LoginForm({ locale, returnTo }: Props) {
  const t = getTranslator(locale).t;
  const toast = useToast();
  const router = useRouter();
  const { signIn, status, user } = useSession();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const target = sanitizeReturnTo(returnTo, `/${locale}/dashboard`);

  // An already signed-in administrator never sees the login form (docs/16 §3.3).
  useEffect(() => {
    if (status === 'authenticated' && user) router.replace(target);
  }, [status, user, router, target]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(username, password);
      router.replace(target);
    } catch (caught) {
      if (caught instanceof AdminApiError) {
        // Stay on the login page and explain the failure; never bounce through
        // the dashboard first.
        setError(translateError(locale, caught.code));
      } else {
        setError(t('errors.INTERNAL_ERROR'));
        toast.error(t('errors.INTERNAL_ERROR'));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <form className="login-card stack" onSubmit={submit}>
        <div className="login-brand">
          <span className="admin-brand-mark" aria-hidden="true">
            {t('shell.brandShort')}
          </span>
          <span className="admin-brand-name">{t('shell.brandName')}</span>
        </div>
        <div className="stack-sm">
          <h1 style={{ fontSize: 'var(--text-2xl)' }}>{t('login.title')}</h1>
          <p className="muted small">{t('login.subtitle')}</p>
        </div>
        <Field label={t('login.username')} required>
          {({ inputId, describedBy }) => (
            <Input
              inputId={inputId}
              describedBy={describedBy}
              value={username}
              autoComplete="username"
              maxLength={80}
              required
              onChange={(event) => setUsername(event.target.value)}
            />
          )}
        </Field>
        <Field label={t('login.password')} required error={error ?? undefined}>
          {({ inputId, describedBy }) => (
            <Input
              inputId={inputId}
              describedBy={describedBy}
              type="password"
              value={password}
              autoComplete="current-password"
              required
              onChange={(event) => setPassword(event.target.value)}
            />
          )}
        </Field>
        <Button type="submit" loading={busy} block>
          {t('login.submit')}
        </Button>
      </form>
    </div>
  );
}
