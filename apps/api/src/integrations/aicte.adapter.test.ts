import { describe, expect, it } from 'vitest';
import { compareMaster, type AicteInstitutionRecord } from './aicte.adapter.js';

const portal: AicteInstitutionRecord = {
  aicteId: 'AICTE-DEMO-0007',
  name: 'Example Institute (Fictional)',
  trustName: 'Example Trust',
  state: 'Maharashtra',
  regionCode: 'WRO',
  yearEstablished: 2010,
  programmes: ['UG_ENGINEERING', 'MCA'],
  approvalStatus: 'APPROVED',
};

describe('compareMaster', () => {
  it('finds no differences when the master matches (programme order ignored)', () => {
    expect(compareMaster(portal, { ...portal, programmes: ['MCA', 'UG_ENGINEERING'] })).toEqual([]);
  });

  it('reports drifted fields', () => {
    const d = compareMaster(portal, { ...portal, state: 'Goa', programmes: ['UG_ENGINEERING'] });
    expect(d).toEqual([
      { field: 'state', portal: 'Maharashtra', local: 'Goa' },
      { field: 'programmes', portal: 'MCA, UG_ENGINEERING', local: 'UG_ENGINEERING' },
    ]);
  });
});
