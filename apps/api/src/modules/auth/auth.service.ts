import { Inject, Injectable } from '@nestjs/common';
import { ERROR_CODES } from '@b2b/contracts';
import type { AuthenticatedAdminUser } from '@b2b/contracts';
import { APP_ENV, type AppEnv } from '../../config/config.module';
import { ApiError } from '../../common/errors/api-error';
import { JsonLogger } from '../../common/logger.service';
import { AuditService } from '../../common/services/audit.service';
import { CryptoService } from '../../common/services/crypto.service';
import { RateLimitService } from '../../common/services/rate-limit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { checkPasswordPolicy } from './password-policy';

export interface LoginContext {
  ip: string | null;
  userAgent: string | null;
  requestId: string;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(APP_ENV) private readonly env: AppEnv,
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly rateLimit: RateLimitService,
    private readonly audit: AuditService,
    private readonly logger: JsonLogger,
  ) {}

  /**
   * Authenticates an administrator.
   *
   * Failures always return the same code so callers cannot enumerate accounts,
   * while an explicit lockout window protects against credential stuffing
   * (docs/01 §3.1, docs/07 §4).
   */
  async login(
    username: string,
    password: string,
    context: LoginContext,
  ): Promise<{ token: string; expiresAt: Date; user: AuthenticatedAdminUser }> {
    const normalizedUsername = username.trim().toLowerCase();
    const rateKey = `login:${normalizedUsername}:${context.ip ?? 'unknown'}`;
    const limit = await this.rateLimit.consume(rateKey, this.env.LOGIN_MAX_ATTEMPTS * 3, 60);
    if (!limit.allowed) {
      throw new ApiError(ERROR_CODES.rateLimited, 'Too many login attempts. Try again shortly.');
    }

    const user = await this.prisma.adminUser.findUnique({
      where: { username: normalizedUsername },
      include: { userRoles: { include: { role: { include: { permissions: true } } } } },
    });

    if (!user) {
      // Spend comparable time even when the account does not exist.
      await this.crypto.verifyPassword(
        '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHR2YWx1ZQ$0000000000000000000000000000000000000000000',
        password,
      );
      await this.audit.record({
        action: 'auth.login_failed',
        entityType: 'admin_user',
        entityId: null,
        requestId: context.requestId,
        metadata: { reason: 'unknown_username', usernameLength: normalizedUsername.length },
      });
      throw new ApiError(ERROR_CODES.authInvalidCredentials, 'Incorrect username or password.');
    }

    if (user.status !== 'ACTIVE') {
      throw new ApiError(ERROR_CODES.authAccountDisabled, 'This account is disabled.');
    }
    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      throw new ApiError(ERROR_CODES.authAccountLocked, 'This account is temporarily locked.');
    }

    const passwordOk = await this.crypto.verifyPassword(user.passwordHash, password);
    if (!passwordOk) {
      const failedLoginCount = user.failedLoginCount + 1;
      const shouldLock = failedLoginCount >= this.env.LOGIN_MAX_ATTEMPTS;
      await this.prisma.adminUser.update({
        where: { id: user.id },
        data: {
          failedLoginCount: shouldLock ? 0 : failedLoginCount,
          lockedUntil: shouldLock ? new Date(Date.now() + this.env.LOGIN_LOCK_MINUTES * 60_000) : null,
        },
      });
      await this.audit.record({
        actorId: user.id,
        action: 'auth.login_failed',
        entityType: 'admin_user',
        entityId: user.id,
        requestId: context.requestId,
        metadata: { locked: shouldLock, attempts: failedLoginCount },
      });
      throw new ApiError(
        shouldLock ? ERROR_CODES.authAccountLocked : ERROR_CODES.authInvalidCredentials,
        'Incorrect username or password.',
      );
    }

    const token = this.crypto.generateSessionToken();
    const expiresAt = new Date(Date.now() + this.env.SESSION_TTL_HOURS * 3600_000);
    await this.prisma.$transaction([
      this.prisma.adminUser.update({
        where: { id: user.id },
        data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
      }),
      this.prisma.adminSession.create({
        data: {
          userId: user.id,
          tokenHash: this.crypto.sha256(token),
          expiresAt,
          userAgent: context.userAgent?.slice(0, 255) ?? null,
          // Only a keyed hash of the IP is retained, and only to spot abuse.
          ipHash: context.ip ? this.crypto.hmac(context.ip, 'session-ip') : null,
        },
      }),
    ]);

    await this.audit.record({
      actorId: user.id,
      action: 'auth.login_succeeded',
      entityType: 'admin_user',
      entityId: user.id,
      requestId: context.requestId,
    });
    this.logger.info('auth.login', { actorId: user.id, requestId: context.requestId }, 'AuthService');

    return { token, expiresAt, user: this.toAuthenticatedUser(user) };
  }

  async logout(sessionId: string, actorId: string, requestId: string): Promise<{ revoked: true }> {
    await this.prisma.adminSession.update({
      where: { id: sessionId },
      data: { revokedAt: new Date() },
    });
    await this.audit.record({
      actorId,
      action: 'auth.logout',
      entityType: 'admin_session',
      entityId: sessionId,
      requestId,
    });
    return { revoked: true };
  }

  async me(userId: string): Promise<AuthenticatedAdminUser> {
    const user = await this.prisma.adminUser.findUnique({
      where: { id: userId },
      include: { userRoles: { include: { role: { include: { permissions: true } } } } },
    });
    if (!user) throw ApiError.notFound('Account not found.');
    return this.toAuthenticatedUser(user);
  }

  async changePassword(
    userId: string,
    currentSessionId: string,
    currentPassword: string,
    newPassword: string,
    requestId: string,
  ): Promise<{ changed: true }> {
    const user = await this.prisma.adminUser.findUnique({ where: { id: userId } });
    if (!user) throw ApiError.notFound('Account not found.');

    const currentOk = await this.crypto.verifyPassword(user.passwordHash, currentPassword);
    if (!currentOk) {
      throw new ApiError(ERROR_CODES.authCurrentPasswordInvalid, 'The current password is not correct.');
    }
    if (await this.crypto.verifyPassword(user.passwordHash, newPassword)) {
      throw ApiError.validation('The new password must differ from the current password.', {
        newPassword: 'password.mustDiffer',
      });
    }
    const policy = checkPasswordPolicy(newPassword, user.username);
    if (!policy.valid) {
      throw ApiError.validation('The new password does not meet the password policy.', {
        newPassword: policy.reasons.join(','),
      });
    }

    const passwordHash = await this.crypto.hashPassword(newPassword);
    await this.prisma.$transaction([
      this.prisma.adminUser.update({
        where: { id: userId },
        data: { passwordHash, mustChangePassword: false, failedLoginCount: 0, lockedUntil: null },
      }),
      // Other sessions are invalidated; the current one survives.
      this.prisma.adminSession.updateMany({
        where: { userId, revokedAt: null, id: { not: currentSessionId } },
        data: { revokedAt: new Date() },
      }),
    ]);

    await this.audit.record({
      actorId: userId,
      action: 'auth.password_changed',
      entityType: 'admin_user',
      entityId: userId,
      requestId,
    });
    return { changed: true };
  }

  private toAuthenticatedUser(user: {
    id: string;
    username: string;
    displayName: string;
    mustChangePassword: boolean;
    userRoles: { role: { code: string; permissions: { permissionCode: string }[] } }[];
  }): AuthenticatedAdminUser {
    const roles = user.userRoles.map((userRole) => userRole.role.code);
    const permissions = new Set<string>();
    for (const userRole of user.userRoles) {
      for (const permission of userRole.role.permissions) {
        permissions.add(permission.permissionCode);
      }
    }
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      mustChangePassword: user.mustChangePassword,
      roles,
      permissions: Array.from(permissions).sort(),
    };
  }
}
