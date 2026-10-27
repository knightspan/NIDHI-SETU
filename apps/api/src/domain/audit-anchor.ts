import { createHmac, timingSafeEqual } from 'node:crypto';
import type { ChainBreak } from './audit-hash.js';

/**
 * Audit anchors (defence against rewriting the whole chain). Periodically the head of the chain is
 * signed with a key that is NOT stored in the database and the signed anchor is also sent to the
 * auditors. Someone with full database access can edit an event and recompute every later hash, but
 * cannot produce a valid signature for the new hashes — so every anchor after the edit stops matching.
 */
export interface AnchorRecord {
  id: number;
  seq: bigint;
  hash: string;
  signature: string;
}

export function signAnchor(key: string, n: number, seq: bigint, hash: string): string {
  return createHmac('sha256', key).update(`nidhisetu-anchor|${n}|${seq}|${hash}`).digest('hex');
}

function sameHex(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Checks each anchor's signature and that the chain still has the anchored hash at that seq. */
export function checkAnchors(
  anchors: readonly AnchorRecord[],
  hashAt: ReadonlyMap<bigint, string>,
  key: string,
): ChainBreak[] {
  const breaks: ChainBreak[] = [];
  for (const a of anchors) {
    const expectedSig = signAnchor(key, a.id, a.seq, a.hash);
    if (!sameHex(expectedSig, a.signature)) {
      breaks.push({
        seq: a.seq.toString(),
        kind: 'ANCHOR_FORGED',
        expected: expectedSig,
        found: a.signature,
      });
      continue;
    }
    const current = hashAt.get(a.seq) ?? '(event missing)';
    if (current !== a.hash) {
      breaks.push({
        seq: a.seq.toString(),
        kind: 'ANCHOR_MISMATCH',
        expected: a.hash,
        found: current,
      });
    }
  }
  return breaks;
}
