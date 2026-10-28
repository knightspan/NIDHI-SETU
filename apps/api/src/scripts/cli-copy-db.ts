/**
 * `pnpm --filter @nidhisetu/api db:copy <source-url> <target-url>` — copies every row from one
 * NidhiSetu database to another with the same schema (e.g. a locally seeded demo → hosted Postgres).
 *
 * The target must already be migrated (`prisma migrate deploy`); its rows are replaced. Tables are copied parent
 * first (foreign keys), in batches, via json_populate_recordset so every column type (enums, arrays,
 * JSON, bytea) round-trips. The audit chain is copied as-is, so it still verifies on the target.
 */
import pg from 'pg';

const [source, target] = process.argv.slice(2);
if (!source || !target) {
  console.error('Usage: db:copy <source-database-url> <target-database-url>');
  process.exit(2);
}

const BATCH = 500;
const q = (t: string) => `"${t.replace(/"/g, '""')}"`;

const src = new pg.Client({ connectionString: source });
const dst = new pg.Client({
  connectionString: target,
  ssl: target.includes('sslmode=') ? undefined : { rejectUnauthorized: false },
});
await src.connect();
await dst.connect();

try {
  const tables = (
    await src.query<{ t: string }>(
      "SELECT tablename AS t FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'",
    )
  ).rows.map((r) => r.t);
  const deps = (
    await src.query<{ child: string; parent: string }>(`
      SELECT c.relname AS child, p.relname AS parent
      FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid JOIN pg_class p ON p.oid = k.confrelid
      WHERE k.contype = 'f' AND c.relnamespace = 'public'::regnamespace`)
  ).rows;

  // Parents before children.
  const ordered: string[] = [];
  const pending = new Set(tables);
  while (pending.size) {
    const ready = [...pending].filter((t) =>
      deps.every((d) => d.child !== t || d.parent === t || !pending.has(d.parent)),
    );
    if (!ready.length) throw new Error(`Circular foreign keys among: ${[...pending].join(', ')}`);
    for (const t of ready.sort()) {
      ordered.push(t);
      pending.delete(t);
    }
  }

  // The target becomes an exact copy: empty it first (migrations seed some rows, e.g. rules).
  // The audit tables' append-only triggers are switched off for this one statement only.
  await dst.query('BEGIN');
  await dst.query('ALTER TABLE audit_events DISABLE TRIGGER USER');
  await dst.query('ALTER TABLE audit_anchors DISABLE TRIGGER USER');
  await dst.query(`TRUNCATE ${ordered.map(q).join(', ')} RESTART IDENTITY CASCADE`);
  await dst.query('ALTER TABLE audit_events ENABLE TRIGGER USER');
  await dst.query('ALTER TABLE audit_anchors ENABLE TRIGGER USER');
  await dst.query('COMMIT');

  let total = 0;
  for (const t of ordered) {
    const count = Number(
      (await src.query<{ n: string }>(`SELECT count(*) AS n FROM ${q(t)}`)).rows[0]!.n,
    );
    for (let offset = 0; offset < count; offset += BATCH) {
      const rows = await src.query<{ j: unknown }>(
        `SELECT coalesce(json_agg(x), '[]'::json) AS j FROM (SELECT * FROM ${q(t)} ORDER BY 1 LIMIT ${BATCH} OFFSET ${offset}) x`,
      );
      await dst.query(
        `INSERT INTO ${q(t)} SELECT * FROM json_populate_recordset(null::${q(t)}, $1::json)`,
        [JSON.stringify(rows.rows[0]!.j)],
      );
    }
    total += count;
    console.log(`${t.padEnd(28)} ${count}`);
  }

  // Serial columns continue after the copied ids.
  const seqs = await dst.query<{ t: string; c: string; s: string }>(`
    SELECT table_name AS t, column_name AS c, pg_get_serial_sequence(quote_ident(table_name), column_name) AS s
    FROM information_schema.columns
    WHERE table_schema = 'public' AND (column_default LIKE 'nextval%' OR is_identity = 'YES')`);
  for (const s of seqs.rows) {
    await dst.query(
      `SELECT setval($1, coalesce((SELECT max(${q(s.c)}) FROM ${q(s.t)}), 0) + 1, false)`,
      [s.s],
    );
  }
  console.log(`Copied ${total} rows across ${ordered.length} tables.`);
} finally {
  await src.end();
  await dst.end();
}
