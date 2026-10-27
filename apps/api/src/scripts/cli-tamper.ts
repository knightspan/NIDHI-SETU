/**
 * `pnpm tamper` — demonstrates that the audit trail is tamper-evident (demo databases only).
 *
 * 1. Tries an ordinary UPDATE of an audit row: the database refuses it (append-only triggers).
 * 2. Plays a privileged insider: switches the triggers off, quietly edits one event, switches them
 *    back on.
 * 3. Recomputes the hash chain, exactly as `POST /api/audit/verify` does, and reports the break.
 *
 * The edit stays until `pnpm demo:reset`, so the break is also visible on the Audit page.
 */
import './seed-env.js';
import { NestFactory } from '@nestjs/core';
import pg from 'pg';
import { AppModule } from '../app.module.js';
import { AuditService } from '../audit/audit.service.js';
import { getConfig } from '../config/config.js';

const config = getConfig();
if (!config.DEMO_MODE) {
  console.error('tamper is a demo script; it refuses to run when DEMO_MODE=false.');
  process.exit(1);
}

const db = new pg.Client({ connectionString: config.DATABASE_URL });
await db.connect();
const { rows } = await db.query<{ seq: string; action: string; data: Record<string, unknown> }>(
  `SELECT seq, action, data FROM audit_events WHERE action LIKE 'release.%' OR action LIKE 'bank.%'
   ORDER BY seq LIMIT 1`,
);
const target = rows[0];
if (!target) {
  console.error('No audit events found. Run `pnpm seed` first.');
  process.exit(1);
}
console.log(`Target: audit event #${target.seq} (${target.action})`);

// 1. The honest path is blocked by the database itself.
try {
  await db.query(`UPDATE audit_events SET data = data || '{"note":"edited"}' WHERE seq = $1`, [
    target.seq,
  ]);
  console.log('✗ UPDATE was allowed — the append-only trigger is missing!');
} catch (e) {
  console.log(
    `✔ Plain UPDATE refused by the database: ${e instanceof Error ? e.message : String(e)}`,
  );
}

// 2. A privileged insider disables the trigger and rewrites history.
await db.query('BEGIN');
await db.query('ALTER TABLE audit_events DISABLE TRIGGER USER');
await db.query(
  `UPDATE audit_events SET data = data || '{"note":"approved by someone else"}' WHERE seq = $1`,
  [target.seq],
);
await db.query('ALTER TABLE audit_events ENABLE TRIGGER USER');
await db.query('COMMIT');
await db.end();
console.log(`… event #${target.seq} silently edited with the triggers switched off`);

// 3. The hash chain exposes it.
const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
try {
  const result = await app.get(AuditService).verify();
  if (result.ok) {
    console.log('✗ Chain still verifies — tampering NOT detected');
    process.exitCode = 1;
  } else {
    console.log(`✔ Tampering detected after checking ${result.checked} events:`);
    for (const b of result.breaks.slice(0, 3)) console.log('   ', JSON.stringify(b));
    console.log('Run `pnpm demo:reset` to restore a clean chain.');
  }
} finally {
  await app.close();
}
