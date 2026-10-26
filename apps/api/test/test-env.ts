import path from 'node:path';
import { config } from 'dotenv';

config({ path: path.resolve(import.meta.dirname, '../../../.env'), quiet: true });

/** Integration tests always use a separate database whose name ends in `_test`. */
export function testDatabaseUrl(): string {
  const explicit = process.env.TEST_DATABASE_URL;
  if (explicit) return explicit;
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error('DATABASE_URL or TEST_DATABASE_URL must be set for integration tests');
  const url = new URL(base);
  if (!url.pathname.endsWith('_test')) url.pathname = `${url.pathname}_test`;
  return url.toString();
}

export function assertTestDatabase(url: string): void {
  const name = new URL(url).pathname.slice(1);
  if (!name.endsWith('_test')) {
    throw new Error(`Refusing to run integration tests against "${name}": name must end in _test`);
  }
}
