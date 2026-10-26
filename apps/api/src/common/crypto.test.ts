import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { open, openString, safeEqual, seal, sealString, sha256Hex } from './crypto.js';

const key = randomBytes(32).toString('base64');

describe('crypto helpers', () => {
  it('round-trips AES-GCM', () => {
    const s = seal(Buffer.from('fixed deposit receipt'), key);
    expect(s.ciphertext.toString()).not.toContain('fixed');
    expect(open(s, key).toString()).toBe('fixed deposit receipt');
  });

  it('rejects a tampered ciphertext', () => {
    const s = seal(Buffer.from('hello'), key);
    s.ciphertext[0] = s.ciphertext[0]! ^ 0xff;
    expect(() => open(s, key)).toThrow();
  });

  it('round-trips sealed strings', () => {
    expect(openString(sealString('JBSWY3DPEHPK3PXP', key), key)).toBe('JBSWY3DPEHPK3PXP');
  });

  it('hashes and compares safely', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(safeEqual('a', 'a')).toBe(true);
    expect(safeEqual('a', 'ab')).toBe(false);
  });
});
