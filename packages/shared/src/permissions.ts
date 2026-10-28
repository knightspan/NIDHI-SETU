import type { Role } from './enums.js';

/**
 * Permission matrix (Section 5). The API guard checks these; the web app uses them only to hide
 * controls. Data scoping (own institution / region / bank) is enforced separately at query level.
 */
export const PERMISSIONS = {
  // Repository
  'instrument:read': [
    'INSTITUTION_USER',
    'RO_OFFICER',
    'BUREAU_OFFICER',
    'COMPETENT_AUTHORITY',
    'FINANCE_OFFICER',
    'AUDITOR',
  ],
  'instrument:write_own': ['INSTITUTION_USER'],
  'institution:read': [
    'INSTITUTION_USER',
    'RO_OFFICER',
    'BUREAU_OFFICER',
    'COMPETENT_AUTHORITY',
    'FINANCE_OFFICER',
    'AUDITOR',
  ],
  // Documents
  'document:upload': ['INSTITUTION_USER', 'RO_OFFICER', 'BANK_OFFICER'],
  'document:read': [
    'INSTITUTION_USER',
    'RO_OFFICER',
    'BUREAU_OFFICER',
    'COMPETENT_AUTHORITY',
    'FINANCE_OFFICER',
    'BANK_OFFICER',
    'AUDITOR',
  ],
  // Scrutiny & discrepancies
  'scrutiny:act': ['RO_OFFICER'],
  'discrepancy:read': [
    'INSTITUTION_USER',
    'RO_OFFICER',
    'BUREAU_OFFICER',
    'COMPETENT_AUTHORITY',
    'AUDITOR',
  ],
  'discrepancy:respond': ['INSTITUTION_USER'],
  'discrepancy:manage': ['RO_OFFICER'],
  // Bank confirmation
  'bank:request': ['RO_OFFICER'],
  'bank:respond': ['BANK_OFFICER'],
  // Renewal & release
  'renewal:submit': ['INSTITUTION_USER'],
  'release:request': ['INSTITUTION_USER'],
  'release:recommend': ['RO_OFFICER', 'BUREAU_OFFICER'],
  'release:approve': ['COMPETENT_AUTHORITY'],
  'release:execute': ['FINANCE_OFFICER'],
  'forfeiture:propose': ['RO_OFFICER', 'BUREAU_OFFICER'],
  'forfeiture:approve': ['COMPETENT_AUTHORITY'],
  'forfeiture:execute': ['FINANCE_OFFICER'],
  'tax:upload': ['INSTITUTION_USER'],
  // Oversight
  'dashboard:read': [
    'INSTITUTION_USER',
    'RO_OFFICER',
    'BUREAU_OFFICER',
    'COMPETENT_AUTHORITY',
    'FINANCE_OFFICER',
    'BANK_OFFICER',
    'AUDITOR',
    'SYS_ADMIN',
  ],
  'report:read': [
    'RO_OFFICER',
    'BUREAU_OFFICER',
    'COMPETENT_AUTHORITY',
    'FINANCE_OFFICER',
    'AUDITOR',
  ],
  'metrics:read': ['BUREAU_OFFICER', 'COMPETENT_AUTHORITY', 'AUDITOR', 'SYS_ADMIN'],
  'metrics:baseline': ['SYS_ADMIN'],
  'escalation:read': ['RO_OFFICER', 'BUREAU_OFFICER', 'COMPETENT_AUTHORITY', 'AUDITOR'],
  'legacy:upload': ['RO_OFFICER'],
  // Administration
  'rule:read': [
    'RO_OFFICER',
    'BUREAU_OFFICER',
    'COMPETENT_AUTHORITY',
    'FINANCE_OFFICER',
    'AUDITOR',
    'SYS_ADMIN',
  ],
  'rule:manage': ['SYS_ADMIN'],
  'user:manage': ['SYS_ADMIN'],
  'clock:manage': ['SYS_ADMIN'],
  'master:manage': ['SYS_ADMIN'],
  'audit:read': ['AUDITOR', 'SYS_ADMIN'],
  'audit:verify': ['AUDITOR', 'SYS_ADMIN'],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function hasPermission(role: Role, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}

export function permissionsFor(role: Role): Permission[] {
  return (Object.keys(PERMISSIONS) as Permission[]).filter((p) => hasPermission(role, p));
}

/** Data visibility scope of each role, enforced at query level by the API. */
export type ScopeKind = 'INSTITUTION' | 'REGION' | 'BANK' | 'NATIONAL' | 'NONE';

export const ROLE_SCOPE: Record<Role, ScopeKind> = {
  INSTITUTION_USER: 'INSTITUTION',
  RO_OFFICER: 'REGION',
  BUREAU_OFFICER: 'NATIONAL',
  COMPETENT_AUTHORITY: 'NATIONAL',
  FINANCE_OFFICER: 'NATIONAL',
  BANK_OFFICER: 'BANK',
  AUDITOR: 'NATIONAL',
  // Admin manages users, rules and master data but sees no financial records.
  SYS_ADMIN: 'NONE',
};
