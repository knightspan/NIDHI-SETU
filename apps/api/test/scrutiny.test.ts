import type { INestApplication } from '@nestjs/common';
import type { DiscrepancyView, InstrumentDetail, Paged } from '@nidhisetu/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DiscrepancyEngine } from '../src/discrepancies/discrepancy-engine.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { declaration, uniquePdf } from './fixtures.js';
import { Client, createFixture, createTestApp, type Fixture } from './helpers.js';

describe('scrutiny and discrepancy detection', () => {
  let app: INestApplication;
  let fx: Fixture;
  let prisma: PrismaService;
  let bankCode: string;
  let inst: Client;
  let ro: Client;

  const detail = async (c: Client, id: string) =>
    (await c.get(`/api/instruments/${id}`).expect(200)).body as InstrumentDetail;
  const codes = (d: InstrumentDetail, open = true) =>
    d.discrepancies
      .filter((x) => !open || x.status === 'OPEN' || x.status === 'RESPONDED')
      .map((x) => x.ruleCode)
      .sort();

  async function submitted(overrides = {}, withScan = true): Promise<string> {
    const { id } = (
      await inst.post('/api/instruments', declaration(bankCode, overrides)).expect(201)
    ).body as { id: string };
    if (withScan) {
      await inst
        .upload(`/api/instruments/${id}/documents`, 'file', uniquePdf(id), 'scan.pdf', {
          type: 'FDR_SCAN',
        })
        .expect(201);
    }
    await inst.post(`/api/instruments/${id}/submit`).expect(200);
    return id;
  }

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    fx = await createFixture(app);
    bankCode = (await prisma.bank.findUniqueOrThrow({ where: { id: fx.bankId } })).code;
    inst = await Client.login(app, fx.users.INSTITUTION_USER);
    ro = await Client.login(app, fx.users.RO_OFFICER);
  });
  afterAll(async () => {
    await app.close();
  });

  it('auto-flags rule breaches when an instrument is submitted (PS: discrepancy identification)', async () => {
    const id = await submitted(
      {
        amount: 400_000,
        depositorNames: ['Test Trust'],
        lienMarked: false,
        maturityDate: '2027-01-15',
      },
      false,
    );
    const d = await detail(inst, id);
    expect(codes(d)).toEqual(
      [
        'AMOUNT_BELOW_REQUIRED',
        'LIEN_NOT_MARKED',
        'MATURITY_BEFORE_REQUIRED_END',
        'MISSING_DOCUMENT',
        'NOT_JOINT_NAME',
      ].sort(),
    );
    expect(d.discrepancies.every((x) => x.autoRaised && x.dueAt)).toBe(true);
    // Re-evaluating does not duplicate findings, and a waived finding is not raised again.
    const lien = d.discrepancies.find((x) => x.ruleCode === 'LIEN_NOT_MARKED')!;
    await ro
      .post(`/api/discrepancies/${lien.id}/close`, {
        resolution: 'WAIVED',
        note: 'Bank letter on file',
      })
      .expect(200);
    await prisma.$transaction((tx) => app.get(DiscrepancyEngine).sync(tx, id));
    const after = await detail(inst, id);
    expect(after.discrepancies).toHaveLength(5);
    expect(after.discrepancies.find((x) => x.id === lien.id)!.status).toBe('WAIVED');
  });

  it('flags a duplicate FDR across institutions on both instruments, as HIGH severity', async () => {
    const decl = declaration(bankCode);
    const a = await submitted(decl);
    const other = await Client.login(app, fx.others.institutionUser);
    const { id: b } = (await other.post('/api/instruments', { ...decl }).expect(201)).body as {
      id: string;
    };
    await other.post(`/api/instruments/${b}/submit`).expect(200);
    const dupA = (await detail(inst, a)).discrepancies.find((x) => x.ruleCode === 'DUPLICATE_FDR');
    const dupB = (await detail(other, b)).discrepancies.find((x) => x.ruleCode === 'DUPLICATE_FDR');
    expect(dupA?.severity).toBe('HIGH');
    expect(dupB?.severity).toBe('HIGH');
  });

  it('catches a duplicate FDR written with look-alike characters and other separators', async () => {
    const decl = declaration(bankCode, { fdrNumber: `SBI/FD/2026/${Date.now() % 1_000_000}0` });
    const a = await submitted(decl);
    const disguised = decl.fdrNumber.replace(/\//g, '-').replace(/0/g, 'O').replace(/1/g, 'I');
    const other = await Client.login(app, fx.others.institutionUser);
    const { id: b } = (
      await other.post('/api/instruments', { ...decl, fdrNumber: disguised }).expect(201)
    ).body as { id: string };
    await other.post(`/api/instruments/${b}/submit`).expect(200);
    expect(codes(await detail(other, b))).toContain('DUPLICATE_FDR');
    expect(codes(await detail(inst, a))).toContain('DUPLICATE_FDR');
  });

  it('flags the same document reused on another instrument', async () => {
    const pdf = uniquePdf('shared-scan');
    const ids: string[] = [];
    for (let i = 0; i < 2; i++) {
      const { id } = (await inst.post('/api/instruments', declaration(bankCode)).expect(201))
        .body as { id: string };
      await inst
        .upload(`/api/instruments/${id}/documents`, 'file', pdf, 'scan.pdf', { type: 'FDR_SCAN' })
        .expect(201);
      await inst.post(`/api/instruments/${id}/submit`).expect(200);
      ids.push(id);
    }
    expect(codes(await detail(inst, ids[1]!))).toContain('DUPLICATE_DOCUMENT');
  });

  it('runs the full scrutiny loop: verify, mismatch, discrepancy, response, verified', async () => {
    const id = await submitted({ amount: 1_500_000 });
    expect(codes(await detail(ro, id))).toEqual([]);

    await ro.post(`/api/instruments/${id}/verify`).expect(409); // not under scrutiny yet
    await ro.post(`/api/instruments/${id}/begin-scrutiny`).expect(200);

    // Officer reads 1,50,000 on the original: officer-verified value disagrees with the declaration.
    await ro
      .post(`/api/instruments/${id}/verify-fields`, {
        items: [{ field: 'amount', value: '150000' }],
      })
      .expect(200);
    let d = await detail(ro, id);
    const amount = d.fields.find((f) => f.field === 'amount')!;
    expect(amount).toMatchObject({
      effectiveTrust: 'OFFICER_VERIFIED',
      mismatch: true,
      effectiveValue: '150000.00',
    });
    // (The amount alone is below the requirement, but the institution's other live deposits cover it.)
    expect(codes(d)).toEqual(['FIELD_MISMATCH']);

    // Officer adds a manual note and sends it back.
    const { id: manualId } = (
      await ro
        .post(`/api/instruments/${id}/discrepancies`, {
          field: 'amount',
          severity: 'HIGH',
          description: 'Amount on the original FDR is ₹1,50,000 — please clarify.',
        })
        .expect(201)
    ).body as { id: string };
    d = await detail(inst, id);
    expect(d.status).toBe('DISCREPANCY_RAISED');
    expect(d.allowedActions).toEqual(expect.arrayContaining(['edit', 'respond']));

    // Institution cannot send it back while something is still OPEN.
    await inst.post(`/api/instruments/${id}/respond`).expect(409);
    for (const x of d.discrepancies.filter((x) => x.status === 'OPEN')) {
      await inst
        .post(`/api/discrepancies/${x.id}/comments`, {
          body: 'We will submit a fresh FDR of the right amount.',
        })
        .expect(201);
    }
    // The institution corrects its declaration; the mismatch clears and is auto-resolved.
    const decl = declaration(bankCode, { amount: 150_000 });
    const declared = (f: string) =>
      d.fields.find((x) => x.field === f)!.history.find((h) => h.trust === 'DECLARED')!.value;
    await inst
      .patch(`/api/instruments/${id}`, {
        ...decl,
        fdrNumber: declared('fdrNumber'),
        ifsc: declared('ifsc'),
      })
      .expect(200);
    d = await detail(inst, id);
    const mismatch = d.discrepancies.find((x) => x.ruleCode === 'FIELD_MISMATCH')!;
    expect(mismatch.status).toBe('RESOLVED');
    expect(mismatch.comments.at(-1)!.authorRole).toBe('SYSTEM');

    await inst
      .post(`/api/instruments/${id}/respond`, { note: 'Responded to all points' })
      .expect(200);
    expect((await detail(ro, id)).status).toBe('UNDER_SCRUTINY');

    // Officer closes what is left.
    d = await detail(ro, id);
    for (const x of d.discrepancies.filter(
      (x) => x.status === 'OPEN' || x.status === 'RESPONDED',
    )) {
      await ro
        .post(`/api/discrepancies/${x.id}/close`, {
          resolution: x.id === manualId ? 'RESOLVED' : 'WAIVED',
          note: 'Checked against original',
        })
        .expect(200);
    }
    // Not every field is officer-verified yet.
    const r = await ro.post(`/api/instruments/${id}/verify`);
    expect(r.status).toBe(409);
    expect((r.body as { error: string }).error).toBe('FieldsNotVerified');

    const all = d.fields.map((f) => ({ field: f.field }));
    await ro.post(`/api/instruments/${id}/verify-fields`, { items: all }).expect(200);
    await ro.post(`/api/instruments/${id}/verify`).expect(200);
    d = await detail(ro, id);
    expect(d.status).toBe('OFFICER_VERIFIED');
    // Officer-verified fields (75 × 40 %) plus the eyes' current state.
    expect(d.trustScore).toBe(67);
  });

  it('lets the officer reject a submission', async () => {
    const id = await submitted();
    await ro.post(`/api/instruments/${id}/reject`, { note: 'x' }).expect(400);
    await ro.post(`/api/instruments/${id}/reject`, { note: 'Not a valid FDR' }).expect(200);
    expect((await detail(inst, id)).status).toBe('REJECTED');
  });

  it('enforces roles and scope on scrutiny endpoints', async () => {
    const id = await submitted();
    await inst.post(`/api/instruments/${id}/begin-scrutiny`).expect(403);
    const otherRo = await Client.login(app, fx.others.roOfficer);
    await otherRo.post(`/api/instruments/${id}/begin-scrutiny`).expect(404);
    const bureau = await Client.login(app, fx.users.BUREAU_OFFICER);
    await bureau.post(`/api/instruments/${id}/begin-scrutiny`).expect(403);
    const list = (await bureau.get('/api/discrepancies?open=true').expect(200))
      .body as Paged<DiscrepancyView>;
    expect(list.total).toBeGreaterThan(0);
    const bank = await Client.login(app, fx.users.BANK_OFFICER);
    await bank.get('/api/discrepancies').expect(403);
    const otherInst = await Client.login(app, fx.others.institutionUser);
    const theirs = (await otherInst.get(`/api/discrepancies?instrumentId=${id}`).expect(200))
      .body as Paged<DiscrepancyView>;
    expect(theirs.total).toBe(0);
  });
});
