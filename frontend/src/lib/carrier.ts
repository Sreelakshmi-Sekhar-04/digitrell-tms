// Carrier types and labels. Mirrors backend/src/shared/carrier.ts and the /api/carrier responses.
import type { SessionUser } from './auth';
import type { Tone } from '@/components/ui/Chip';

export const CARRIER_ROLE_OPTIONS = [
  { value: 'OWNER', label: 'Owner', help: 'Rates, quotes, accepting trips, approvals above limits, users and policies.' },
  { value: 'TRAFFIC_MANAGER', label: 'Traffic manager', help: 'Trucks, drivers, assigning trucks, breakdowns and truck swaps.' },
  { value: 'ACCOUNTS', label: 'Accounts', help: 'Invoices to shippers, settlements and payments.' },
] as const;
export const carrierRoleLabel = (r: string) => CARRIER_ROLE_OPTIONS.find((o) => o.value === r)?.label ?? r;

export const OWNERSHIP_LABELS: Record<string, string> = { OWN: 'Own', ATTACHED: 'Attached' };
export const LICENCE_CLASS_OPTIONS = [
  { value: 'LGV', label: 'LGV – Light Goods Vehicle' },
  { value: 'MGV', label: 'MGV – Medium Goods Vehicle' },
  { value: 'HGV', label: 'HGV – Heavy Goods Vehicle' },
  { value: 'EHV', label: 'EHV – Extra Heavy Goods Vehicle' },
];

/** Same rule as the server (carrier/execution.service.ts requiredLicenceClass): does this licence cover the truck? */
const LIGHT_BODIES = ['14ft', '17ft', '19ft'];
const CLASS_RANK: Record<string, number> = { LGV: 1, MGV: 2, HGV: 3, EHV: 4 };
export function licenceCovers(licenceClass: string | null, truck: { truckType: string | null; capacityKg: number | null }): boolean {
  if (!licenceClass) return false;
  const light = !truck.truckType || LIGHT_BODIES.includes(truck.truckType);
  const kg = truck.capacityKg;
  const need = kg != null && kg > 0 ? (kg <= 7500 && light ? 1 : kg <= 12000 ? 2 : 3) : light ? 1 : 3;
  return (CLASS_RANK[licenceClass] ?? 0) >= need;
}
export const GST_OPTION_LABELS: Record<string, string> = {
  FCM: 'We charge GST on our invoices (forward charge)',
  RCM: 'Shipper pays GST (reverse charge)',
};

export function hasRole(user: SessionUser | null, ...roles: string[]) {
  return !!user && (user.roles ?? [user.role]).some((r) => roles.includes(r));
}

export type DocState = 'VALID' | 'EXPIRING' | 'EXPIRED' | 'MISSING';
export interface TruckDoc { key: string; label: string; expiry: string | null; state: DocState; file: { fileName: string; uploadedAt: string } | null }
export interface Truck {
  id: string;
  number: string;
  truckType: string;
  ownership: string;
  make: string | null;
  capacityKg: number | null;
  ownerName: string | null;
  ownerPhone: string | null;
  usualDriver: { id: string; name: string } | null;
  currentTrip: string | null;
  isActive: boolean;
  docs: TruckDoc[];
  status: 'INACTIVE' | 'BLOCKED' | 'ON_TRIP' | 'EXPIRING' | 'READY';
  note: string;
  nextExpiry: { label: string; date: string } | null;
}
export const TRUCK_STATUS_UI: Record<Truck['status'], { label: string; tone: Tone }> = {
  READY: { label: 'Ready', tone: 'success' },
  EXPIRING: { label: 'Expiring', tone: 'action' },
  ON_TRIP: { label: 'On trip', tone: 'progress' },
  BLOCKED: { label: 'Blocked', tone: 'danger' },
  INACTIVE: { label: 'Deactivated', tone: 'neutral' },
};
export const DOC_STATE_UI: Record<DocState, { label: string; tone: Tone }> = {
  VALID: { label: 'Valid', tone: 'success' },
  EXPIRING: { label: 'Expiring soon', tone: 'action' },
  EXPIRED: { label: 'Expired', tone: 'danger' },
  MISSING: { label: 'Missing', tone: 'danger' },
};

export interface Driver {
  id: string;
  name: string;
  phone: string;
  language: string;
  licenceNumber: string | null;
  licenceClass: string | null;
  licenceExpiry: string | null;
  licenceState: DocState;
  upi: { id: string | null; verified: boolean; verifiedAt: string | null; pending: { upiId: string; byName: string; byMe: boolean } | null };
  currentTrip: string | null;
  isActive: boolean;
  status: 'INACTIVE' | 'BLOCKED' | 'ON_TRIP' | 'FREE';
  note: string;
}
export const DRIVER_STATUS_UI: Record<Driver['status'], { label: string; tone: Tone }> = {
  FREE: { label: 'Free', tone: 'success' },
  ON_TRIP: { label: 'On trip', tone: 'progress' },
  BLOCKED: { label: 'Blocked', tone: 'danger' },
  INACTIVE: { label: 'Deactivated', tone: 'neutral' },
};

export interface RateCard {
  id: string;
  shipper: { id: string; name: string } | null;
  origin: string;
  destination: string;
  truckType: string;
  rate: number;
  bandPct: number;
  tripCost: number | null;
  bandLow: number;
  bandHigh: number;
  marginPct: number | null;
  validFrom: string;
  validTo: string;
  isActive: boolean;
  status: 'INACTIVE' | 'EXPIRED' | 'UPCOMING' | 'ACTIVE';
}
export const RATE_STATUS_UI: Record<RateCard['status'], { label: string; tone: Tone }> = {
  ACTIVE: { label: 'Active', tone: 'success' },
  UPCOMING: { label: 'Starts later', tone: 'progress' },
  EXPIRED: { label: 'Expired', tone: 'neutral' },
  INACTIVE: { label: 'Deactivated', tone: 'neutral' },
};

