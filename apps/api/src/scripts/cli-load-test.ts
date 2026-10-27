/**
 * `pnpm load-test` — performance check for the nightly lifecycle job (validity, reminders,
 * escalations) at scale: loads N active instruments (default 10 000) into a separate database
 * (`<db>_load`), runs the job once and fails if it takes longer than the budget (default 60 s).
 * The demo database is never touched.
 */
import './seed-env.js';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { NestFactory } from '@nestjs/core';
import pg from 'pg';
import { loadConfig } from '../config/config.js';

const N = Number(process.env.LOAD_INSTRUMENTS ?? 10_000);
const BUDGET_S = Number(process.env.LOAD_BUDGET_SECONDS ?? 60);

// loadConfig reads .env without caching, so the app below can still be pointed at the load DB.
const base = new URL(loadConfig().DATABASE_URL);
const loadDb = `${base.pathname.slice(1)}_load`;
const loadUrl = new URL(base);
loadUrl.pathname = `/${loadDb}`;

// 1. Fresh database with the current schema.
const admin = new pg.Client({ connectionString: base.toString() });
await admin.connect();
await admin.query(`DROP DATABASE IF EXISTS "${loadDb}" WITH (FORCE)`);
await admin.query(`CREATE DATABASE "${loadDb}"`);
await admin.end();
process.env.DATABASE_URL = loadUrl.toString();
execSync('pnpm exec prisma migrate deploy', {
  cwd: path.resolve(import.meta.dirname, '../..'),
  env: process.env,
  stdio: 'ignore',
});

// Config is read on first use, so these imports come after DATABASE_URL points at the load DB.
const { AppModule } = await import('../app.module.js');
const { LifecycleService } = await import('../jobs/lifecycle.service.js');
const { scriptPrisma } = await import('./db.js');
const { seedAll } = await import('./seed.js');

const prisma = scriptPrisma();
await seedAll(prisma, { quiet: true, masterOnly: true });
const institutions = await prisma.institution.findMany({ select: { id: true } });
const banks = await prisma.bank.findMany({ select: { id: true, code: true } });

// 2. N active deposits with maturities spread from 100 days ago to 5 years ahead.
const t0 = Date.now();
const today = Date.UTC(
  new Date().getUTCFullYear(),
  new Date().getUTCMonth(),
  new Date().getUTCDate(),
);
const DAY = 86_400_000;
for (let start = 0; start < N; start += 2_000) {
  const rows = Array.from({ length: Math.min(2_000, N - start) }, (_, k) => {
    const i = start + k;
    const bank = banks[i % banks.length]!;
    const maturity = new Date(today + (((i * 7919) % 1900) - 100) * DAY);
    return {
      refNo: `LOAD-${String(i).padStart(6, '0')}`,
      institutionId: institutions[i % institutions.length]!.id,
      bankId: bank.id,
      bankCode: bank.code,
      ifsc: `${bank.code}0LOAD01`,
      fdrNumber: `LOAD/${i}`,
      amount: 500_000,
      issueDate: new Date(maturity.getTime() - 1826 * DAY),
      maturityDate: maturity,
      depositorNames: 'AICTE; LOAD TEST TRUST',
      jointName: true,
      lienMarked: true,
      status: 'ACTIVE' as const,
      trustScore: 100,
      activatedAt: new Date(maturity.getTime() - 1800 * DAY),
    };
  });
  await prisma.instrument.createMany({ data: rows });
}
console.log(`Loaded ${N} active instruments in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
await prisma.$disconnect();

// 3. Run the lifecycle job once, as the scheduler would.
const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
try {
  const started = Date.now();
  const summary = await app.get(LifecycleService).run('load-test');
  const seconds = (Date.now() - started) / 1000;
  console.log(`Lifecycle job over ${N} instruments: ${seconds.toFixed(1)}s`);
  console.log(JSON.stringify(summary));
  if (seconds > BUDGET_S) {
    console.error(`FAIL: over the ${BUDGET_S}s budget`);
    process.exitCode = 1;
  } else {
    console.log(`PASS: within the ${BUDGET_S}s budget`);
  }
} finally {
  await app.close();
}
