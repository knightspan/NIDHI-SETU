import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

export interface Sealed {
  ciphertext: Buffer;
  iv: string; // base64
  authTag: string; // base64
}

/** AES-256-GCM with a random 96-bit IV. */
export function seal(plaintext: Buffer, keyBase64: string, aad?: string): Sealed {
  const key = Buffer.from(keyBase64, 'base64');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  if (aad) cipher.setAAD(Buffer.from(aad));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { ciphertext, iv: iv.toString('base64'), authTag: cipher.getAuthTag().toString('base64') };
}

export function open(sealed: Sealed, keyBase64: string, aad?: string): Buffer {
  const key = Buffer.from(keyBase64, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(sealed.iv, 'base64'));
  if (aad) decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(sealed.authTag, 'base64'));
  return Buffer.concat([decipher.update(sealed.ciphertext), decipher.final()]);
}

/** Compact string form for small secrets (e.g. TOTP): iv.tag.ciphertext, all base64. */
export function sealString(plain: string, keyBase64: string): string {
  const s = seal(Buffer.from(plain, 'utf8'), keyBase64);
  return `${s.iv}.${s.authTag}.${s.ciphertext.toString('base64')}`;
}

export function openString(packed: string, keyBase64: string): string {
  const [iv, authTag, ct] = packed.split('.');
  if (!iv || !authTag || !ct) throw new Error('malformed sealed string');
  return open({ iv, authTag, ciphertext: Buffer.from(ct, 'base64') }, keyBase64).toString('utf8');
}

export function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
