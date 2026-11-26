/** Shipper navigation, in the order of the approved design (Navigation and journeys artboard). */
export interface NavItem {
  href: string;
  label: string;
  /** Shown in the phone bottom bar; the rest go under "More". */
  primaryOnPhone?: boolean;
}

export const SHIPPER_NAV: NavItem[] = [
  { href: '/', label: 'Home', primaryOnPhone: true },
  { href: '/trips', label: 'Trips', primaryOnPhone: true },
  { href: '/approvals', label: 'Approvals', primaryOnPhone: true },
  // Carriers, rate cards, lanes, addresses and users. New bookings start from Trips (and Home).
  { href: '/masters', label: 'Master data' },
  { href: '/reports', label: 'Reports' },
  { href: '/policies', label: 'Policies' },
];

/** Pages without a menu item of their own, highlighted under the item they belong to. */
const SECTION_OF: Record<string, string> = { '/bookings': '/trips' };

export function isActive(pathname: string, href: string) {
  if (href === '/') return pathname === '/';
  const under = (p: string, base: string) => p === base || p.startsWith(base + '/');
  if (under(pathname, href)) return true;
  return Object.entries(SECTION_OF).some(([base, section]) => section === href && under(pathname, base));
}
