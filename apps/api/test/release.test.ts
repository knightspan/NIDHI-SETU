import type { INestApplication } from '@nestjs/common';
import type { ReleaseView } from '@nidhisetu/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { uniquePdf } from './fixtures.js';
import { detail, toActive } from './flows.js';
import { Client, createFixture, createTestApp, type Fixture } from './helpers.js';

describe('release workflow with maker-checker (PS: authorized release processing)', () => {
  let app: INestApplication;
  let fx: Fixture;
  let prisma: PrismaService;
  let bankCode: string;
  let inst: Client;
  let ro: Client;
  let bureau: Client;
  let ca: Client;
  let finance: Client;
  let a: string;
  let b: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    fx = await createFixture(app);
    bankCode = (await prisma.bank.findUniqueOrThrow({ where: { id: fx.bankId } })).code;
    inst = await Client.login(app, fx.users.INSTITUTION_USER);
    ro = await Client.login(app, fx.users.RO_OFFICER);
    bureau = await Client.login(app, fx.users.BUREAU_OFFICER);
    ca = await Client.login(app, fx.users.COMPETENT_AUTHORITY);
    finance = await Client.login(app, fx.users.FINANCE_OFFICER);
    const bank = await Client.login(app, fx.users.BANK_OFFICER);
    // Two active deposits of ₹15 lakh each; the institution needs ₹10 lakh, so one can be released.
    a = await toActive(inst, ro, bank, bankCode);
    b = await toActive(inst, ro, bank, bankCode);
  });
  afterAll(async () => {
    await app.close();
  });

  it('runs request → checklist → recommend → approve → execute', async () => {
    const preview = (await inst.get(`/api/instruments/${a}/release-checklist`).expect(200))
      .body as {
      passed: boolean;
      items: { code: string; passed: boolean }[];
    };
    expect(preview.passed).toBe(false);
    expect(preview.items.find((i) => i.code === 'NOC_UPLOADED')!.passed).toBe(false);

    const req = (
      await inst
        .post(`/api/instruments/${a}/release`, {
          reason: 'Programme closed; deposit no longer required.',
        })
        .expect(201)
    ).body as ReleaseView;
    expect(req).toMatchObject({ status: 'REQUESTED', checklistPassed: false });
    expect((await detail(inst, a)).status).toBe('RELEASE_REQUESTED');

    // Recommendation is blocked until the checklist passes.
    const blocked = await ro.post(`/api/releases/${req.id}/recommend`, { note: 'Looks fine' });
    expect(blocked.status).toBe(409);
    expect((blocked.body as { error: string }).error).toBe('ChecklistFailed');

    await inst
      .upload(`/api/instruments/${a}/documents`, 'file', uniquePdf('noc'), 'noc.pdf', {
        type: 'NOC',
      })
      .expect(201);
    const rec = (
      await ro
        .post(`/api/releases/${req.id}/recommend`, { note: 'All preconditions met' })
        .expect(200)
    ).body as ReleaseView;
    expect(rec).toMatchObject({
      status: 'RECOMMENDED',
      checklistPassed: true,
      recommendedById: fx.users.RO_OFFICER.id,
    });

    // Wrong roles are refused.
    await finance.post(`/api/releases/${req.id}/approve`, { note: 'x approve' }).expect(403);
    await (
      await Client.login(app, fx.users.SYS_ADMIN)
    )
      .post(`/api/releases/${req.id}/approve`, { note: 'admin approve' })
      .expect(403);
    await finance
      .post(`/api/releases/${req.id}/execute`, {
        executionRef: 'FIN-1',
        executionDate: '2026-11-01',
      })
      .expect(409);

    const appr = (
      await ca
        .post(`/api/releases/${req.id}/approve`, { note: 'Approved under delegated powers' })
        .expect(200)
    ).body as ReleaseView;
    expect(appr.status).toBe('APPROVED');
    await ca
      .post(`/api/releases/${req.id}/execute`, { executionRef: 'X', executionDate: '2026-11-01' })
      .expect(403);

    const done = (
      await finance
        .post(`/api/releases/${req.id}/execute`, {
          executionRef: 'FIN/REL/2026/0001',
          executionDate: '2026-11-02',
        })
        .expect(200)
    ).body as ReleaseView;
    expect(done).toMatchObject({
      status: 'EXECUTED',
      executionRef: 'FIN/REL/2026/0001',
      executionDate: '2026-11-02',
    });

    const d = await detail(inst, a);
    expect(d.status).toBe('RELEASED');
    expect(d.closedAt).not.toBeNull();
    expect(d.validityStatus).toBeNull();
    expect(d.transitions.map((t) => t.to).slice(-4)).toEqual([
      'RELEASE_REQUESTED',
      'RELEASE_RECOMMENDED',
      'RELEASE_APPROVED',
      'RELEASED',
    ]);
    expect(d.releases[0]).toMatchObject({
      requestedBy: expect.any(String),
      recommendedBy: expect.any(String),
      decidedBy: expect.any(String),
      executedBy: expect.any(String),
    });
    for (const action of [
      'release.requested',
      'release.recommended',
      'release.approved',
      'release.executed',
    ]) {
      expect(await prisma.auditEvent.count({ where: { action, entityId: req.id } })).toBe(1);
    }
  });

  it('enforces maker-checker even if the recommender later holds approval rights', async () => {
    await inst
      .upload(`/api/instruments/${b}/documents`, 'file', uniquePdf('noc-b'), 'noc.pdf', {
        type: 'NOC',
      })
      .expect(201);
    // With A released, B is now the only deposit → releasing it would breach the requirement.
    const req = (
      await inst
        .post(`/api/instruments/${b}/release`, { reason: 'Testing segregation of duties.' })
        .expect(201)
    ).body as ReleaseView;
    expect(req.checklist.find((i) => i.code === 'DEPOSIT_NOT_REQUIRED_OR_REPLACED')!.passed).toBe(
      false,
    );
    // Simulate the CA having recommended it (e.g. after a role change).
    await prisma.releaseRequest.update({
      where: { id: req.id },
      data: {
        status: 'RECOMMENDED',
        recommendedById: fx.users.COMPETENT_AUTHORITY.id,
        recommendedAt: new Date(),
      },
    });
    await prisma.$executeRaw`UPDATE "Instrument" SET status = 'RELEASE_RECOMMENDED' WHERE id = ${b}::uuid`;
    const res = await ca.post(`/api/releases/${req.id}/approve`, { note: 'Self-approval attempt' });
    expect(res.status).toBe(403);
    expect((res.body as { error: string }).error).toBe('SegregationOfDuties');
    // A different competent authority may decide.
    const ca2 = await Client.login(app, fx.others.competentAuthority);
    await ca2
      .post(`/api/releases/${req.id}/reject`, { note: 'Deposit still required' })
      .expect(200);
    const d = await detail(inst, b);
    expect(d.status).toBe('ACTIVE');
    expect(d.releases[0]!.status).toBe('REJECTED');
    expect(d.transitions.map((t) => t.to).slice(-2)).toEqual(['RELEASE_REJECTED', 'ACTIVE']);
  });

  it('lets the bureau decline, and keeps other regions out', async () => {
    const req = (
      await inst
        .post(`/api/instruments/${b}/release`, { reason: 'Second attempt for decline path.' })
        .expect(201)
    ).body as ReleaseView;
    await inst.post(`/api/releases/${req.id}/recommend`, { note: 'self' }).expect(403);
    const otherRo = await Client.login(app, fx.others.roOfficer);
    await otherRo.post(`/api/releases/${req.id}/recommend`, { note: 'not my region' }).expect(404);
    await bureau
      .post(`/api/releases/${req.id}/decline`, { note: 'Requirement not met' })
      .expect(200);
    expect((await detail(inst, b)).status).toBe('ACTIVE');
    const list = (await bureau.get('/api/releases?open=false').expect(200)).body as {
      items: ReleaseView[];
    };
    expect(list.items.filter((r) => r.instrumentId === b).map((r) => r.status)).toEqual([
      'REJECTED',
      'REJECTED',
    ]);
  });
});
