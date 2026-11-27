import type { Prisma, CarrierRate } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { toNumber } from '../../lib/validate';
import { tripInclude, type TripFull } from '../trips/tender.service';
import { currentInvoice } from '../trips/billing.service';
import { openException as openExceptionOf } from '../trips/trip.view';
import { trackFlags } from './onroad.service';

/**
 * The carrier's view of a trip. Built from the shared trip, but never exposes the shipper's budget,
 * other carriers' quotes or scores, or the shipper's internal notes (carrier spec §3.2).
 */

export const OPEN = ['QUOTES_REQUESTED', 'QUOTES_RECEIVED'] as const;
export type Group = 'action' | 'transit' | 'delivered' | 'closed' | 'waiting';
export type Tone = 'neutral' | 'action' | 'progress' | 'success' | 'danger' | 'billing';

/**
 * Trips this carrier has been offered (offeredAt set; QUEUED offers are invisible) or won, most recent
 * first. Only this carrier's own offered quote is returned: other carriers' quotes never leave here.
 */
export async function myTrips(carrierId: string, where: Prisma.TripWhereInput = {}, take?: number) {
  const trips = await prisma.trip.findMany({
    where: { AND: [where, { OR: [{ carrierId }, { quotes: { some: { carrierId, offeredAt: { not: null } } } }] }] },
    include: { ...tripInclude, shipper: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
    take,
  });
  return trips.map((t) => ({ ...t, quotes: t.quotes.filter((q) => q.carrierId === carrierId && q.offeredAt != null) }));
}
export type CarrierTrip = Awaited<ReturnType<typeof myTrips>>[number];

const fmtTime = (d: Date) => d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' });
const istDay = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
/** "14:30" today, otherwise "28 Nov, 14:30" (India time). */
const deadlineText = (d: Date) => (istDay(d) === istDay(new Date()) ? fmtTime(d) : fmtDateTime(d));
const fmtDateTime = (d: Date) => d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' });
const fmtDate = (d: Date) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });

/** Per-trip facts the state needs beyond the trip row: recorded driver steps and the owner's invoice approval. */
export interface Extras { pickup: boolean; drop: boolean; invoiceApproval: 'PENDING' | 'REJECTED' | null }
export type ExtrasMap = Map<string, Extras>;

/** One batched lookup for a list of trips (two queries, however many trips). */
export async function loadExtras(tripIds: string[]): Promise<ExtrasMap> {
  const flags = await trackFlags(tripIds);
  const approvals = tripIds.length ? await prisma.approval.findMany({ where: { tripId: { in: tripIds }, kind: 'CARRIER_INVOICE' }, orderBy: { createdAt: 'desc' }, select: { tripId: true, status: true } }) : [];
  const latest = new Map<string, string>();
  for (const a of approvals) if (!latest.has(a.tripId!)) latest.set(a.tripId!, a.status);
  const out: ExtrasMap = new Map();
  for (const id of tripIds) {
    const st = latest.get(id);
    out.set(id, { pickup: flags.get(id)?.pickup ?? false, drop: flags.get(id)?.drop ?? false, invoiceApproval: st === 'PENDING' || st === 'REJECTED' ? st : null });
  }
  return out;
}

export interface CarrierState {
  /** Panel shown at the top of the load page. */
  panel: 'offer' | 'accepted' | 'closedRequest' | 'won' | 'assigned' | 'ready' | 'transit' | 'hold' | 'delivered' | 'unbilled' | 'invoiced' | 'closed' | 'cancelled';
  label: string;
  tone: Tone;
  group: Group;
  nextStep: string;
  /** 0–6 on the shared 7-stage progress bar. */
  stage: number;
}

