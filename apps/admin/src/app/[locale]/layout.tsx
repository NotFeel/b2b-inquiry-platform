import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { ToastProvider } from '@b2b/ui';
import { SessionProvider } from '../../components/session-provider';
import { isAdminLocale } from '../../lib/i18n';

interface Props {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}

/**
 * Locale layout shared by the login route and the protected back office.
 *
 * It provides session state and toasts only - no chrome. The admin shell is
 * mounted by the `(admin)` route group so the login screen and protected pages
 * cannot disagree about which layout owns the navigation (docs/16 §3.1).
 */
export default async function AdminLocaleLayout({ children, params }: Props) {
  const { locale } = await params;
  if (!isAdminLocale(locale)) notFound();
  return (
    <SessionProvider locale={locale}>
      <ToastProvider>{children}</ToastProvider>
    </SessionProvider>
  );
}
