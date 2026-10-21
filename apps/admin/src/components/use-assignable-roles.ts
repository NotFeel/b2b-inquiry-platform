'use client';

import { useCallback, useEffect, useState } from 'react';
import type { AssignableRoleSummary } from '@b2b/contracts';
import { AdminApiError } from '../lib/admin-api';
import { usersApi } from '../lib/users-api';
import { translateError } from '../lib/i18n';

export interface AssignableRolesState {
  roles: AssignableRoleSummary[];
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/**
 * Loads the assignable-role inventory once per page and exposes explicit
 * loading/error/retry state (docs/17 §4.4). The list is refreshed deliberately
 * rather than cached across users, so a role change by another administrator is
 * picked up when the form is opened again.
 */
export function useAssignableRoles(locale: string, enabled = true): AssignableRolesState {
  const [roles, setRoles] = useState<AssignableRoleSummary[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      setRoles([]);
      setError(null);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    usersApi
      .assignableRoles()
      .then((result) => {
        if (cancelled) return;
        setRoles(result);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setRoles([]);
        setError(
          caught instanceof AdminApiError ? translateError(locale, caught.code) : 'errors.INTERNAL_ERROR',
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, locale, nonce]);

  return { roles, loading, error, reload };
}