/** What this trip means for this carrier right now. */
export function carrierState(t: TripFull, carrierId: string, x: Extras = { pickup: false, drop: false, invoiceApproval: null }): CarrierState {
  const q = t.quotes.find((x) => x.carrierId === carrierId);
  const mine = t.carrierId === carrierId;
  if (t.status === 'CANCELLED') return { panel: 'cancelled', label: 'Cancelled', tone: 'neutral', group: 'closed', nextStep: 'Cancelled by the shipper', stage: 0 };

  if (mine) {
    const inv = currentInvoice(t);
    switch (t.status) {
      case 'AWARDED':
      case 'SOURCING_TRUCK':
        return { panel: 'won', label: 'Won', tone: 'action', group: 'action', nextStep: 'Assign truck and driver', stage: 2 };
      case 'TRUCK_CONFIRMED':
        // Truck assigned; the carrier issues the LR next (trips confirmed with an LR by older flows count as ready).
        if (!t.documents.some((d) => d.kind === 'LR' && !d.isVoid)) {
          return { panel: 'assigned', label: 'Truck assigned', tone: 'action', group: 'action', nextStep: 'Issue the LR', stage: 3 };
        }
      // falls through
      case 'CLEARED':
      case 'READY_FOR_PICKUP':
        return {
          panel: 'ready', label: 'Ready for pickup', tone: 'progress', group: 'transit', stage: 3,
          nextStep: x.pickup ? 'At pickup: record Loaded when the truck leaves' : `${t.truckNumber ?? 'Truck'} going for pickup: record Reached pickup`,
        };
      case 'IN_TRANSIT':
        return {
          panel: 'transit', label: 'In transit', tone: 'progress', group: 'transit', stage: 4,
          nextStep: x.drop ? 'Reached drop: record the delivery' : t.eta ? `On the road, ETA ${fmtDateTime(t.eta)}` : 'On the road: share location updates',
        };
      case 'ON_HOLD': {
        const ex = openExceptionOf(t);
        const p = ex?.proposal as { label?: string } | null;
        const next =
          !ex || !p?.label ? 'Problem reported: propose a fix'
          : ex.status === 'AWAITING_SHIPPER' ? `Fix proposed (${p.label}): waiting for the shipper`
          : ex.status === 'REJECTED' ? 'Shipper rejected the fix: propose another'
          : `Fix ${ex.status === 'APPROVED' ? 'approved' : 'ready'} (${p.label}): resume the trip when done`;
        return { panel: 'hold', label: 'On hold', tone: 'danger', group: 'action', nextStep: next, stage: 4 };
      }
      case 'DELIVERED': {
        const pod = t.documents.some((d) => d.kind === 'POD' && !d.isVoid);
        const open = t.claims.find((c) => c.status === 'RAISED');
        return {
          panel: 'delivered', label: 'Delivered', tone: 'success', group: !pod || open ? 'action' : 'delivered', stage: 5,
          nextStep: open ? `Claim ${open.number} needs your answer` : pod ? 'POD with the shipper for review' : 'Upload the signed POD',
        };
      }
      case 'POD_RECEIVED': {
        const open = t.claims.find((c) => c.status === 'RAISED');
        return {
          panel: 'unbilled', label: 'POD received', tone: 'success', group: 'action', stage: 5,
          nextStep: open ? `Answer claim ${open.number}, then invoice` : x.invoiceApproval === 'PENDING' ? 'Invoice waiting for the owner’s approval' : x.invoiceApproval === 'REJECTED' ? 'Owner rejected the invoice: fix and send again' : 'Send the invoice',
        };
      }
      case 'INVOICED': {
        const overdue = inv && ['RECEIVED', 'APPROVED'].includes(inv.status) && inv.dueDate.getTime() < Date.now();
        return {
          panel: 'invoiced', label: inv?.status === 'QUERIED' ? 'Invoice queried' : 'Invoiced', tone: inv?.status === 'QUERIED' ? 'danger' : 'billing',
          group: inv?.status === 'QUERIED' ? 'action' : 'delivered', stage: 6,
          nextStep: !inv ? 'Invoiced' : inv.status === 'QUERIED' ? 'Invoice queried: send a corrected one' : overdue ? `Payment overdue since ${fmtDate(inv.dueDate)}: send a reminder` : `Payment due ${fmtDate(inv.dueDate)}`,
        };
      }
      case 'CLOSED':
        return { panel: 'closed', label: 'Closed', tone: 'success', group: 'closed', nextStep: t.closedAt ? `Paid ${fmtDate(t.closedAt)}` : 'Closed', stage: 7 };
    }
  }

  const open = OPEN.includes(t.status as (typeof OPEN)[number]) && !t.quotesClosedAt;
  switch (q?.status) {
    case 'REQUESTED':
      if (!open) return { panel: 'closedRequest', label: 'Load went to another carrier', tone: 'neutral', group: 'closed', nextStep: 'Load went to another carrier', stage: 1 };
      return {
        panel: 'offer', label: 'New offer', tone: 'action', group: 'action',
        nextStep: `Accept or pass${q.respondBy ? ` by ${deadlineText(q.respondBy)}` : ''}`, stage: 1,
      };
    // ACCEPTED and REJECTED_BY_SHIPPER are legacy: no longer written (accept awards at once); kept for old rows.
    case 'ACCEPTED':
      if (!open) return { panel: 'closedRequest', label: 'Load went to another carrier', tone: 'neutral', group: 'closed', nextStep: 'Load went to another carrier', stage: 1 };
      return { panel: 'accepted', label: 'Awaiting shipper approval', tone: 'progress', group: 'waiting', nextStep: 'You accepted. Waiting for the shipper’s approval.', stage: 1 };
    case 'REJECTED_BY_SHIPPER':
      return { panel: 'closedRequest', label: 'Not approved', tone: 'neutral', group: 'closed', nextStep: 'The shipper did not approve this load.', stage: 1 };
    case 'AWARDED':
      return { panel: 'won', label: 'Won', tone: 'action', group: 'action', nextStep: 'Assign truck and driver', stage: 2 };
    case 'DECLINED':
      return { panel: 'closedRequest', label: 'You passed', tone: 'neutral', group: 'closed', nextStep: 'You passed', stage: 1 };
    case 'EXPIRED':
      return { panel: 'closedRequest', label: 'Offer expired', tone: 'neutral', group: 'closed', nextStep: 'Offer expired (no answer in time)', stage: 1 };
    default:
      // WITHDRAWN, LOST or anything else: the load went elsewhere.
      return { panel: 'closedRequest', label: 'Load went to another carrier', tone: 'neutral', group: 'closed', nextStep: 'Load went to another carrier', stage: 1 };
  }
}

