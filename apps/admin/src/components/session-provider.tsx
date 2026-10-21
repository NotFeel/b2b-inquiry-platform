'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { AuthenticatedAdminUser, MenuNode } from '@b2b/contracts';
import { AdminApiError, adminApi } from '../lib/admin-api';
import { getTranslator } from '../lib/i18n';

/**
 * Session states are explicit so the shell can react to each one without ever
 * replacing itself with a bare page (docs/16 §2.2, AGENTS.md F2).
 *
 * - loading:         first check in flight; the shell renders a skeleton
 * - authenticated:   a valid session with menus
 * - unauthenticated: no valid session; the shell asks the gate to redirect
 * - error:           the session check itself failed (5xx, network, CORS)
 */
export type SessionStatus = 'loading' | 'authenticated' | 'unauthenticated' | 'error';

interface SessionContextValue {
  status: SessionStatus;
  user: AuthenticatedAdminUser | null;
  menus: MenuNode[];
  locale: string;
  errorCode: string | null;
  requestId: string | null;
  signIn: (username: string, password: string) => Promise<AuthenticatedAdminUser>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
  can: (permission: string) => boolean;
  t: (key: string, params?: Record<string, string | number>) => string;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ locale, children }: { locale: string; children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [user, setUser] = useState<AuthenticatedAdminUser | null>(null);
  const [menus, setMenus] = useState<MenuNode[]>([]);
  const [menusLocale, setMenusLocale] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  // Keeps the last known session usable while a transient refresh failure is
  // reported, instead of dropping the user back to a shell-less state.
  const userRef = useRef<AuthenticatedAdminUser | null>(null);
  userRef.current = user;

  const refresh = useCallback(async () => {
    try {
      const result = await adminApi.me(locale);
      setUser(result.user);
      setMenus(result.menus);
      setMenusLocale(locale);
      setStatus('authenticated');
      setErrorCode(null);
      setRequestId(null);
    } catch (error) {
      const apiError = error instanceof AdminApiError ? error : null;
      const code = apiError?.code ?? 'INTERNAL_ERROR';
      if (apiError?.status === 401) {
        setUser(null);
        setMenus([]);
        setStatus('unauthenticated');
        setErrorCode(code);
        setRequestId(apiError.requestId ?? null);
        return;
      }
      setErrorCode(code);
      setRequestId(apiError?.requestId ?? null);
      if (userRef.current) {
        // The session itself is still valid; surface the failure as a warning
        // inside the shell rather than unmounting navigation.
        setStatus('authenticated');
        return;
      }
      setStatus('error');
    }
  }, [locale]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<SessionContextValue>(() => {
    const translator = getTranslator(locale);
    return {
      status,
      user,
      // A locale switch must never render the previous locale's menu labels
      // while the new navigation request is in flight (docs/26 §4.8).
      menus: menusLocale === locale ? menus : [],
      locale,
      errorCode,
      requestId,
      signIn: async (username: string, password: string) => {
        const result = await adminApi.login(username, password);
        setUser(result.user);
        setStatus('authenticated');
        setErrorCode(null);
        setRequestId(null);
        // Menus arrive with /me; loading them must not block the redirect.
        void refresh();
        return result.user;
      },
      signOut: async () => {
        await adminApi.logout().catch(() => undefined);
        setUser(null);
        setMenus([]);
        setMenusLocale(null);
        setStatus('unauthenticated');
      },
      refresh,
      can: (permission: string) =>
        user !== null &&
        (user.roles.includes('super_admin') || user.permissions.includes(permission)),
      t: translator.t,
    };
  }, [status, user, menus, menusLocale, locale, errorCode, requestId, refresh]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSession must be used inside <SessionProvider>.');
  return context;
}
