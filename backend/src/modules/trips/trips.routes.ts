import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler, badRequest } from '../../lib/errors';
import { Validator } from '../../lib/validate';
import { expireOffers, loadTrip, sendAgain, tripInclude } from './tender.service';
import { GROUPS, tripDetail, tripSummary } from './trip.view';
import { acceptPod, approveInvoice, markHardCopy, payInvoice, queryInvoice, raiseClaim, withdrawClaim } from './billing.service';
import { CANCEL_REASONS, cancelPreview, cancelTrip, decideFix, editBooking, editRules, extendDeadline } from './exceptions.service';
import { getPolicy } from '../policies/policies.routes';
import { requireRole } from '../../middleware/auth';
import { lrHtml } from './lr.service';

export const tripsRouter = Router();

const PAGE_SIZE = 20;

/** Moves on any offers whose response time has passed, so lists and inboxes are current. */
export async function syncDueTrips(_shipperId?: string) {
  await expireOffers();
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
    const policy = await getPolicy(shipperId);
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
      trips: rows.map((t) => tripSummary(t, policy.podRule)),
      page, pageSize: PAGE_SIZE, total,
      counts: { all: counts[0], action: counts[1], transit: counts[2], delivered: counts[3], closed: counts[4] },
    });
  }),
);

export const ACTION_TEXT: Record<string, (d: Record<string, unknown>) => string> = {
  BOOKED: (d) => `Booked on the ${d.channel ?? 'web'}`,
  QUOTES_REQUESTED: (d) => `Quote request sent to ${(d.carriers as string[])?.length ?? 0} carriers`,
  OFFER_SENT: (d) => `Offered to ${d.carrier} at ₹${Number(d.amount).toLocaleString('en-IN')} (contract rate, ${d.sequence} of ${d.of})`,
  OFFER_ACCEPTED: (d) => `${d.carrier} accepted at ₹${Number(d.amount).toLocaleString('en-IN')}`,
  OFFER_DECLINED: (d) => `${d.carrier} passed${d.reason ? ` — “${d.reason}”` : ''}`,
  OFFER_EXPIRED: (d) => `${d.carrier} did not answer in time`,
  OFFERS_EXHAUSTED: () => 'No carrier accepted',
  OFFERS_RESTARTED: (d) => `Offers sent again from the lowest rate: ${d.first} at ₹${Number(d.amount).toLocaleString('en-IN')}`,
  ACCEPTANCE_REJECTED: (d) => `${d.carrier} was not approved; offered to the next carrier`,
  AWARDED: (d) => `Awarded to ${d.carrier} at ₹${Number(d.amount).toLocaleString('en-IN')} (contract rate)`,
  TRUCK_CONFIRMED: (d) => `Truck ${d.truck} confirmed, driver ${d.driver}`,
  DOCUMENTS_ISSUED: (d) => `LR ${d.lr} and e-way bill ${d.ewayBill} issued`,
  TRACK_REACHED_PICKUP: () => 'Driver reached pickup',
  TRACK_LOADED: () => 'Loaded; on the way',
  TRACK_LOCATION: (d) => `Location: ${d.location ?? 'shared'}`,
  TRACK_REACHED_DROP: () => 'Driver reached drop',
  DELIVERED: (d) => `Delivered: ${d.goodQty} good${Number(d.damagedQty) ? `, ${d.damagedQty} damaged` : ''}`,
  POD_RECEIVED: (d) => `POD photo received${d.qrMatched ? ', QR matches LR' : ', QR did not match'}${d.remarks ? ` — “${d.remarks}”` : ''}`,
  POD_ACCEPTED: () => 'POD accepted',
  POD_HARD_COPY_RECEIVED: () => 'POD hard copy received',
  CLAIM_RAISED: (d) => `Claim ${d.claim} raised: ₹${Number(d.amount).toLocaleString('en-IN')}`,
  CLAIM_ACCEPTED: (d) => `Carrier accepted claim ${d.claim}`,
  CLAIM_DISPUTED: (d) => `Carrier disputed claim ${d.claim}${d.note ? `: “${d.note}”` : ''}`,
  CLAIM_WITHDRAWN: (d) => `Claim ${d.claim} withdrawn`,
  INVOICE_RECEIVED: (d) => `Invoice ${d.invoice} received: ₹${Number(d.total).toLocaleString('en-IN')}`,
  INVOICE_APPROVED: (d) => `Invoice ${d.invoice} approved${d.by ? ` (${d.by})` : ''}`,
  PAYMENT_REMINDER: (d) => `Payment reminder for invoice ${d.invoice} (due ${String(d.dueDate).slice(0, 10)})`,
  INVOICE_QUERIED: (d) => `Invoice ${d.invoice} queried`,
  INVOICE_PAID: (d) => `Paid ₹${Number(d.total).toLocaleString('en-IN')} by ${d.mode === 'UPI' ? 'UPI' : 'bank transfer'}, ref ${d.reference}`,
  TRIP_CLOSED: () => 'Trip closed',
  TRIP_CANCELLED: () => 'Booking cancelled',
  BOOKING_EDITED: (d) => `Booking edited${d.requoted ? '; offers restarted from the lowest rate' : ''}`,
  DEADLINE_EXTENDED: (d) => `Response time extended by ${d.hours} h`,
  DELAY_NOTICE: (d) => `Delay: ${d.description}`,
  EXCEPTION_REPORTED: (d) => `Problem reported: ${String(d.kind).toLowerCase()} — ${d.description}`,
  FIX_PROPOSED: (d) => `Fix proposed: ${d.label}${Number(d.extraCost) ? ` (₹${Number(d.extraCost).toLocaleString('en-IN')}, paid by ${d.payer === 'SHIPPER' ? 'you' : 'carrier'})` : ''}`,
  FIX_APPROVED: (d) => `Fix approved: ${d.label}`,
  FIX_REJECTED: (d) => `Fix rejected: ${d.label}`,
  EXCEPTION_RESOLVED: (d) => `Back on the road${d.truck ? ` with truck ${d.truck}` : ''}`,
};
export const AGENTS: Record<string, string> = {
  'tender-agent': 'Tender agent', 'bid-evaluation-agent': 'Bid evaluation agent', 'documents-agent': 'Documents agent',
  'tracking-agent': 'Tracking agent', 'pod-agent': 'POD agent', 'billing-agent': 'Billing agent', 'exception-agent': 'Exception agent', coordinator: 'Coordinator', carrier: 'Carrier',
};

tripsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const shipperId = req.user!.companyId;
    await loadTrip(req.params.id, shipperId); // 404 for other companies
    await expireOffers();
    const trip = await loadTrip(req.params.id, shipperId);
    const logs = await prisma.auditLog.findMany({ where: { tripId: trip.id }, orderBy: { createdAt: 'desc' }, take: 50 });
    const userIds = [...new Set(logs.map((l) => l.actor).filter((a) => !a.includes('-agent') && !a.startsWith('carrier:')))];
    const users = new Map((await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
    const activity = logs.map((l) => ({
      at: l.createdAt,
      actor: AGENTS[l.actor] ?? users.get(l.actor) ?? (l.actor.startsWith('carrier:') ? 'Carrier' : 'System'),
      action: l.action,
      text: (ACTION_TEXT[l.action] ?? (() => l.action))((l.data ?? {}) as Record<string, unknown>) + (l.reason && ['ACCEPTANCE_REJECTED', 'INVOICE_QUERIED', 'TRIP_CANCELLED', 'FIX_REJECTED'].includes(l.action) ? ` — “${l.reason}”` : ''),
    }));
    const policy = await getPolicy(shipperId);
    const extra = { cancel: cancelPreview(trip, req.user!.role), edit: editRules(trip), canApprove: false };
    res.json({ trip: { ...tripDetail(trip, activity, { podRule: policy.podRule, paymentApprovalAbove: Number(policy.paymentApprovalAbove) }), ...extra } });
  }),
);

// ---------- LR (the carrier issues it; the shipper can view and print it) ----------

/** Printable LR as an HTML page. */
tripsRouter.get(
  '/:id/lr',
  asyncHandler(async (req, res) => {
    await loadTrip(req.params.id, req.user!.companyId);
    res.type('html').send(await lrHtml(req.params.id));
  }),
);

// ---------- POD, claims and billing (shipper decisions) ----------

const actorOf = (req: { user?: { id: string; name: string; role: string } }) => ({ id: req.user!.id, name: req.user!.name, role: req.user!.role });

tripsRouter.post(
  '/:id/pod/accept',
  asyncHandler(async (req, res) => {
    await acceptPod(req.params.id, req.user!.companyId, actorOf(req));
    res.json({ ok: true });
  }),
);

tripsRouter.post(
  '/:id/pod/hard-copy',
  asyncHandler(async (req, res) => {
    await markHardCopy(req.params.id, req.user!.companyId, actorOf(req));
    res.json({ ok: true });
  }),
);

tripsRouter.post(
  '/:id/claims',
  asyncHandler(async (req, res) => {
    const v = new Validator(req.body);
    const kind = v.oneOf('kind', 'damage or shortage', ['DAMAGE', 'SHORTAGE'] as const);
    const qty = v.int('qty', 'the number of units', 1, 100000);
    const unitValue = v.money('unitValue', 'the value of one unit', { required: true });
    const description = v.text('description', 'what is wrong', { required: true, max: 200 });
    v.done();
    const claim = await raiseClaim(req.params.id, req.user!.companyId, actorOf(req), { kind: kind!, qty: qty!, unitValue: unitValue!, description: description! });
    res.status(201).json({ claim: { id: claim.id, number: claim.number } });
  }),
);