export interface CarrierUser {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  roles: string[];
  language: string;
  isActive: boolean;
  status: 'ACTIVE' | 'INVITED' | 'INACTIVE';
}

export interface CarrierProfile {
  name: string;
  phone: string | null;
  address: string | null;
  gstin: string | null;
  pan: string | null;
  gstOption: string | null;
  tdsDeclared: boolean;
  tdsDeclaredAt: string | null;
  bankAccountName: string | null;
  bankAccountNo: string | null;
  bankIfsc: string | null;
  missing: string[];
}

/** "2027-03-31" → "31 Mar 2027". */
export function prettyDate(iso: string | null | undefined) {
  if (!iso) return '—';
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** "KR", 482 → "KR-000482". */
export const lrNumber = (prefix: string, n: number) => `${prefix}-${String(n).padStart(6, '0')}`;

// ---------- Loads (phase 3) ----------

export type LoadGroup = 'action' | 'transit' | 'delivered' | 'closed' | 'waiting';
export type LoadPanel = 'offer' | 'accepted' | 'closedRequest' | 'won' | 'assigned' | 'ready' | 'transit' | 'hold' | 'delivered' | 'unbilled' | 'invoiced' | 'closed' | 'cancelled';
export interface LoadSummary {
  id: string;
  number: string;
  shipper: string;
  origin: string | null;
  destination: string | null;
  pickupDate: string | null;
  material: string | null;
  weightTonnes: number | null;
  truckType: string | null;
  amount: number | null;
  respondBy: string | null;
  panel: LoadPanel;
  label: string;
  tone: Tone;
  group: LoadGroup;
  nextStep: string;
  stage: number;
}
/** Carrier approvals inbox row: today only invoices above the limit (kind INVOICE); the owner approves or rejects. */
export interface CarrierApproval {
  id: string;
  kind?: 'INVOICE';
  amount?: number;
  kindLabel: string;
  tripId: string | null;
  ref: string;
  summary: string;
  reason: string;
  createdAt: string;
}
export interface AssignTruck { id: string; number: string; truckType: string; matchesType: boolean; status: Truck['status']; note: string; usualDriverId: string | null; capacityKg: number | null }
export interface AssignDriver { id: string; name: string; phone: string; licenceClass: string | null; licenceExpiry: string | null; status: 'FREE' | 'ON_TRIP' | 'BLOCKED'; note: string }
export interface TrackEvent { type: string; label: string; at: string; location: string | null; eta: string | null; detail: string | null }
export interface InvoiceDraft {
  freight: number;
  detention: number;
  claimDeduction: number;
  total: number;
  dueDate: string;
  gst: { option: string | null; text: string };
  blocked: { code: string; message: string } | null;
  limit: number | null;
  overLimit: boolean;
  approval: { id: string; status: 'PENDING' | 'REJECTED'; requestedByName: string; reason: string | null; at: string } | null;
  queryReason: string | null;
}
export interface LoadDetail extends LoadSummary {
  pickup: { name: string; city: string; line1: string } | null;
  drop: { name: string; city: string; line1: string | null } | null;
  /** Contract-rate offer: fixed amount, nothing to type. Present only while the offer awaits an answer. */
  offer: { amount: number | null; respondBy: string | null; freeTrucks: string[] } | null;
  execution: {
    awardedAmount: number | null;
    awardedAt: string | null;
    truckNumber: string | null;
    driverName: string | null;
    driverPhone: string | null;
    truckId: string | null;
    driverId: string | null;
    pickupEta: string | null;
    /** Choices for the assign form (won and truck-assigned states only). */
    assignment: { trucks: AssignTruck[]; drivers: AssignDriver[] } | null;
    lr: { number: string | null; issuedAt: string; ewayBill: string | null } | null;
    eta: string | null;
    lastLocation: string | null;
    lastUpdateAt: string | null;
    deliveredAt: string | null;
    goodQty: number | null;
    damagedQty: number | null;
    deliveryRemarks: string | null;
    tracking: { events: TrackEvent[]; reachedPickup: boolean; reachedDrop: boolean };
    /** Trucks and drivers for a swap (on-hold loads only). */
    swapOptions: { trucks: AssignTruck[]; drivers: AssignDriver[] } | null;
    pod: { rule: string; uploaded: boolean; accepted: boolean; hardCopy: boolean; lrNumber: string | null } | null;
    billing: InvoiceDraft | null;
    receiverContact: string | null;
    documents: { kind: string; number: string | null; isVoid: boolean; validUntil: string | null; voidReason: string | null; fileUrl: string | null }[];
    invoice: { number: string; freight: number; detention: number; claimDeduction: number; total: number; status: string; dueDate: string; paidAt: string | null; paymentMode: string | null; paymentRef: string | null; queryReason: string | null; overdue: boolean; lastReminderAt: string | null } | null;
    exception: { id: string; kind: string; description: string; status: string; decisionReason: string | null; proposal: { fix?: string; label?: string; newEta?: string | null; extraCost?: number; payer?: string; swap?: { truckNumber: string; driverName: string } } | null; createdAt: string } | null;
    claims: { id: string; number: string; kind: string; qty: number; amount: number; status: string; description: string; carrierNote: string | null }[];
  } | null;
  activity: { at: string; text: string }[];
}

