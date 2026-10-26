import { describe, expect, it } from 'vitest';
import { csvCell, toCsv } from './reports.service.js';

describe('CSV export', () => {
  it('quotes commas, quotes and newlines', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line\nbreak')).toBe('"line\nbreak"');
    expect(csvCell(null)).toBe('');
    expect(csvCell(12.5)).toBe('12.5');
  });

  it('neutralises spreadsheet formula injection', () => {
    expect(csvCell('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell(-5)).toBe('-5'); // real numbers are left alone
  });

  it('writes a BOM, header and rows', () => {
    const csv = toCsv({
      title: 't',
      subtitle: 's',
      columns: [
        { key: 'a', label: 'A' },
        { key: 'b', label: 'B' },
      ],
      rows: [{ a: 1, b: 'x' }],
    });
    expect(csv).toBe('﻿A,B\r\n1,x\r\n');
  });
});