/** The carrier's own price list, used only as a trip cost reference for margins on Home; never prices offers. */
export const activeRateCards = (carrierId: string) => prisma.carrierRate.findMany({ where: { carrierId, isActive: true } });

export function pickRate(cards: CarrierRate[], t: { shipperId: string; truckType: string | null; pickupDate: Date | null }, origin: string | null, destination: string | null) {
  if (!origin || !destination || !t.truckType) return null;
  const on = (t.pickupDate ?? new Date()).getTime();
  const same = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'accent' }) === 0;
  const rows = cards.filter(
    (r) => r.truckType === t.truckType && same(r.origin, origin) && same(r.destination, destination) && r.validFrom.getTime() <= on && r.validTo.getTime() >= on && (r.shipperId === t.shipperId || r.shipperId === null),
  );
  return rows.find((r) => r.shipperId === t.shipperId) ?? rows.find((r) => r.shipperId === null) ?? null;
}

/** Trucks of this type that can take a load that day: active, documents fine on the date, not busy. */
export async function freeTrucks(carrierId: string, truckType: string | null, on: Date | null) {
  if (!truckType) return [];
  const day = on ?? new Date();
  const trucks = await prisma.truck.findMany({ where: { carrierId, truckType, isActive: true }, orderBy: { number: 'asc' } });
  const busy = new Set(
    (await prisma.trip.findMany({
      where: { carrierId, truckId: { not: null }, status: { in: ['TRUCK_CONFIRMED', 'CLEARED', 'READY_FOR_PICKUP', 'IN_TRANSIT', 'ON_HOLD'] } },
      select: { truckId: true },
    })).map((t) => t.truckId),
  );
  const ok = (d: Date | null) => !!d && d >= day;
  return trucks.filter((t) => !busy.has(t.id) && ok(t.rcExpiry) && ok(t.insuranceExpiry) && ok(t.permitExpiry) && ok(t.fitnessExpiry) && ok(t.pucExpiry));
}

