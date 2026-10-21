import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ERROR_CODES } from '@b2b/contracts';
import type { RequestWithContext } from '../request-context';
import { PrismaService } from '../../prisma/prisma.service';
import { CryptoService } from '../services/crypto.service';
import { IS_PUBLIC_KEY } from '../decorators';
import { ApiError } from '../errors/api-error';
import { isSelfServiceRequest } from '../auth-paths';

// Server-side session authentication. The cookie only carries an opaque token;
// the database holds its hash, so a leaked cookie store is not replayable.
@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<RequestWithContext>();
    const token = this.readToken(request);
    if (!token) {
      throw new ApiError(ERROR_CODES.unauthorized, 'Authentication is required.');
    }

    const tokenHash = this.crypto.sha256(token);
    const session = await this.prisma.adminSession.findUnique({
      where: { tokenHash },
      include: {
        user: {
          include: {
            userRoles: {
              include: {
                role: { include: { permissions: true } },
              },
            },
          },
        },
      },
    });

    if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now()) {
      throw new ApiError(ERROR_CODES.authSessionExpired, 'The session has expired.');
    }
    if (session.user.status !== 'ACTIVE') {
      throw new ApiError(ERROR_CODES.authAccountDisabled, 'This account is disabled.');
    }

    const roles = session.user.userRoles.map((userRole) => userRole.role.code);
    const permissions = new Set<string>();
    for (const userRole of session.user.userRoles) {
      for (const rolePermission of userRole.role.permissions) {
        permissions.add(rolePermission.permissionCode);
      }
    }

    request.actor = {
      id: session.user.id,
      username: session.user.username,
      displayName: session.user.displayName,
      roles,
      permissions,
      sessionId: session.id,
      mustChangePassword: session.user.mustChangePassword,
    };

    if (request.actor.mustChangePassword) {
      if (!isSelfServiceRequest(request)) {
        throw new ApiError(
          ERROR_CODES.authPasswordChangeRequired,
          'A password change is required before using the back office.',
        );
      }
    }

    return true;
  }

  private readToken(request: RequestWithContext): string | null {
    const cookies = request.cookies as Record<string, string> | undefined;
    const cookieToken = cookies?.[this.cookieName()];
    if (cookieToken) return cookieToken;
    const header = request.headers.authorization;
    if (typeof header === 'string' && header.toLowerCase().startsWith('bearer ')) {
      return header.slice(7).trim();
    }
    return null;
  }

  private cookieName(): string {
    return process.env.SESSION_COOKIE_NAME ?? 'b2b_admin_session';
  }
}
