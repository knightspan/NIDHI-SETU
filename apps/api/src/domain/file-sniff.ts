/**
 * Detects the real file type from magic bytes, ignoring the client's claimed MIME type and
 * file extension (Section 7 · cap 10: file type sniffing).
 */
export type SniffedType = 'application/pdf' | 'image/png' | 'image/jpeg';

export const ALLOWED_TYPES: readonly SniffedType[] = ['application/pdf', 'image/png', 'image/jpeg'];

export function sniffFileType(buf: Buffer): SniffedType | null {
  if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-')
    return 'application/pdf';
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  return null;
}

/** File names are stored for display only; strip paths and control characters. */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'file';
  const cleaned = base
    .split('')
    .filter((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127)
    .join('')
    .replace(/["<>|*?:]/g, '_')
    .trim();
  return cleaned.slice(0, 150) || 'file';
}
