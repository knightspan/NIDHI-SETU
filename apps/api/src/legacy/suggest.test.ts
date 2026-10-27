import type { OcrPreview } from '@nidhisetu/shared';
import { describe, expect, it } from 'vitest';
import { suggestInstitution } from './legacy.service.js';

const inst = [
  {
    id: '1',
    name: 'Shiksha Institute of Technology (Fictional)',
    aicteId: 'A-1',
    trustName: 'Shiksha Educational Trust',
  },
  { id: '2', name: 'Vidya College', aicteId: 'A-2', trustName: 'Vidya Society' },
];
const ocr = (names: string): OcrPreview => ({
  fields: { depositorNames: names },
  confidence: {},
  lowConfidence: [],
  rawText: '',
  engine: 'x',
});

describe('suggestInstitution', () => {
  it('matches the trust named alongside AICTE', () => {
    expect(suggestInstitution(ocr('AICTE; SHIKSHA EDUCATIONAL TRUST'), inst)?.id).toBe('1');
    expect(suggestInstitution(ocr('AICTE; VIDYA COLLEGE'), inst)?.id).toBe('2');
  });
  it('returns null when nothing or more than one matches', () => {
    expect(suggestInstitution(ocr('AICTE'), inst)).toBeNull();
    expect(suggestInstitution(ocr('AICTE; SOMEONE ELSE'), inst)).toBeNull();
  });
});
