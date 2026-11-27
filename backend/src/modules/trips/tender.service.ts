import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError, notFound } from '../../lib/errors';
import { toNumber } from '../../lib/validate';
import { audit } from '../../lib/audit';
import { getPolicy } from '../policies/policies.routes';

/*
 * Contract-rate offers. The shipper types no price: every carrier with a valid rate-card line for
 * the trip's cities and truck type is a candidate, ordered by that rate. Only the lowest is offered
 * the load, at its contract rate; a pass or a missed deadline moves the offer to the next one.
 * The first carrier to accept is awarded the trip at the rate on its Quote row.
 */

export const tripInclude = {
  lane: true,
  pickupAddress: true,
  dropAddress: true,
  carrier: { select: { id: true, name: true } },
  quotes: { include: { carrier: { include: { performance: true } } }, orderBy: [{ sequence: 'asc' as const }, { createdAt: 'asc' as const }] },
  documents: { orderBy: { createdAt: 'asc' as const } },
  claims: { orderBy: { createdAt: 'asc' as const } },
  invoices: { orderBy: { createdAt: 'desc' as const } },
  exceptions: { orderBy: { createdAt: 'desc' as const } },
} satisfies Prisma.TripInclude;
export type TripFull = Prisma.TripGetPayload<{ include: typeof tripInclude }>;

/** Trip statuses before an award (QUOTES_RECEIVED is kept for old rows). */
export const OFFERING = ['QUOTES_REQUESTED', 'QUOTES_RECEIVED'] as const;

const OFFER_CLOSED = () => new HttpError(409, 'OFFER_CLOSED', 'This load is no longer offered to you.');

export async function loadTrip(tripId: string, shipperId?: string) {
  const trip = await prisma.trip.findFirst({ where: { id: tripId, ...(shipperId ? { shipperId } : {}) }, include: tripInclude });
  if (!trip) throw notFound('That trip no longer exists.');
  return trip;
}

// ---------- candidates ----------

export interface Candidate {
  carrierId: string;
  carrierName: string;
  rate: number;
  rateCardLineId: string;
  transitDays: number | null;
  perfScore: number;
}

/** Tie-break only: higher is better. Carriers with no record are scored at a neutral level. */
function perfScore(p: { onTimePct: number; acceptPct: number; podDays: Prisma.Decimal } | null) {
  const onTime = p?.onTimePct ?? 70;
  const accept = p?.acceptPct ?? 70;
  const pod = Math.max(0, Math.min(100, 100 - ((p ? toNumber(p.podDays)! : 3) - 1) * 20));
  return 0.5 * onTime + 0.3 * accept + 0.2 * pod;
}

export const noContractRate = (origin: string, destination: string, truckType: string) =>
  new HttpError(400, 'NO_CONTRACT_RATE', `No contract rate for ${origin} → ${destination}, ${truckType}. Add one in Master data › Rate cards.`, {
    rate: `No contract rate for ${origin} → ${destination}, ${truckType}.`,
  });

/**
 * Every carrier with a contract line for this city pair and truck type whose rate card is valid on
 * the pickup day (YYYY-MM-DD), who is active or invited (not inactive) and in the shipper's carrier list. Cheapest first; ties
 * go to the better performance score, then the name.
 */
export async function offerCandidates(shipperId: string, origin: string, destination: string, truckType: string, pickupDay: string): Promise<Candidate[]> {
  const lines = await prisma.rateCardLine.findMany({
    where: {
      truckType,
      origin: { equals: origin, mode: 'insensitive' },
      destination: { equals: destination, mode: 'insensitive' },
      rateCard: { shipperId, carrier: { status: { in: ['ACTIVE', 'INVITED'] }, listedBy: { some: { shipperId, isActive: true } } } },
    },
    include: { rateCard: { include: { carrier: { include: { performance: true } } } } },
  });
  const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
  const out: Candidate[] = [];
  for (const l of lines) {
    const from = day(l.rateCard.validFrom);
    const to = day(l.rateCard.validTo);
    if ((from && from > pickupDay) || (to && to < pickupDay)) continue;
    out.push({
      carrierId: l.rateCard.carrierId,
      carrierName: l.rateCard.carrier.name,
      rate: toNumber(l.rate)!,
      rateCardLineId: l.id,
      transitDays: l.transitDays,
      perfScore: perfScore(l.rateCard.carrier.performance),
    });
  }
  return out.sort((a, b) => a.rate - b.rate || b.perfScore - a.perfScore || a.carrierName.localeCompare(b.carrierName));
}

