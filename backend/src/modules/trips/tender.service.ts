import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError, forbidden, notFound } from '../../lib/errors';
import { toNumber } from '../../lib/validate';
import { audit } from '../../lib/audit';
import { recommendationReason, scoreQuotes, type QuoteInput } from './scoring';

/** Awards can be undone for this long; losing carriers are only told after it (assumption, plan §7.3). */
export const UNDO_MINUTES = 10;

export const tripInclude = {
  lane: true,
  pickupAddress: true,
  dropAddress: true,
  carrier: { select: { id: true, name: true } },
  quotes: { include: { carrier: { include: { performance: true } } }, orderBy: { createdAt: 'asc' as const } },
  documents: { orderBy: { createdAt: 'asc' as const } },
  claims: { orderBy: { createdAt: 'asc' as const } },
  invoices: { orderBy: { createdAt: 'desc' as const } },
  exceptions: { orderBy: { createdAt: 'desc' as const } },
} satisfies Prisma.TripInclude;
export type TripFull = Prisma.TripGetPayload<{ include: typeof tripInclude }>;

const OPEN = ['QUOTES_REQUESTED', 'QUOTES_RECEIVED'] as const;

export function quoteInputs(trip: TripFull): QuoteInput[] {
  return trip.quotes
    .filter((q) => q.status === 'QUOTED' && q.amount != null)
    .map((q) => ({
      id: q.id,
      carrierId: q.carrierId,
      carrierName: q.carrier.name,
      amount: toNumber(q.amount)!,
      perf: q.carrier.performance
        ? { trips: q.carrier.performance.trips, onTimePct: q.carrier.performance.onTimePct, podDays: toNumber(q.carrier.performance.podDays)!, acceptPct: q.carrier.performance.acceptPct }
        : null,
    }));
}

export function scored(trip: TripFull) {
  const list = scoreQuotes(quoteInputs(trip), toNumber(trip.lane?.budget));
  return { list, reason: recommendationReason(list) };
}

export async function loadTrip(tripId: string, shipperId?: string) {
  const trip = await prisma.trip.findFirst({ where: { id: tripId, ...(shipperId ? { shipperId } : {}) }, include: tripInclude });
  if (!trip) throw notFound('That trip no longer exists.');
  return trip;
}

/** An award needs a person unless the lane says otherwise; one pending approval per trip. */
async function ensureAwardApproval(trip: TripFull) {
  const existing = await prisma.approval.findFirst({ where: { tripId: trip.id, kind: 'AWARD', status: 'PENDING' } });
  if (!existing) await prisma.approval.create({ data: { tripId: trip.id, companyId: trip.shipperId, kind: 'AWARD', payload: {} } });
}

/**
 * Closes the quote request when every carrier has answered or the deadline has passed, then
 * applies the lane's award rule. Safe to call on every read: it only acts once.
 */
export async function syncTrip(tripId: string): Promise<void> {
  const trip = await prisma.trip.findUnique({ where: { id: tripId }, include: tripInclude });
  if (!trip || !OPEN.includes(trip.status as (typeof OPEN)[number]) || trip.quotesClosedAt) return;
  const allAnswered = trip.quotes.length > 0 && trip.quotes.every((q) => q.status !== 'REQUESTED');
  const due = trip.quoteDeadline != null && trip.quoteDeadline <= new Date();
  if (!allAnswered && !due) return;

  const claimed = await prisma.trip.updateMany({ where: { id: trip.id, quotesClosedAt: null }, data: { quotesClosedAt: new Date() } });
  if (claimed.count === 0) return; // another request closed it first
  await audit('tender-agent', 'QUOTES_CLOSED', { quoted: quoteInputs(trip).length, asked: trip.quotes.length, reason: allAnswered ? 'all replied' : 'deadline' }, { tripId: trip.id });

  const { list } = scored(trip);
  if (!list.length) return; // no quotes: the shipper chooses what next (re-tender)

  if (trip.lane?.awardRule === 'AUTO_LOWEST' && trip.lane.budget != null) {
    const budget = toNumber(trip.lane.budget)!;
    const lowest = [...list].sort((a, b) => a.amount - b.amount)[0];
    const priorAwards = await prisma.quote.count({ where: { carrierId: lowest.carrierId, status: 'AWARDED', trip: { shipperId: trip.shipperId } } });
    // BRD §6: no agent awards a first trip to a new carrier on its own; never above budget.
    if (lowest.amount <= budget && priorAwards > 0) {
      await awardQuote(trip.id, lowest.id, null, 'Lane rule: lowest quote within budget, awarded automatically.');
      return;
    }
    await audit('bid-evaluation-agent', 'AUTO_AWARD_SKIPPED', { reason: lowest.amount > budget ? 'over budget' : 'first trip with this carrier' }, { tripId: trip.id });
  }
  await ensureAwardApproval(trip);
}

