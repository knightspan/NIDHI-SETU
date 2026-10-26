import { describe, expect, it } from 'vitest';
import {
  GENESIS_HASH,
  canonicalJson,
  computeAuditHash,
  verifyAuditChain,
  type StoredAuditEvent,
} from './audit-hash.js';

function buildChain(n: number): StoredAuditEvent[] {
  const out: StoredAuditEvent[] = [];
  let prev = GENESIS_HASH;
  for (let i = 1; i <= n; i++) {
    const base = {
      seq: BigInt(i),
      occurredAt: new Date(Date.UTC(2026, 0, i)),
      actorId: null,
      actorRole: 'SYSTEM',
      action: 'test.event',
      entityType: 'Test',
      entityId: String(i),
      ip: null,
      data: { i, nested: { b: 2, a: 1 } },
    };
    const hash = computeAuditHash(prev, base);
    out.push({ ...base, prevHash: prev, hash });
    prev = hash;
  }
  return out;
}

describe('canonicalJson', () => {
  it('sorts keys recursively and drops undefined', () => {
    expect(canonicalJson({ b: 1, a: { d: undefined, c: [3, { z: 1, y: 2 }] } })).toBe(
      '{"a":{"c":[3,{"y":2,"z":1}]},"b":1}',
    );
  });

  it('serialises dates and bigints deterministically', () => {
    expect(canonicalJson({ t: new Date('2026-01-01T00:00:00Z'), n: 5n })).toBe(
      '{"n":"5","t":"2026-01-01T00:00:00.000Z"}',
    );
  });
});

describe('verifyAuditChain', () => {
  it('accepts an intact chain', () => {
    const r = verifyAuditChain(buildChain(20));
    expect(r.ok).toBe(true);
    expect(r.checked).toBe(20);
  });

  it('detects a tampered payload', () => {
    const chain = buildChain(10);
    chain[4] = { ...chain[4]!, data: { i: 999 } };
    const r = verifyAuditChain(chain);
    expect(r.ok).toBe(false);
    expect(r.breaks[0]).toMatchObject({ seq: '5', kind: 'HASH_MISMATCH' });
  });

  it('detects a deleted row', () => {
    const chain = buildChain(10);
    chain.splice(3, 1);
    const r = verifyAuditChain(chain);
    expect(r.ok).toBe(false);
    expect(r.breaks.map((b) => b.kind)).toContain('SEQUENCE_GAP');
    expect(r.breaks.map((b) => b.kind)).toContain('PREV_HASH_MISMATCH');
  });

  it('detects a recomputed-but-relinked row (hash rewritten without fixing successors)', () => {
    const chain = buildChain(5);
    const forged = { ...chain[1]!, data: { forged: true } };
    forged.hash = computeAuditHash(forged.prevHash, forged);
    chain[1] = forged;
    const r = verifyAuditChain(chain);
    expect(r.ok).toBe(false);
    expect(r.breaks[0]).toMatchObject({ seq: '3', kind: 'PREV_HASH_MISMATCH' });
  });

  it('verifies in pages', () => {
    const chain = buildChain(10);
    const first = verifyAuditChain(chain.slice(0, 6));
    const second = verifyAuditChain(chain.slice(6), first.lastHash, 7n);
    expect(first.ok && second.ok).toBe(true);
  });
});
