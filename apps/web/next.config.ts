import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Standalone output is only needed for the Docker image (it also trips Windows symlink limits).
  ...(process.env.NEXT_OUTPUT === 'standalone' ? { output: 'standalone' as const } : {}),
  // Monorepo root, so the standalone build includes workspace packages.
  outputFileTracingRoot: path.join(import.meta.dirname, '../../'),
  poweredByHeader: false,
  reactStrictMode: true,
};

export default nextConfig;
