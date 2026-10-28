/**
 * `pnpm --filter @nidhisetu/api ifsc:import <file.csv>` — loads an IFSC master into IfscBranch.
 *
 * Expects a CSV with a header row containing at least IFSC, BRANCH and (optionally) CITY, STATE,
 * as in the RBI bank-wise IFSC lists or the open IFSC datasets derived from them. Rows are upserted,
 * so the import can be re-run when the master is refreshed.
 */
import { readFileSync } from 'node:fs';
import { IFSC_REGEX } from '@nidhisetu/shared';
import { scriptPrisma } from './db.js';

/** Minimal RFC 4180 CSV parser (quoted fields, escaped quotes). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f !== '')) rows.push(row);
  return rows;
}

const file = process.argv[2];
if (!file) {
  console.error('Usage: ifsc:import <file.csv>');
  process.exit(2);
}
const [header, ...rows] = parseCsv(readFileSync(file, 'utf8'));
const col = (name: string) => header!.findIndex((h) => h.trim().toUpperCase() === name);
const [iIfsc, iBranch, iCity, iState] = ['IFSC', 'BRANCH', 'CITY', 'STATE'].map(col);
if (iIfsc! < 0 || iBranch! < 0) {
  console.error('The CSV needs IFSC and BRANCH columns');
  process.exit(2);
}
const prisma = scriptPrisma();
let loaded = 0;
let skipped = 0;
try {
  for (let i = 0; i < rows.length; i += 1000) {
    const batch = rows
      .slice(i, i + 1000)
      .map((r) => ({
        ifsc: (r[iIfsc!] ?? '').trim().toUpperCase(),
        branch: (r[iBranch!] ?? '').trim(),
        city: iCity! >= 0 ? (r[iCity!] ?? '').trim() || null : null,
        state: iState! >= 0 ? (r[iState!] ?? '').trim() || null : null,
      }))
      .filter((r) => {
        const ok = IFSC_REGEX.test(r.ifsc) && r.branch;
        if (!ok) skipped++;
        return ok;
      });
    await prisma.$transaction(
      batch.map((r) =>
        prisma.ifscBranch.upsert({
          where: { ifsc: r.ifsc },
          create: { ...r, bankCode: r.ifsc.slice(0, 4) },
          update: { branch: r.branch, city: r.city, state: r.state },
        }),
      ),
    );
    loaded += batch.length;
  }
  console.log(`IFSC master: ${loaded} rows loaded, ${skipped} skipped`);
} finally {
  await prisma.$disconnect();
}