/** Quote rows for an ordered candidate list: the first is offered now, the rest wait in line. */
export function offerRows(candidates: Candidate[], windowHours: number, now = new Date()) {
  const respondBy = new Date(now.getTime() + windowHours * 3600_000);
  return {
    respondBy,
    rows: candidates.map((c, i) => ({
      carrierId: c.carrierId,
      amount: new Prisma.Decimal(c.rate),
      rateCardLineId: c.rateCardLineId,
      sequence: i + 1,
      status: i === 0 ? 'REQUESTED' : 'QUEUED',
      offeredAt: i === 0 ? now : null,
      respondBy: i === 0 ? respondBy : null,
    })),
  };
}

// ---------- advancing the line ----------

type Tx = Prisma.TransactionClient;

/**
 * Offers the load to the next carrier in line, or closes the request when none is left. Conditional
 * updates make a second caller a no-op. Returns what happened, for the audit trail.
 */
async function offerNext(tx: Tx, tripId: string, windowHours: number, now: Date): Promise<{ offeredTo: { carrierId: string; carrier: string; amount: number; sequence: number; of: number } | null }> {
  const next = await tx.quote.findFirst({ where: { tripId, status: 'QUEUED' }, orderBy: { sequence: 'asc' }, include: { carrier: { select: { name: true } } } });
  if (!next) {
    await tx.trip.updateMany({ where: { id: tripId, status: 'QUOTES_REQUESTED', quotesClosedAt: null }, data: { quotesClosedAt: now } });
    return { offeredTo: null };
  }
  const respondBy = new Date(now.getTime() + windowHours * 3600_000);
  const claimed = await tx.quote.updateMany({ where: { id: next.id, status: 'QUEUED' }, data: { status: 'REQUESTED', offeredAt: now, respondBy } });
  if (claimed.count === 0) return { offeredTo: null };
  await tx.trip.update({ where: { id: tripId }, data: { quoteDeadline: respondBy } });
  const of = await tx.quote.count({ where: { tripId } });
  return { offeredTo: { carrierId: next.carrierId, carrier: next.carrier.name, amount: toNumber(next.amount)!, sequence: next.sequence ?? 0, of } };
}

async function afterAdvance(tripId: string, result: Awaited<ReturnType<typeof offerNext>>, offered: number) {
  if (result.offeredTo) {
    const o = result.offeredTo;
    await audit('tender-agent', 'OFFER_SENT', { carrier: o.carrier, amount: o.amount, sequence: o.sequence, of: o.of }, { tripId });
  } else {
    await audit('tender-agent', 'OFFERS_EXHAUSTED', { carriers: offered }, { tripId });
    const t = await prisma.trip.findUnique({ where: { id: tripId }, include: { pickupAddress: true, dropAddress: true, lane: true } });
    if (t) {
      const lane = `${t.pickupAddress?.city ?? t.lane?.origin ?? ''} → ${t.dropAddress?.city ?? t.lane?.destination ?? ''}`;
      await notifyShipper(t.shipperId, { kind: 'OFFERS_EXHAUSTED', tripId, title: `No carrier accepted ${t.number} (${lane})`, body: 'Send again or cancel the trip.' });
    }
  }
}

/** The offer is open: REQUESTED for this carrier on a trip still looking for one. */
async function openOffer(tx: Tx, tripId: string, carrierId: string) {
  const quote = await tx.quote.findFirst({ where: { tripId, carrierId, status: 'REQUESTED' }, include: { trip: true, carrier: { select: { name: true } } } });
  if (!quote || quote.offeredAt == null || quote.trip.status !== 'QUOTES_REQUESTED' || quote.trip.cancelledAt || quote.trip.carrierId) throw OFFER_CLOSED();
  return quote;
}