tripsRouter.post(
  '/:id/claims/:claimId/withdraw',
  asyncHandler(async (req, res) => {
    await withdrawClaim(req.params.claimId, req.user!.companyId, actorOf(req));
    res.json({ ok: true });
  }),
);

tripsRouter.post(
  '/:id/invoice/approve',
  asyncHandler(async (req, res) => {
    await approveInvoice(req.params.id, req.user!.companyId, actorOf(req));
    res.json({ ok: true });
  }),
);

tripsRouter.post(
  '/:id/invoice/query',
  asyncHandler(async (req, res) => {
    const v = new Validator(req.body);
    const reason = v.text('reason', 'what is wrong with the invoice', { required: true, max: 200 });
    v.done();
    await queryInvoice(req.params.id, req.user!.companyId, actorOf(req), reason!);
    res.json({ ok: true });
  }),
);

tripsRouter.post(
  '/:id/invoice/pay',
  asyncHandler(async (req, res) => {
    const v = new Validator(req.body);
    const mode = v.oneOf('mode', 'how you paid', ['UPI', 'BANK'] as const);
    const reference = v.text('reference', 'the UPI or bank reference', { required: true, max: 40 });
    v.done();
    await payInvoice(req.params.id, req.user!.companyId, actorOf(req), mode!, reference!);
    res.json({ ok: true });
  }),
);

/** After "No carrier accepted": offer again from the lowest contract rate (re-priced from current rate cards). */
tripsRouter.post(
  '/:id/send-again',
  asyncHandler(async (req, res) => {
    const r = await sendAgain(req.params.id, req.user!.companyId, { id: req.user!.id, name: req.user!.name });
    res.json({ ok: true, ...r });
  }),
);

// ---------- exceptions: cancel, edit, extend, fixes on the road ----------

tripsRouter.post(
  '/:id/cancel',
  asyncHandler(async (req, res) => {
    const v = new Validator(req.body);
    const reason = v.oneOf('reason', 'a reason', CANCEL_REASONS);
    const note = v.text('note', 'a note', { max: 200 });
    if (reason === 'OTHER' && !note) v.fail('note', 'Say what the reason is.');
    v.done();
    await cancelTrip(req.params.id, req.user!.companyId, actorOf(req), reason!, note);
    res.json({ ok: true });
  }),
);

tripsRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const v = new Validator(req.body);
    const edit: Parameters<typeof editBooking>[3] = {};
    const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
    if (v.has('pickupDate')) {
      const d = v.text('pickupDate', 'the pickup date', { required: true });
      if (d && (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(d)))) v.fail('pickupDate', 'Choose a valid date.');
      else if (d && d < today) v.fail('pickupDate', 'Pickup date cannot be in the past.');
      else if (d && Date.parse(d) - Date.parse(today) > 60 * 86400_000) v.fail('pickupDate', 'Book at most 60 days ahead.');
      else if (d) edit.pickupDate = d;
    }
    if (v.has('weightTonnes')) {
      const w = Number(String(req.body.weightTonnes).replace(',', '.'));
      if (!Number.isFinite(w) || w <= 0 || w > 60) v.fail('weightTonnes', 'Weight must be between 0.1 and 60 tonnes.');
      else edit.weightTonnes = w;
    }
    if (v.has('material')) edit.material = v.text('material', 'what is being moved', { required: true, max: 80 }) ?? undefined;
    if (v.has('receiverContact')) edit.receiverContact = v.text('receiverContact', 'the receiver contact', { max: 80 });
    if (v.has('reference')) edit.reference = v.text('reference', 'your reference', { max: 40 });
    if (v.has('notes')) edit.notes = v.text('notes', 'notes', { max: 200 });
    v.done();
    const r = await editBooking(req.params.id, req.user!.companyId, actorOf(req), edit);
    res.json({ ok: true, ...r });
  }),
);

tripsRouter.post(
  '/:id/extend',
  asyncHandler(async (req, res) => {
    const v = new Validator(req.body);
    const hours = v.int('hours', 'the extra hours', 1, 24);
    v.done();
    const until = await extendDeadline(req.params.id, req.user!.companyId, actorOf(req), hours!);
    res.json({ ok: true, quoteDeadline: until });
  }),
);

tripsRouter.post(
  '/:id/exception/approve',
  asyncHandler(async (req, res) => {
    await decideFix(req.params.id, req.user!.companyId, actorOf(req), true, null);
    res.json({ ok: true });
  }),
);

tripsRouter.post(
  '/:id/exception/reject',
  asyncHandler(async (req, res) => {
    const v = new Validator(req.body);
    const reason = v.text('reason', 'why', { max: 200 });
    v.done();
    await decideFix(req.params.id, req.user!.companyId, actorOf(req), false, reason);
    res.json({ ok: true });
  }),
);
