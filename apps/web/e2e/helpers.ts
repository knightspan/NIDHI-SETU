import { createHash, createHmac } from 'node:crypto';
import { expect, type Page } from '@playwright/test';

export const PASSWORD = 'NidhiSetu@2026';
export const USERS = {
  institution: 'institution@demo.nidhisetu.local',
  institution2: 'institution2@demo.nidhisetu.local',
  roNorth: 'ro.north@demo.nidhisetu.local',
  bureau: 'bureau@demo.nidhisetu.local',
  authority: 'authority@demo.nidhisetu.local',
  finance: 'finance@demo.nidhisetu.local',
  bankSbi: 'bank.sbi@demo.nidhisetu.local',
  auditor: 'auditor@demo.nidhisetu.local',
  admin: 'admin@demo.nidhisetu.local',
} as const;

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Same derivation as the API's demo seed (apps/api/src/scripts/demo-users.ts). */
function demoSecret(email: string): string {
  const bytes = createHash('sha256').update(`nidhisetu-demo:${email}`).digest();
  let out = '';
  for (let i = 0; i < 32; i++) out += BASE32[bytes[i]! % 32];
  return out;
}

function base32Decode(s: string): Buffer {
  let bits = '';
  for (const c of s) bits += BASE32.indexOf(c).toString(2).padStart(5, '0');
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

/** RFC 6238 TOTP (SHA-1, 30 s, 6 digits), as used by the authenticator apps. */
export function totp(email: string, at = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const h = createHmac('sha1', base32Decode(demoSecret(email)))
    .update(counter)
    .digest();
  const o = h[h.length - 1]! & 0xf;
  const code = (h.readUInt32BE(o) & 0x7fffffff) % 1_000_000;
  return String(code).padStart(6, '0');
}

export async function login(page: Page, email: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  const code = page.getByLabel('Authentication code');
  const dashboard = page.waitForURL(/\/dashboard/);
  const mfa = code.waitFor().then(() => 'mfa' as const);
  if ((await Promise.race([dashboard.then(() => 'in' as const), mfa])) === 'mfa') {
    await code.fill(totp(email));
    await page.getByRole('button', { name: 'Verify' }).click();
    await page.waitForURL(/\/dashboard/);
  }
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}

export async function logout(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForURL(/\/login/);
}

/** A small, valid, unique PDF (the portal sniffs magic bytes). */
export function pdf(tag: string): { name: string; mimeType: string; buffer: Buffer } {
  return {
    name: `${tag}.pdf`,
    mimeType: 'application/pdf',
    buffer: Buffer.from(`%PDF-1.4\n% e2e ${tag} ${Date.now()} ${Math.random()}\n%%EOF\n`),
  };
}

export const unique = () =>
  `${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1000)}`;
