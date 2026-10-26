import type { INestApplication } from '@nestjs/common';
import type {
  DashboardData,
  InstitutionStatementView,
  InstitutionSummaryView,
  MetricView,
  Paged,
} from '@nidhisetu/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { submitInstrument, toActive } from './flows.js';
import { Client, createFixture, createTestApp, type Fixture } from './helpers.js';

describe('dashboard, institutions, search, reports, metrics', () => {
  let app: INestApplication;
  let fx: Fixture;
  let prisma: PrismaService;
  let bankCode: string;
  let inst: Client;
  let ro: Client;
  let bureau: Client;
  let admin: Client;
  let activeId: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    fx = await createFixture(app);
    bankCode = (await prisma.bank.findUniqueOrThrow({ where: { id: fx.bankId } })).code;
    inst = await Client.login(app, fx.users.INSTITUTION_USER);
    ro = await Client.login(app, fx.users.RO_OFFICER);
    bureau = await Client.login(app, fx.users.BUREAU_OFFICER);
    admin = await Client.login(app, fx.users.SYS_ADMIN);
    const bank = await Client.login(app, fx.users.BANK_OFFICER);
    activeId = await toActive(inst, ro, bank, bankCode);
    await submitInstrument(inst, bankCode);
  });
  afterAll(async () => {
    await app.close();
  });

  it('builds a scoped dashboard quickly', async () => {
    const d = (await inst.get('/api/dashboard').expect(200)).body as DashboardData;
    expect(d.scope).toBe('INSTITUTION');
    expect(d.kpis.active).toBe(1);
    expect(d.kpis.pendingVerification).toBe(1);
    expect(Number(d.kpis.heldAmount)).toBe(1_500_000);
    expect(d.queue.map((q) => q.key)).toContain('drafts');
    expect(d.generatedInMs).toBeLessThan(2000);

    const r = (await ro.get('/api/dashboard').expect(200)).body as DashboardData;
    expect(r.queue.find((q) => q.key === 'awaitingScrutiny')!.count).toBe(1);
    expect(r.byRegion).toHaveLength(1);

    const other = (
      await (await Client.login(app, fx.others.roOfficer)).get('/api/dashboard').expect(200)
    ).body as DashboardData;
    expect(other.kpis.active).toBe(0);
    const sys = (await admin.get('/api/dashboard').expect(200)).body as DashboardData;
    expect(sys.kpis.heldCount).toBe(0);
    expect(sys.queue.map((q) => q.key)).toContain('placeholderRules');
  });

  it('lists institutions with requirement and compliance, scoped by region', async () => {
    const list = (await ro.get(`/api/institutions?q=${fx.tag}`).expect(200))
      .body as Paged<InstitutionSummaryView>;
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({
      id: fx.institutionId,
      compliant: true,
      exempt: false,
      required: '1000000.00',
      heldAmount: '1500000.00',
    });
    const national = (await bureau.get(`/api/institutions?q=${fx.tag}`).expect(200))
      .body as Paged<InstitutionSummaryView>;
    expect(national.items).toHaveLength(2);
    expect(national.items.find((i) => i.id === fx.otherInstitutionId)!.compliant).toBe(false);
    const shortfall = (
      await bureau.get(`/api/institutions?q=${fx.tag}&compliance=shortfall`).expect(200)
    ).body as Paged<InstitutionSummaryView>;
    expect(shortfall.items.map((i) => i.id)).toEqual([fx.otherInstitutionId]);

    const st = (await ro.get(`/api/institutions/${fx.institutionId}`).expect(200))
      .body as InstitutionStatementView;
    expect(st.instruments).toHaveLength(2);
    await ro.get(`/api/institutions/${fx.otherInstitutionId}`).expect(404);
    await inst.get(`/api/institutions/${fx.otherInstitutionId}`).expect(404);
  });

  it('searches institutions and instruments within scope', async () => {
    const r = (await ro.get(`/api/search?q=${fx.tag}`).expect(200)).body as {
      institutions: unknown[];
      instruments: unknown[];
    };
    expect(r.institutions).toHaveLength(1);
    expect(r.instruments.length).toBeGreaterThanOrEqual(2);
  });

  it('exports every report in CSV, XLSX and PDF, and audits the export', async () => {
    for (const type of [
      'pending-verifications',
      'upcoming-maturities',
      'missing-documents',
      'intervention',
    ]) {
      const csv = await bureau
        .get(`/api/reports/${type}?format=csv&days=3650`)
        .buffer(true)
        .expect(200);
      expect(csv.headers['content-type']).toMatch(/text\/csv/);
      expect(csv.headers['content-disposition']).toMatch(/attachment; filename="nidhisetu-/);
    }
    const maturities = await ro
      .get('/api/reports/upcoming-maturities?format=csv&days=3650')
      .buffer(true)
      .expect(200);
    const refNo = (await prisma.instrument.findUniqueOrThrow({ where: { id: activeId } })).refNo;
    expect(String(maturities.text ?? (maturities.body as Buffer).toString())).toContain(refNo);

    const xlsx = await ro
      .get('/api/reports/pending-verifications?format=xlsx')
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect((xlsx.body as Buffer).subarray(0, 2).toString()).toBe('PK');

    const pdf = await ro
      .get(`/api/reports/institution-statement?format=pdf&institutionId=${fx.institutionId}`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');

    await inst.get('/api/reports/pending-verifications').expect(403);
    await ro.get('/api/reports/institution-statement?format=csv').expect(400);
    await ro.get('/api/reports/nope').expect(404);
    expect(
      await prisma.auditEvent.count({
        where: { action: 'report.exported', actorId: fx.users.RO_OFFICER.id },
      }),
    ).toBeGreaterThanOrEqual(3);
  });

  it('computes outcome metrics from audit events and keeps admin-set baselines', async () => {
    const m = (await bureau.get('/api/metrics').expect(200)).body as MetricView[];
    const turnaround = m.find((x) => x.key === 'verification_turnaround_days')!;
    expect(turnaround.sampleSize).toBeGreaterThanOrEqual(1);
    expect(turnaround.value).not.toBeNull();
    expect(m.find((x) => x.key === 'fully_bank_confirmed_pct')!.value).toBeGreaterThan(0);

    await bureau
      .put('/api/metrics/baselines/verification_turnaround_days', { value: 45 })
      .expect(403);
    await admin
      .put('/api/metrics/baselines/verification_turnaround_days', {
        value: 45,
        note: 'Manual process, 2025 sample',
      })
      .expect(200);
    const after = (await admin.get('/api/metrics').expect(200)).body as MetricView[];
    expect(after.find((x) => x.key === 'verification_turnaround_days')).toMatchObject({
      baseline: 45,
      betterWhen: 'lower',
    });
    await ro.get('/api/metrics').expect(403);
  });

  it('stores saved filters per user', async () => {
    const f = (
      await ro
        .post('/api/saved-filters', { name: 'Overdue', query: { validity: 'OVERDUE_RENEWAL' } })
        .expect(201)
    ).body as { id: string };
    expect(((await ro.get('/api/saved-filters').expect(200)).body as unknown[]).length).toBe(1);
    expect(((await bureau.get('/api/saved-filters').expect(200)).body as unknown[]).length).toBe(0);
    await bureau.delete(`/api/saved-filters/${f.id}`).expect(200);
    expect(((await ro.get('/api/saved-filters').expect(200)).body as unknown[]).length).toBe(1);
    await ro.delete(`/api/saved-filters/${f.id}`).expect(200);
    expect(((await ro.get('/api/saved-filters').expect(200)).body as unknown[]).length).toBe(0);
  });
});
