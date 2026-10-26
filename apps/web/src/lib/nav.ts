import type { Me, Permission } from '@nidhisetu/shared';
import {
  AlertTriangle,
  Archive,
  Bell,
  BookOpenCheck,
  Building2,
  ClipboardCheck,
  Clock,
  FileBarChart,
  FilePlus2,
  FileStack,
  Gauge,
  HandCoins,
  Landmark,
  LayoutDashboard,
  RefreshCw,
  ScrollText,
  ShieldAlert,
  Users,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  href: string;
  key: string; // messages key under "nav"
  icon: LucideIcon;
  /** Shown when the user holds any of these permissions (empty = everyone). */
  anyOf: Permission[];
  /** Optional extra predicate (e.g. role-specific entries). */
  when?: (me: Me) => boolean;
  section: 'work' | 'oversight' | 'admin';
}

export const NAV: NavItem[] = [
  { href: '/dashboard', key: 'dashboard', icon: LayoutDashboard, anyOf: [], section: 'work' },
  {
    href: '/instruments',
    key: 'instruments',
    icon: FileStack,
    anyOf: ['instrument:read'],
    section: 'work',
  },
  {
    href: '/instruments/new',
    key: 'newInstrument',
    icon: FilePlus2,
    anyOf: ['instrument:write_own'],
    section: 'work',
  },
  {
    href: '/scrutiny',
    key: 'scrutiny',
    icon: ClipboardCheck,
    anyOf: ['scrutiny:act'],
    section: 'work',
  },
  {
    href: '/discrepancies',
    key: 'discrepancies',
    icon: AlertTriangle,
    anyOf: ['discrepancy:read'],
    section: 'work',
  },
  { href: '/bank-desk', key: 'bankDesk', icon: Landmark, anyOf: ['bank:respond'], section: 'work' },
  {
    href: '/renewals',
    key: 'renewals',
    icon: RefreshCw,
    anyOf: ['instrument:read'],
    section: 'work',
  },
  {
    href: '/releases',
    key: 'releases',
    icon: HandCoins,
    anyOf: [
      'release:request',
      'release:recommend',
      'release:approve',
      'release:execute',
      'instrument:read',
    ],
    section: 'work',
  },
  { href: '/legacy', key: 'legacy', icon: Archive, anyOf: ['legacy:upload'], section: 'work' },
  { href: '/notifications', key: 'notifications', icon: Bell, anyOf: [], section: 'work' },
  {
    href: '/institutions',
    key: 'institutions',
    icon: Building2,
    anyOf: ['institution:read'],
    when: (me) => me.role !== 'INSTITUTION_USER',
    section: 'oversight',
  },
  {
    href: '/escalations',
    key: 'escalations',
    icon: ShieldAlert,
    anyOf: ['escalation:read'],
    section: 'oversight',
  },
  {
    href: '/reports',
    key: 'reports',
    icon: FileBarChart,
    anyOf: ['report:read'],
    section: 'oversight',
  },
  { href: '/metrics', key: 'metrics', icon: Gauge, anyOf: ['metrics:read'], section: 'oversight' },
  {
    href: '/admin/rules',
    key: 'rules',
    icon: BookOpenCheck,
    anyOf: ['rule:read'],
    section: 'admin',
  },
  { href: '/admin/users', key: 'users', icon: Users, anyOf: ['user:manage'], section: 'admin' },
  { href: '/admin/clock', key: 'clock', icon: Clock, anyOf: ['clock:manage'], section: 'admin' },
  { href: '/audit', key: 'audit', icon: ScrollText, anyOf: ['audit:read'], section: 'admin' },
];

export function visibleNav(me: Me): NavItem[] {
  return NAV.filter(
    (n) =>
      (n.anyOf.length === 0 || n.anyOf.some((p) => me.permissions.includes(p))) &&
      (!n.when || n.when(me)),
  );
}
