import type { RequestWithContext } from './request-context';

/**
 * Self-service endpoints that every authenticated administrator may call,
 * regardless of role or of a pending forced password change.
 *
 * Both the session guard (forced password change) and the permission guard
 * (deny-by-default) consult this single list so the two can never drift: a new
 * administrator whose password must be changed has to be able to reach
 * `change-password`, otherwise the account is unusable.
 */
export const SELF_SERVICE_PATHS: ReadonlySet<string> = new Set([
  '/api/v1/admin/auth/me',
  '/api/v1/admin/auth/logout',
  '/api/v1/admin/auth/change-password',
  '/api/v1/health/live',
  '/api/v1/health/ready',
]);

function normalize(value: string | undefined): string | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  const [path] = value.split('?');
  if (!path) return null;
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
}

/**
 * True when the request targets a self-service endpoint.
 *
 * Depending on how the router mounts the global prefix, the matched route path
 * may or may not include `/api/v1`, so every candidate spelling is compared.
 */
export function isSelfServiceRequest(request: RequestWithContext): boolean {
  const routePath = request.route?.path;
  const candidates = [
    normalize(request.path),
    normalize(routePath),
    normalize(`${request.baseUrl ?? ''}${routePath ?? ''}`),
  ];
  return candidates.some((candidate) => candidate !== null && SELF_SERVICE_PATHS.has(candidate));
}
