import { describe, expect, it } from 'vitest';
import {
  ScopeMisconfiguredError,
  bankRequestScope,
  institutionScope,
  instrumentScope,
  type Principal,
} from './scope.js';

const base: Principal = {
  id: 'u',
  role: 'AUDITOR',
  regionId: null,
  institutionId: null,
  bankId: null,
};

describe('instrumentScope', () => {
  it('is unrestricted for national roles', () => {
    for (const role of [
      'BUREAU_OFFICER',
      'COMPETENT_AUTHORITY',
      'FINANCE_OFFICER',
      'AUDITOR',
    ] as const) {
      expect(instrumentScope({ ...base, role })).toEqual({});
    }
  });

  it('restricts institution users to their institution', () => {
    expect(instrumentScope({ ...base, role: 'INSTITUTION_USER', institutionId: 'i1' })).toEqual({
      institutionId: 'i1',
    });
  });

  it('restricts regional officers to their region', () => {
    expect(instrumentScope({ ...base, role: 'RO_OFFICER', regionId: 'r1' })).toEqual({
      institution: { regionId: 'r1' },
    });
  });

  it('restricts bank officers to instruments sent to their bank', () => {
    expect(instrumentScope({ ...base, role: 'BANK_OFFICER', bankId: 'b1' })).toEqual({
      bankRequests: { some: { bankId: 'b1' } },
    });
    expect(bankRequestScope({ ...base, role: 'BANK_OFFICER', bankId: 'b1' })).toEqual({
      bankId: 'b1',
    });
  });

  it('gives the system admin no access to financial records', () => {
    expect(instrumentScope({ ...base, role: 'SYS_ADMIN' })).toHaveProperty('id');
    expect(institutionScope({ ...base, role: 'SYS_ADMIN' })).toHaveProperty('id');
  });

  it('fails closed when the account lacks its scope attribute', () => {
    expect(() => instrumentScope({ ...base, role: 'RO_OFFICER' })).toThrow(ScopeMisconfiguredError);
    expect(() => instrumentScope({ ...base, role: 'INSTITUTION_USER' })).toThrow(
      ScopeMisconfiguredError,
    );
    expect(() => bankRequestScope({ ...base, role: 'BANK_OFFICER' })).toThrow(
      ScopeMisconfiguredError,
    );
  });

  it('scopes institutions for regional officers and institution users', () => {
    expect(institutionScope({ ...base, role: 'RO_OFFICER', regionId: 'r1' })).toEqual({
      regionId: 'r1',
    });
    expect(institutionScope({ ...base, role: 'INSTITUTION_USER', institutionId: 'i1' })).toEqual({
      id: 'i1',
    });
    expect(bankRequestScope({ ...base, role: 'RO_OFFICER', regionId: 'r1' })).toEqual({
      instrument: { institution: { regionId: 'r1' } },
    });
  });
});
