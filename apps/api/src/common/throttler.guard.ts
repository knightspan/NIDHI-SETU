import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { MFA_COOKIE } from '../auth/cookies.js';

/**
 * Rate limits per client IP, except sign-in steps, which are limited per IP *and* account: a whole
 * office behind one public IP must not lock itself out, while guessing one account stays slow (on
 * top of the per-account lockout).
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected override getTracker(req: Record<string, unknown>): Promise<string> {
    const ip = (req.ip as string | undefined) ?? 'unknown';
    const body = req.body as { email?: unknown } | undefined;
    if (typeof body?.email === 'string')
      return Promise.resolve(`${ip}|${body.email.trim().toLowerCase()}`);
    const mfa = (req.cookies as Record<string, string> | undefined)?.[MFA_COOKIE];
    if (mfa)
      return Promise.resolve(
        `${ip}|mfa:${createHash('sha256').update(mfa).digest('hex').slice(0, 16)}`,
      );
    return Promise.resolve(ip);
  }
}