/** Tells every active user of the shipper company (in-app bell). */
export async function notifyShipper(companyId: string, n: { kind: string; tripId: string; title: string; body?: string }, tx: Tx | typeof prisma = prisma) {
  const users = await tx.user.findMany({ where: { companyId, isActive: true }, select: { id: true } });
  if (!users.length) return;
  await tx.notification.createMany({ data: users.map((u) => ({ companyId, userId: u.id, kind: n.kind, tripId: n.tripId, title: n.title, body: n.body ?? null })) });
}

const inr = (n: number) => '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 2 });

/**
 * Carrier accepts the offer at the contract rate on its Quote row (the amount never comes from the
 * caller) and the trip is awarded at once. No shipper approval; the shipper is notified.
 */
export async function acceptOffer(tripId: string, carrierId: string, userId: string): Promise<void> {
  const now = new Date();
  const done = await prisma.$transaction(async (tx) => {
    const quote = await openOffer(tx, tripId, carrierId);
    if (quote.amount == null) throw OFFER_CLOSED();
    const trip = await tx.trip.updateMany({
      where: { id: tripId, status: 'QUOTES_REQUESTED', carrierId: null, cancelledAt: null },
      data: { status: 'AWARDED', carrierId, awardedAmount: quote.amount, awardedAt: now, awardedById: userId, quotesClosedAt: now },
    });
    if (trip.count === 0) throw OFFER_CLOSED();
    const upd = await tx.quote.updateMany({ where: { id: quote.id, status: 'REQUESTED' }, data: { status: 'AWARDED', isWinner: true, respondedById: userId, quotedAt: now } });
    if (upd.count === 0) throw OFFER_CLOSED(); // rolls the trip update back
    await tx.quote.updateMany({ where: { tripId, id: { not: quote.id }, status: { in: ['QUEUED', 'REQUESTED'] } }, data: { status: 'WITHDRAWN' } });
    await tx.approval.updateMany({ where: { tripId, kind: 'AWARD', status: 'PENDING' }, data: { status: 'REJECTED', reason: 'Awarded on carrier acceptance', decidedAt: now } });
    const t = await tx.trip.findUniqueOrThrow({ where: { id: tripId }, include: { pickupAddress: true, dropAddress: true, lane: true } });
    const lane = `${t.pickupAddress?.city ?? t.lane?.origin ?? ''} → ${t.dropAddress?.city ?? t.lane?.destination ?? ''}`;
    const amount = toNumber(quote.amount)!;
    await notifyShipper(quote.trip.shipperId, { kind: 'OFFER_ACCEPTED', tripId, title: `${quote.carrier.name} accepted ${t.number} (${lane}) at ${inr(amount)}`, body: 'Awarded at the contract rate.' }, tx);
    return { carrier: quote.carrier.name, amount };
  });
  await audit(userId, 'OFFER_ACCEPTED', { carrier: done.carrier, amount: done.amount }, { tripId });
  await audit(userId, 'AWARDED', { carrier: done.carrier, amount: done.amount }, { tripId });
}

/** Carrier passes; the offer moves to the next carrier, or the request closes. */
export async function declineOffer(tripId: string, carrierId: string, userId: string, reason?: string): Promise<void> {
  const now = new Date();
  const text = reason?.trim() ? reason.trim().slice(0, 200) : null;
  const trip = await prisma.trip.findUnique({ where: { id: tripId }, select: { shipperId: true } });
  const hours = trip ? (await getPolicy(trip.shipperId)).quoteWindowHours : 4;
  const r = await prisma.$transaction(async (tx) => {
    const quote = await openOffer(tx, tripId, carrierId);
    const upd = await tx.quote.updateMany({ where: { id: quote.id, status: 'REQUESTED' }, data: { status: 'DECLINED', respondedById: userId, declineReason: text, quotedAt: now } });
    if (upd.count === 0) throw OFFER_CLOSED();
    return { carrier: quote.carrier.name, next: await offerNext(tx, tripId, hours, now), total: await tx.quote.count({ where: { tripId } }) };
  });
  await audit(userId, 'OFFER_DECLINED', { carrier: r.carrier, reason: text }, { tripId, reason: text ?? undefined });
  await afterAdvance(tripId, r.next, r.total);
}

