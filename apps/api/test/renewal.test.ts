import type { INestApplication } from '@nestjs/common';
import type { InstrumentDetail } from '@nidhisetu/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { declaration, uniquePdf } from './fixtures.js';
import { detail, toActive } from './flows.js';
import { Client, createFixture, createTestApp, type Fixture } from './helpers.js';

describe('renewal / replacement chain (PS: renewal)', () => {
  let app: INestApplication;
  let fx: Fixture;
  let bankCode: string;
  let inst: Client;
  let ro: Client;
  let bank: Client;

  /** Institution files a replacement for `oldId`, uploads its scan and submits it. */
  async function submitReplacement(
    oldId: string,
    maturityDate: string,
    issueDate: string,
  ): Promise<string> {
    const res = await inst
      .post(`/api/instruments/${oldId}/renewal`, declaration(bankCode, { issueDate, maturityDate }))
      .expect(201);
    const { id } = res.body as { id: string };
    await inst
      .upload(`/api/instruments/${id}/documents`, 'file', uniquePdf(id), 'renewal.pdf', {
        type: 'FDR_SCAN',
      })
      .expect(201);
    await inst.post(`/api/instruments/${id}/submit`).expect(200);
    return id;
  }

  /** RO scrutinises and the bank confirms the given (submitted) instrument. */
  async function confirm(id: string): Promise<void> {
    await ro.post(`/api/instruments/${id}/begin-scrutiny`).expect(200);
    let d = await detail(ro, id);
    for (const x of d.discrepancies.filter((x) => x.status === 'OPEN')) {
      await ro
        .post(`/api/discrepancies/${x.id}/close`, {
          resolution: 'WAIVED',
          note: 'Accepted for test',
        })
        .expect(200);
    }
    await ro
      .post(`/api/instruments/${id}/verify-fields`, {
        items: d.fields.map((f) => ({ field: f.field })),
      })
      .expect(200);
    await ro.post(`/api/instruments/${id}/verify`).expect(200);
    const req = (await ro.post(`/api/instruments/${id}/send-to-bank`).expect(200)).body as {
      id: string;
    };
    d = await detail(ro, id);
    await bank
      .post(`/api/bank-requests/${req.id}/respond`, {
        exists: true,
        lienMarked: true,
        maturityDate: d.maturityDate,
        autoRenewal: false,
        amount: Number(d.amount),
      })
      .expect(200);
  }

  beforeAll(async () => {
    app = await createTestApp();
    fx = await createFixture(app);
    bankCode = (await app.get(PrismaService).bank.findUniqueOrThrow({ where: { id: fx.bankId } }))
      .code;
    inst = await Client.login(app, fx.users.INSTITUTION_USER);
    ro = await Client.login(app, fx.users.RO_OFFICER);
    bank = await Client.login(app, fx.users.BANK_OFFICER);
  });
  afterAll(async () => {
    await app.close();
  });

  it('builds a three-instrument chain, closing each old one only on bank confirmation', async () => {
    const first = await toActive(inst, ro, bank, bankCode);
    expect((await detail(inst, first)).allowedActions).toContain('renew');

    const second = await submitReplacement(first, '2036-01-15', '2031-01-15');
    let old = await detail(inst, first);
    expect(old.status).toBe('RENEWAL_PENDING');
    expect(old.allowedActions).not.toContain('renew');
    // A second replacement while one is in flight is refused.
    await inst.post(`/api/instruments/${first}/renewal`, declaration(bankCode)).expect(409);

    await ro.post(`/api/instruments/${second}/begin-scrutiny`).expect(200);
    // Still pending while the replacement is only under scrutiny.
    expect((await detail(inst, first)).status).toBe('RENEWAL_PENDING');
    await ro.post(`/api/instruments/${second}/reject`, { note: 'Wrong FDR uploaded' }).expect(200);
    // Rejected replacement → old instrument active again, and a new attempt is allowed.
    old = await detail(inst, first);
    expect(old.status).toBe('ACTIVE');
    expect(old.transitions.map((t) => t.to).slice(-2)).toEqual(['RENEWAL_PENDING', 'ACTIVE']);

    const secondAgain = await submitReplacement(first, '2036-01-15', '2031-01-15');
    await confirm(secondAgain);
    old = await detail(inst, first);
    expect(old.status).toBe('RENEWED');
    expect(old.validityStatus).toBeNull();
    expect(old.replacedBy?.id).toBe(secondAgain);

    const third = await submitReplacement(secondAgain, '2041-01-15', '2036-01-15');
    await confirm(third);
    const d: InstrumentDetail = await detail(inst, third);
    expect(d.status).toBe('ACTIVE');
    expect(d.chain.map((c) => [c.id, c.status])).toEqual([
      [first, 'RENEWED'],
      [secondAgain, 'RENEWED'],
      [third, 'ACTIVE'],
    ]);
    // The chain looks the same from the oldest instrument.
    expect((await detail(inst, first)).chain.map((c) => c.id)).toEqual([first, secondAgain, third]);
  });

  it('only allows renewing your own ACTIVE instrument', async () => {
    const active = await toActive(inst, ro, bank, bankCode);
    const other = await Client.login(app, fx.others.institutionUser);
    await other.post(`/api/instruments/${active}/renewal`, declaration(bankCode)).expect(404);
    await ro.post(`/api/instruments/${active}/renewal`, declaration(bankCode)).expect(403);
    const { id: draft } = (await inst.post('/api/instruments', declaration(bankCode)).expect(201))
      .body as { id: string };
    await inst.post(`/api/instruments/${draft}/renewal`, declaration(bankCode)).expect(409);
  });
});
