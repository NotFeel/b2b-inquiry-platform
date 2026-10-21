import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ERROR_CODES } from '@b2b/contracts';
import type { RequestWithContext } from '../request-context';
import { IS_PUBLIC_KEY, PERMISSIONS_KEY, SUPER_ADMIN_ROLE } from '../decorators';
import { ApiError } from '../errors/api-error';
import { isSelfServiceRequest } from '../auth-paths';

// Deny-by-default authorization: a protected route without an explicit
// @RequirePermissions declaration is only reachable by a super administrator.
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<RequestWithContext>();
    const actor = request.actor;
    if (!actor) {
      throw new ApiError(ERROR_CODES.unauthorized, 'Authentication is required.');
    }
    if (actor.roles.includes(SUPER_ADMIN_ROLE)) return true;

    // Self-service auth routes (change password, sign out, read own session)
    // must stay reachable for every authenticated account, including one that is
    // required to change its password before using the back office.
    if (isSelfServiceRequest(request)) return true;

    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) {
      throw new ApiError(
        ERROR_CODES.forbidden,
        'This endpoint has no declared permission and is restricted to super administrators.',
      );
    }
    const granted = required.every((code) => actor.permissions.has(code));
    if (!granted) {
      throw new ApiError(ERROR_CODES.forbidden, 'The current account lacks the required permission.');
    }
    return true;
  }
}
