import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Role } from '@nidhisetu/shared';
import { generate, generateSecret } from 'otplib';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { hashPassword } from '../src/auth/auth.service.js';
import { sealString } from '../src/common/crypto.js';
import { getConfig } from '../src/config/config.js';
import { OcrClient } from '../src/ocr/ocr.client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { FakeOcrClient } from './fake-ocr.js';

export const TEST_PASSWORD = 'Test-Password-2026';

export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(OcrClient)
    .useValue(new FakeOcrClient())
    .compile();
  const app = moduleRef.createNestApplication({ logger: ['error'] });
  configureApp(app);
  await app.init();
  return app;
}

export interface Fixture {
  tag: string;
  regionId: string;
  otherRegionId: string;
  bankId: string;
  otherBankId: string;
  institutionId: string;
  otherInstitutionId: string;
  /** One user per role; INSTITUTION_USER belongs to `institutionId`, RO_OFFICER to `regionId`. */
  users: Record<Role, TestUser>;
  /** Users scoped to the "other" region / institution / bank, for scoping tests. */
  others: {
    institutionUser: TestUser;
    roOfficer: TestUser;
    bankOfficer: TestUser;
    bureauOfficer: TestUser;
    competentAuthority: TestUser;
  };
}

export interface TestUser {
  id: string;
  email: string;
  role: Role;
  mfaSecret: string | null;
}

/** Creates an isolated set of regions, banks, institutions and users (unique per call). */
export async function createFixture(app: INestApplication): Promise<Fixture> {
  const prisma = app.get(PrismaService);
  const tag = randomUUID().slice(0, 8);
  const passwordHash = await hashPassword(TEST_PASSWORD);
  const key = getConfig().MFA_ENCRYPTION_KEY;

  const region = await prisma.region.create({
    data: { code: `R${tag.slice(0, 3).toUpperCase()}`, name: `Region ${tag}` },
  });
  const otherRegion = await prisma.region.create({
    data: { code: `O${tag.slice(0, 3).toUpperCase()}`, name: `Other region ${tag}` },
  });
  const bankCode = randomBankCode();
  const bank = await prisma.bank.create({ data: { code: bankCode, name: `Test Bank ${tag}` } });
  const otherBank = await prisma.bank.create({
    data: { code: randomBankCode(), name: `Other Bank ${tag}`, apiEnabled: true },
  });
  const mkInstitution = (regionId: string, n: string) =>
    prisma.institution.create({
      data: {
        aicteId: `T-${tag}-${n}`,
        name: `Test Institute ${n} ${tag}`,
        trustName: `Test Trust ${n}`,
        regionId,
        state: 'Test State',
        yearEstablished: 2024,
        programmes: ['UG_ENGINEERING'],
        contactEmail: `inst${n}-${tag}@example.test`,
        contactPhone: '0000000000',
      },
    });
  const institution = await mkInstitution(region.id, 'A');
  const otherInstitution = await mkInstitution(otherRegion.id, 'B');

  const mkUser = async (
    role: Role,
    scope: { regionId?: string; institutionId?: string; bankId?: string },
    suffix = '',
  ) => {
    const mfa = role === 'INSTITUTION_USER' ? null : generateSecret();
    const email = `${role.toLowerCase()}${suffix}-${tag}@example.test`;
    const u = await prisma.user.create({
      data: {
        email,
        name: `${role} ${suffix}${tag}`,
        role,
        passwordHash,
        mfaEnabled: mfa !== null,
        mfaSecretEnc: mfa ? sealString(mfa, key) : null,
        regionId: scope.regionId ?? null,
        institutionId: scope.institutionId ?? null,
        bankId: scope.bankId ?? null,
      },
    });
    return { id: u.id, email, role, mfaSecret: mfa };
  };

  const users = {
    INSTITUTION_USER: await mkUser('INSTITUTION_USER', { institutionId: institution.id }),
    RO_OFFICER: await mkUser('RO_OFFICER', { regionId: region.id }),
    BUREAU_OFFICER: await mkUser('BUREAU_OFFICER', {}),
    COMPETENT_AUTHORITY: await mkUser('COMPETENT_AUTHORITY', {}),
    FINANCE_OFFICER: await mkUser('FINANCE_OFFICER', {}),
    BANK_OFFICER: await mkUser('BANK_OFFICER', { bankId: bank.id }),
    AUDITOR: await mkUser('AUDITOR', {}),
    SYS_ADMIN: await mkUser('SYS_ADMIN', {}),
  } satisfies Record<Role, TestUser>;

  const others = {
    institutionUser: await mkUser(
      'INSTITUTION_USER',
      { institutionId: otherInstitution.id },
      '-other',
    ),
    roOfficer: await mkUser('RO_OFFICER', { regionId: otherRegion.id }, '-other'),
    bankOfficer: await mkUser('BANK_OFFICER', { bankId: otherBank.id }, '-other'),
    bureauOfficer: await mkUser('BUREAU_OFFICER', {}, '-2'),
    competentAuthority: await mkUser('COMPETENT_AUTHORITY', {}, '-2'),
  };

  return {
    tag,
    regionId: region.id,
    otherRegionId: otherRegion.id,
    bankId: bank.id,
    otherBankId: otherBank.id,
    institutionId: institution.id,
    otherInstitutionId: otherInstitution.id,
    users,
    others,
  };
}

