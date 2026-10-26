import { ForbiddenException, Inject, Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { randomToken, safeEqual } from '../common/crypto.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { CSRF_COOKIE, CSRF_HEADER } from './cookies.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
/** Pre-session endpoints: there is no session to ride on yet. */
const EXEMPT = new Set(['/api/auth/login', '/api/auth/mfa/verify']);

/**
 * Double-submit CSRF protection for cookie-authenticated requests: a readable `ns_csrf` cookie
 * must be echoed in the `x-csrf-token` header on every state-changing request.
 */
@Injectable()
export class CsrfMiddleware implements NestMiddleware {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const cookies = req.cookies as Record<string, string | undefined>;
    let token = cookies[CSRF_COOKIE];
    if (!token) {
      token = randomToken(24);
      res.cookie(CSRF_COOKIE, token, {
        httpOnly: false,
        sameSite: 'lax',
        secure: this.config.NODE_ENV === 'production',
        path: '/',
      });
      cookies[CSRF_COOKIE] = token;
    }
    const path = req.originalUrl.split('?')[0] ?? '';
    if (SAFE_METHODS.has(req.method) || EXEMPT.has(path)) return next();
    const header = req.header(CSRF_HEADER);
    if (!header || !safeEqual(header, token)) {
      throw new ForbiddenException('Missing or invalid CSRF token');
    }
    next();
  }
}
