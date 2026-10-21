import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { PERMISSIONS } from '@b2b/contracts';
import type { AuthenticatedActor, RequestWithContext } from '../request-context';

export const IS_PUBLIC_KEY = 'b2b:is-public';
export const PERMISSIONS_KEY = 'b2b:permissions';
export const AUDIT_ACTION_KEY = 'b2b:audit-action';

// Marks a route as reachable without an admin session (storefront endpoints).
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

// Every admin route must declare the permission it needs; the guards deny by
// default otherwise (docs/05 §4).
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

export const SUPER_ADMIN_ROLE = 'super_admin';

export const Permission = PERMISSIONS;

export const CurrentActor = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedActor => {
    const request = context.switchToHttp().getRequest<RequestWithContext>();
    if (!request.actor) {
      throw new Error('CurrentActor used on a route without an authenticated actor.');
    }
    return request.actor;
  },
);

export const RequestId = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => {
    const request = context.switchToHttp().getRequest<RequestWithContext>();
    return request.requestId ?? 'unknown';
  },
);

export const ClientIp = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string | null => {
    const request = context.switchToHttp().getRequest<RequestWithContext>();
    const forwarded = request.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length > 0) {
      return forwarded.split(',')[0]?.trim() ?? null;
    }
    return request.ip ?? null;
  },
);
