/**
 * `pnpm demo:reset` — wipes the demo database and reseeds it (target: < 30 s).
 * Drops the `public` schema (the audit triggers go with it), re-applies migrations, reseeds and
 * clears locally stored documents. Refuses to run when DEMO_MODE=false.
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { REPO_ROOT, getConfig } from '../config/config.js';
import { scriptPrisma } from './db.js';
import { printCredentials, seedAll } from './seed.js';

const started = Date.now();
const config = getConfig();
if (!config.DEMO_MODE) {
  console.error('demo:reset is only available when DEMO_MODE=true.');
  process.exit(1);
}
const dbName = new URL(config.DATABASE_URL).pathname.slice(1);
console.log(`Resetting demo database "${dbName}"…`);

const client = new pg.Client({ connectionString: config.DATABASE_URL });
await client.connect();
await client.query('DROP SCHEMA IF EXISTS public CASCADE');
await client.query('CREATE SCHEMA public');
await client.end();

execSync('pnpm exec prisma migrate deploy', {
  cwd: path.resolve(import.meta.dirname, '../..'),
  env: process.env,
  stdio: 'ignore',
});

if (config.STORAGE_DRIVER === 'fs') {
  const root = path.resolve(REPO_ROOT, config.STORAGE_FS_ROOT ?? '.data/objects');
  fs.rmSync(root, { recursive: true, force: true });
}

const prisma = scriptPrisma();
try {
  await seedAll(prisma);
} finally {
  await prisma.$disconnect();
}
printCredentials();
console.log(`\ndemo:reset finished in ${((Date.now() - started) / 1000).toFixed(1)}s`);
