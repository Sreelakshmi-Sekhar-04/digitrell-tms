import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler, badRequest } from '../../lib/errors';
import { Validator } from '../../lib/validate';
import { awardQuote, loadTrip, retender, syncTrip, tripInclude, undoAward } from './tender.service';
import { GROUPS, tripDetail, tripSummary } from './trip.view';
import { acceptPod, approveInvoice, markHardCopy, payInvoice, queryInvoice, raiseClaim, withdrawClaim } from './billing.service';
import { CANCEL_REASONS, askMoreCarriers, cancelPreview, cancelTrip, carriersNotAsked, decideFix, editBooking, editRules, extendDeadline } from './exceptions.service';
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
  QUOTE_RECEIVED: (d) => `${d.carrier} quoted ₹${Number(d.amount).toLocaleString('en-IN')}`,
  QUOTE_DECLINED: (d) => `${d.carrier} passed`,
  QUOTES_CLOSED: (d) => `Quotes closed: ${d.quoted} of ${d.asked} quoted (${d.reason})`,
  AWARDED: (d) => `Awarded to ${d.carrier} at ₹${Number(d.amount).toLocaleString('en-IN')}${d.recommended ? '' : ' (not the recommended carrier)'}`,
  AWARD_UNDONE: (d) => `Award to ${d.carrier} undone`,
  AUTO_AWARD_SKIPPED: (d) => `Automatic award skipped: ${d.reason}`,
  QUOTES_REJECTED: (d) => `All quotes rejected; ${d.carriersAskedAgain} carriers asked again`,
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
  INVOICE_QUERIED: (d) => `Invoice ${d.invoice} queried`,
  INVOICE_PAID: (d) => `Paid ₹${Number(d.total).toLocaleString('en-IN')} by ${d.mode === 'UPI' ? 'UPI' : 'bank transfer'}, ref ${d.reference}`,
  TRIP_CLOSED: () => 'Trip closed',
  TRIP_CANCELLED: () => 'Booking cancelled',
  BOOKING_EDITED: (d) => `Booking edited${d.requoted ? '; carriers asked to quote again' : ''}`,
  DEADLINE_EXTENDED: (d) => `Quote deadline extended by ${d.hours} h`,
  CARRIERS_ADDED: (d) => `${d.added} more carrier${Number(d.added) > 1 ? 's' : ''} asked to quote`,
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
    await syncTrip(req.params.id);
    const trip = await loadTrip(req.params.id, shipperId);
    const logs = await prisma.auditLog.findMany({ where: { tripId: trip.id }, orderBy: { createdAt: 'desc' }, take: 50 });
    const userIds = [...new Set(logs.map((l) => l.actor).filter((a) => !a.includes('-agent') && !a.startsWith('carrier:')))];
    const users = new Map((await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
    const activity = logs.map((l) => ({
      at: l.createdAt,
      actor: AGENTS[l.actor] ?? users.get(l.actor) ?? (l.actor.startsWith('carrier:') ? 'Carrier' : 'System'),
      action: l.action,
      text: (ACTION_TEXT[l.action] ?? (() => l.action))((l.data ?? {}) as Record<string, unknown>) + (l.reason && ['QUOTES_REJECTED', 'INVOICE_QUERIED', 'TRIP_CANCELLED', 'FIX_REJECTED'].includes(l.action) ? ` — “${l.reason}”` : ''),
    }));
    const policy = await getPolicy(shipperId);
    const extra = { cancel: cancelPreview(trip, req.user!.role), edit: editRules(trip), carriersNotAsked: await carriersNotAsked(trip) };
    res.json({ trip: { ...tripDetail(trip, activity, { podRule: policy.podRule, paymentApprovalAbove: Number(policy.paymentApprovalAbove) }), ...extra } });
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

// ---------- exceptions: cancel, edit, widen the request, fixes on the road ----------

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
  '/:id/carriers',
  asyncHandler(async (req, res) => {
    const ids = Array.isArray(req.body?.carrierIds) ? req.body.carrierIds.map(String) : [];
    await askMoreCarriers(req.params.id, req.user!.companyId, actorOf(req), ids);
    res.json({ ok: true });
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
