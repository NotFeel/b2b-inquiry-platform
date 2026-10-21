'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { MenuNode } from '@b2b/contracts';
import { IconChevronDown, MenuIcon } from '@b2b/ui';
import { isActiveRoute } from '../lib/layout-state';
import { localeHref } from '../lib/i18n';

interface Props {
  menus: MenuNode[];
  locale: string;
  /** Rail mode hides labels but keeps every item reachable by tooltip. */
  rail: boolean;
  closedGroups: Record<string, boolean>;
  onToggleGroup: (code: string, closed: boolean) => void;
  onNavigate: () => void;
  labels: { navigation: string; brandContext: string };
  companyName: string;
  brandMark: string;
}

// Sidebar content: brand block plus the permission-filtered menu groups.
// The shell owns all state; this component only renders and reports intent.
export function AdminSidebarNav({
  menus,
  locale,
  rail,
  closedGroups,
  onToggleGroup,
  onNavigate,
  labels,
  companyName,
  brandMark,
}: Props) {
  const pathname = usePathname();

  return (
    <>
      <div className="admin-sidebar-brand">
        <span className="admin-brand-mark" aria-hidden="true">
          {brandMark}
        </span>
        <span className="admin-brand-text">
          <span className="admin-brand-name" title={companyName}>
            {companyName}
          </span>
          <span className="admin-brand-context">{labels.brandContext}</span>
        </span>
      </div>

      <nav className="admin-nav" aria-label={labels.navigation}>
        {menus.map((group) => {
          const isClosed = Boolean(closedGroups[group.code]);
          // A group with a single child is rendered as a direct link so simple
          // modules (Overview) do not hide behind a disclosure (docs/16 §4.3).
          const singleChild = group.children.length === 1 ? group.children[0] : null;
          if (singleChild && !group.route) {
            const href = localeHref(locale, singleChild.route ?? '/dashboard');
            const active = isActiveRoute(pathname, href);
            return (
              <div className="admin-nav-group" key={group.id}>
                <span className="admin-nav-group-label" title={rail ? group.label : undefined}>
                  <span>{group.label}</span>
                </span>
                <Link
                  className="admin-nav-link"
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  aria-label={singleChild.label}
                  title={rail ? singleChild.label : undefined}
                  onClick={onNavigate}
                >
                  <MenuIcon name={singleChild.icon} />
                  <span className="nav-label">{singleChild.label}</span>
                </Link>
              </div>
            );
          }

          return (
            <div className="admin-nav-group" key={group.id}>
              <button
                type="button"
                className="admin-nav-group-toggle"
                aria-expanded={!isClosed}
                aria-controls={`admin-nav-group-${group.code}`}
                title={rail ? group.label : undefined}
                onClick={() => onToggleGroup(group.code, !isClosed)}
              >
                <IconChevronDown size={14} />
                <span>{group.label}</span>
              </button>
              <div id={`admin-nav-group-${group.code}`} hidden={isClosed}>
                {group.children.map((child) => {
                  const href = localeHref(locale, child.route ?? '/dashboard');
                  const active = isActiveRoute(pathname, href);
                  return (
                    <Link
                      key={child.id}
                      className="admin-nav-link"
                      href={href}
                      aria-current={active ? 'page' : undefined}
                      aria-label={child.label}
                      title={rail ? child.label : undefined}
                      onClick={onNavigate}
                    >
                      <MenuIcon name={child.icon} />
                      <span className="nav-label">{child.label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>
    </>
  );
}
