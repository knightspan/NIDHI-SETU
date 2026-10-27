import { ROLE_SCOPE, type Role } from '@nidhisetu/shared';

/** The authenticated principal, as carried in the access token. */
export interface Principal {
  id: string;
  role: Role;
  regionId: string | null;
  institutionId: string | null;
  bankId: string | null;
  /** A temporary password is in use: only the change-password flow is allowed. */
  mustChangePassword?: boolean;
}

/** Thrown when a principal's account is missing the attribute its scope needs. */
export class ScopeMisconfiguredError extends Error {}

/** A filter that matches nothing (UUID columns never equal this sentinel). */
const NOTHING = '00000000-0000-0000-0000-000000000000';

/**
 * Query-level data scoping (Section 5): every repository query for instruments is AND-ed with
 * this filter, so a user can never read outside their institution / region / bank, whatever the UI
 * sends. Returned as a plain object compatible with Prisma's `InstrumentWhereInput`.
 */
export function instrumentScope(p: Principal): Record<string, unknown> {
  switch (ROLE_SCOPE[p.role]) {
    case 'NATIONAL':
      return {};
    case 'INSTITUTION':
      if (!p.institutionId)
        throw new ScopeMisconfiguredError('institution user without institution');
      return { institutionId: p.institutionId };
    case 'REGION':
      if (!p.regionId) throw new ScopeMisconfiguredError('regional officer without region');
      return { institution: { regionId: p.regionId } };
    case 'BANK':
      if (!p.bankId) throw new ScopeMisconfiguredError('bank officer without bank');
      // Bank officers see only instruments they have been asked to confirm.
      return { bankRequests: { some: { bankId: p.bankId } } };
    case 'NONE':
      return { id: NOTHING };
  }
}

/** Institution-level scoping, same rules. */
export function institutionScope(p: Principal): Record<string, unknown> {
  switch (ROLE_SCOPE[p.role]) {
    case 'NATIONAL':
      return {};
    case 'INSTITUTION':
      if (!p.institutionId)
        throw new ScopeMisconfiguredError('institution user without institution');
      return { id: p.institutionId };
    case 'REGION':
      if (!p.regionId) throw new ScopeMisconfiguredError('regional officer without region');
      return { regionId: p.regionId };
    case 'BANK':
    case 'NONE':
      return { id: NOTHING };
  }
}

/** Bank confirmation requests: bank officers see only their own bank's queue. */
export function bankRequestScope(p: Principal): Record<string, unknown> {
  if (ROLE_SCOPE[p.role] === 'BANK') {
    if (!p.bankId) throw new ScopeMisconfiguredError('bank officer without bank');
    return { bankId: p.bankId };
  }
  return { instrument: instrumentScope(p) };
}
