import path from 'node:path';
import { config } from 'dotenv';
import { defineConfig } from 'prisma/config';

// The single .env lives at the monorepo root.
config({ path: path.resolve(import.meta.dirname, '../../.env'), quiet: true });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // `prisma generate` (e.g. during the Docker build) needs no database; migrate commands do.
    url: process.env.DATABASE_URL ?? 'postgresql://unset:unset@localhost:5432/unset',
  },
});