/** Called when a carrier quotes or declines (integration point for the carrier module). */
export async function receiveQuote(tripId: string, carrierId: string, amount: number | null) {
  const trip = await loadTrip(tripId);
  const quote = trip.quotes.find((q) => q.carrierId === carrierId);
  if (!quote) throw new HttpError(404, 'NOT_FOUND', 'This carrier was not asked to quote on this trip.');
  if (!OPEN.includes(trip.status as (typeof OPEN)[number]) || trip.quotesClosedAt) throw new HttpError(409, 'CLOSED', 'This quote request is closed.');
  if (quote.status !== 'REQUESTED' && quote.status !== 'QUOTED') throw new HttpError(409, 'CLOSED', 'This carrier has already answered.');

  await prisma.quote.update({
    where: { id: quote.id },
    data: amount == null ? { status: 'DECLINED', amount: null, quotedAt: new Date() } : { status: 'QUOTED', amount: new Prisma.Decimal(amount), quotedAt: new Date() },
  });
  if (amount != null && trip.status === 'QUOTES_REQUESTED') await prisma.trip.update({ where: { id: trip.id }, data: { status: 'QUOTES_RECEIVED' } });
  await audit(`carrier:${carrierId}`, amount == null ? 'QUOTE_DECLINED' : 'QUOTE_RECEIVED', { carrier: quote.carrier.name, amount }, { tripId: trip.id });

  const fresh = await loadTrip(trip.id);
  if (amount != null && fresh.lane?.awardRule !== 'AUTO_LOWEST') await ensureAwardApproval(fresh);
  await syncTrip(trip.id);
}

interface Actor {
  id: string;
  name: string;
}

/** Checks a person may approve this amount (BRD §6: nobody commits money above their limit). */
export async function assertCanApprove(actor: Actor, amount: number) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: actor.id } });
  const limit = toNumber(user.approvalLimit);
  if (limit == null) throw forbidden("Your role can't approve awards. Your logistics head or an approver will get it.");
  if (amount > limit) throw forbidden(`₹${amount.toLocaleString('en-IN')} is above your approval limit of ₹${limit.toLocaleString('en-IN')}. Ask your logistics head to approve it.`);
}

/** Awards one quote. `actor` null means the lane rule awarded it. */
export async function awardQuote(tripId: string, quoteId: string, actor: Actor | null, note?: string) {
  const trip = await loadTrip(tripId);
  if (!OPEN.includes(trip.status as (typeof OPEN)[number])) throw new HttpError(409, 'NOT_OPEN', 'This trip is not waiting for an award any more.');
  const quote = trip.quotes.find((q) => q.id === quoteId);
  if (!quote || quote.status !== 'QUOTED' || quote.amount == null) throw new HttpError(409, 'NOT_QUOTED', 'That carrier has no quote to award.');
  const amount = toNumber(quote.amount)!;
  if (actor) await assertCanApprove(actor, amount);

  const now = new Date();
  await prisma.$transaction([
    prisma.quote.update({ where: { id: quote.id }, data: { status: 'AWARDED', isWinner: true } }),
    prisma.quote.updateMany({ where: { tripId: trip.id, id: { not: quote.id }, status: 'QUOTED' }, data: { status: 'LOST' } }),
    prisma.quote.updateMany({ where: { tripId: trip.id, status: 'REQUESTED' }, data: { status: 'WITHDRAWN' } }),
    prisma.trip.update({
      where: { id: trip.id },
      data: { status: 'AWARDED', carrierId: quote.carrierId, awardedAmount: quote.amount, awardedAt: now, awardedById: actor?.id ?? null, quotesClosedAt: trip.quotesClosedAt ?? now },
    }),
    prisma.approval.updateMany({ where: { tripId: trip.id, kind: 'AWARD', status: 'PENDING' }, data: { status: 'APPROVED', approverId: actor?.id ?? null, decidedAt: now } }),
  ]);
  const { list } = scored(trip);
  const recommended = list[0]?.id === quote.id;
  await audit(actor?.id ?? 'bid-evaluation-agent', 'AWARDED', { carrier: quote.carrier.name, amount, recommended, note }, { tripId: trip.id, reason: note });
}

