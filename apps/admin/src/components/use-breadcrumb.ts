'use client';

import { useMemo } from 'react';
import { usePathname } from 'next/navigation';
import type { BreadcrumbItem } from '@b2b/ui';
import { resolveNavigationBreadcrumb } from '../lib/navigation-breadcrumb';
import { useSession } from './session-provider';

// Breadcrumb derived from the menu tree the signed-in account can actually see,
// so a page never advertises a module the user cannot open (docs/16 §4.3).
export function useBreadcrumb(): BreadcrumbItem[] | undefined {
  const { menus, locale } = useSession();
  const pathname = usePathname();

  return useMemo(
    () => resolveNavigationBreadcrumb(menus, pathname, locale),
    [menus, pathname, locale],
  );
}
