import type { INestApplication } from '@nestjs/common';
import type {
  DashboardData,
  ForfeitureView,
  InstrumentDetail,
  MetricView,
  Paged,
  InstrumentSummary,
} from '@nidhisetu/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { maturityValueFor, tenureYears } from '../src/domain/maturity-math.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { detail, submitInstrument, toActive } from './flows.js';
import { Client, createFixture, createTestApp, type Fixture } from './helpers.js';

const ISSUE = '2026-01-15';
const MATURITY = '2031-01-15';
const printed = (principal: number, rate = 7) =>
  Math.round(maturityValueFor(principal, rate, tenureYears(ISSUE, MATURITY), 'QUARTERLY'));
const terms = (amount: number) => ({
  amount,
  interestRate: 7,
  maturityValue: printed(amount),
  issueDate: ISSUE,
  maturityDate: MATURITY,
});

describe('TRINETRA verification, heartbeat, gate and forfeiture', () => {
  let app: INestApplication;
  let fx: Fixture;
  let prisma: PrismaService;
  let bankCode: string;
  let bankName: string;
  let inst: Client;
  let ro: Client;
  let bank: Client;
  let ca: Client;
  let finance: Client;
  let admin: Client;

  const eye = (d: InstrumentDetail, e: 'BANK' | 'TAX' | 'DOCUMENT') =>
    d.verification.eyes.find((x) => x.eye === e)!;
  const openCodes = (d: InstrumentDetail) =>
    d.discrepancies
      .filter((x) => x.status === 'OPEN' || x.status === 'RESPONDED')
      .map((x) => x.ruleCode);
  const ageBankPass = (instrumentId: string, days: number) =>
    prisma.verificationSignal.updateMany({
      where: { instrumentId, eye: 'BANK' },
      data: {
        checkedAt: new Date(Date.now() - days * 86_400_000),
        validUntil: new Date(Date.now() - (days - 365) * 86_400_000),
      },
    });
  const bankAnswers = async (instrumentId: string, confirm = true) => {
    const req = await prisma.bankConfirmationRequest.findFirstOrThrow({
      where: { instrumentId, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    });
    const d = await detail(ro, instrumentId);
    await bank
      .post(`/api/bank-requests/${req.id}/respond`, {
        exists: true,
        lienMarked: confirm,
        maturityDate: d.maturityDate,
        autoRenewal: d.autoRenewal,
        amount: Number(d.amount),
      })
      .expect(200);
    return req;
  };
  const ais = (fy: string, entries: { reportedBy: string; amount: number }[]) =>
    Buffer.from(
      JSON.stringify({
        assessee: { pan: 'AAATT0000A', name: 'TEST TRUST' },
        financialYear: fy,
        informationCategories: [
          { category: 'Interest from deposit', infoCode: 'SFT-016(TD)', entries },
        ],
      }),
    );

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    fx = await createFixture(app);
    const b = await prisma.bank.findUniqueOrThrow({ where: { id: fx.bankId } });
    bankCode = b.code;
    bankName = b.name;
    inst = await Client.login(app, fx.users.INSTITUTION_USER);
    ro = await Client.login(app, fx.users.RO_OFFICER);
    bank = await Client.login(app, fx.users.BANK_OFFICER);
    ca = await Client.login(app, fx.users.COMPETENT_AUTHORITY);
    finance = await Client.login(app, fx.users.FINANCE_OFFICER);
    admin = await Client.login(app, fx.users.SYS_ADMIN);
  });
  afterAll(async () => {
    await app.close();
  });

  it('document eye catches an altered amount by reverse maturity math (scenario a)', async () => {
    // The receipt reads ₹2,50,000 but its printed maturity value fits ₹25,00,000.
    const id = await submitInstrument(inst, bankCode, {
      ...terms(250_000),
      maturityValue: printed(2_500_000),
    });
    const d = await detail(ro, id);
    const doc = eye(d, 'DOCUMENT');
    expect(doc.result).toBe('FAIL');
    const mm = doc.latest!.details.maturityMath as { impliedMultiple: number; note: string };
    expect(mm.impliedMultiple).toBe(10);
    expect(mm.note).toMatch(/10× the ₹2,50,000/);
    expect(openCodes(d)).toContain('DOCUMENT_CHECK_FAILED');
    expect(d.verification.riskLevel).toBe('HIGH');
  });

  it('document eye passes when the printed maturity value adds up', async () => {
    const id = await submitInstrument(inst, bankCode, terms(1_500_000));
    const d = await detail(ro, id);
    expect(eye(d, 'DOCUMENT').result).toBe('PASS');
    expect((eye(d, 'DOCUMENT').latest!.details.maturityMath as { result: string }).result).toBe(
      'PASS',
    );
    expect(openCodes(d)).not.toContain('DOCUMENT_CHECK_FAILED');
  });

  it('bank answers record the bank eye; activation leaves a fresh PASS', async () => {
    const id = await toActive(inst, ro, bank, bankCode, terms(1_500_000));
    const d = await detail(ro, id);
    expect(eye(d, 'BANK')).toMatchObject({ result: 'PASS' });
    expect(eye(d, 'TAX').result).toBe('NOT_AVAILABLE');
    expect(d.verification.gate.passed).toBe(true);
  });

  it('tax heartbeat: a bank that stops reporting interest fails, locks release, and re-attestation unlocks (scenario b)', async () => {
    const id = await toActive(inst, ro, bank, bankCode, terms(1_500_000));
    expect((await detail(inst, id)).allowedActions).toContain('request_release');

    // The FY 2025-26 AIS shows no interest from this bank: premature closure?
    const up = await inst
      .upload(
        '/api/tax/ais',
        'file',
        ais('2025-26', [{ reportedBy: 'Some Other Bank', amount: 10 }]),
        'ais.json',
      )
      .expect(201);
    expect((up.body as { evaluation: { failed: number } }).evaluation.failed).toBeGreaterThan(0);
    const failed = await detail(inst, id);
    expect(eye(failed, 'TAX')).toMatchObject({ result: 'FAIL' });
    expect(failed.verification.heartbeat.find((c) => c.fy === '2025-26')?.result).toBe('FAIL');
    expect(openCodes(failed)).toContain('TAX_TRAIL_BROKEN');
    expect(failed.verification.taxLocked).toBe(true);
    expect(failed.allowedActions).not.toContain('request_release');
    expect(failed.allowedActions).not.toContain('renew');
    expect(failed.status).toBe('ACTIVE'); // corroboration only: never auto-rejects
    const reattest = await prisma.bankConfirmationRequest.findFirst({
      where: { instrumentId: id, purpose: 'REATTESTATION', status: 'PENDING' },
    });
    expect(reattest?.requestedById).toBeNull();

    // The bank re-attests: the lock lifts and the tax alarm is answered.
    await bankAnswers(id);
    const after = await detail(inst, id);
    expect(after.status).toBe('ACTIVE');
    expect(after.verification.taxLocked).toBe(false);
    expect(openCodes(after)).not.toContain('TAX_TRAIL_BROKEN');
    expect(after.allowedActions).toContain('request_release');
  });

  it('tax heartbeat passes when the bank reports the expected interest; bad files are refused', async () => {
    const id = await toActive(inst, ro, bank, bankCode, terms(1_500_000));
    await inst
      .upload(
        '/api/tax/ais',
        'file',
        ais('2025-26', [{ reportedBy: bankName, amount: 9_999_999 }]),
        'ais.json',
      )
      .expect(201);
    expect(eye(await detail(inst, id), 'TAX').result).toBe('PASS');
    await inst.upload('/api/tax/ais', 'file', Buffer.from('not json'), 'ais.json').expect(400);
    await inst.upload('/api/tax/ais', 'file', Buffer.from('{"hello":1}'), 'ais.json').expect(400);
    await ro.upload('/api/tax/ais', 'file', ais('2025-26', []), 'ais.json').expect(403);
    const overview = (await inst.get('/api/tax/ais').expect(200)).body as {
      statements: { fy: string }[];
    };
    expect(overview.statements.some((s) => s.fy === '2025-26')).toBe(true);
  });

  it('daily job: a stale bank signal triggers a scheduled re-attestation (feature 2)', async () => {
    const id = await toActive(inst, ro, bank, bankCode, terms(1_500_000));
    await ageBankPass(id, 400);
    await admin.post('/api/admin/jobs/lifecycle').expect(200);
    const req = await prisma.bankConfirmationRequest.findFirst({
      where: { instrumentId: id, purpose: 'REATTESTATION', status: 'PENDING' },
    });
    expect(req?.reason).toMatch(/stale/);
    const d = await detail(ro, id);
    expect(d.status).toBe('ACTIVE');
    expect(eye(d, 'BANK').result).toBe('STALE');
    expect(d.allowedActions).not.toContain('reattest'); // one request at a time
  });

  it('forfeiture: maker proposes, gate needs a fresh bank PASS, checker approves, finance executes (feature 3)', async () => {
    const id = await toActive(inst, ro, bank, bankCode, terms(1_500_000));
    await ageBankPass(id, 60);
    await ro
      .post(`/api/instruments/${id}/forfeiture`, { reason: 'Institution closed without notice' })
      .expect(400);
    await inst
      .post(`/api/instruments/${id}/forfeiture`, {
        reason: 'x'.repeat(20),
        orderReference: 'ORD/1',
      })
      .expect(403);
    const f = (
      await ro
        .post(`/api/instruments/${id}/forfeiture`, {
          reason: 'Approval withdrawn; deposit to be invoked as per order.',
          orderReference: 'AICTE/RO/NR/2026/FF-001',
        })
        .expect(201)
    ).body as ForfeitureView;
    expect((await detail(ro, id)).status).toBe('FORFEITURE_PROPOSED');

    // The gate refuses approval on a 60-day-old bank confirmation.
    const blocked = await ca.post(`/api/forfeitures/${f.id}/approve`, { note: 'Approved' });
    expect(blocked.status).toBe(409);
    expect((blocked.body as { error: string }).error).toBe('ReverificationGateFailed');

    await ro.post(`/api/instruments/${id}/reattest`, {}).expect(200);
    await bankAnswers(id);
    await finance
      .post(`/api/forfeitures/${f.id}/execute`, {
        executionRef: 'X-1',
        executionDate: '2026-11-01',
      })
      .expect(409);
    await ca
      .post(`/api/forfeitures/${f.id}/approve`, { note: 'Approved after re-attestation' })
      .expect(200);
    const done = (
      await finance
        .post(`/api/forfeitures/${f.id}/execute`, {
          executionRef: 'FIN/INV/2026/0001',
          executionDate: '2026-11-02',
        })
        .expect(200)
    ).body as ForfeitureView;
    expect(done).toMatchObject({ status: 'EXECUTED', orderReference: 'AICTE/RO/NR/2026/FF-001' });
    const d = await detail(ro, id);
    expect(d.status).toBe('FORFEITED');
    expect(d.transitions.map((t) => t.to).slice(-3)).toEqual([
      'FORFEITURE_PROPOSED',
      'FORFEITURE_APPROVED',
      'FORFEITED',
    ]);
    for (const action of ['forfeiture.proposed', 'forfeiture.approved', 'forfeiture.executed'])
      expect(await prisma.auditEvent.count({ where: { action, entityId: f.id } })).toBe(1);
  });

  it('the proposer can never approve; the checker can reject back to ACTIVE', async () => {
    const id = await toActive(inst, ro, bank, bankCode, terms(1_500_000));
    const bureau = await Client.login(app, fx.users.BUREAU_OFFICER);
    const f = (
      await bureau
        .post(`/api/instruments/${id}/forfeiture`, {
          reason: 'Proposed by the bureau for testing',
          orderReference: 'ORD/2',
        })
        .expect(201)
    ).body as ForfeitureView;
    await bureau.post(`/api/forfeitures/${f.id}/approve`, { note: 'self' }).expect(403);
    await ca
      .post(`/api/forfeitures/${f.id}/reject`, { note: 'Show-cause reply accepted' })
      .expect(200);
    expect((await detail(ro, id)).status).toBe('ACTIVE');
  });

  it('lists the scrutiny queue by risk, and exposes trust mix and manual-effort metrics (features 1, 4, 5)', async () => {
    const list = (await ro.get('/api/instruments?sort=risk&dir=desc&pageSize=50').expect(200))
      .body as Paged<InstrumentSummary>;
    const scores = list.items.map((i) => i.riskScore);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    expect(list.items[0]!.riskLevel).toMatch(/LOW|MEDIUM|HIGH/);

    const bureau = await Client.login(app, fx.users.BUREAU_OFFICER);
    const dash = (await bureau.get('/api/dashboard').expect(200)).body as DashboardData;
    const mine = dash.trustMix.find((r) => r.region === `Region ${fx.tag}`);
    expect(mine && mine.BANK_CONFIRMED).toBeGreaterThan(0);

    await admin
      .put('/api/metrics/registers', { retired: 12, total: 40, note: 'Northern RO registers' })
      .expect(200);
    await ro.put('/api/metrics/registers', { retired: 1 }).expect(403);
    const metrics = (await bureau.get('/api/metrics').expect(200)).body as MetricView[];
    expect(metrics.find((m) => m.key === 'registers_retired')).toMatchObject({
      value: 12,
      unit: 'count',
    });
    const edits = metrics.find((m) => m.key === 'manual_edits_per_instrument')!;
    expect(edits.unit).toBe('count');
    expect(edits.sampleSize).toBeGreaterThan(0);
  });

  it('counts an officer correction as a manual field edit in the audit log', async () => {
    const id = await submitInstrument(inst, bankCode, terms(1_500_000));
    await ro.post(`/api/instruments/${id}/begin-scrutiny`).expect(200);
    await ro
      .post(`/api/instruments/${id}/verify-fields`, {
        items: [{ field: 'amount', value: '1400000' }],
      })
      .expect(200);
    expect(await prisma.auditEvent.count({ where: { action: 'field.edited', entityId: id } })).toBe(
      1,
    );
  });
});
