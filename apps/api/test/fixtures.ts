import type { InstrumentDeclarationInput } from '@nidhisetu/shared';

let n = 0;

/** A valid declaration with a unique FDR number. */
export function declaration(
  bankCode: string,
  overrides: Partial<InstrumentDeclarationInput> = {},
): InstrumentDeclarationInput {
  n++;
  return {
    type: 'FDR',
    bankCode,
    branch: 'Test Branch',
    ifsc: `${bankCode}0001234`,
    fdrNumber: `FDR${Date.now().toString(36).toUpperCase()}${n}`,
    amount: 1_500_000,
    issueDate: '2026-01-15',
    maturityDate: '2031-01-15',
    depositorNames: ['AICTE', 'Test Trust'],
    lienMarked: true,
    autoRenewal: false,
    ...overrides,
  };
}

/** Minimal byte payloads that pass magic-byte sniffing. */
export const PDF = Buffer.from('%PDF-1.4\n% NidhiSetu test document\n%%EOF\n');
export const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
export function uniquePdf(tag: string): Buffer {
  return Buffer.from(`%PDF-1.4\n% ${tag} ${Math.random()}\n%%EOF\n`);
}
