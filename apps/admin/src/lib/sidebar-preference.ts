import { SIDEBAR_MODE_KEY, isSidebarMode, type SidebarMode } from './layout-state';

/**
 * The desktop sidebar preference is stored in a cookie rather than
 * localStorage so the server can render the first paint in the user's chosen
 * mode and hydration stays consistent (docs/16 §6.3).
 *
 * Only a display preference is stored - never a token, permission list or any
 * business data (docs/16 §6.5).
 *
 * This module is deliberately free of the 'use client' directive: the reader is
 * used by the server layout to render the first paint, while the writers run in
 * the browser (both are guarded against a missing `document`).
 */
export const SIDEBAR_COOKIE = 'admin_sidebar_mode';
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export function readSidebarCookieValue(raw: string | undefined): SidebarMode | null {
  if (!raw) return null;
  return isSidebarMode(raw) ? raw : null;
}

export function writeSidebarPreference(mode: SidebarMode | null): void {
  if (typeof document === 'undefined') return;
  const base = `path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax`;
  document.cookie = mode
    ? `${SIDEBAR_COOKIE}=${mode}; ${base}`
    : `${SIDEBAR_COOKIE}=; path=/; max-age=0; samesite=lax`;
}

/** localStorage fallback used only when cookies are unavailable. */
export function readSidebarFallback(): SidebarMode | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = window.localStorage.getItem(SIDEBAR_MODE_KEY);
    return isSidebarMode(stored) ? stored : null;
  } catch {
    return null;
  }
}

export function writeSidebarFallback(mode: SidebarMode | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (mode) window.localStorage.setItem(SIDEBAR_MODE_KEY, mode);
    else window.localStorage.removeItem(SIDEBAR_MODE_KEY);
  } catch {
    // Private mode or storage disabled: the preference simply does not persist.
  }
}
