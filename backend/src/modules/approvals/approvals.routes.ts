import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { HttpError, asyncHandler, notFound } from '../../lib/errors';
import { Validator, toNumber } from '../../lib/validate';
import { loadTrip } from '../trips/tender.service';
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
        continue; // carrier acceptance awards directly; old AWARD rows are rejected by migration
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

/** Approve: award the carrier that accepted, or approve the invoice for payment. */
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
    throw new HttpError(409, 'NOT_WAITING', 'Carrier acceptance awards the trip directly; there is nothing to approve.');
  }),
);

/** Reject: not approve the accepted carrier and offer the next one (award), or query the invoice back to the carrier (payment). Reason required. */
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
    throw new HttpError(409, 'NOT_WAITING', 'Carrier acceptance awards the trip directly; there is nothing to reject.');
  }),
);
