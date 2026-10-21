import { cookies } from 'next/headers';
import type { ReactNode } from 'react';
import { AdminShell } from '../../../components/admin-shell';
import { SIDEBAR_COOKIE, readSidebarCookieValue } from '../../../lib/sidebar-preference';

interface Props {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}

/**
 * The single protected shell for every back-office route (docs/16 §3.1).
 *
 * The sidebar preference is read from a cookie so the server renders the first
 * paint in the user's chosen mode; `null` means "auto" and is resolved by CSS
 * (expanded on desktop, rail on tablet). The dashboard and every other page only
 * supply their own content.
 */
export default async function AdminProtectedLayout({ children, params }: Props) {
  const { locale } = await params;
  const cookieStore = await cookies();
  const initialMode = readSidebarCookieValue(cookieStore.get(SIDEBAR_COOKIE)?.value);
  return (
    <AdminShell locale={locale} initialMode={initialMode}>
      {children}
    </AdminShell>
  );
}
