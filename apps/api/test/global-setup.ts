import { execSync } from 'node:child_process';
import path from 'node:path';
import pg from 'pg';
import { assertTestDatabase, testDatabaseUrl } from './test-env.js';

/**
 * Gives the integration suite a fresh schema on the dedicated *_test database:
 * drop `public`, then apply all migrations (including the audit triggers).
 */
export default async function setup(): Promise<void> {
  const url = testDatabaseUrl();
  assertTestDatabase(url);

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('DROP SCHEMA IF EXISTS public CASCADE');
    await client.query('CREATE SCHEMA public');
  } finally {
    await client.end();
  }

  execSync('pnpm exec prisma migrate deploy', {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
}
