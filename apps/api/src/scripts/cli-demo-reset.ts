/**
 * `pnpm demo:reset` — wipes the demo database and reseeds it (target: < 30 s).
 * Empties every table (or rebuilds the schema when migrations are missing), reseeds and clears
 * locally stored documents. Refuses to run when DEMO_MODE=false.
 */
import './seed-env.js';
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

const apiDir = path.resolve(import.meta.dirname, '../..');
const migrationsOnDisk = fs
  .readdirSync(path.join(apiDir, 'prisma/migrations'), { withFileTypes: true })
  .filter((e) => e.isDirectory()).length;

const client = new pg.Client({ connectionString: config.DATABASE_URL });
await client.connect();
const applied = await client
  .query<{ n: string }>(
    'SELECT count(*) AS n FROM _prisma_migrations WHERE finished_at IS NOT NULL',
  )
  .then((r) => Number(r.rows[0]!.n))
  .catch(() => -1);

if (applied === migrationsOnDisk) {
  // Schema is current: empty every table (fast). The audit table's append-only triggers are
  // switched off for this one statement only, inside the transaction.
  const tables = await client.query<{ tablename: string }>(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'",
  );
  const list = tables.rows.map((t) => `"${t.tablename.replace(/"/g, '""')}"`).join(', ');
  await client.query('BEGIN');
  await client.query('ALTER TABLE audit_events DISABLE TRIGGER USER');
  await client.query(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
  await client.query('ALTER TABLE audit_events ENABLE TRIGGER USER');
  await client.query('COMMIT');
  await client.end();
} else {
  // First run or new migrations: rebuild the schema (the audit triggers go with it).
  await client.query('DROP SCHEMA IF EXISTS public CASCADE');
  await client.query('CREATE SCHEMA public');
  await client.end();
  execSync('pnpm exec prisma migrate deploy', { cwd: apiDir, env: process.env, stdio: 'ignore' });
}

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
