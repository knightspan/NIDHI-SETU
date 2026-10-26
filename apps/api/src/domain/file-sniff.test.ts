import { describe, expect, it } from 'vitest';
import { safeFileName, sniffFileType } from './file-sniff.js';

describe('sniffFileType', () => {
  it('recognises PDF, PNG and JPEG by magic bytes', () => {
    expect(sniffFileType(Buffer.from('%PDF-1.7\n...'))).toBe('application/pdf');
    expect(sniffFileType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe(
      'image/png',
    );
    expect(sniffFileType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
  });

  it('rejects anything else, whatever it claims to be', () => {
    expect(sniffFileType(Buffer.from('<html><script>alert(1)</script>'))).toBeNull();
    expect(sniffFileType(Buffer.from('MZ\x90\x00'))).toBeNull();
    expect(sniffFileType(Buffer.alloc(0))).toBeNull();
  });
});

describe('safeFileName', () => {
  it('strips directories and dangerous characters', () => {
    expect(safeFileName('../../etc/passwd')).toBe('passwd');
    expect(safeFileName('C:\\scans\\fdr "1".pdf')).toBe('fdr _1_.pdf');
    expect(safeFileName('a\u0000b.pdf')).toBe('ab.pdf');
    expect(safeFileName('')).toBe('file');
  });
});
