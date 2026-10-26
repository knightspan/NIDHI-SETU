import type { BankChannel, BankResponse } from '@nidhisetu/shared';

/** What AICTE asks the bank about one instrument. */
export interface BankConfirmationQuery {
  requestId: string;
  bankCode: string;
  fdrNumber: string;
  ifsc: string | null;
  amount: string | null;
  maturityDate: string | null;
  depositorNames: string | null;
}

export type BankSubmitResult =
  { kind: 'pending' } | { kind: 'answered'; response: BankResponse; reference: string };

/**
 * Integration seam for bank verification (Section 3.2, docs/INTEGRATION.md). A real bank API or an
 * NeSL-style registry is one more implementation of this interface.
 */
export interface BankVerificationAdapter {
  readonly channel: BankChannel;
  submit(query: BankConfirmationQuery): Promise<BankSubmitResult>;
}

export class BankApiError extends Error {
  constructor(
    message: string,
    readonly retryable = true,
  ) {
    super(message);
    this.name = 'BankApiError';
  }
}

/** Manual flow: the request waits on the bank officer's desk. */
export class BankDeskAdapter implements BankVerificationAdapter {
  readonly channel = 'DESK' as const;

  submit(): Promise<BankSubmitResult> {
    return Promise.resolve({ kind: 'pending' });
  }
}

/**
 * Simulated bank API with configurable latency and failure rate. It behaves like an honest bank
 * ledger: it echoes AICTE's values back, except for fictional "trap" FDR numbers used in the demo:
 *   …NOTFOUND… → the FDR does not exist
 *   …NOLIEN…   → the lien is not marked for AICTE
 *   …EARLY…    → the bank's maturity date is one year earlier
 */
export class MockBankApiAdapter implements BankVerificationAdapter {
  readonly channel = 'MOCK_API' as const;

  constructor(
    private readonly opts: { latencyMs: number; failureRate: number; random?: () => number },
  ) {}

  async submit(q: BankConfirmationQuery): Promise<BankSubmitResult> {
    if (this.opts.latencyMs > 0) await new Promise((r) => setTimeout(r, this.opts.latencyMs));
    const rnd = this.opts.random ?? Math.random;
    if (rnd() < this.opts.failureRate)
      throw new BankApiError(`Bank ${q.bankCode} API timed out (simulated)`);

    const fdr = q.fdrNumber.toUpperCase();
    const reference = `MOCK-${q.bankCode}-${q.requestId.slice(0, 8).toUpperCase()}`;
    if (fdr.includes('NOTFOUND')) {
      return {
        kind: 'answered',
        reference,
        response: {
          exists: false,
          lienMarked: null,
          maturityDate: null,
          autoRenewal: null,
          remarks: 'No such deposit (simulated)',
        },
      };
    }
    let maturity = q.maturityDate;
    if (maturity && fdr.includes('EARLY'))
      maturity = `${Number(maturity.slice(0, 4)) - 1}${maturity.slice(4)}`;
    return {
      kind: 'answered',
      reference,
      response: {
        exists: true,
        lienMarked: !fdr.includes('NOLIEN'),
        maturityDate: maturity,
        autoRenewal: false,
        amount: q.amount ? Number(q.amount) : null,
        remarks: 'Confirmed by simulated bank API',
        reference,
      },
    };
  }
}
