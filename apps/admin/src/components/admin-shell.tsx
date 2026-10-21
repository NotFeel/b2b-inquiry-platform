'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Button, ErrorState, Modal, Skeleton, ToastProvider } from '@b2b/ui';
import { buildApiUrl } from '../lib/admin-api';
import {
  SIDEBAR_GROUPS_KEY,
  isDrawerOpen,
  loginHrefWithReturnTo,
  nextModeOnMenuToggle,
  nextModeOnRailToggle,
  resolveMode,
  type SidebarMode,
} from '../lib/layout-state';
import {
  readSidebarFallback,
  writeSidebarFallback,
  writeSidebarPreference,
} from '../lib/sidebar-preference';
import { AdminHeader } from './admin-header';
import { AdminSidebarNav } from './admin-sidebar-nav';
import { ChangePasswordForm, ChangePasswordScreen } from './change-password';
import { useSession } from './session-provider';
import { useViewport } from './use-viewport';

export interface AdminShellProps {
  locale: string;
  /**
   * Sidebar preference read from the cookie on the server, so the first paint
   * already matches the user's choice (docs/16 §6.3). `null` means "auto":
   * CSS resolves it to expanded on desktop and rail on tablet.
   */
  initialMode: SidebarMode | null;
  children: ReactNode;
}

/**
 * The single admin application frame (docs/16 §3.1-§3.2).
 *
 * It is mounted once by the protected route group and always renders the header,
 * the menu toggle and the content area. Session loading, a failed session check
 * or an unauthenticated visit only change the *content area*, never the chrome,
 * so navigation can always be restored (AGENTS.md F1/F2).
 */
