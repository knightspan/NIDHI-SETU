import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  ChangePasswordSchema,
  LoginSchema,
  TotpCodeSchema,
  type ChangePasswordInput,
  type LoginInput,
  type LoginResult,
  type Me,
  type TotpCodeInput,
} from '@nidhisetu/shared';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { ApiZodBody, ZodPipe } from '../common/zod.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import type { Principal } from '../domain/scope.js';
import { AuthService, type IssuedSession } from './auth.service.js';
import { ACCESS_COOKIE, MFA_COOKIE, REFRESH_COOKIE, cookieOptions } from './cookies.js';
import { AllowDuringPasswordChange, AuthenticatedOnly, CurrentUser, Public } from './decorators.js';

const REFRESH_PATH = '/api/auth';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  @ApiZodBody(LoginSchema)
  async login(
    @Body(new ZodPipe(LoginSchema)) body: LoginInput,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResult> {
    const outcome = await this.auth.login(body.email, body.password);
    if ('session' in outcome) {
      this.setSession(res, outcome.session);
      return outcome.result;
    }
    res.cookie(MFA_COOKIE, outcome.mfaToken, {
      ...cookieOptions(this.secure, 300),
      sameSite: 'strict',
    });
    return outcome.result;
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('mfa/verify')
  @HttpCode(200)
  @ApiZodBody(TotpCodeSchema)
  async verifyMfa(
    @Body(new ZodPipe(TotpCodeSchema)) body: TotpCodeInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResult> {
    const session = await this.auth.verifyMfa(this.cookie(req, MFA_COOKIE), body.code);
    res.clearCookie(MFA_COOKIE, { path: '/' });
    this.setSession(res, session);
    return { status: 'OK' };
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true }> {
    this.setSession(res, await this.auth.refresh(this.cookie(req, REFRESH_COOKIE)));
    return { ok: true };
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  async logout(
    @Req() req: Request & { user?: Principal },
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true }> {
    await this.auth.logout(this.cookie(req, REFRESH_COOKIE), req.user);
    res.clearCookie(ACCESS_COOKIE, { path: '/' });
    res.clearCookie(REFRESH_COOKIE, { path: REFRESH_PATH });
    return { ok: true };
  }

  @AuthenticatedOnly()
  @AllowDuringPasswordChange()
  @Get('me')
  me(@CurrentUser() user: Principal): Promise<Me> {
    return this.auth.me(user);
  }

  /** Change your own password (also how a temporary password is replaced). */
  @AuthenticatedOnly()
  @AllowDuringPasswordChange()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('password')
  @HttpCode(200)
  @ApiZodBody(ChangePasswordSchema)
  async changePassword(
    @CurrentUser() user: Principal,
    @Body(new ZodPipe(ChangePasswordSchema)) body: ChangePasswordInput,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true }> {
    this.setSession(
      res,
      await this.auth.changePassword(user, body.currentPassword, body.newPassword),
    );
    return { ok: true };
  }

  /** Optional MFA for institution users. */
  @AuthenticatedOnly()
  @Post('mfa/setup')
  @HttpCode(200)
  setupMfa(@CurrentUser() user: Principal) {
    return this.auth.startOptionalMfa(user);
  }

  @AuthenticatedOnly()
  @Post('mfa/enable')
  @HttpCode(200)
  @ApiZodBody(TotpCodeSchema)
  async enableMfa(
    @CurrentUser() user: Principal,
    @Body(new ZodPipe(TotpCodeSchema)) body: TotpCodeInput,
  ): Promise<{ ok: true }> {
    await this.auth.confirmOptionalMfa(user, body.code);
    return { ok: true };
  }

  private get secure(): boolean {
    return this.config.NODE_ENV === 'production';
  }

  private cookie(req: Request, name: string): string | undefined {
    return (req.cookies as Record<string, string | undefined>)[name];
  }

  private setSession(res: Response, s: IssuedSession): void {
    res.cookie(
      ACCESS_COOKIE,
      s.accessToken,
      cookieOptions(this.secure, this.config.JWT_ACCESS_TTL_SECONDS),
    );
    res.cookie(
      REFRESH_COOKIE,
      s.refreshToken,
      cookieOptions(this.secure, this.config.JWT_REFRESH_TTL_SECONDS, REFRESH_PATH),
    );
  }
}