/** Marks offers whose deadline has passed EXPIRED and moves each trip on. Returns how many expired. */
export async function expireOffers(now: Date = new Date()): Promise<number> {
  const due = await prisma.quote.findMany({
    where: { status: 'REQUESTED', respondBy: { lt: now }, trip: { status: 'QUOTES_REQUESTED', cancelledAt: null, carrierId: null } },
    include: { carrier: { select: { name: true } }, trip: { select: { shipperId: true } } },
    orderBy: { respondBy: 'asc' },
  });
  let count = 0;
  for (const q of due) {
    const hours = (await getPolicy(q.trip.shipperId)).quoteWindowHours;
    const r = await prisma.$transaction(async (tx) => {
      const upd = await tx.quote.updateMany({ where: { id: q.id, status: 'REQUESTED', respondBy: { lt: now } }, data: { status: 'EXPIRED' } });
      if (upd.count === 0) return null;
      return { next: await offerNext(tx, q.tripId, hours, now), total: await tx.quote.count({ where: { tripId: q.tripId } }) };
    });
    if (!r) continue;
    count++;
    await audit('tender-agent', 'OFFER_EXPIRED', { carrier: q.carrier.name }, { tripId: q.tripId });
    await afterAdvance(q.tripId, r.next, r.total);
  }
  return count;
}

/** @deprecated Kept so older callers still compile; offers now advance through expireOffers. */
export async function syncTrip(_tripId?: string): Promise<void> {
  await expireOffers();
}

// ---------- restart ----------

interface Actor {
  id: string;
  name: string;
}

/**
 * Throws NO_CONTRACT_RATE if the trip has no candidate for `pickupDay`; otherwise replaces the offer
 * list from the lowest carrier. Prices are re-read from the current rate cards.
 */
export async function rebuildOffers(trip: TripFull, pickupDay: string): Promise<{ candidates: Candidate[]; respondBy: Date }> {
  const origin = trip.pickupAddress?.city ?? trip.lane?.origin ?? '';
  const destination = trip.dropAddress?.city ?? trip.lane?.destination ?? '';
  const candidates = await offerCandidates(trip.shipperId, origin, destination, trip.truckType ?? '', pickupDay);
  if (!candidates.length) throw noContractRate(origin, destination, trip.truckType ?? '');
  const policy = await getPolicy(trip.shipperId);
  const { rows, respondBy } = offerRows(candidates, policy.quoteWindowHours);
  await prisma.$transaction([
    prisma.approval.updateMany({ where: { tripId: trip.id, kind: 'AWARD', status: 'PENDING' }, data: { status: 'REJECTED', reason: 'Offers restarted', decidedAt: new Date() } }),
    prisma.quote.deleteMany({ where: { tripId: trip.id } }),
    prisma.quote.createMany({ data: rows.map((r) => ({ ...r, tripId: trip.id })) }),
    prisma.trip.update({ where: { id: trip.id }, data: { status: 'QUOTES_REQUESTED', quotesClosedAt: null, quoteDeadline: respondBy } }),
  ]);
  await audit('tender-agent', 'OFFER_SENT', { carrier: candidates[0].carrierName, amount: candidates[0].rate, sequence: 1, of: candidates.length }, { tripId: trip.id });
  return { candidates, respondBy };
}

/** Shipper restarts the offers from the lowest carrier after "No carrier accepted". */
export async function sendAgain(tripId: string, shipperId: string, actor: Actor) {
  const trip = await loadTrip(tripId, shipperId);
  if (trip.status !== 'QUOTES_REQUESTED' || !trip.quotesClosedAt) throw new HttpError(409, 'NOT_CLOSED', 'Offers can be sent again once every carrier has passed or not answered.');
  const day = (trip.pickupDate ?? new Date()).toISOString().slice(0, 10);
  const r = await rebuildOffers(trip, day);
  await audit(actor.id, 'OFFERS_RESTARTED', { carriers: r.candidates.length, first: r.candidates[0].carrierName, amount: r.candidates[0].rate }, { tripId: trip.id });
  return { offeredTo: r.candidates[0].carrierName, amount: r.candidates[0].rate, carriers: r.candidates.length, respondBy: r.respondBy };
}


