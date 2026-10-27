/**
 * `pnpm tamper` — demonstrates that the audit trail is tamper-evident (demo databases only).
 *
 * 1. Tries an ordinary UPDATE of an audit row: the database refuses it (append-only triggers).
 * 2. Plays a privileged insider: switches the triggers off, quietly edits one event, switches them
 *    back on.
 * 3. Recomputes the hash chain, exactly as `POST /api/audit/verify` does, and reports the break.
 * 4. Goes further: recomputes every later hash so the chain is internally consistent again. The
 *    signed anchors (whose key is not in the database) still expose the rewrite.
 *
 * The edit stays until `pnpm demo:reset`, so the break is also visible on the Audit page.
 */
import './seed-env.js';
import { NestFactory } from '@nestjs/core';
import pg from 'pg';
import { AppModule } from '../app.module.js';
import { AuditService } from '../audit/audit.service.js';
import { getConfig } from '../config/config.js';
import { computeAuditHash, GENESIS_HASH } from '../domain/audit-hash.js';

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
  const audit = app.get(AuditService);
  const first = await audit.verify();
  if (first.ok) {
    console.log('✗ Chain still verifies — tampering NOT detected');
    process.exitCode = 1;
  } else {
    console.log(`✔ Edit detected after checking ${first.checked} events:`);
    for (const b of first.breaks.slice(0, 2)) console.log('   ', JSON.stringify(b));
  }

  // 4. A smarter attacker recomputes every hash from the edited event onwards.
  const db2 = new pg.Client({ connectionString: config.DATABASE_URL });
  await db2.connect();
  const events = await db2.query<{
    seq: string;
    occurredAt: Date;
    actorId: string | null;
    actorRole: string | null;
    action: string;
    entityType: string;
    entityId: string | null;
    ip: string | null;
    data: unknown;
  }>(`SELECT seq, "occurredAt", "actorId", "actorRole", action, "entityType", "entityId", ip, data
      FROM audit_events ORDER BY seq`);
  await db2.query('BEGIN');
  await db2.query('ALTER TABLE audit_events DISABLE TRIGGER USER');
  let prev = GENESIS_HASH;
  for (const e of events.rows) {
    const hash = computeAuditHash(prev, { ...e, seq: BigInt(e.seq) });
    if (BigInt(e.seq) >= BigInt(target.seq))
      await db2.query('UPDATE audit_events SET "prevHash" = $1, hash = $2 WHERE seq = $3', [
        prev,
        hash,
        e.seq,
      ]);
    prev = hash;
  }
  await db2.query('ALTER TABLE audit_events ENABLE TRIGGER USER');
  await db2.query('COMMIT');
  await db2.end();
  console.log(
    `… every hash from #${target.seq} onwards recomputed: the chain is internally consistent again`,
  );

  const second = await audit.verify();
  const anchorBreaks = second.breaks.filter((b) => b.kind.startsWith('ANCHOR'));
  if (anchorBreaks.length > 0) {
    console.log(
      `✔ Rewrite still detected by ${anchorBreaks.length} of ${second.anchorsChecked} signed anchors:`,
    );
    for (const b of anchorBreaks.slice(0, 2)) console.log('   ', JSON.stringify(b));
  } else {
    console.log(
      second.anchorsChecked === 0
        ? '✗ No anchors yet — run the lifecycle job (it signs the chain head) and try again'
        : '✗ Rewrite NOT detected',
    );
    process.exitCode = 1;
  }
  console.log('Run `pnpm demo:reset` to restore a clean chain.');
} finally {
  await app.close();
}
