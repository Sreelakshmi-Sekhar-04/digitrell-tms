import { toNumber } from '../../lib/validate';
import { scored, UNDO_MINUTES, type TripFull } from './tender.service';

/** Tabs on the Trips list (design: All / Needs action / In transit / Delivered and billed / Closed). */
export const GROUPS = {
  action: ['QUOTES_RECEIVED', 'ON_HOLD', 'DELIVERED'],
  transit: ['AWARDED', 'SOURCING_TRUCK', 'TRUCK_CONFIRMED', 'CLEARED', 'READY_FOR_PICKUP', 'IN_TRANSIT'],
  delivered: ['POD_RECEIVED', 'INVOICED'],
  closed: ['CLOSED', 'CANCELLED'],
} as const;

const fmtTime = (d: Date) => d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' });

/** A request that closed with no quotes needs the shipper too. */
export const noQuotes = (t: TripFull) => t.status === 'QUOTES_REQUESTED' && !!t.quotesClosedAt;

export function groupOf(t: TripFull): keyof typeof GROUPS | 'waiting' {
  if (noQuotes(t)) return 'action';
  for (const [g, statuses] of Object.entries(GROUPS)) if ((statuses as readonly string[]).includes(t.status)) return g as keyof typeof GROUPS;
  return 'waiting';
}

/** The one-line "Next step" column. */
export function nextStep(t: TripFull): string {
  const quoted = t.quotes.filter((q) => q.status === 'QUOTED').length;
  switch (t.status) {
    case 'QUOTES_REQUESTED':
      return t.quotesClosedAt ? 'No quotes: ask again or change carriers' : `Quotes close ${t.quoteDeadline ? fmtTime(t.quoteDeadline) : 'soon'}`;
    case 'QUOTES_RECEIVED':
      return t.quotesClosedAt ? 'Choose a carrier' : `Choose a carrier (${quoted} of ${t.quotes.length} quoted)`;
    case 'AWARDED':
      return 'Carrier assigning truck';
    case 'CANCELLED':
      return 'Cancelled';
    default:
      return '—';
  }
}

const date = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

export function tripSummary(t: TripFull) {
  return {
    id: t.id,
    number: t.number,
    status: t.status,
    group: groupOf(t),
    origin: t.pickupAddress?.city ?? t.lane?.origin ?? null,
    destination: t.dropAddress?.city ?? t.lane?.destination ?? null,
    material: t.material,
    weightTonnes: t.weightKg != null ? toNumber(t.weightKg)! / 1000 : null,
    truckType: t.truckType,
    pickupDate: date(t.pickupDate),
    carrier: t.carrier?.name ?? null,
    amount: toNumber(t.awardedAmount),
    budget: toNumber(t.lane?.budget),
    nextStep: nextStep(t),
    createdAt: t.createdAt,
  };
}

export function tripDetail(t: TripFull, activity: { at: Date; actor: string; action: string; text: string }[]) {
  const { list, reason } = scored(t);
  const scoreById = new Map(list.map((q, i) => [q.id, { ...q, rank: i + 1 }]));
  return {
    ...tripSummary(t),
    pickup: t.pickupAddress && { id: t.pickupAddress.id, name: t.pickupAddress.name, city: t.pickupAddress.city, line1: t.pickupAddress.line1 },
    drop: t.dropAddress && { id: t.dropAddress.id, name: t.dropAddress.name, city: t.dropAddress.city, line1: t.dropAddress.line1 },
    laneId: t.laneId,
    awardRule: t.lane?.awardRule ?? null,
    receiverContact: t.receiverContact,
    reference: t.reference,
    notes: t.notes,
    quoteDeadline: t.quoteDeadline,
    quotesClosedAt: t.quotesClosedAt,
    noQuotes: noQuotes(t),
    awardedAt: t.awardedAt,
    undoUntil: t.status === 'AWARDED' && t.awardedAt ? new Date(t.awardedAt.getTime() + UNDO_MINUTES * 60_000) : null,
    recommendation: list[0] ? { quoteId: list[0].id, carrier: list[0].carrierName, amount: list[0].amount, reason } : null,
    quotes: t.quotes.map((q) => {
      const s = scoreById.get(q.id);
      const perf = q.carrier.performance;
      return {
        id: q.id,
        carrierId: q.carrierId,
        carrier: q.carrier.name,
        carrierStatus: q.carrier.status,
        status: q.status,
        amount: toNumber(q.amount),
        quotedAt: q.quotedAt,
        score: s?.score ?? null,
        rank: s?.rank ?? null,
        vsBudget: s?.vsBudget ?? null,
        overBudget: s?.overBudget ?? false,
        onTimePct: perf?.onTimePct ?? null,
        podDays: perf ? toNumber(perf.podDays) : null,
        acceptPct: perf?.acceptPct ?? null,
        trips: perf?.trips ?? 0,
      };
    }),
    activity,
  };
}
