// Navigation and layout state machine for the admin shell (docs/16 §4).
//
// Kept as pure functions so the transitions, viewport mapping and return-path
// sanitisation are unit-testable without a DOM. The shell component only wires
// these to React state and CSS attributes.

export type SidebarMode = 'expanded' | 'rail' | 'closed';
export type Viewport = 'mobile' | 'tablet' | 'desktop';

/** One preference key for the desktop sidebar mode (docs/16 §6). */
export const SIDEBAR_MODE_KEY = 'admin.sidebar.mode.v1';
/** Group collapse is an independent, non-authoritative visual preference. */
export const SIDEBAR_GROUPS_KEY = 'admin.sidebar.groups.v1';

export const BREAKPOINT_TABLET = 768;
export const BREAKPOINT_DESKTOP = 1280;

// Breakpoints follow docs/16 §4.2: mobile 360-767, tablet 768-1279, desktop 1280+.
export function viewportFor(width: number): Viewport {
  if (!Number.isFinite(width) || width <= 0) return 'desktop';
  if (width < BREAKPOINT_TABLET) return 'mobile';
  if (width < BREAKPOINT_DESKTOP) return 'tablet';
  return 'desktop';
}

export function defaultModeFor(viewport: Viewport): SidebarMode {
  if (viewport === 'mobile') return 'closed';
  if (viewport === 'tablet') return 'rail';
  return 'expanded';
}

export function isSidebarMode(value: unknown): value is SidebarMode {
  return value === 'expanded' || value === 'rail' || value === 'closed';
}

/**
 * Resolves the persisted preference against the current viewport.
 * A stored desktop preference must not force the sidebar open on a phone.
 */
export function resolveMode(stored: unknown, viewport: Viewport): SidebarMode {
  if (viewport === 'mobile') return 'closed';
  if (isSidebarMode(stored)) return stored;
  return defaultModeFor(viewport);
}

/**
 * MenuToggle behaviour (docs/16 §4.2):
 * - desktop: expanded <-> closed
 * - tablet:  expanded <-> rail
 * - mobile:  handled by the drawer, the mode itself never changes
 */
export function nextModeOnMenuToggle(mode: SidebarMode, viewport: Viewport): SidebarMode {
  if (viewport === 'mobile') return mode;
  if (viewport === 'tablet') return mode === 'expanded' ? 'rail' : 'expanded';
  return mode === 'closed' ? 'expanded' : 'closed';
}

/** Secondary control available on desktop only: expanded <-> rail. */
export function nextModeOnRailToggle(mode: SidebarMode): SidebarMode {
  return mode === 'rail' ? 'expanded' : 'rail';
}

/** Mobile drawer starts closed on every entry; it is never persisted (docs/16 §6.2). */
export function isDrawerOpen(viewport: Viewport, mobileOpen: boolean): boolean {
  return viewport === 'mobile' && mobileOpen;
}

/**
 * Only internal, same-origin paths may be used as a post-login destination.
 * Rejects absolute URLs, protocol-relative URLs, backslashes, control
 * characters and dangerous schemes such as `javascript:` (docs/16 §3.3).
 */
export function sanitizeReturnTo(value: string | null | undefined, fallback: string): string {
  if (!value) return fallback;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) return fallback;
  if (!value.startsWith('/')) return fallback;
  if (value.startsWith('//')) return fallback;
  if (value.includes('\\')) return fallback;
  if (value.toLowerCase().startsWith('/\\')) return fallback;
  const withoutLocale = value.replace(/^\/(zh-CN|en-US)(?=\/|$)/, '') || '/';
  if (/^[a-z][a-z0-9+.-]*:/i.test(withoutLocale)) return fallback;
  return value;
}

/** Builds the login URL for an unauthenticated visit, preserving the target. */
export function loginHrefWithReturnTo(locale: string, pathname: string, search: string): string {
  const target = `${pathname}${search}`;
  const safe = sanitizeReturnTo(target, `/${locale}/dashboard`);
  return `/${locale}/login?returnTo=${encodeURIComponent(safe)}`;
}

/**
 * Route matching for menu highlighting. Uses segment boundaries so
 * `/products-archive` never highlights `/products` (docs/16 §4.3).
 */
export function isActiveRoute(pathname: string, href: string): boolean {
  if (pathname === href) return true;
  return pathname.startsWith(href.endsWith('/') ? href : `${href}/`);
}
