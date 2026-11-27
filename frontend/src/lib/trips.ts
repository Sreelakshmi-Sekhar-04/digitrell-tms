export interface TripSummary {
  id: string;
  number: string;
  status: string;
  group: string;
  origin: string | null;
  destination: string | null;
  material: string | null;
  weightTonnes: number | null;
  truckType: string | null;
  pickupDate: string | null;
  carrier: string | null;
  amount: number | null;
  nextStep: string;
  createdAt: string;
}

/** One carrier in the offer list, in offer order, with its fixed contract rate. */
export interface QuoteRow {
  id: string;
  carrierId: string;
  carrier: string;
  carrierStatus: string;
  sequence: number | null;
  status: 'QUEUED' | 'REQUESTED' | 'ACCEPTED' | 'AWARDED' | 'DECLINED' | 'EXPIRED' | 'REJECTED_BY_SHIPPER' | 'WITHDRAWN' | 'QUOTED' | 'LOST';
  statusLabel: string;
  amount: number | null;
  offeredAt: string | null;
  respondBy: string | null;
  answeredAt: string | null;
  declineReason: string | null;
  isWinner: boolean;
}

export interface TripDetail extends TripSummary {
  pickup: { id: string; name: string; city: string; line1: string } | null;
  drop: { id: string; name: string; city: string; line1: string } | null;
  laneId: string | null;
  receiverContact: string | null;
  reference: string | null;
  notes: string | null;
  quoteDeadline: string | null;
  quotesClosedAt: string | null;
  noQuotes: boolean;
  awardedAt: string | null;
  noCarrierAccepted: boolean;
  canApprove?: boolean;
  quotes: QuoteRow[];
  activity: { at: string; actor: string; action: string; text: string }[];
  truck: { number: string; driverName: string | null; driverPhone: string | null } | null;
  eta: string | null;
  lastLocation: string | null;
  lastUpdateAt: string | null;
  delivery: { at: string; goodQty: number | null; damagedQty: number | null; remarks: string | null } | null;
  pod: { rule: 'DIGITAL' | 'HARD_COPY' | 'BOTH'; photo: boolean; accepted: boolean; hardCopy: boolean; readyToBill: boolean; readyToPay: boolean; acceptedAt: string | null; hardCopyAt: string | null };
  documents: { id: string; kind: 'LR' | 'EWAY_BILL' | 'POD' | string; number: string | null; validUntil: string | null; fileUrl: string | null; at: string }[];
  claims: { id: string; number: string; kind: string; qty: number; unitValue: number; amount: number; description: string; status: 'RAISED' | 'ACCEPTED' | 'DISPUTED' | 'WITHDRAWN'; carrierNote: string | null; at: string }[];
  acceptedClaims: number;
  invoice: {
    id: string;
    number: string;
    status: 'RECEIVED' | 'APPROVED' | 'PAID' | 'QUERIED';
    freight: number;
    detention: number;
    claimDeduction: number;
    total: number;
    dueDate: string;
    queryReason: string | null;
    approvedAt: string | null;
    paidAt: string | null;
    paymentMode: string | null;
    paymentRef: string | null;
    receivedAt: string;
    checks: { label: string; ok: boolean; detail: string }[];
    needsApproval: boolean;
    aboveThreshold: boolean;
  } | null;
  paymentApprovalAbove: number;
  cancel: { allowed: boolean; roleOnly: boolean; reason: string | null; consequences: string[] };
  edit: { load: boolean; extras: boolean; requotes: boolean };
  exception: {
    id: string;
    kind: string;
    description: string;
    status: 'OPEN' | 'AWAITING_SHIPPER' | 'APPROVED' | 'REJECTED';
    proposal: { fix: string; label: string; newEta: string | null; extraCost: number; payer: 'CARRIER' | 'SHIPPER' } | null;
    decisionReason: string | null;
    at: string;
  } | null;
  delays: { description: string; at: string }[];
  cancelled: { at: string; reason: string | null } | null;
}

export const CANCEL_REASONS = [
  { value: 'ORDER_CANCELLED', label: 'Order cancelled by the customer' },
  { value: 'WRONG_DETAILS', label: 'Wrong details, will rebook' },
  { value: 'OTHER_MODE', label: 'Moved to another mode or vendor' },
  { value: 'NO_SUITABLE_QUOTE', label: 'No suitable quote' },
  { value: 'OTHER', label: 'Other (write below)' },
];

export const POD_RULE_LABEL: Record<string, string> = {
  DIGITAL: 'Digital photo accepted',
  HARD_COPY: 'Hard copy required before billing',
  BOTH: 'Photo to bill, hard copy before payment',
};

/** The 7 stages on the trip progress bar; each BRD status maps to one. */
export const STAGES = ['Booked', 'Offer', 'Awarded', 'Truck and documents', 'In transit', 'Delivered and POD', 'Billed and paid'];
const STAGE_OF: Record<string, number> = {
  REQUEST_RECEIVED: 0, BOOKED: 0, QUOTES_REQUESTED: 1, QUOTES_RECEIVED: 1, AWARDED: 2, SOURCING_TRUCK: 2,
  TRUCK_CONFIRMED: 3, CLEARED: 3, READY_FOR_PICKUP: 3, IN_TRANSIT: 4, ON_HOLD: 4, DELIVERED: 5, POD_RECEIVED: 5, INVOICED: 6, CLOSED: 7,
};
export const stageOf = (status: string) => STAGE_OF[status] ?? 0;

export const timeIST = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' });
export const dateShort = (iso: string | null) =>
  iso ? new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '—';
export const dateTimeIST = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' });

/** "18 min", "1 h 05 min", "2 days" since a time. */
export function ago(iso: string) {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return 'under 1 min';
  if (mins < 60) return `${mins} min`;
  if (mins < 24 * 60) return `${Math.floor(mins / 60)} h ${String(mins % 60).padStart(2, '0')} min`;
  const d = Math.floor(mins / (24 * 60));
  return `${d} day${d > 1 ? 's' : ''}`;
}

export const tonnes = (t: number | null) => (t == null ? '—' : `${t.toLocaleString('en-IN', { maximumFractionDigits: 2 })} t`);
