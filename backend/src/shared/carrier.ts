// Carrier roles and defaults (carrier spec §3.1–3.2). Change only with lead review.

/**
 * OWNER (or Key Account Manager): rate contracts, quotes, accepts trips, approves above limits.
 * TRAFFIC_MANAGER: assigns trucks and drivers, keeps fleet and driver records, handles breakdowns.
 * ACCOUNTS: invoices to shippers, settlements, payments.
 * Small carriers give one person several roles; access checks use `role` plus `roles`.
 */
export const CARRIER_ROLES = ['OWNER', 'TRAFFIC_MANAGER', 'ACCOUNTS'] as const;
export type CarrierRole = (typeof CARRIER_ROLES)[number];

/** Agents the carrier controls and their default autonomy: 0 suggest only, 1 ask first, 2 act within limits. */
export const DEFAULT_CARRIER_AUTONOMY = { quote: 1, truckAssignment: 1, documents: 2, billing: 0 } as const;

/** Every role a user holds (main role first, no duplicates). */
export function rolesOf(u: { role: string; roles?: string[] | null }): string[] {
  return Array.from(new Set([u.role, ...(u.roles ?? [])]));
}

export const TRUCK_OWNERSHIP = ['OWN', 'ATTACHED'] as const;
/** Goods-vehicle licence classes: Light, Medium, Heavy, Extra Heavy. */
export const LICENCE_CLASSES = ['LGV', 'MGV', 'HGV', 'EHV'] as const;
export const GST_OPTIONS = ['FCM', 'RCM'] as const;

/** Days before a document's expiry when the truck shows "Expiring" (carrier spec C5: alerts at 15 and 1 days). */
export const EXPIRY_WARNING_DAYS = 15;

/**
 * Indian registration number, normalised to capitals without spaces: TN09BX4471, or the
 * Bharat series 22BH1234AA. Returns null if it doesn't look like one.
 */
export function normaliseTruckNumber(raw: string): string | null {
  const s = raw.toUpperCase().replace(/[\s.-]/g, '');
  if (/^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{4}$/.test(s)) return s;
  if (/^\d{2}BH\d{4}[A-Z]{1,2}$/.test(s)) return s;
  return null;
}

/** "TN09BX4471" → "TN 09 BX 4471"; "22BH1234AA" → "22 BH 1234 AA". */
export function formatTruckNumber(n: string): string {
  const bh = n.match(/^(\d{2})(BH)(\d{4})([A-Z]{1,2})$/);
  if (bh) return bh.slice(1).join(' ');
  const m = n.match(/^([A-Z]{2})(\d{1,2})([A-Z]{0,3})(\d{4})$/);
  if (!m) return n;
  return [m[1], m[2].padStart(2, '0'), m[3], m[4]].filter(Boolean).join(' ');
}

export const TRUCK_DOCUMENTS = [
  { key: 'rcExpiry', label: 'RC' },
  { key: 'insuranceExpiry', label: 'Insurance' },
  { key: 'permitExpiry', label: 'Permit' },
  { key: 'fitnessExpiry', label: 'Fitness' },
  { key: 'pucExpiry', label: 'PUC' },
] as const;
export type TruckDocKey = (typeof TRUCK_DOCUMENTS)[number]['key'];

export type DocState = 'VALID' | 'EXPIRING' | 'EXPIRED' | 'MISSING';

/** One document's state on a given day. Missing dates count as not checked, which blocks assignment. */
export function docState(expiry: Date | null | undefined, today = new Date()): DocState {
  if (!expiry) return 'MISSING';
  const day = 86400_000;
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  if (expiry.getTime() < start) return 'EXPIRED';
  if (expiry.getTime() < start + EXPIRY_WARNING_DAYS * day) return 'EXPIRING';
  return 'VALID';
}
