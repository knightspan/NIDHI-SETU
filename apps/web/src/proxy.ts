import { NextResponse, type NextRequest } from 'next/server';

/**
 * Signed-out visitors go straight to /login (no client-side "Loading…" first). Only the entry
 * points are handled here; every other page and the API still enforce access themselves.
 * `ns_access` is a short-lived cookie set at sign-in; if it has lapsed the sign-in page is the
 * right place anyway, and signing in again is quick.
 */
export function proxy(req: NextRequest) {
  if (req.cookies.has('ns_access')) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.search = '';
  return NextResponse.redirect(url);
}

export const config = { matcher: ['/', '/dashboard'] };
