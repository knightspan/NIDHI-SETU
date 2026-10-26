import { ASSUMPTION_SOURCE, DEFAULT_RULES, RULE_CODES, RULE_DEFINITIONS } from '@nidhisetu/shared';
import type { PrismaClient } from '../generated/prisma/client.js';

/** Regions: configurable list, seeded with a few (fictional grouping). */
export const SEED_REGIONS = [
  { code: 'NR', name: 'Northern Region' },
  { code: 'WR', name: 'Western Region' },
  { code: 'SR', name: 'Southern Region' },
  { code: 'ER', name: 'Eastern Region' },
  { code: 'CR', name: 'Central Region' },
];

/** Real bank names are used only as labels (Rule 3); IFSC prefixes are the public bank codes. */
export const SEED_BANKS = [
  { code: 'SBIN', name: 'State Bank of India', apiEnabled: false },
  { code: 'PUNB', name: 'Punjab National Bank', apiEnabled: false },
  { code: 'BARB', name: 'Bank of Baroda', apiEnabled: false },
  { code: 'CNRB', name: 'Canara Bank', apiEnabled: false },
  { code: 'UBIN', name: 'Union Bank of India', apiEnabled: false },
  { code: 'HDFC', name: 'HDFC Bank', apiEnabled: true },
  { code: 'ICIC', name: 'ICICI Bank', apiEnabled: true },
  { code: 'UTIB', name: 'Axis Bank', apiEnabled: false },
];

export async function seedMaster(prisma: PrismaClient) {
  for (const r of SEED_REGIONS) {
    await prisma.region.upsert({ where: { code: r.code }, create: r, update: { name: r.name } });
  }
  for (const b of SEED_BANKS) {
    await prisma.bank.upsert({
      where: { code: b.code },
      create: b,
      update: { name: b.name, apiEnabled: b.apiEnabled },
    });
  }
  for (const code of RULE_CODES) {
    const existing = await prisma.rule.findFirst({ where: { code } });
    if (existing) continue;
    await prisma.rule.create({
      data: {
        code,
        type: RULE_DEFINITIONS[code].type,
        version: 1,
        config: DEFAULT_RULES[code],
        effectiveFrom: new Date('2020-01-01T00:00:00+05:30'),
        source: ASSUMPTION_SOURCE,
        note: 'Seeded placeholder. Replace with values from the AICTE Approval Process Handbook.',
      },
    });
  }
  const regions = await prisma.region.findMany();
  const banks = await prisma.bank.findMany();
  return {
    regionByCode: new Map(regions.map((r) => [r.code, r])),
    bankByCode: new Map(banks.map((b) => [b.code, b])),
  };
}
