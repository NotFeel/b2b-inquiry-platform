'use client';

import Link from 'next/link';
import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from 'react';
import type { AuthenticatedAdminUser, MenuNode } from '@b2b/contracts';
import { IconChevronDown, IconClose, IconMenu, IconPanelLeft, IconSettings } from '@b2b/ui';
import { resolveNavigationBreadcrumb } from '../lib/navigation-breadcrumb';
import { hasUnsavedAdminForm } from '../lib/unsaved-form';

export interface AdminHeaderProps {
  locale: string;
  pathname: string;
  user: AuthenticatedAdminUser;
  menus: MenuNode[];
  /** True when the navigation is currently hidden or collapsed to icons. */
  navHidden: boolean;
  navCollapsed: boolean;
  drawerOpen: boolean;
  onMenuToggle: () => void;
  onRailToggle: () => void;
  onSignOut: () => void;
  onChangePassword: () => void;
  t: (key: string, params?: Record<string, string | number>) => string;
  languageHref: (locale: string) => string;
  /** Focus target restored after the mobile drawer closes. */
  menuButtonRef?: RefObject<HTMLButtonElement | null>;
}

/**
 * Top bar. The menu toggle lives here and is rendered on every admin page in
 * every navigation state, so navigation can always be restored
 * (docs/16 §4.3, AGENTS.md F2).
 */
export function AdminHeader({
  locale,
  pathname,
  user,
  menus,
  navHidden,
  navCollapsed,
  drawerOpen,
  onMenuToggle,
  onRailToggle,
  onSignOut,
  onChangePassword,
  t,
  languageHref,
  menuButtonRef,
}: AdminHeaderProps) {
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (!userMenuRef.current?.contains(event.target as Node)) setUserMenuOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const breadcrumb = resolveNavigationBreadcrumb(menus, pathname, locale) ?? [
    { label: t('shell.brandContext') },
  ];

  const menuLabel = drawerOpen
    ? t('shell.closeNav')
    : navHidden
      ? t('shell.openNav')
      : t('shell.hideNav');
  const initials = (user.displayName || user.username).trim().slice(0, 1).toUpperCase();
  const confirmLanguageSwitch = (event: ReactMouseEvent<HTMLAnchorElement>) => {
    if (!hasUnsavedAdminForm()) return;
    if (!window.confirm(t('shell.unsavedLanguageSwitch'))) event.preventDefault();
  };

  return (
    <header className="admin-header" data-role="admin-header">
      <div className="admin-header-left">
        <button
          ref={menuButtonRef}
          type="button"
          className="icon-button admin-menu-toggle"
          aria-label={menuLabel}
          aria-expanded={drawerOpen || !navHidden}
          aria-controls="admin-sidebar"
          onClick={onMenuToggle}
        >
          {drawerOpen ? <IconClose size={20} /> : <IconMenu size={20} />}
        </button>

        {!navHidden ? (
          <button
            type="button"
            className="icon-button admin-rail-toggle"
            aria-label={navCollapsed ? t('shell.expandNav') : t('shell.collapseNav')}
            aria-pressed={navCollapsed}
            onClick={onRailToggle}
          >
            <IconPanelLeft size={18} />
          </button>
        ) : null}

        <nav aria-label={t('shell.breadcrumb')} className="admin-topbar-context">
          <ol className="breadcrumb">
            {breadcrumb.map((item, index) => (
              <li
                key={`${item.label}-${index}`}
                aria-current={index === breadcrumb.length - 1 ? 'page' : undefined}
              >
                {item.label}
              </li>
            ))}
          </ol>
        </nav>
      </div>

      <div className="admin-header-right">
        <div className="admin-lang-switch" role="group" aria-label={t('shell.language')}>
          <Link
            href={languageHref('zh-CN')}
            aria-current={locale === 'zh-CN' ? 'true' : undefined}
            onClick={confirmLanguageSwitch}
          >
            中文
          </Link>
          <Link
            href={languageHref('en-US')}
            aria-current={locale === 'en-US' ? 'true' : undefined}
            onClick={confirmLanguageSwitch}
          >
            EN
          </Link>
        </div>

        <div className="admin-user-menu" ref={userMenuRef}>
          <button
            type="button"
            className="admin-user-trigger"
            aria-expanded={userMenuOpen}
            aria-haspopup="menu"
            onClick={() => setUserMenuOpen((value) => !value)}
          >
            <span className="admin-user-avatar" aria-hidden="true">
              {initials}
            </span>
            <span className="truncate admin-user-name-compact" style={{ maxWidth: 140 }}>
              {user.displayName || user.username}
            </span>
            <IconChevronDown size={14} />
          </button>
          {userMenuOpen ? (
            <div className="admin-user-popover" role="menu">
              <div className="admin-user-meta">
                <span className="admin-user-name">{user.displayName || user.username}</span>
                <span className="admin-user-roles">{user.roles.join(', ')}</span>
              </div>
              <button
                type="button"
                className="admin-user-action"
                role="menuitem"
                onClick={() => {
                  onChangePassword();
                  setUserMenuOpen(false);
                }}
              >
                <IconSettings size={16} />
                {t('changePassword.menuItem')}
              </button>
              <button
                type="button"
                className="admin-user-action"
                role="menuitem"
                onClick={() => {
                  setUserMenuOpen(false);
                  onSignOut();
                }}
              >
                <IconClose size={16} />
                {t('nav.signOut')}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
