/**
 * `pnpm seed` — loads fictional demo data into an empty, migrated database.
 * Everything here is made up; real bank names appear only as bank labels.
 */
import { hashPassword } from '../auth/auth.service.js';
import { sealString } from '../common/crypto.js';
import { getConfig } from '../config/config.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import { DEMO_PASSWORD, DEMO_USERS, demoMfaSecret } from './demo-users.js';
import { seedInstitutions } from './seed-institutions.js';
import { seedMaster } from './seed-master.js';

export async function seedAll(prisma: PrismaClient, opts: { quiet?: boolean } = {}): Promise<void> {
  const log = (m: string) => !opts.quiet && console.log(m);
  const started = Date.now();

  const { regionByCode, bankByCode } = await seedMaster(prisma);
  log(`✔ master data: ${regionByCode.size} regions, ${bankByCode.size} banks, rules v1`);

  const institutions = await seedInstitutions(prisma, regionByCode);
  log(`✔ institutions: ${institutions.length}`);

  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const key = getConfig().MFA_ENCRYPTION_KEY;
  const instByAicte = new Map(institutions.map((i) => [i.aicteId, i]));
  for (const u of DEMO_USERS) {
    const mfa = u.role === 'INSTITUTION_USER' ? null : demoMfaSecret(u.email);
    await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: {
        email: u.email,
        name: u.name,
        role: u.role,
        passwordHash,
        mfaEnabled: mfa !== null,
        mfaSecretEnc: mfa ? sealString(mfa, key) : null,
        regionId: u.role === 'RO_OFFICER' ? regionByCode.get(u.scope!)!.id : null,
        bankId: u.role === 'BANK_OFFICER' ? bankByCode.get(u.scope!)!.id : null,
        institutionId: u.role === 'INSTITUTION_USER' ? instByAicte.get(u.scope!)!.id : null,
      },
    });
  }
  log(`✔ demo users: ${DEMO_USERS.length}`);

  log(`Seed finished in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

export function printCredentials(): void {
  console.log('\nDemo accounts (fictional) — password for all: ' + DEMO_PASSWORD);
  console.log(
    'Officer accounts need a TOTP code: `pnpm demo:otp <email>` prints the current one.\n',
  );
  for (const u of DEMO_USERS) {
    const secret = u.role === 'INSTITUTION_USER' ? '(MFA optional)' : demoMfaSecret(u.email);
    console.log(`  ${u.role.padEnd(20)} ${u.email.padEnd(36)} ${secret}`);
  }
}