let bankCounter = 0;
function randomBankCode(): string {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let s = 'T';
  let n = Date.now() + bankCounter++ * 7919 + Math.floor(Math.random() * 1e6);
  for (let i = 0; i < 3; i++) {
    s += letters[n % 26];
    n = Math.floor(n / 26);
  }
  return s;
}

/** A logged-in HTTP client that carries cookies and the CSRF header. */
export class Client {
  private csrf = '';
  constructor(
    readonly agent: ReturnType<typeof request.agent>,
    readonly user?: TestUser,
  ) {}

  static async anonymous(app: INestApplication): Promise<Client> {
    const c = new Client(request.agent(app.getHttpServer() as Server));
    await c.primeCsrf();
    return c;
  }

  static async login(app: INestApplication, user: TestUser): Promise<Client> {
    const c = new Client(request.agent(app.getHttpServer() as Server), user);
    await c.primeCsrf();
    const res = await c.agent
      .post('/api/auth/login')
      .send({ email: user.email, password: TEST_PASSWORD });
    if (res.status !== 200)
      throw new Error(`login failed for ${user.email}: ${res.status} ${JSON.stringify(res.body)}`);
    const body = res.body as { status: string };
    if (body.status === 'MFA_REQUIRED') {
      const code = await generate({ secret: user.mfaSecret! });
      const v = await c.agent.post('/api/auth/mfa/verify').send({ code });
      if (v.status !== 200) throw new Error(`MFA failed for ${user.email}: ${v.status}`);
    }
    return c;
  }

  private async primeCsrf(): Promise<void> {
    const res = await this.agent.get('/api/health');
    const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
    const cookie = raw?.find((c) => c.startsWith('ns_csrf='));
    if (cookie) this.csrf = cookie.split(';')[0]!.split('=')[1]!;
  }

  get(url: string) {
    return this.agent.get(url);
  }
  post(url: string, body?: object) {
    return this.agent
      .post(url)
      .set('x-csrf-token', this.csrf)
      .send(body ?? {});
  }
  patch(url: string, body?: object) {
    return this.agent
      .patch(url)
      .set('x-csrf-token', this.csrf)
      .send(body ?? {});
  }
  put(url: string, body?: object) {
    return this.agent
      .put(url)
      .set('x-csrf-token', this.csrf)
      .send(body ?? {});
  }
  delete(url: string) {
    return this.agent.delete(url).set('x-csrf-token', this.csrf);
  }
  /** Multipart upload. */
  upload(
    url: string,
    field: string,
    file: Buffer,
    filename: string,
    fields: Record<string, string> = {},
  ) {
    let r = this.agent.post(url).set('x-csrf-token', this.csrf).attach(field, file, filename);
    for (const [k, v] of Object.entries(fields)) r = r.field(k, v);
    return r;
  }
  /** Multipart upload of several files under one field. */
  uploadMany(
    url: string,
    field: string,
    files: { file: Buffer; name: string }[],
    fields: Record<string, string> = {},
  ) {
    let r = this.agent.post(url).set('x-csrf-token', this.csrf);
    for (const [k, v] of Object.entries(fields)) r = r.field(k, v);
    for (const f of files) r = r.attach(field, f.file, f.name);
    return r;
  }
}