export async function undoAward(tripId: string, shipperId: string, actor: Actor) {
  const trip = await loadTrip(tripId, shipperId);
  if (trip.status !== 'AWARDED' || !trip.awardedAt) throw new HttpError(409, 'NOT_AWARDED', 'This trip has no award to undo.');
  if (Date.now() - trip.awardedAt.getTime() > UNDO_MINUTES * 60_000) {
    throw new HttpError(409, 'TOO_LATE', `Awards can be undone for ${UNDO_MINUTES} minutes. The carrier has started; ask them to cancel instead.`);
  }
  const reopen = trip.quoteDeadline != null && trip.quoteDeadline > new Date();
  await prisma.$transaction([
    prisma.quote.updateMany({ where: { tripId: trip.id, status: { in: ['AWARDED', 'LOST'] } }, data: { status: 'QUOTED', isWinner: false } }),
    prisma.quote.updateMany({ where: { tripId: trip.id, status: 'WITHDRAWN' }, data: { status: reopen ? 'REQUESTED' : 'WITHDRAWN' } }),
    prisma.trip.update({
      where: { id: trip.id },
      data: { status: 'QUOTES_RECEIVED', carrierId: null, awardedAmount: null, awardedAt: null, awardedById: null, quotesClosedAt: reopen ? null : trip.quotesClosedAt },
    }),
    prisma.approval.create({ data: { tripId: trip.id, companyId: trip.shipperId, kind: 'AWARD', payload: {} } }),
  ]);
  await audit(actor.id, 'AWARD_UNDONE', { carrier: trip.carrier?.name }, { tripId: trip.id });
}

/** Rejects every quote and asks the same approved carriers again with a fresh deadline. */
export async function retender(tripId: string, shipperId: string, actor: Actor, reason: string, windowHours: number) {
  const trip = await loadTrip(tripId, shipperId);
  if (!OPEN.includes(trip.status as (typeof OPEN)[number])) throw new HttpError(409, 'NOT_OPEN', 'Quotes can only be re-requested before an award.');
  const carriers = await prisma.laneCarrier.findMany({ where: { laneId: trip.laneId ?? '' } });
  if (!carriers.length) throw new HttpError(409, 'NO_CARRIERS', 'This lane has no approved carriers left. Add carriers to the lane first.');
  const previous = quoteInputs(trip).map((q) => ({ carrier: q.carrierName, amount: q.amount }));
  await prisma.$transaction([
    prisma.quote.deleteMany({ where: { tripId: trip.id } }),
    prisma.quote.createMany({ data: carriers.map((c) => ({ tripId: trip.id, carrierId: c.carrierId })) }),
    prisma.trip.update({ where: { id: trip.id }, data: { status: 'QUOTES_REQUESTED', quotesClosedAt: null, quoteDeadline: new Date(Date.now() + windowHours * 3600_000) } }),
    prisma.approval.updateMany({ where: { tripId: trip.id, kind: 'AWARD', status: 'PENDING' }, data: { status: 'REJECTED', approverId: actor.id, reason, decidedAt: new Date() } }),
  ]);
  await audit(actor.id, 'QUOTES_REJECTED', { previous, carriersAskedAgain: carriers.length }, { tripId: trip.id, reason });
}
