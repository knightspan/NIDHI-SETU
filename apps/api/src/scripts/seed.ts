/**
 * `pnpm seed` — loads fictional demo data into an empty, migrated database.
 * Everything here is made up; real bank names appear only as bank labels.
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.js';
import { hashPassword } from '../auth/auth.service.js';
import { sealString } from '../common/crypto.js';
import { getConfig } from '../config/config.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import { DEMO_PASSWORD, DEMO_USERS, demoMfaSecret, type DemoUserSpec } from './demo-users.js';
import { seedInstitutions } from './seed-institutions.js';
import { seedMaster } from './seed-master.js';
import { seedScenarios } from './seed-scenarios.js';

export async function seedAll(
  prisma: PrismaClient,
  opts: { quiet?: boolean; masterOnly?: boolean } = {},
): Promise<void> {
  const log = (m: string) => !opts.quiet && console.log(m);
  const started = Date.now();

  const { regionByCode, bankByCode } = await seedMaster(prisma);
  log(`✔ master data: ${regionByCode.size} regions, ${bankByCode.size} banks, rules v1`);

  const institutions = await seedInstitutions(prisma, regionByCode);
  log(`✔ institutions: ${institutions.length}`);

  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const key = getConfig().MFA_ENCRYPTION_KEY;
  const instByAicte = new Map(institutions.map((i) => [i.aicteId, i]));
  // Every other region, bank and institution also gets an account (not printed), so the demo
  // scenarios can act as the right officer for each record.
  const extra: DemoUserSpec[] = [];
  const covered = (role: string, scope: string) =>
    DEMO_USERS.some((u) => u.role === role && u.scope === scope);
  for (const code of regionByCode.keys())
    if (!covered('RO_OFFICER', code))
      extra.push({
        email: `ro.${code.toLowerCase()}@demo.nidhisetu.local`,
        name: `Regional Officer ${code} (fictional)`,
        role: 'RO_OFFICER',
        scope: code,
      });
  for (const code of bankByCode.keys())
    if (!covered('BANK_OFFICER', code))
      extra.push({
        email: `bank.${code.toLowerCase()}@demo.nidhisetu.local`,
        name: `Bank Desk – ${code} (fictional)`,
        role: 'BANK_OFFICER',
        scope: code,
      });
  for (const i of institutions)
    if (!covered('INSTITUTION_USER', i.aicteId))
      extra.push({
        email: `office.${i.aicteId.slice(-4)}@inst.demo.nidhisetu.local`,
        name: `Institution office ${i.aicteId.slice(-4)} (fictional)`,
        role: 'INSTITUTION_USER',
        scope: i.aicteId,
      });

  for (const u of [...DEMO_USERS, ...extra]) {
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
  log(
    `✔ users: ${DEMO_USERS.length} demo accounts + ${extra.length} more officers / institution offices`,
  );

  if (!opts.masterOnly) {
    const app = await NestFactory.createApplicationContext(AppModule, {
      logger: ['error', 'warn'],
    });
    try {
      await seedScenarios(app, opts);
    } finally {
      await app.close();
    }
  }
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
