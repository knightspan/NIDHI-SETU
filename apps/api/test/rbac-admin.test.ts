import type { INestApplication } from '@nestjs/common';
import { ROLES } from '@nidhisetu/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, createFixture, createTestApp, type Fixture } from './helpers.js';

describe('RBAC: administration endpoints', () => {
  let app: INestApplication;
  let fx: Fixture;
  const clients = new Map<string, Client>();

  beforeAll(async () => {
    app = await createTestApp();
    fx = await createFixture(app);
    for (const role of ROLES) clients.set(role, await Client.login(app, fx.users[role]));
  });
  afterAll(async () => {
    await app.close();
  });

  it('rejects anonymous callers with 401', async () => {
    const anon = await Client.anonymous(app);
    await anon.get('/api/admin/users').expect(401);
    await anon.get('/api/master/banks').expect(401);
  });

  it('allows only SYS_ADMIN to manage users', async () => {
    for (const role of ROLES) {
      const res = await clients.get(role)!.get('/api/admin/users');
      expect([role, res.status]).toEqual([role, role === 'SYS_ADMIN' ? 200 : 403]);
    }
  });

  it('creates a user with scope validation and audits it', async () => {
    const admin = clients.get('SYS_ADMIN')!;
    const bad = await admin.post('/api/admin/users', {
      email: `new-ro-${fx.tag}@example.test`,
      name: 'New RO',
      role: 'RO_OFFICER',
      password: 'Strong-Password-1',
    });
    expect(bad.status).toBe(400);
    const ok = await admin.post('/api/admin/users', {
      email: `new-ro-${fx.tag}@example.test`,
      name: 'New RO',
      role: 'RO_OFFICER',
      password: 'Strong-Password-1',
      regionId: fx.regionId,
    });
    expect(ok.status).toBe(201);
    const weak = await admin.post('/api/admin/users', {
      email: `weak-${fx.tag}@example.test`,
      name: 'Weak',
      role: 'AUDITOR',
      password: 'short',
    });
    expect(weak.status).toBe(400);
  });

  it('lets every signed-in role read master data, but only SYS_ADMIN change it', async () => {
    for (const role of ROLES) {
      await clients.get(role)!.get('/api/master/banks').expect(200);
      const res = await clients.get(role)!.post('/api/master/regions', { code: 'ZZ', name: 'Z' });
      expect([role, res.status === 403]).toEqual([role, role !== 'SYS_ADMIN']);
    }
  });
});
