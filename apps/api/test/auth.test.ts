import type { INestApplication } from '@nestjs/common';
import { generate } from 'otplib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { Client, TEST_PASSWORD, createFixture, createTestApp, type Fixture } from './helpers.js';

describe('authentication and MFA', () => {
  let app: INestApplication;
  let fx: Fixture;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    fx = await createFixture(app);
  });
  afterAll(async () => {
    await app.close();
  });

  it('rejects a wrong password with a generic message', async () => {
    const c = await Client.anonymous(app);
    const res = await c.post('/api/auth/login', {
      email: fx.users.AUDITOR.email,
      password: 'nope',
    });
    expect(res.status).toBe(401);
    expect((res.body as { message: string }).message).toBe('Invalid email or password');
  });

  it('logs an institution user straight in (MFA optional)', async () => {
    const c = await Client.anonymous(app);
    const res = await c.post('/api/auth/login', {
      email: fx.users.INSTITUTION_USER.email,
      password: TEST_PASSWORD,
    });
    expect(res.body).toEqual({ status: 'OK' });
    const me = await c.get('/api/auth/me').expect(200);
    expect(me.body).toMatchObject({ role: 'INSTITUTION_USER', institutionId: fx.institutionId });
  });

  it('requires a TOTP code for officers', async () => {
    const c = await Client.anonymous(app);
    const user = fx.users.RO_OFFICER;
    const res = await c.post('/api/auth/login', { email: user.email, password: TEST_PASSWORD });
    expect(res.body).toEqual({ status: 'MFA_REQUIRED' });
    // Not signed in yet.
    await c.get('/api/auth/me').expect(401);
    await c.post('/api/auth/mfa/verify', { code: '000000' }).expect(401);
    const code = await generate({ secret: user.mfaSecret! });
    await c.post('/api/auth/mfa/verify', { code }).expect(200);
    const me = await c.get('/api/auth/me').expect(200);
    expect(me.body).toMatchObject({ role: 'RO_OFFICER', regionId: fx.regionId, mfaEnabled: true });
  });

  it('forces MFA enrolment for an officer without an authenticator', async () => {
    const user = fx.users.FINANCE_OFFICER;
    await prisma.user.update({
      where: { id: user.id },
      data: { mfaEnabled: false, mfaSecretEnc: null },
    });
    const c = await Client.anonymous(app);
    const res = await c.post('/api/auth/login', { email: user.email, password: TEST_PASSWORD });
    const body = res.body as { status: string; secret: string; qrDataUrl: string };
    expect(body.status).toBe('MFA_SETUP_REQUIRED');
    expect(body.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    await c
      .post('/api/auth/mfa/verify', { code: await generate({ secret: body.secret }) })
      .expect(200);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.mfaEnabled).toBe(true);
  });

  it('locks the account after 5 failed attempts', async () => {
    const user = fx.others.bureauOfficer;
    const c = await Client.anonymous(app);
    for (let i = 0; i < 5; i++) {
      await c.post('/api/auth/login', { email: user.email, password: 'wrong' }).expect(401);
    }
    // Even the right password is refused while locked.
    await c.post('/api/auth/login', { email: user.email, password: TEST_PASSWORD }).expect(401);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
    await prisma.user.update({ where: { id: user.id }, data: { lockedUntil: null } });
  });

  it('refuses state-changing requests without the CSRF header', async () => {
    const c = await Client.login(app, fx.users.SYS_ADMIN);
    const res = await c.agent.post('/api/admin/users').send({});
    expect(res.status).toBe(403);
    expect((res.body as { message: string }).message).toMatch(/CSRF/);
  });

  it('rotates refresh tokens and revokes them on logout', async () => {
    const c = await Client.login(app, fx.users.INSTITUTION_USER);
    await c.post('/api/auth/refresh').expect(200);
    await c.get('/api/auth/me').expect(200);
    await c.post('/api/auth/logout').expect(200);
    await c.get('/api/auth/me').expect(401);
    await c.post('/api/auth/refresh').expect(401);
  });

  it('rejects requests from deactivated users immediately', async () => {
    const user = fx.others.competentAuthority;
    const c = await Client.login(app, user);
    await c.get('/api/auth/me').expect(200);
    await prisma.user.update({ where: { id: user.id }, data: { active: false } });
    await c.get('/api/auth/me').expect(401);
  });

  it('lets a user change their own password; wrong or weak passwords are refused', async () => {
    const user = fx.users.INSTITUTION_USER;
    const c = await Client.login(app, user);
    await c
      .post('/api/auth/password', { currentPassword: 'nope', newPassword: 'Another-Pass-2026' })
      .expect(400);
    await c
      .post('/api/auth/password', { currentPassword: TEST_PASSWORD, newPassword: 'short1' })
      .expect(400);
    await c
      .post('/api/auth/password', {
        currentPassword: TEST_PASSWORD,
        newPassword: 'Another-Pass-2026',
      })
      .expect(200);
    await c.get('/api/auth/me').expect(200); // the new session keeps this browser signed in
    const anon = await Client.anonymous(app);
    await anon.post('/api/auth/login', { email: user.email, password: TEST_PASSWORD }).expect(401);
    // Restore for other tests.
    await c
      .post('/api/auth/password', {
        currentPassword: 'Another-Pass-2026',
        newPassword: TEST_PASSWORD,
      })
      .expect(200);
  });

  it('admin reset issues a temporary password that must be replaced before anything else', async () => {
    const admin = await Client.login(app, fx.users.SYS_ADMIN);
    const target = fx.others.institutionUser;
    const { temporaryPassword } = (
      await admin.post(`/api/admin/users/${target.id}/reset-password`).expect(200)
    ).body as { temporaryPassword: string };
    expect(temporaryPassword.length).toBeGreaterThanOrEqual(12);
    const audit = await prisma.auditEvent.findFirst({
      where: { action: 'user.password_reset', entityId: target.id },
    });
    expect(JSON.stringify(audit?.data ?? {})).not.toContain(temporaryPassword);

    const c = await Client.anonymous(app);
    await c
      .post('/api/auth/login', { email: target.email, password: temporaryPassword })
      .expect(200);
    const me = (await c.get('/api/auth/me').expect(200)).body as { mustChangePassword: boolean };
    expect(me.mustChangePassword).toBe(true);
    const blocked = await c.get('/api/instruments');
    expect(blocked.status).toBe(403);
    expect((blocked.body as { error: string }).error).toBe('PasswordChangeRequired');

    await c
      .post('/api/auth/password', {
        currentPassword: temporaryPassword,
        newPassword: TEST_PASSWORD,
      })
      .expect(200);
    await c.get('/api/instruments').expect(200);
    await admin.post(`/api/admin/users/${fx.users.SYS_ADMIN.id}/reset-password`).expect(400);
  });
});
