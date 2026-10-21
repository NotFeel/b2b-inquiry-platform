import type { MenuNode } from '@b2b/contracts';
import type { BreadcrumbItem } from '@b2b/ui';
import { localeHref } from './i18n';

/**
 * Resolves the visible navigation trail for the current URL.
 *
 * The same localized menu labels feed the sidebar and the breadcrumb; this
 * helper is the single route-to-trail resolver so deep links such as
 * `/en-US/products/:id/edit` never fall back to a separately hard-coded map.
 */
export function resolveNavigationBreadcrumb(
  menus: MenuNode[],
  pathname: string,
  locale: string,
): BreadcrumbItem[] | undefined {
  const find = (nodes: MenuNode[], trail: MenuNode[]): MenuNode[] | null => {
    for (const node of nodes) {
      const nextTrail = [...trail, node];
      const found = find(node.children, nextTrail);
      if (found) return found;
      if (node.route) {
        const href = localeHref(locale, node.route);
        if (pathname === href || pathname.startsWith(`${href}/`)) return nextTrail;
      }
    }
    return null;
  };

  const trail = find(menus, []);
  if (!trail) return undefined;
  return trail
    .filter((node) => node.label.trim().length > 0)
    .map((node) => ({ label: node.label }));
}
