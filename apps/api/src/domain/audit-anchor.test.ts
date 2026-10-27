import { describe, expect, it } from 'vitest';
import { checkAnchors, signAnchor, type AnchorRecord } from './audit-anchor.js';

const KEY = 'k'.repeat(32);
const anchor = (id: number, seq: bigint, hash: string): AnchorRecord => ({
  id,
  seq,
  hash,
  signature: signAnchor(KEY, id, seq, hash),
});

describe('audit anchors', () => {
  it('pass while the chain still holds the anchored hashes', () => {
    const anchors = [anchor(1, 10n, 'aa'), anchor(2, 20n, 'bb')];
    expect(
      checkAnchors(
        anchors,
        new Map([
          [10n, 'aa'],
          [20n, 'bb'],
        ]),
        KEY,
      ),
    ).toEqual([]);
  });

  it('catch a rewritten chain (hashes recomputed after an edit)', () => {
    const b = checkAnchors(
      [anchor(1, 10n, 'aa'), anchor(2, 20n, 'bb')],
      new Map([
        [10n, 'aa'],
        [20n, 'cc'],
      ]),
      KEY,
    );
    expect(b).toEqual([{ seq: '20', kind: 'ANCHOR_MISMATCH', expected: 'bb', found: 'cc' }]);
  });

  it('catch deleted events and anchors re-signed without the key', () => {
    expect(checkAnchors([anchor(1, 10n, 'aa')], new Map(), KEY)[0]!.kind).toBe('ANCHOR_MISMATCH');
    const forged = { ...anchor(1, 10n, 'aa'), hash: 'zz' };
    expect(checkAnchors([forged], new Map([[10n, 'zz']]), KEY)[0]!.kind).toBe('ANCHOR_FORGED');
    const wrongKey = {
      id: 1,
      seq: 10n,
      hash: 'aa',
      signature: signAnchor('x'.repeat(32), 1, 10n, 'aa'),
    };
    expect(checkAnchors([wrongKey], new Map([[10n, 'aa']]), KEY)[0]!.kind).toBe('ANCHOR_FORGED');
  });
});