export function AdminShell({ locale, initialMode, children }: AdminShellProps) {
  const { status, user, menus, errorCode, requestId, signOut, refresh, t } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const viewport = useViewport();

  const [mode, setMode] = useState<SidebarMode | 'auto'>(initialMode ?? 'auto');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [closedGroups, setClosedGroups] = useState<Record<string, boolean>>({});
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [companyName, setCompanyName] = useState('');
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);

  const resolvedMode = resolveMode(mode === 'auto' ? undefined : mode, viewport);
  const drawerOpen = isDrawerOpen(viewport, mobileOpen);
  const navHidden = viewport === 'mobile' ? !drawerOpen : resolvedMode === 'closed';
  const navCollapsed = viewport !== 'mobile' && resolvedMode === 'rail';

  // Group collapse is an independent visual preference, never authoritative.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(SIDEBAR_GROUPS_KEY);
      if (stored) setClosedGroups(JSON.parse(stored) as Record<string, boolean>);
    } catch {
      setClosedGroups({});
    }
  }, []);

  // Cookie-less environments (private mode) fall back to a local preference.
  useEffect(() => {
    if (initialMode) return;
    const fallback = readSidebarFallback();
    if (fallback) setMode(fallback);
  }, [initialMode]);

  useEffect(() => {
    void fetch(buildApiUrl('/public/site-config'))
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { data?: { companyName?: string } } | null) => {
        if (payload?.data?.companyName) setCompanyName(payload.data.companyName);
      })
      .catch(() => undefined);
  }, []);

  // Unauthenticated on a protected route: keep the chrome and hand off to login.
  useEffect(() => {
    if (status !== 'unauthenticated') return;
    const search = typeof window === 'undefined' ? '' : window.location.search;
    router.replace(loginHrefWithReturnTo(locale, pathname, search));
  }, [status, locale, pathname, router]);

  // Drawer: Escape closes and returns focus to the toggle; body scroll is locked
  // while it is open and restored afterwards.
  useEffect(() => {
    if (!drawerOpen) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMobileOpen(false);
        menuButtonRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [drawerOpen]);

  const persistMode = useCallback((next: SidebarMode) => {
    writeSidebarPreference(next);
    writeSidebarFallback(next);
  }, []);

  const onMenuToggle = useCallback(() => {
    if (viewport === 'mobile') {
      setMobileOpen((value) => !value);
      return;
    }
    const next = nextModeOnMenuToggle(resolvedMode, viewport);
    setMode(next);
    persistMode(next);
  }, [viewport, resolvedMode, persistMode]);

  const onRailToggle = useCallback(() => {
    const next = nextModeOnRailToggle(resolvedMode);
    setMode(next);
    persistMode(next);
  }, [resolvedMode, persistMode]);

  const onToggleGroup = useCallback((code: string, closed: boolean) => {
    setClosedGroups((current) => {
      const next = { ...current, [code]: closed };
      try {
        window.localStorage.setItem(SIDEBAR_GROUPS_KEY, JSON.stringify(next));
      } catch {
        // Storage unavailable: the collapse state simply does not persist.
      }
      return next;
    });
  }, []);

  const onNavigate = useCallback(() => {
    if (viewport !== 'mobile') return;
    setMobileOpen(false);
    // Focus is returned to the toggle so keyboard users keep their place.
    window.setTimeout(() => menuButtonRef.current?.focus(), 0);
  }, [viewport]);

  const languageHref = useCallback(
    (target: string) => {
      const nextPath = pathname.replace(/^\/(zh-CN|en-US)/, `/${target}`);
      const query = searchParams.toString();
      return query.length > 0 ? `${nextPath}?${query}` : nextPath;
    },
    [pathname, searchParams],
  );

  // A temporary password blocks every other endpoint, so this is the one screen
  // that intentionally replaces the workspace (docs/01 §3.1).
  if (status === 'authenticated' && user?.mustChangePassword) {
    return (
      <ToastProvider>
        <ChangePasswordScreen />
      </ToastProvider>
    );
  }

  const content =
    status === 'loading' || status === 'unauthenticated' || !user ? (
      <ShellContentSkeleton />
    ) : status === 'error' ? (
      <ErrorState
        title={t('shell.sessionErrorTitle')}
        description={t('shell.sessionErrorBody', { code: errorCode ?? 'INTERNAL_ERROR' })}
        retryLabel={t('common.retry')}
        onRetry={() => void refresh()}
        requestId={requestId}
        copyLabel={t('list.copy')}
        copiedLabel={t('list.copied')}
      />
    ) : (
      children
    );

  return (
    <ToastProvider>
      <div
        className="admin-shell"
        data-sidebar={mode}
        data-rail={navCollapsed}
        data-viewport={viewport}
      >
        <aside id="admin-sidebar" className="admin-sidebar" data-open={drawerOpen}>
          <AdminSidebarNav
            menus={menus}
            locale={locale}
            rail={navCollapsed}
            closedGroups={closedGroups}
            onToggleGroup={onToggleGroup}
            onNavigate={onNavigate}
            labels={{ navigation: t('shell.navigation'), brandContext: t('shell.brandContext') }}
            companyName={companyName || t('shell.brandName')}
            brandMark={t('shell.brandShort')}
          />
        </aside>

        <div
          className="admin-overlay"
          data-open={drawerOpen}
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />

        <div className="admin-main">
          {user ? (
            <AdminHeader
              menuButtonRef={menuButtonRef}
              locale={locale}
              pathname={pathname}
              user={user}
              menus={menus}
              navHidden={navHidden}
              navCollapsed={navCollapsed}
              drawerOpen={drawerOpen}
              onMenuToggle={onMenuToggle}
              onRailToggle={onRailToggle}
              onSignOut={() => void signOut()}
              onChangePassword={() => setPasswordOpen(true)}
              t={t}
              languageHref={languageHref}
            />
          ) : (
            <div className="admin-header admin-header-placeholder" aria-hidden="true" />
          )}
          <div className="admin-content" data-role="admin-content">
            {content}
          </div>
        </div>
      </div>

      <Modal
        open={passwordOpen}
        title={t('changePassword.menuItem')}
        onClose={() => setPasswordOpen(false)}
        closeLabel={t('common.close')}
      >
        <ChangePasswordForm locale={locale} onDone={() => setPasswordOpen(false)} />
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <Button variant="secondary" onClick={() => setPasswordOpen(false)}>
            {t('common.close')}
          </Button>
        </div>
      </Modal>
    </ToastProvider>
  );
}

function ShellContentSkeleton() {
  return (
    <div className="stack" aria-hidden="true">
      <Skeleton height={28} width="38%" />
      <Skeleton height={14} width="62%" />
      <div className="stat-grid">
        {[0, 1, 2, 3].map((index) => (
          <div className="stat-card" key={index}>
            <Skeleton height={12} width="50%" />
            <Skeleton height={26} width="35%" />
          </div>
        ))}
      </div>
      <Skeleton height={180} />
    </div>
  );
}
