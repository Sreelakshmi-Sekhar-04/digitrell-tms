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
  budget: number | null;
  nextStep: string;
  createdAt: string;
}

export interface QuoteRow {
  id: string;
  carrierId: string;
  carrier: string;
  carrierStatus: string;
  status: 'REQUESTED' | 'QUOTED' | 'DECLINED' | 'AWARDED' | 'LOST' | 'WITHDRAWN';
  amount: number | null;
  quotedAt: string | null;
  score: number | null;
  rank: number | null;
  vsBudget: number | null;
  overBudget: boolean;
  onTimePct: number | null;
  podDays: number | null;
  acceptPct: number | null;
  trips: number;
}

export interface TripDetail extends TripSummary {
  pickup: { id: string; name: string; city: string; line1: string } | null;
  drop: { id: string; name: string; city: string; line1: string } | null;
  laneId: string | null;
  awardRule: string | null;
  receiverContact: string | null;
  reference: string | null;
  notes: string | null;
  quoteDeadline: string | null;
  quotesClosedAt: string | null;
  noQuotes: boolean;
  awardedAt: string | null;
  undoUntil: string | null;
  recommendation: { quoteId: string; carrier: string; amount: number; reason: string } | null;
  quotes: QuoteRow[];
  activity: { at: string; actor: string; action: string; text: string }[];
}

/** The 7 stages on the trip progress bar; each BRD status maps to one. */
export const STAGES = ['Booked', 'Quotes', 'Awarded', 'Truck and documents', 'In transit', 'Delivered and POD', 'Billed and paid'];
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
  if (mins < 60) return `${mins} min`;
  if (mins < 24 * 60) return `${Math.floor(mins / 60)} h ${String(mins % 60).padStart(2, '0')} min`;
  const d = Math.floor(mins / (24 * 60));
  return `${d} day${d > 1 ? 's' : ''}`;
}

export const tonnes = (t: number | null) => (t == null ? '—' : `${t.toLocaleString('en-IN', { maximumFractionDigits: 2 })} t`);
