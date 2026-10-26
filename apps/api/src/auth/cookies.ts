import type { CookieOptions } from 'express';

export const ACCESS_COOKIE = 'ns_access';
export const REFRESH_COOKIE = 'ns_refresh';
export const MFA_COOKIE = 'ns_mfa';
export const CSRF_COOKIE = 'ns_csrf';
export const CSRF_HEADER = 'x-csrf-token';

export function cookieOptions(secure: boolean, maxAgeSeconds: number, path = '/'): CookieOptions {
  return {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path,
    maxAge: maxAgeSeconds * 1000,
  };
}
