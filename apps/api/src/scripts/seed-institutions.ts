import type { ProgrammeCode } from '@nidhisetu/shared';
import type { PrismaClient, Region } from '../generated/prisma/client.js';

/** Deterministic PRNG so every seed produces the same fictional data. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick<T>(rnd: () => number, list: readonly T[]): T {
  return list[Math.floor(rnd() * list.length)]!;
}

const FIRST = [
  'Vindhya',
  'Sahyadri',
  'Narmada',
  'Godavari',
  'Kaveri',
  'Aravali',
  'Shivalik',
  'Nilgiri',
  'Satpura',
  'Konkan',
  'Malwa',
  'Deccan',
  'Kalinga',
  'Magadh',
  'Tapti',
  'Mahanadi',
  'Chambal',
  'Brahmaputra',
  'Sabarmati',
  'Krishna',
];
const SECOND = [
  'Valley',
  'Heights',
  'Vidyapeeth',
  'Gurukul',
  'Nagar',
  'Sagar',
  'Prastha',
  'Kshetra',
];
const KINDS: { suffix: string; programmes: ProgrammeCode[] }[] = [
  { suffix: 'Institute of Technology', programmes: ['UG_ENGINEERING', 'PG_ENGINEERING'] },
  { suffix: 'College of Engineering', programmes: ['UG_ENGINEERING'] },
  { suffix: 'Polytechnic', programmes: ['DIPLOMA'] },
  { suffix: 'School of Management', programmes: ['MBA'] },
  { suffix: 'Institute of Computer Applications', programmes: ['MCA'] },
  { suffix: 'College of Pharmacy', programmes: ['PHARMACY', 'DIPLOMA'] },
  { suffix: 'School of Architecture', programmes: ['ARCHITECTURE'] },
  { suffix: 'Institute of Hotel Management', programmes: ['HOTEL_MANAGEMENT'] },
  { suffix: 'Technical Campus', programmes: ['UG_ENGINEERING', 'MBA', 'MCA'] },
];
const STATES: Record<string, string[]> = {
  NR: ['Uttar Pradesh', 'Punjab', 'Haryana', 'Delhi', 'Uttarakhand'],
  WR: ['Maharashtra', 'Gujarat', 'Goa'],
  SR: ['Karnataka', 'Tamil Nadu', 'Kerala', 'Telangana', 'Andhra Pradesh'],
  ER: ['West Bengal', 'Odisha', 'Bihar', 'Assam'],
  CR: ['Madhya Pradesh', 'Chhattisgarh', 'Rajasthan'],
};
const TRUSTS = [
  'Shiksha Prasar',
  'Vidya Vikas',
  'Gyan Jyoti',
  'Saraswati Seva',
  'Navnirman',
  'Pragati Shiksha',
];

export interface SeededInstitution {
  id: string;
  aicteId: string;
  regionCode: string;
  yearEstablished: number;
  programmes: ProgrammeCode[];
}

/** 60 fictional institutions spread over the regions, with varied ages and programmes. */
export async function seedInstitutions(
  prisma: PrismaClient,
  regionByCode: Map<string, Region>,
  count = 60,
): Promise<SeededInstitution[]> {
  const rnd = mulberry32(26265);
  const regionCodes = [...regionByCode.keys()];
  const out: SeededInstitution[] = [];
  const usedNames = new Set<string>();
  for (let i = 1; i <= count; i++) {
    // The first two are the demo institutions (both Northern Region, both young → deposit required).
    const regionCode = i <= 2 ? 'NR' : regionCodes[(i - 1) % regionCodes.length]!;
    const kind = i === 1 ? KINDS[0]! : i === 2 ? KINDS[8]! : pick(rnd, KINDS);
    let name: string;
    do {
      name = `${pick(rnd, FIRST)} ${pick(rnd, SECOND)} ${kind.suffix}`;
    } while (usedNames.has(name));
    usedNames.add(name);
    // ~60 % younger than 10 years (deposit required), the rest older (exempt under the placeholder rule).
    const yearEstablished =
      i <= 2 ? 2021 : rnd() < 0.6 ? 2017 + Math.floor(rnd() * 9) : 1985 + Math.floor(rnd() * 30);
    const state = pick(rnd, STATES[regionCode] ?? ['Delhi']);
    const aicteId = `AICTE-DEMO-${String(i).padStart(4, '0')}`;
    const inst = await prisma.institution.upsert({
      where: { aicteId },
      update: {},
      create: {
        aicteId,
        name,
        trustName: `${pick(rnd, TRUSTS)} Trust (fictional)`,
        regionId: regionByCode.get(regionCode)!.id,
        state,
        district: null,
        yearEstablished,
        programmes: kind.programmes,
        contactEmail: `office${i}@inst.demo.nidhisetu.local`,
        contactPhone: `+91-00000-${String(10000 + i).slice(-5)}`,
      },
    });
    out.push({ id: inst.id, aicteId, regionCode, yearEstablished, programmes: kind.programmes });
  }
  return out;
}
