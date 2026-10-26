import type { InstrumentDeclarationInput, InstrumentDetail } from '@nidhisetu/shared';
import { expect } from 'vitest';
import { declaration, uniquePdf } from './fixtures.js';
import type { Client } from './helpers.js';

export async function detail(c: Client, id: string): Promise<InstrumentDetail> {
  return (await c.get(`/api/instruments/${id}`).expect(200)).body as InstrumentDetail;
}

/** Institution declares + uploads a scan + submits. */
export async function submitInstrument(
  inst: Client,
  bankCode: string,
  overrides: Partial<InstrumentDeclarationInput> = {},
): Promise<string> {
  const { id } = (await inst.post('/api/instruments', declaration(bankCode, overrides)).expect(201))
    .body as { id: string };
  await inst
    .upload(`/api/instruments/${id}/documents`, 'file', uniquePdf(id), 'scan.pdf', {
      type: 'FDR_SCAN',
    })
    .expect(201);
  await inst.post(`/api/instruments/${id}/submit`).expect(200);
  return id;
}

/** Takes an instrument through scrutiny to OFFICER_VERIFIED (waiving anything auto-raised). */
export async function toOfficerVerified(
  inst: Client,
  ro: Client,
  bankCode: string,
  overrides: Partial<InstrumentDeclarationInput> = {},
): Promise<string> {
  const id = await submitInstrument(inst, bankCode, overrides);
  await ro.post(`/api/instruments/${id}/begin-scrutiny`).expect(200);
  const d = await detail(ro, id);
  for (const x of d.discrepancies.filter((x) => x.status === 'OPEN' || x.status === 'RESPONDED')) {
    await ro
      .post(`/api/discrepancies/${x.id}/close`, { resolution: 'WAIVED', note: 'Accepted for test' })
      .expect(200);
  }
  await ro
    .post(`/api/instruments/${id}/verify-fields`, {
      items: d.fields.map((f) => ({ field: f.field })),
    })
    .expect(200);
  await ro.post(`/api/instruments/${id}/verify`).expect(200);
  expect((await detail(ro, id)).status).toBe('OFFICER_VERIFIED');
  return id;
}

/** All the way to ACTIVE through the bank desk. */
export async function toActive(
  inst: Client,
  ro: Client,
  bank: Client,
  bankCode: string,
  overrides: Partial<InstrumentDeclarationInput> = {},
): Promise<string> {
  const id = await toOfficerVerified(inst, ro, bankCode, overrides);
  const req = (await ro.post(`/api/instruments/${id}/send-to-bank`).expect(200)).body as {
    id: string;
  };
  const d = await detail(ro, id);
  await bank
    .post(`/api/bank-requests/${req.id}/respond`, {
      exists: true,
      lienMarked: true,
      maturityDate: d.maturityDate,
      autoRenewal: d.autoRenewal,
      amount: Number(d.amount),
    })
    .expect(200);
  expect((await detail(ro, id)).status).toBe('ACTIVE');
  return id;
}
