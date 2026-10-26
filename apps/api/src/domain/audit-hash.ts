import { createHash } from 'node:crypto';

/** Hash of the (virtual) event before the first one. */
export const GENESIS_HASH = '0'.repeat(64);

/**
 * Deterministic JSON: object keys sorted recursively, no whitespace, `undefined` dropped,
 * Dates as ISO strings, bigints as strings. Two equal events always serialise identically.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = canonicalize(v);
    }
    return out;
  }
  return value;
}

/** The part of an audit event covered by the hash. */
export interface HashableAuditEvent {
  seq: bigint | number | string;
  occurredAt: Date | string;
  actorId: string | null;
  actorRole: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  ip: string | null;
  data: unknown;
}

export function hashableView(e: HashableAuditEvent): Record<string, unknown> {
  return {
    seq: String(e.seq),
    occurredAt: e.occurredAt instanceof Date ? e.occurredAt.toISOString() : e.occurredAt,
    actorId: e.actorId,
    actorRole: e.actorRole,
    action: e.action,
    entityType: e.entityType,
    entityId: e.entityId,
    ip: e.ip,
    data: e.data ?? null,
  };
}

/** hash = sha256(prev_hash + canonical_json(event)) — Section 3.5. */
export function computeAuditHash(prevHash: string, event: HashableAuditEvent): string {
  return createHash('sha256')
    .update(prevHash + canonicalJson(hashableView(event)))
    .digest('hex');
}

export interface StoredAuditEvent extends HashableAuditEvent {
  prevHash: string;
  hash: string;
}

export type ChainBreak =
  | { seq: string; kind: 'PREV_HASH_MISMATCH'; expected: string; found: string }
  | { seq: string; kind: 'HASH_MISMATCH'; expected: string; found: string }
  | { seq: string; kind: 'SEQUENCE_GAP'; expected: string; found: string };

export interface ChainVerification {
  ok: boolean;
  checked: number;
  lastHash: string;
  breaks: ChainBreak[];
}

/**
 * Recomputes the chain. Events must be ordered by seq. `startPrevHash`/`startSeq` let the caller
 * verify in pages: pass the previous page's lastHash and the next expected seq.
 */
export function verifyAuditChain(
  events: Iterable<StoredAuditEvent>,
  startPrevHash = GENESIS_HASH,
  startSeq: bigint = 1n,
): ChainVerification {
  let prev = startPrevHash;
  let expectedSeq = startSeq;
  let checked = 0;
  const breaks: ChainBreak[] = [];

  for (const e of events) {
    const seq = BigInt(e.seq);
    if (seq !== expectedSeq) {
      breaks.push({
        seq: seq.toString(),
        kind: 'SEQUENCE_GAP',
        expected: expectedSeq.toString(),
        found: seq.toString(),
      });
    }
    if (e.prevHash !== prev) {
      breaks.push({
        seq: seq.toString(),
        kind: 'PREV_HASH_MISMATCH',
        expected: prev,
        found: e.prevHash,
      });
    }
    const recomputed = computeAuditHash(e.prevHash, e);
    if (recomputed !== e.hash) {
      breaks.push({
        seq: seq.toString(),
        kind: 'HASH_MISMATCH',
        expected: recomputed,
        found: e.hash,
      });
    }
    prev = e.hash;
    expectedSeq = seq + 1n;
    checked++;
  }
  return { ok: breaks.length === 0, checked, lastHash: prev, breaks };
}
