import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditService } from '../src/audit/audit.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { Client, createFixture, createTestApp, type Fixture } from './helpers.js';

describe('tamper-evident audit log', () => {
  let app: INestApplication;
  let fx: Fixture;
  let prisma: PrismaService;
  let audit: AuditService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    audit = app.get(AuditService);
    fx = await createFixture(app);
  });
  afterAll(async () => {
    await app.close();
  });

  it('records logins in a contiguous hash chain', async () => {
    await Client.login(app, fx.users.AUDITOR);
    const ev = await prisma.auditEvent.findFirst({
      where: { action: 'auth.login', actorId: fx.users.AUDITOR.id },
    });
    expect(ev).not.toBeNull();
    expect(ev!.hash).toMatch(/^[0-9a-f]{64}$/);
    expect((await audit.verify()).ok).toBe(true);
  });

  it('keeps the chain intact under concurrent writes', async () => {
    await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        audit.record({
          actor: null,
          action: 'test.concurrent',
          entityType: 'Test',
          entityId: String(i),
        }),
      ),
    );
    const r = await audit.verify();
    expect(r.ok).toBe(true);
  });

  it('blocks UPDATE, DELETE and TRUNCATE at the database level', async () => {
    await expect(
      prisma.$executeRawUnsafe(`UPDATE audit_events SET action = 'x' WHERE seq = 1`),
    ).rejects.toThrow(/append-only/);
    await expect(
      prisma.$executeRawUnsafe(`DELETE FROM audit_events WHERE seq = 1`),
    ).rejects.toThrow(/append-only/);
    await expect(prisma.$executeRawUnsafe(`TRUNCATE audit_events`)).rejects.toThrow(/append-only/);
  });

  it('detects a row tampered with by a superuser who disabled the trigger', async () => {
    const sentinel = new Error('rollback');
    let report: Awaited<ReturnType<AuditService['verify']>> | undefined;
    await prisma
      .$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
          'ALTER TABLE audit_events DISABLE TRIGGER audit_events_no_update',
        );
        await tx.$executeRawUnsafe(
          `UPDATE audit_events SET data = '{"tampered": true}'::jsonb WHERE seq = (SELECT min(seq) FROM audit_events)`,
        );
        report = await audit.verify(tx);
        throw sentinel; // roll everything back, including the trigger change
      })
      .catch((e: unknown) => {
        if (e !== sentinel) throw e;
      });
    expect(report?.ok).toBe(false);
    expect(report?.breaks[0]).toMatchObject({ seq: '1', kind: 'HASH_MISMATCH' });
    // And the real table is untouched.
    expect((await audit.verify()).ok).toBe(true);
  });

  it('lets auditors browse and verify; refuses others', async () => {
    const auditor = await Client.login(app, fx.users.AUDITOR);
    const list = await auditor.get('/api/audit/events?action=auth.&pageSize=5').expect(200);
    expect((list.body as { items: unknown[] }).items.length).toBeGreaterThan(0);
    const v = await auditor.post('/api/audit/verify').expect(200);
    expect(v.body).toMatchObject({ ok: true });

    const officer = await Client.login(app, fx.users.RO_OFFICER);
    await officer.get('/api/audit/events').expect(403);
    await officer.post('/api/audit/verify').expect(403);
  });
});
