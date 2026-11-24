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
  { href: '/bookings/new', label: 'New booking' },
  { href: '/approvals', label: 'Approvals', primaryOnPhone: true },
  { href: '/masters', label: 'Carriers and lanes' },
  { href: '/reports', label: 'Reports' },
  { href: '/policies', label: 'Policies' },
];

export function isActive(pathname: string, href: string) {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(href + '/');
}
