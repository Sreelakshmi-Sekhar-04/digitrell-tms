import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { HttpError, asyncHandler, notFound } from '../../lib/errors';
import { Validator } from '../../lib/validate';
import { getPolicy } from '../policies/policies.routes';
import { awardQuote, loadTrip, retender, scored } from '../trips/tender.service';
import { syncDueTrips } from '../trips/trips.routes';

/**
 * The approvals inbox (BRD §4: recommendation, reasons, alternatives; Approve / Change / Reject).
 * Phase 3 covers carrier awards; claims and payments join in phase 4.
 */
export const approvalsRouter = Router();

approvalsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const companyId = req.user!.companyId;
    await syncDueTrips(companyId);
    const pending = await prisma.approval.findMany({ where: { companyId, status: 'PENDING' }, orderBy: { createdAt: 'asc' } });
    const items = [];
    for (const a of pending) {
      if (a.kind !== 'AWARD' || !a.tripId) continue;
      const trip = await loadTrip(a.tripId, companyId);
      const { list, reason } = scored(trip);
      if (!list.length) continue;
      const top = list[0];
      items.push({
        id: a.id,
        kind: 'AWARD',
        kindLabel: 'Carrier award',
        tripId: trip.id,
        ref: trip.number,
        summary: `Award ${trip.pickupAddress?.city} → ${trip.dropAddress?.city} to ${top.carrierName}`,
        reason,
        amount: top.amount,
        quoted: list.length,
        asked: trip.quotes.length,
        createdAt: a.createdAt,
      });
    }
    res.json({ approvals: items, count: items.length });
  }),
);

async function pendingAward(id: string, companyId: string) {
  const a = await prisma.approval.findFirst({ where: { id, companyId } });
  if (!a || !a.tripId) throw notFound('That approval no longer exists.');
  if (a.status !== 'PENDING') throw new HttpError(409, 'DECIDED', 'Someone has already decided this. Refresh to see the latest.');
  return a;
}

/** Approve = award the recommended carrier. */
approvalsRouter.post(
  '/:id/approve',
  asyncHandler(async (req, res) => {
    const a = await pendingAward(req.params.id, req.user!.companyId);
    const trip = await loadTrip(a.tripId!, req.user!.companyId);
    const top = scored(trip).list[0];
    if (!top) throw new HttpError(409, 'NO_QUOTES', 'There is no quote to award yet.');
    await awardQuote(trip.id, top.id, { id: req.user!.id, name: req.user!.name });
    res.json({ ok: true, carrier: top.carrierName, amount: top.amount });
  }),
);

/** Reject = reject all quotes and ask the lane's carriers again. */
approvalsRouter.post(
  '/:id/reject',
  asyncHandler(async (req, res) => {
    const a = await pendingAward(req.params.id, req.user!.companyId);
    const v = new Validator(req.body);
    const reason = v.text('reason', 'why you are rejecting', { required: true, max: 200 });
    v.done();
    const policy = await getPolicy(req.user!.companyId);
    await retender(a.tripId!, req.user!.companyId, { id: req.user!.id, name: req.user!.name }, reason!, policy.quoteWindowHours);
    res.json({ ok: true });
  }),
);
