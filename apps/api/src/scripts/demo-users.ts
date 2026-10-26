import { createHash } from 'node:crypto';
import type { Role } from '@nidhisetu/shared';

/** Shared password for every demo account (fictional, demo only). */
export const DEMO_PASSWORD = 'NidhiSetu@2026';

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Deterministic TOTP secret per demo account, so README credentials stay valid after a reset. */
export function demoMfaSecret(email: string): string {
  const bytes = createHash('sha256').update(`nidhisetu-demo:${email}`).digest();
  let out = '';
  for (let i = 0; i < 32; i++) out += BASE32[bytes[i]! % 32];
  return out;
}

export interface DemoUserSpec {
  email: string;
  name: string;
  role: Role;
  /** Region code, bank code or institution AICTE id, depending on role. */
  scope?: string;
}

/** One demo user per role (plus a second RO and bank officer to show scoping). Names are fictional. */
export const DEMO_USERS: DemoUserSpec[] = [
  {
    email: 'institution@demo.nidhisetu.local',
    name: 'Meera Kulkarni (fictional)',
    role: 'INSTITUTION_USER',
    scope: 'AICTE-DEMO-0001',
  },
  {
    email: 'institution2@demo.nidhisetu.local',
    name: 'Arjun Rao (fictional)',
    role: 'INSTITUTION_USER',
    scope: 'AICTE-DEMO-0002',
  },
  {
    email: 'ro.north@demo.nidhisetu.local',
    name: 'Ravi Sharma (fictional)',
    role: 'RO_OFFICER',
    scope: 'NR',
  },
  {
    email: 'ro.west@demo.nidhisetu.local',
    name: 'Priya Desai (fictional)',
    role: 'RO_OFFICER',
    scope: 'WR',
  },
  { email: 'bureau@demo.nidhisetu.local', name: 'Anil Verma (fictional)', role: 'BUREAU_OFFICER' },
  {
    email: 'authority@demo.nidhisetu.local',
    name: 'Dr. Kavita Iyer (fictional)',
    role: 'COMPETENT_AUTHORITY',
  },
  {
    email: 'finance@demo.nidhisetu.local',
    name: 'Suresh Menon (fictional)',
    role: 'FINANCE_OFFICER',
  },
  {
    email: 'bank.sbi@demo.nidhisetu.local',
    name: 'Bank Desk – SBI (fictional)',
    role: 'BANK_OFFICER',
    scope: 'SBIN',
  },
  {
    email: 'bank.hdfc@demo.nidhisetu.local',
    name: 'Bank Desk – HDFC (fictional)',
    role: 'BANK_OFFICER',
    scope: 'HDFC',
  },
  { email: 'auditor@demo.nidhisetu.local', name: 'Neha Gupta (fictional)', role: 'AUDITOR' },
  { email: 'admin@demo.nidhisetu.local', name: 'System Admin (fictional)', role: 'SYS_ADMIN' },
];
