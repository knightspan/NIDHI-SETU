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
export const SEED_BANKS: {
  code: string;
  name: string;
  apiEnabled: boolean;
  aliases: string[];
  compounding?: 'MONTHLY' | 'QUARTERLY' | 'HALF_YEARLY' | 'YEARLY';
}[] = [
  { code: 'SBIN', name: 'State Bank of India', apiEnabled: false, aliases: ['SBI'] },
  { code: 'PUNB', name: 'Punjab National Bank', apiEnabled: false, aliases: ['PNB'] },
  { code: 'BARB', name: 'Bank of Baroda', apiEnabled: false, aliases: ['BOB'] },
  // Configurable per bank (TRINETRA maturity math); the others use the rule default (quarterly).
  { code: 'CNRB', name: 'Canara Bank', apiEnabled: false, aliases: [], compounding: 'HALF_YEARLY' },
  { code: 'UBIN', name: 'Union Bank of India', apiEnabled: false, aliases: ['UBI'] },
  { code: 'HDFC', name: 'HDFC Bank', apiEnabled: true, aliases: ['HDFC BANK LIMITED'] },
  { code: 'ICIC', name: 'ICICI Bank', apiEnabled: true, aliases: ['ICICI BANK LIMITED'] },
  { code: 'UTIB', name: 'Axis Bank', apiEnabled: false, aliases: ['AXIS BANK LIMITED'] },
];

const IFSC_BRANCHES = [
  { branch: 'Civil Lines', city: 'Prayagraj' },
  { branch: 'MG Road', city: 'Pune' },
  { branch: 'Station Road', city: 'Jaipur' },
  { branch: 'Main Branch', city: 'Bhopal' },
  { branch: 'Industrial Area', city: 'Ludhiana' },
  { branch: 'University Campus', city: 'Hyderabad' },
  { branch: 'Cantonment', city: 'Bengaluru' },
  { branch: 'Market Yard', city: 'Nagpur' },
];

/**
 * A small FICTIONAL IFSC master (branch codes are made up). Load the real RBI list with
 * `pnpm --filter @nidhisetu/api ifsc:import <file.csv>` (docs/INTEGRATION.md).
 */
export const SEED_IFSC = SEED_BANKS.flatMap((b, bi) =>
  IFSC_BRANCHES.map((br, i) => ({
    ifsc: `${b.code}0${String(710000 + bi * 1000 + i * 37).slice(0, 6)}`,
    bankCode: b.code,
    branch: br.branch,
    city: br.city,
    state: null as string | null,
  })),
);

export async function seedMaster(prisma: PrismaClient) {
  for (const r of SEED_REGIONS) {
    await prisma.region.upsert({ where: { code: r.code }, create: r, update: { name: r.name } });
  }
  for (const b of SEED_BANKS) {
    const data = {
      name: b.name,
      apiEnabled: b.apiEnabled,
      aliases: b.aliases,
      compounding: b.compounding ?? null,
    };
    await prisma.bank.upsert({
      where: { code: b.code },
      create: { code: b.code, ...data },
      update: data,
    });
  }
  await prisma.ifscBranch.createMany({ data: SEED_IFSC, skipDuplicates: true });
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
