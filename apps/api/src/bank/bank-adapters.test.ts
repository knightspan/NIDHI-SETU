import { describe, expect, it } from 'vitest';
import {
  BankApiError,
  BankDeskAdapter,
  MockBankApiAdapter,
  type BankConfirmationQuery,
} from './bank-adapters.js';

const q = (fdrNumber: string): BankConfirmationQuery => ({
  requestId: '1234567890abcdef',
  bankCode: 'HDFC',
  fdrNumber,
  ifsc: 'HDFC0001234',
  amount: '500000.00',
  maturityDate: '2031-03-31',
  depositorNames: 'AICTE; TRUST',
});

describe('bank adapters', () => {
  it('desk adapter leaves the request pending for a human', async () => {
    expect(await new BankDeskAdapter().submit()).toEqual({ kind: 'pending' });
  });

  it('mock API echoes AICTE values for an ordinary FDR', async () => {
    const r = await new MockBankApiAdapter({ latencyMs: 0, failureRate: 0 }).submit(q('FD100'));
    expect(r).toMatchObject({
      kind: 'answered',
      response: { exists: true, lienMarked: true, maturityDate: '2031-03-31', amount: 500000 },
    });
  });

  it('mock API honours the demo trap numbers', async () => {
    const api = new MockBankApiAdapter({ latencyMs: 0, failureRate: 0 });
    expect(
      (await api.submit(q('X-NOTFOUND-1'))) as { response: { exists: boolean } },
    ).toMatchObject({ response: { exists: false } });
    expect(await api.submit(q('X-NOLIEN-1'))).toMatchObject({ response: { lienMarked: false } });
    expect(await api.submit(q('X-EARLY-1'))).toMatchObject({
      response: { maturityDate: '2030-03-31' },
    });
  });

  it('mock API fails at the configured rate, with a retryable error', async () => {
    const api = new MockBankApiAdapter({ latencyMs: 0, failureRate: 0.5, random: () => 0.1 });
    await expect(api.submit(q('FD1'))).rejects.toBeInstanceOf(BankApiError);
    const ok = new MockBankApiAdapter({ latencyMs: 0, failureRate: 0.5, random: () => 0.9 });
    await expect(ok.submit(q('FD1'))).resolves.toMatchObject({ kind: 'answered' });
  });

  it('mock API simulates latency', async () => {
    const started = Date.now();
    await new MockBankApiAdapter({ latencyMs: 60, failureRate: 0 }).submit(q('FD1'));
    expect(Date.now() - started).toBeGreaterThanOrEqual(55);
  });
});
