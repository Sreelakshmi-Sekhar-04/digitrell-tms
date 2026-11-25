import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler, badRequest } from '../../lib/errors';
import { Validator } from '../../lib/validate';
import { awardQuote, loadTrip, retender, syncTrip, tripInclude, undoAward } from './tender.service';
import { GROUPS, tripDetail, tripSummary } from './trip.view';
import { getPolicy } from '../policies/policies.routes';

export const tripsRouter = Router();
const PAGE_SIZE = 20;

/** Closes any quote requests whose deadline has passed, so lists and inboxes are current. */
export async function syncDueTrips(shipperId: string) {
  const due = await prisma.trip.findMany({
    where: { shipperId, status: { in: ['QUOTES_REQUESTED', 'QUOTES_RECEIVED'] }, quotesClosedAt: null, quoteDeadline: { lte: new Date() } },
    select: { id: true },
  });
  for (const t of due) await syncTrip(t.id);
}

function groupWhere(tab: string): Prisma.TripWhereInput {
  switch (tab) {
    case 'action':
      return { OR: [{ status: { in: [...GROUPS.action] } }, { status: 'QUOTES_REQUESTED', quotesClosedAt: { not: null } }] };
    case 'transit':
    case 'delivered':
    case 'closed':
      return { status: { in: [...GROUPS[tab]] } };
    default:
      return {};
  }
}

tripsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const shipperId = req.user!.companyId;
    await syncDueTrips(shipperId);
    const tab = String(req.query.tab ?? 'all');
    const q = String(req.query.q ?? '').trim();
    const laneId = String(req.query.laneId ?? '');
    const days = Number(req.query.days ?? 0);
    const page = Math.max(1, Number(req.query.page ?? 1) || 1);

    const base: Prisma.TripWhereInput = {
      shipperId,
      ...(laneId ? { laneId } : {}),
      ...(days > 0 ? { createdAt: { gte: new Date(Date.now() - days * 86400_000) } } : {}),
      ...(q
        ? {
            OR: [
              { number: { contains: q, mode: 'insensitive' } },
              { reference: { contains: q, mode: 'insensitive' } },
              { material: { contains: q, mode: 'insensitive' } },
              { pickupAddress: { city: { contains: q, mode: 'insensitive' } } },
              { dropAddress: { city: { contains: q, mode: 'insensitive' } } },
              { carrier: { name: { contains: q, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const where = { AND: [base, groupWhere(tab)] };
    const [rows, total, ...counts] = await Promise.all([
      prisma.trip.findMany({ where, include: tripInclude, orderBy: { createdAt: 'desc' }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
      prisma.trip.count({ where }),
      ...['all', 'action', 'transit', 'delivered', 'closed'].map((t) => prisma.trip.count({ where: { AND: [base, groupWhere(t)] } })),
    ]);
    res.json({
      trips: rows.map(tripSummary),
      page, pageSize: PAGE_SIZE, total,
      counts: { all: counts[0], action: counts[1], transit: counts[2], delivered: counts[3], closed: counts[4] },
    });
  }),
);

const ACTION_TEXT: Record<string, (d: Record<string, unknown>) => string> = {
  BOOKED: (d) => `Booked on the ${d.channel ?? 'web'}`,
  QUOTES_REQUESTED: (d) => `Quote request sent to ${(d.carriers as string[])?.length ?? 0} carriers`,
  QUOTE_RECEIVED: (d) => `${d.carrier} quoted ₹${Number(d.amount).toLocaleString('en-IN')}`,
  QUOTE_DECLINED: (d) => `${d.carrier} passed`,
  QUOTES_CLOSED: (d) => `Quotes closed: ${d.quoted} of ${d.asked} quoted (${d.reason})`,
  AWARDED: (d) => `Awarded to ${d.carrier} at ₹${Number(d.amount).toLocaleString('en-IN')}${d.recommended ? '' : ' (not the recommended carrier)'}`,
  AWARD_UNDONE: (d) => `Award to ${d.carrier} undone`,
  AUTO_AWARD_SKIPPED: (d) => `Automatic award skipped: ${d.reason}`,
  QUOTES_REJECTED: (d) => `All quotes rejected; ${d.carriersAskedAgain} carriers asked again`,
};
const AGENTS: Record<string, string> = { 'tender-agent': 'Tender agent', 'bid-evaluation-agent': 'Bid evaluation agent' };

tripsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const shipperId = req.user!.companyId;
    await loadTrip(req.params.id, shipperId); // 404 for other companies
    await syncTrip(req.params.id);
    const trip = await loadTrip(req.params.id, shipperId);
    const logs = await prisma.auditLog.findMany({ where: { tripId: trip.id }, orderBy: { createdAt: 'desc' }, take: 50 });
    const userIds = [...new Set(logs.map((l) => l.actor).filter((a) => !a.includes('-agent') && !a.startsWith('carrier:')))];
    const users = new Map((await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
    const activity = logs.map((l) => ({
      at: l.createdAt,
      actor: AGENTS[l.actor] ?? users.get(l.actor) ?? (l.actor.startsWith('carrier:') ? 'Carrier' : 'System'),
      action: l.action,
      text: (ACTION_TEXT[l.action] ?? (() => l.action))((l.data ?? {}) as Record<string, unknown>) + (l.reason && l.action === 'QUOTES_REJECTED' ? ` — “${l.reason}”` : ''),
    }));
    res.json({ trip: tripDetail(trip, activity) });
  }),
);

tripsRouter.post(
  '/:id/award',
  asyncHandler(async (req, res) => {
    const trip = await loadTrip(req.params.id, req.user!.companyId);
    const quoteId = String(req.body?.quoteId ?? '');
    if (!quoteId) throw badRequest('Choose a carrier to award.', { quoteId: 'Choose a carrier to award.' });
    await awardQuote(trip.id, quoteId, { id: req.user!.id, name: req.user!.name });
    res.json({ ok: true });
  }),
);

tripsRouter.post(
  '/:id/undo-award',
  asyncHandler(async (req, res) => {
    await undoAward(req.params.id, req.user!.companyId, { id: req.user!.id, name: req.user!.name });
    res.json({ ok: true });
  }),
);

tripsRouter.post(
  '/:id/retender',
  asyncHandler(async (req, res) => {
    const v = new Validator(req.body);
    const reason = v.text('reason', 'why the quotes are rejected', { required: true, max: 200 });
    const policy = await getPolicy(req.user!.companyId);
    const hours = req.body?.windowHours == null ? policy.quoteWindowHours : v.int('windowHours', 'the quote window', 1, 48);
    v.done();
    await retender(req.params.id, req.user!.companyId, { id: req.user!.id, name: req.user!.name }, reason!, hours!);
    res.json({ ok: true });
  }),
);
