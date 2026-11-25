import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { HttpError, asyncHandler, notFound } from '../../lib/errors';
import { Validator, toNumber } from '../../lib/validate';
import { getPolicy } from '../policies/policies.routes';
import { awardQuote, loadTrip, retender, scored } from '../trips/tender.service';
import { syncDueTrips } from '../trips/trips.routes';
import { approveInvoice, currentInvoice, invoiceChecks, queryInvoice } from '../trips/billing.service';
import { decideFix, type Proposal } from '../trips/exceptions.service';

/**
 * The approvals inbox (BRD §4: recommendation, reasons, alternatives; Approve / Change / Reject).
 * Carrier awards (phase 3) and carrier invoices to pay (phase 4).
 */
export const approvalsRouter = Router();
const inr = (n: number) => '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 2 });

export interface ApprovalItem {
  id: string;
  kind: 'AWARD' | 'PAYMENT' | 'EXCEPTION';
  kindLabel: string;
  tripId: string;
  ref: string;
  summary: string;
  reason: string;
  amount: number;
  quoted?: number;
  asked?: number;
  createdAt: Date;
}

/** Everything waiting for a shipper decision, oldest first (also used by the Home dashboard). */
export async function listApprovals(companyId: string): Promise<ApprovalItem[]> {
  {
    await syncDueTrips(companyId);
    const pending = await prisma.approval.findMany({ where: { companyId, status: 'PENDING' }, orderBy: { createdAt: 'asc' } });
    const items: ApprovalItem[] = [];
    for (const a of pending) {
      if (!a.tripId) continue;
      const trip = await loadTrip(a.tripId, companyId);
      const lane = `${trip.pickupAddress?.city} → ${trip.dropAddress?.city}`;
      if (a.kind === 'AWARD') {
        const { list, reason } = scored(trip);
        if (!list.length) continue;
        const top = list[0];
        items.push({
          id: a.id, kind: 'AWARD', kindLabel: 'Carrier award', tripId: trip.id, ref: trip.number,
          summary: `Award ${lane} to ${top.carrierName}`,
          reason: `${list.length} of ${trip.quotes.length} quoted. ${reason}`,
          amount: top.amount, quoted: list.length, asked: trip.quotes.length, createdAt: a.createdAt,
        });
      } else if (a.kind === 'PAYMENT') {
        const inv = currentInvoice(trip);
        if (!inv || inv.status !== 'RECEIVED') continue;
        const checks = invoiceChecks(trip, inv);
        const failed = checks.filter((c) => !c.ok);
        items.push({
          id: a.id, kind: 'PAYMENT', kindLabel: 'Payment', tripId: trip.id, ref: inv.number,
          summary: `Pay ${trip.carrier?.name} for ${trip.number} (${lane})`,
          reason: failed.length ? `Check: ${failed.map((c) => `${c.label.toLowerCase()} — ${c.detail}`).join('; ')}.` : 'POD accepted, invoice matches the award.',
          amount: toNumber(inv.total)!, createdAt: a.createdAt,
        });
      } else if (a.kind === 'EXCEPTION') {
        const ex = trip.exceptions.find((x) => x.status === 'AWAITING_SHIPPER');
        const p = ex?.proposal as unknown as Proposal | null;
        if (!ex || !p) continue;
        items.push({
          id: a.id, kind: 'EXCEPTION', kindLabel: 'Exception fix', tripId: trip.id, ref: trip.number,
          summary: `${p.label} on ${lane}`,
          reason: `${ex.description}. ${p.newEta ? `New ETA ${new Date(p.newEta).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' })}. ` : ''}Extra ${inr(p.extraCost)}, billed to you.`,
          amount: p.extraCost, createdAt: a.createdAt,
        });
      }
    }
    return items;
  }
}

approvalsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const items = await listApprovals(req.user!.companyId);
    res.json({ approvals: items, count: items.length });
  }),
);

async function pending(id: string, companyId: string) {
  const a = await prisma.approval.findFirst({ where: { id, companyId } });
  if (!a || !a.tripId) throw notFound('That approval no longer exists.');
  if (a.status !== 'PENDING') throw new HttpError(409, 'DECIDED', 'Someone has already decided this. Refresh to see the latest.');
  return a;
}

/** Approve: award the recommended carrier, or approve the invoice for payment. */
approvalsRouter.post(
  '/:id/approve',
  asyncHandler(async (req, res) => {
    const a = await pending(req.params.id, req.user!.companyId);
    const actor = { id: req.user!.id, name: req.user!.name };
    if (a.kind === 'PAYMENT') {
      await approveInvoice(a.tripId!, req.user!.companyId, actor);
      return res.json({ ok: true });
    }
    if (a.kind === 'EXCEPTION') {
      await decideFix(a.tripId!, req.user!.companyId, { ...actor, role: req.user!.role }, true, null);
      return res.json({ ok: true });
    }
    const trip = await loadTrip(a.tripId!, req.user!.companyId);
    const top = scored(trip).list[0];
    if (!top) throw new HttpError(409, 'NO_QUOTES', 'There is no quote to award yet.');
    await awardQuote(trip.id, top.id, actor);
    res.json({ ok: true, carrier: top.carrierName, amount: top.amount, text: `${inr(top.amount)} to ${top.carrierName}` });
  }),
);

/** Reject: re-request quotes (award), or query the invoice back to the carrier (payment). Reason required. */
approvalsRouter.post(
  '/:id/reject',
  asyncHandler(async (req, res) => {
    const a = await pending(req.params.id, req.user!.companyId);
    const v = new Validator(req.body);
    const reason = v.text('reason', 'why you are rejecting', { required: true, max: 200 });
    v.done();
    const actor = { id: req.user!.id, name: req.user!.name };
    if (a.kind === 'PAYMENT') {
      await queryInvoice(a.tripId!, req.user!.companyId, actor, reason!);
      return res.json({ ok: true });
    }
    if (a.kind === 'EXCEPTION') {
      await decideFix(a.tripId!, req.user!.companyId, { ...actor, role: req.user!.role }, false, reason);
      return res.json({ ok: true });
    }
    const policy = await getPolicy(req.user!.companyId);
    await retender(a.tripId!, req.user!.companyId, actor, reason!, policy.quoteWindowHours);
    res.json({ ok: true });
  }),
);
