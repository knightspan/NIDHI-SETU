import path from 'node:path';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const apiUrl = (process.env.API_INTERNAL_URL ?? 'http://localhost:4000').replace(/\/+$/, '');
const isProd = process.env.NODE_ENV === 'production';

// Next.js inlines its bootstrap scripts, so script-src needs 'unsafe-inline' without nonces; every
// other source is restricted to this origin. Dev mode also needs 'unsafe-eval' for fast refresh,
// so the policy is only sent in production builds.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-src 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const nextConfig: NextConfig = {
  // Standalone output is only needed for the Docker image (it also trips Windows symlink limits).
  ...(process.env.NEXT_OUTPUT === 'standalone' ? { output: 'standalone' as const } : {}),
  // Monorepo root, so the standalone build includes workspace packages.
  outputFileTracingRoot: path.join(import.meta.dirname, '../../'),
  poweredByHeader: false,
  reactStrictMode: true,
  // The browser only ever talks to this origin; /api is proxied to NestJS, so auth cookies are
  // first-party and SameSite protections apply.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiUrl}/api/:path*` }];
  },
  async headers() {
    return [
      {
        // /api responses carry the API's own (helmet) headers.
        source: '/((?!api/).*)',
        headers: [
          ...(isProd
            ? [
                { key: 'Content-Security-Policy', value: CSP },
                { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
              ]
            : []),
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default createNextIntlPlugin('./src/i18n/request.ts')(nextConfig);
