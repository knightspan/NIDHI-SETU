import { MFA_MANDATORY_ROLES } from '@nidhisetu/shared';
import { describe, expect, it } from 'vitest';
import { mfaRequiredFor } from './config.js';

describe('MFA policy', () => {
  it('always requires MFA for officer roles', () => {
    for (const r of MFA_MANDATORY_ROLES)
      expect(
        mfaRequiredFor(
          r,
          { DEMO_MODE: true, MFA_REQUIRED_ALL_ROLES: 'false' },
          MFA_MANDATORY_ROLES,
        ),
      ).toBe(true);
  });
  it('requires it for institutions outside demo mode, unless explicitly turned off', () => {
    const r = 'INSTITUTION_USER';
    expect(
      mfaRequiredFor(
        r,
        { DEMO_MODE: false, MFA_REQUIRED_ALL_ROLES: undefined },
        MFA_MANDATORY_ROLES,
      ),
    ).toBe(true);
    expect(
      mfaRequiredFor(
        r,
        { DEMO_MODE: true, MFA_REQUIRED_ALL_ROLES: undefined },
        MFA_MANDATORY_ROLES,
      ),
    ).toBe(false);
    expect(
      mfaRequiredFor(r, { DEMO_MODE: true, MFA_REQUIRED_ALL_ROLES: 'true' }, MFA_MANDATORY_ROLES),
    ).toBe(true);
    expect(
      mfaRequiredFor(r, { DEMO_MODE: false, MFA_REQUIRED_ALL_ROLES: 'false' }, MFA_MANDATORY_ROLES),
    ).toBe(false);
  });
});
