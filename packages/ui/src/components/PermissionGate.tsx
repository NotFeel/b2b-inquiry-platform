'use client';

import type { ReactNode } from 'react';

export interface PermissionGateProps {
  permissions: string[];
  required: string | string[];
  mode?: 'any' | 'all';
  children: ReactNode;
  fallback?: ReactNode;
}

// Hides UI for users without a permission. This is a UX affordance only - the
// API enforces the same permission server-side (docs/06 §6).
export function PermissionGate({
  permissions,
  required,
  mode = 'any',
  children,
  fallback = null,
}: PermissionGateProps) {
  const list = Array.isArray(required) ? required : [required];
  const granted =
    mode === 'any' ? list.some((code) => permissions.includes(code)) : list.every((code) => permissions.includes(code));
  return <>{granted ? children : fallback}</>;
}
