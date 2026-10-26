import type { INestApplication } from '@nestjs/common';
import type { BankRequestView, Paged } from '@nidhisetu/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { uniquePdf } from './fixtures.js';
import { detail, toOfficerVerified } from './flows.js';
import { Client, createFixture, createTestApp, type Fixture } from './helpers.js';

describe('Bank Confirmation Desk and mock bank API', () => {
  let app: INestApplication;
  let fx: Fixture;
  let prisma: PrismaService;
  let deskBank: string;
  let apiBank: string;
  let inst: Client;
  let ro: Client;
  let bank: Client;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    fx = await createFixture(app);
    deskBank = (await prisma.bank.findUniqueOrThrow({ where: { id: fx.bankId } })).code;
    apiBank = (await prisma.bank.findUniqueOrThrow({ where: { id: fx.otherBankId } })).code;
    inst = await Client.login(app, fx.users.INSTITUTION_USER);
    ro = await Client.login(app, fx.users.RO_OFFICER);
    bank = await Client.login(app, fx.users.BANK_OFFICER);
  });
  afterAll(async () => {
    await app.close();
  });

  it('routes a desk bank to its officer, who confirms with a signed letter → ACTIVE, green badges', async () => {
    const id = await toOfficerVerified(inst, ro, deskBank);
    const req = (await ro.post(`/api/instruments/${id}/send-to-bank`).expect(200))
      .body as BankRequestView;
    expect(req).toMatchObject({ channel: 'DESK', status: 'PENDING' });
    expect((await detail(ro, id)).status).toBe('BANK_CONFIRMATION_PENDING');

    const queue = (await bank.get('/api/bank-requests?status=PENDING').expect(200))
      .body as Paged<BankRequestView>;
    const mine = queue.items.find((r) => r.id === req.id)!;
    expect(mine.snapshot.fdrNumber).toBeTruthy();

    const letter = (
      await bank
        .upload(`/api/bank-requests/${req.id}/letter`, 'file', uniquePdf('letter'), 'letter.pdf')
        .expect(201)
    ).body as { documentId: string };
    await bank
      .post(`/api/bank-requests/${req.id}/respond`, {
        exists: true,
        lienMarked: true,
        maturityDate: mine.snapshot.maturityDate,
        autoRenewal: false,
        amount: Number(mine.snapshot.amount),
        remarks: 'Lien noted in core banking',
        letterDocumentId: letter.documentId,
      })
      .expect(200);

    const d = await detail(ro, id);
    expect(d.status).toBe('ACTIVE');
    expect(d.activatedAt).not.toBeNull();
    for (const f of [
      'fdrNumber',
      'bankCode',
      'amount',
      'maturityDate',
      'lienMarked',
      'autoRenewal',
    ]) {
      const fv = d.fields.find((x) => x.field === f)!;
      expect([f, fv.effectiveTrust, fv.mismatch]).toEqual([f, 'BANK_CONFIRMED', false]);
      expect(fv.history[0]!.evidenceDocumentId).toBe(letter.documentId);
    }
    expect(d.trustScore).toBeGreaterThanOrEqual(90);
    expect(d.bankRequests[0]).toMatchObject({
      status: 'CONFIRMED',
      letterDocumentId: letter.documentId,
    });
    expect(d.transitions.map((t) => t.to).slice(-3)).toEqual([
      'BANK_CONFIRMATION_PENDING',
      'BANK_CONFIRMED',
      'ACTIVE',
    ]);

    // Answering twice is refused.
    await bank
      .post(`/api/bank-requests/${req.id}/respond`, {
        exists: false,
        lienMarked: null,
        maturityDate: null,
        autoRenewal: null,
      })
      .expect(409);
  });

  it('sends a contradicted instrument back to scrutiny with a HIGH discrepancy', async () => {
    const id = await toOfficerVerified(inst, ro, deskBank);
    const req = (await ro.post(`/api/instruments/${id}/send-to-bank`).expect(200))
      .body as BankRequestView;
    await bank
      .post(`/api/bank-requests/${req.id}/respond`, {
        exists: true,
        lienMarked: false,
        maturityDate: '2030-01-15',
        autoRenewal: false,
      })
      .expect(200);
    const d = await detail(ro, id);
    expect(d.status).toBe('UNDER_SCRUTINY');
    const open = d.discrepancies.filter((x) => x.status === 'OPEN').map((x) => x.ruleCode);
    expect(open).toEqual(
      expect.arrayContaining(['BANK_DENIED', 'LIEN_NOT_MARKED', 'FIELD_MISMATCH']),
    );
    expect(d.discrepancies.find((x) => x.ruleCode === 'BANK_DENIED')!.severity).toBe('HIGH');
    expect(d.fields.find((f) => f.field === 'maturityDate')).toMatchObject({
      effectiveTrust: 'BANK_CONFIRMED',
      mismatch: true,
    });
  });

  it('confirms instantly through the mock API for API-enabled banks', async () => {
    const id = await toOfficerVerified(inst, ro, apiBank);
    const req = (await ro.post(`/api/instruments/${id}/send-to-bank`).expect(200))
      .body as BankRequestView;
    expect(req).toMatchObject({
      channel: 'MOCK_API',
      status: 'CONFIRMED',
      respondedBy: 'Bank API',
    });
    expect((await detail(ro, id)).status).toBe('ACTIVE');
  });

  it('reports a non-existent FDR from the mock API', async () => {
    const id = await toOfficerVerified(inst, ro, apiBank, { fdrNumber: `NOTFOUND${Date.now()}` });
    const req = (await ro.post(`/api/instruments/${id}/send-to-bank`).expect(200))
      .body as BankRequestView;
    expect(req.status).toBe('DENIED');
    const d = await detail(ro, id);
    expect(d.status).toBe('UNDER_SCRUTINY');
    expect(d.discrepancies.find((x) => x.ruleCode === 'BANK_DENIED')!.description).toMatch(
      /does not exist/,
    );
  });

  it('lets the officer retry a failed API call', async () => {
    const id = await toOfficerVerified(inst, ro, apiBank);
    const req = (await ro.post(`/api/instruments/${id}/send-to-bank`).expect(200))
      .body as BankRequestView;
    // Simulate an earlier timeout.
    await prisma.$executeRaw`UPDATE "BankConfirmationRequest" SET status = 'FAILED', "failureReason" = 'timeout' WHERE id = ${req.id}::uuid`;
    await prisma.$executeRaw`UPDATE "Instrument" SET status = 'BANK_CONFIRMATION_PENDING' WHERE id = ${id}::uuid`;
    const retried = (await ro.post(`/api/bank-requests/${req.id}/retry`).expect(200))
      .body as BankRequestView;
    expect(retried.status).toBe('CONFIRMED');
    expect(retried.attempts).toBe(2);
  });

  it('keeps every bank officer inside their own bank', async () => {
    const id = await toOfficerVerified(inst, ro, deskBank);
    const req = (await ro.post(`/api/instruments/${id}/send-to-bank`).expect(200))
      .body as BankRequestView;
    const otherBank = await Client.login(app, fx.others.bankOfficer);
    await otherBank.get(`/api/bank-requests/${req.id}`).expect(404);
    const list = (await otherBank.get('/api/bank-requests').expect(200))
      .body as Paged<BankRequestView>;
    expect(list.items.find((r) => r.id === req.id)).toBeUndefined();
    await otherBank
      .post(`/api/bank-requests/${req.id}/respond`, {
        exists: false,
        lienMarked: null,
        maturityDate: null,
        autoRenewal: null,
      })
      .expect(404);
    // Roles
    await bank.post(`/api/instruments/${id}/send-to-bank`).expect(403);
    await inst.get('/api/bank-requests').expect(403);
    await ro.get('/api/bank-requests').expect(403);
    // Their own officer can open the instrument it concerns.
    await bank.get(`/api/instruments/${id}`).expect(200);
  });
});
