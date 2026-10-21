import { Body, Controller, Get, Inject, Post, Query, Req, Res } from '@nestjs/common';
import { resolveAdminLocale } from '@b2b/contracts';
import {
  changePasswordSchema,
  loginSchema,
  type ChangePasswordInput,
  type LoginInput,
} from '@b2b/validation';
import type { Response } from 'express';
import { APP_ENV, type AppEnv } from '../../config/config.module';
import { ClientIp, CurrentActor, Public, RequestId } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod.pipe';
import type { AuthenticatedActor, RequestWithContext } from '../../common/request-context';
import { MenusService } from '../menus/menus.service';
import { AuthService } from './auth.service';

@Controller('admin/auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly menus: MenusService,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  @Public()
  @Post('login')
  async login(
    @Body(zodPipe(loginSchema)) body: LoginInput,
    @ClientIp() ip: string | null,
    @Req() request: RequestWithContext,
    @RequestId() requestId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const userAgent = request.headers['user-agent'] ?? null;
    const { token, expiresAt, user } = await this.auth.login(body.username, body.password, {
      ip,
      userAgent: typeof userAgent === 'string' ? userAgent : null,
      requestId,
    });
    this.setSessionCookie(response, token, expiresAt);
    return { user, expiresAt: expiresAt.toISOString() };
  }

  @Post('logout')
  async logout(
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.logout(actor.sessionId, actor.id, requestId);
    response.clearCookie(this.env.SESSION_COOKIE_NAME, { path: '/' });
    return result;
  }

  @Get('me')
  async me(@CurrentActor() actor: AuthenticatedActor, @Query('locale') locale?: string) {
    const [user, menus] = await Promise.all([
      this.auth.me(actor.id),
      this.menus.listForPermissions(
        Array.from(actor.permissions),
        actor.roles,
        resolveAdminLocale(locale),
      ),
    ]);
    return { user, menus };
  }

  @Post('change-password')
  async changePassword(
    @Body(zodPipe(changePasswordSchema)) body: ChangePasswordInput,
    @CurrentActor() actor: AuthenticatedActor,
    @RequestId() requestId: string,
  ) {
    return this.auth.changePassword(
      actor.id,
      actor.sessionId,
      body.currentPassword,
      body.newPassword,
      requestId,
    );
  }

  private setSessionCookie(response: Response, token: string, expiresAt: Date): void {
    response.cookie(this.env.SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      secure: this.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      expires: expiresAt,
    });
  }
}
