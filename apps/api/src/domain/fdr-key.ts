/**
 * Canonical key for duplicate-FDR detection. Separators, case and the characters OCR and people
 * most often confuse (O/0, I/L/1, S/5, B/8, Z/2) are folded together, so "SBI/FD/2026/1O4211" and
 * "sbi fd 2026 104211" at the same bank are recognised as the same receipt.
 */
const CONFUSABLE: Record<string, string> = {
  O: '0',
  Q: '0',
  D: '0',
  I: '1',
  L: '1',
  S: '5',
  B: '8',
  Z: '2',
};

export function fdrKey(bankCode: string | null, fdrNumber: string | null): string | null {
  if (!bankCode || !fdrNumber) return null;
  const folded = fdrNumber
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .replace(/[OQDILSBZ]/g, (c) => CONFUSABLE[c]!);
  return folded ? `${bankCode.toUpperCase()}:${folded}` : null;
}
