import { Router, type Request } from 'express';
import { prisma } from '../../lib/prisma';
import { HttpError, asyncHandler, badRequest, notFound } from '../../lib/errors';
import { formatTruckNumber } from '../../shared/carrier';
import { Validator, toNumber } from '../../lib/validate';
import { requireCarrierRole } from '../../middleware/auth';
import { acceptOffer, declineOffer, expireOffers } from '../trips/tender.service';
import { currentInvoice } from '../trips/billing.service';
import { openException } from '../trips/trip.view';
import { getCarrierPolicy } from './policy.service';
import { assignTruck, assignmentOptions, type Actor } from './execution.service';
import { eventTimeline, markDelivered, proposeCarrierFix, recordEvent, reportProblem, respondClaim, resumeTrip, uploadPod, type ProposalInput } from './onroad.service';
import { decideInvoiceApproval, draftFor, pendingInvoiceApprovals, remindPayment, sendInvoice } from './invoicing.service';
import { podState } from '../trips/billing.service';
import { getPolicy } from '../policies/policies.routes';
import { TRACKING_EVENTS } from '../trips/billing.service';
import { EXCEPTION_KINDS, FIX_KINDS } from '../trips/exceptions.service';
import { issueLr, lrHtml, readEwayBill, reissueLr } from '../trips/lr.service';
import { activeRateCards, carrierState, freeTrucks, loadExtras, myTrips, pickRate, type CarrierTrip, type ExtrasMap } from './loads.service';

/**
 * Loads (carrier spec C1, C2): contract-rate offers and won trips. The carrier is offered a load at the
 * shipper's contract rate and can only accept or pass; the amount is fixed when the offer is created.
 * Accept and decline go through the shared tender service so both sides stay consistent.
 */
export const loadsRouter = Router();
const canQuote = requireCarrierRole(['OWNER', 'TRAFFIC_MANAGER'], 'Only the owner or traffic manager can answer load offers.');
const canExecute = requireCarrierRole(['OWNER', 'TRAFFIC_MANAGER'], 'Only the owner or traffic manager can assign trucks.');
const canRun = requireCarrierRole(['OWNER', 'TRAFFIC_MANAGER'], 'Only the owner or traffic manager can record trip steps, problems, the POD and claims.');
const canBill = requireCarrierRole(['OWNER', 'ACCOUNTS'], 'Only the owner or accounts can send invoices and payment reminders.');
const actorOf = (req: Request): Actor => ({ id: req.user!.id, name: req.user!.name, roles: req.user!.roles });
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const inr = (n: number) => '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
/** Lists and Home show the most recent loads; older ones are reached by search in a later phase. */
const LIST_LIMIT = 300;
const RANK = { action: 0, transit: 1, waiting: 2, delivered: 3, closed: 4 } as const;

/** Moves offers whose response time passed on to the next carrier (the tender timer), before showing them. */
async function syncOpen() {
  await expireOffers();
}

function summary(t: CarrierTrip, carrierId: string, extras?: ExtrasMap) {
  const q = t.quotes.find((x) => x.carrierId === carrierId);
  const state = carrierState(t, carrierId, extras?.get(t.id));
  const mine = t.carrierId === carrierId;
  return {
    id: t.id,
    number: t.number,
    shipper: t.shipper.name,
    origin: t.pickupAddress?.city ?? t.lane?.origin ?? null,
    destination: t.dropAddress?.city ?? t.lane?.destination ?? null,
    pickupDate: iso(t.pickupDate),
    material: t.material,
    weightTonnes: t.weightKg != null ? toNumber(t.weightKg)! / 1000 : null,
    truckType: t.truckType,
    amount: mine ? toNumber(t.awardedAmount) : toNumber(q?.amount ?? null),
    respondBy: state.panel === 'offer' ? (q?.respondBy ?? null) : null,
    ...state,
  };
}

loadsRouter.get(
  '/loads',
  asyncHandler(async (req, res) => {
    const carrierId = req.user!.companyId;
    await syncOpen();
    const trips = await myTrips(carrierId, {}, LIST_LIMIT);
    const extras = await loadExtras(trips.map((t) => t.id));
    let list = trips.map((t) => summary(t, carrierId, extras));
    const counts = {
      all: list.length,
      action: list.filter((l) => l.group === 'action').length,
      transit: list.filter((l) => l.group === 'transit').length,
      delivered: list.filter((l) => l.group === 'delivered').length,
      closed: list.filter((l) => l.group === 'closed').length,
    };
    const group = String(req.query.group ?? 'all');
    if (group !== 'all') list = list.filter((l) => l.group === group);
    const q = String(req.query.q ?? '').trim().toLowerCase();
    if (q) list = list.filter((l) => [l.number, l.shipper, l.origin, l.destination, l.material].some((x) => x?.toLowerCase().includes(q)));
    // Needs action first, then the most recent.
    list.sort((a, b) => RANK[a.group] - RANK[b.group]);
    res.json({ loads: list, counts });
  }),
);

/** Only events this carrier may see: its own offer, its own trip from the award on. */
const VISIBLE: Record<string, (d: Record<string, unknown>) => string> = {
  TRUCK_CONFIRMED: (d) => `Truck ${d.truck} and driver ${d.driver} confirmed`,
  DOCUMENTS_ISSUED: (d) => `LR ${d.lr} and e-way bill issued`,
  TRACK_REACHED_PICKUP: () => 'Driver reached pickup',
  TRACK_LOADED: () => 'Loaded; on the road',
  TRACK_LOCATION: (d) => `Location: ${d.location ?? 'shared'}`,
  TRACK_REACHED_DROP: () => 'Reached drop',
  DELIVERED: (d) => `Delivered: ${d.goodQty} good, ${d.damagedQty} damaged`,
  POD_RECEIVED: () => 'POD photo received',
  POD_ACCEPTED: () => 'POD accepted',
  EXCEPTION_REPORTED: (d) => `Problem reported: ${d.description}`,
  FIX_PROPOSED: (d) => `Fix proposed: ${d.label}`,
  EXCEPTION_RESOLVED: () => 'Problem fixed; back on the road',
  INVOICE_RECEIVED: (d) => `Invoice ${d.invoice} sent: ${inr(Number(d.total))}`,
  INVOICE_APPROVED: (d) => `Shipper approved invoice ${d.invoice}`,
  INVOICE_QUERIED: (d) => `Shipper queried invoice ${d.invoice}`,
  PAYMENT_REMINDER: (d) => `Payment reminder sent for invoice ${d.invoice}`,
  POD_HARD_COPY_RECEIVED: () => 'Shipper received the POD hard copy',
  CLAIM_RAISED: (d) => `Claim ${d.claim} raised: ${inr(Number(d.amount))}`,
  CLAIM_ACCEPTED: (d) => `You accepted claim ${d.claim}`,
  CLAIM_DISPUTED: (d) => `You disputed claim ${d.claim}`,
  DELAY_NOTICE: (d) => `Delay: ${d.description}`,
  FIX_APPROVED: (d) => `Shipper approved the fix: ${d.label}`,
  FIX_REJECTED: (d) => `Shipper rejected the fix: ${d.label}`,
  INVOICE_PAID: (d) => `Paid ${inr(Number(d.total))}`,
  TRIP_CLOSED: () => 'Trip closed',
  CANCELLED: () => 'Shipper cancelled the trip',
};

async function activity(t: CarrierTrip, carrierId: string) {
  const mine = t.carrierId === carrierId;
  const rows = await prisma.auditLog.findMany({ where: { tripId: t.id }, orderBy: { createdAt: 'desc' }, take: 100 });
  const out: { at: Date; text: string }[] = [];
  for (const r of rows) {
    const d = (r.data ?? {}) as Record<string, unknown>;
    if (r.action === 'AWARDED') {
      if (mine) out.push({ at: r.createdAt, text: `Awarded to you at ${inr(Number(d.amount))}` });
      continue;
    }
    // Offer events are built below from this carrier's own quote row; shipper-side offer/approval events never show.
    if (r.action.startsWith('OFFER') || r.action === 'ACCEPTANCE_REJECTED') continue;
    if (r.action !== 'CANCELLED' && !mine) continue;
    const fn = VISIBLE[r.action];
    if (fn) out.push({ at: r.createdAt, text: fn(d) });
  }
  // This carrier's own offer timeline, from its own quote row (never other carriers').
  const q = t.quotes.find((x) => x.carrierId === carrierId);
  if (q?.offeredAt) {
    out.push({ at: q.offeredAt, text: `Load offered to you${q.amount != null ? ` at ${inr(Number(q.amount))}` : ''}` });
    if (q.status === 'AWARDED') out.push({ at: q.quotedAt ?? q.offeredAt, text: 'You accepted the load and won it' });
    if (q.status === 'ACCEPTED' || q.status === 'REJECTED_BY_SHIPPER') out.push({ at: q.quotedAt ?? q.offeredAt, text: 'You accepted the load' }); // legacy rows
    if (q.status === 'REJECTED_BY_SHIPPER') out.push({ at: q.quotedAt ?? q.offeredAt, text: 'The shipper did not approve this load' });
    if (q.status === 'DECLINED') out.push({ at: q.quotedAt ?? q.offeredAt, text: `You passed${q.declineReason ? `: ${q.declineReason}` : ''}` });
    if (q.status === 'EXPIRED') out.push({ at: q.respondBy ?? q.offeredAt, text: 'No answer in time; the offer moved to the next carrier' });
  }
  return out.sort((a, b) => +b.at - +a.at);
}

async function loadFor(id: string, carrierId: string) {
  const [t] = await myTrips(carrierId, { id });
  if (!t) throw notFound('That load no longer exists, or it was not sent to you.');
  return t;
}

loadsRouter.get(
  '/loads/:id',
  asyncHandler(async (req, res) => {
    const carrierId = req.user!.companyId;
    await syncOpen();
    const t = await loadFor(req.params.id, carrierId);
    const extras = await loadExtras([t.id]);
    const base = summary(t, carrierId, extras);
    const q = t.quotes.find((x) => x.carrierId === carrierId);
    const mine = t.carrierId === carrierId;

    let offer = null;
    if (base.panel === 'offer' && q) {
      const free = await freeTrucks(carrierId, t.truckType, t.pickupDate);
      offer = { amount: toNumber(q.amount), respondBy: q.respondBy, freeTrucks: free.map((f) => formatTruckNumber(f.number)) };
    }

    const inv = mine ? currentInvoice(t) : null;
    const ex = mine ? openException(t) : null;
    const lrDoc = t.documents.find((d) => d.kind === 'LR' && !d.isVoid);
    const ewbDoc = t.documents.find((d) => d.kind === 'EWAY_BILL' && !d.isVoid);
    const assign = mine && (base.panel === 'won' || base.panel === 'assigned') ? await assignmentOptions(carrierId, t) : null;
    const swapOptions = mine && base.panel === 'hold' ? await assignmentOptions(carrierId, t) : null;
    const timeline = mine ? await eventTimeline(t.id) : [];
    const billing = mine ? await draftFor(t, carrierId) : null;
    const podRule = mine ? (await getPolicy(t.shipperId)).podRule : 'DIGITAL';
    const pod = mine ? podState(t, podRule) : null;
    const lastReminder = inv ? await prisma.auditLog.findFirst({ where: { tripId: t.id, action: 'PAYMENT_REMINDER' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }) : null;
    res.json({
      load: {
        ...base,
        pickup: t.pickupAddress ? { name: t.pickupAddress.name, city: t.pickupAddress.city, line1: t.pickupAddress.line1 } : null,
        drop: t.dropAddress ? { name: t.dropAddress.name, city: t.dropAddress.city, line1: mine ? t.dropAddress.line1 : null } : null,
        offer,
        execution: mine
          ? {
              awardedAmount: toNumber(t.awardedAmount), awardedAt: t.awardedAt, truckNumber: t.truckNumber, driverName: t.driverName, driverPhone: t.driverPhone,
              truckId: t.truckId, driverId: t.driverId, pickupEta: t.pickupEta,
              assignment: assign,
              lr: lrDoc ? { number: lrDoc.number, issuedAt: lrDoc.createdAt, ewayBill: ewbDoc?.number ?? null } : null,
              eta: t.eta, lastLocation: t.lastLocation, lastUpdateAt: t.lastUpdateAt, deliveredAt: t.deliveredAt, goodQty: t.goodQty, damagedQty: t.damagedQty,
              deliveryRemarks: t.deliveryRemarks, receiverContact: t.receiverContact,
              tracking: { events: timeline, reachedPickup: extras.get(t.id)?.pickup ?? false, reachedDrop: extras.get(t.id)?.drop ?? false },
              swapOptions,
              pod: pod && { rule: pod.rule, uploaded: pod.photo, accepted: pod.accepted, hardCopy: pod.hardCopy, lrNumber: lrDoc?.number ?? null },
              billing,
              documents: t.documents.map((d) => ({ kind: d.kind, number: d.number, isVoid: d.isVoid, validUntil: d.validUntil, voidReason: d.voidReason, fileUrl: d.kind === 'POD' ? d.fileUrl : null })),
              invoice: inv ? { number: inv.number, freight: toNumber(inv.freight), detention: toNumber(inv.detention), claimDeduction: toNumber(inv.claimDeduction), total: toNumber(inv.total), status: inv.status, dueDate: inv.dueDate, paidAt: inv.paidAt, paymentMode: inv.paymentMode, paymentRef: inv.paymentRef, queryReason: inv.queryReason, overdue: ['RECEIVED', 'APPROVED'].includes(inv.status) && inv.dueDate.getTime() < Date.now(), lastReminderAt: lastReminder?.createdAt ?? null } : null,
              exception: ex ? { id: ex.id, decisionReason: ex.decisionReason, kind: ex.kind, description: ex.description, status: ex.status, proposal: ex.proposal, createdAt: ex.createdAt } : null,
              claims: t.claims.map((c) => ({ id: c.id, number: c.number, kind: c.kind, qty: c.qty, amount: toNumber(c.amount), status: c.status, description: c.description, carrierNote: c.carrierNote })),
            }
          : null,
        activity: await activity(t, carrierId),
      },
    });
  }),
);

/** Accept the offer at the contract rate. No body: the amount is never taken from the request. */
loadsRouter.post(
  '/loads/:id/accept',
  canQuote,
  asyncHandler(async (req, res) => {
    const carrierId = req.user!.companyId;
    await loadFor(req.params.id, carrierId);
    await acceptOffer(req.params.id, carrierId, req.user!.id);
    res.json({ ok: true });
  }),
);

/** Pass on the offer (optional reason); the shipper's list moves on to the next carrier. */
const decline = asyncHandler(async (req, res) => {
  const carrierId = req.user!.companyId;
  await loadFor(req.params.id, carrierId);
  const v = new Validator(req.body ?? {});
  const reason = v.text('reason', 'why you are passing', { max: 200 });
  v.done();
  await declineOffer(req.params.id, carrierId, req.user!.id, reason ?? undefined);
  res.json({ ok: true });
});
loadsRouter.post('/loads/:id/decline', canQuote, decline);
loadsRouter.post('/loads/:id/pass', canQuote, decline);

// ---------- Truck and driver (phase 4) and the LR (carrier-issued) ----------

/** Assign or change the truck and driver. Compliance problems need an owner override with a reason. */
loadsRouter.post(
  '/loads/:id/assign',
  canExecute,
  asyncHandler(async (req, res) => {
    const carrierId = req.user!.companyId;
    await loadFor(req.params.id, carrierId);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const v = new Validator(body);
    const truckId = v.text('truckId', 'a truck', { required: true, max: 60 });
    const driverId = v.text('driverId', 'a driver', { required: true, max: 60 });
    const pickupEta = v.date('pickupEta', 'the ETA at pickup');
    let override: { reason: string } | null = null;
    if (body.override != null && body.override !== false) {
      const ov = new Validator((body.override as Record<string, unknown>) ?? {});
      const reason = ov.text('reason', 'the reason for the override', { required: true, max: 200 });
      if (ov.fields.reason) v.fail('override', ov.fields.reason);
      else override = { reason: reason! };
    }
    v.done();
    await assignTruck(req.params.id, carrierId, actorOf(req), { truckId: truckId!, driverId: driverId!, pickupEta, override });
    res.json({ ok: true });
  }),
);

/** Issue the LR (and the e-way bill record when given) from the carrier's own series: Truck assigned → Ready for pickup. */
loadsRouter.post(
  '/loads/:id/lr',
  canExecute,
  asyncHandler(async (req, res) => {
    const carrierId = req.user!.companyId;
    await loadFor(req.params.id, carrierId);
    const eway = readEwayBill(req.body?.ewayBill);
    if (eway.error) throw badRequest(eway.error, { ewayBill: eway.error });
    const lrNumber = await issueLr(req.params.id, carrierId, { id: req.user!.id, name: req.user!.name }, { ewayBill: eway.value });
    res.json({ ok: true, lrNumber });
  }),
);

/** Void the current LR and issue a new number (reason required), until the truck leaves for the drop. */
loadsRouter.post(
  '/loads/:id/lr/reissue',
  canExecute,
  asyncHandler(async (req, res) => {
    const carrierId = req.user!.companyId;
    await loadFor(req.params.id, carrierId);
    const v = new Validator(req.body ?? {});
    const reason = v.text('reason', 'why the LR is being voided', { required: true, max: 200 });
    const eway = readEwayBill(req.body?.ewayBill);
    if (eway.error) v.fail('ewayBill', eway.error);
    v.done();
    const lrNumber = await reissueLr(req.params.id, carrierId, { id: req.user!.id, name: req.user!.name }, { reason: reason!, ewayBill: eway.value });
    res.json({ ok: true, lrNumber });
  }),
);

/** Printable LR (any carrier user; the load must be this carrier's). */
loadsRouter.get(
  '/loads/:id/lr',
  asyncHandler(async (req, res) => {
    const carrierId = req.user!.companyId;
    const t = await loadFor(req.params.id, carrierId);
    if (t.carrierId !== carrierId || !t.documents.some((d) => d.kind === 'LR' && !d.isVoid)) throw new HttpError(404, 'NOT_FOUND', 'No LR has been issued for this load yet.');
    res.type('html').send(await lrHtml(req.params.id));
  }),
);

// ---------- Phase 5: on the road ----------

const isoDateTime = (v: Validator, key: string, label: string, required = false) => {
  const s = v.text(key, label, { required, max: 40 });
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) {
    v.fail(key, `Enter ${label} as a date and time.`);
    return null;
  }
  return d;
};
const body = (req: Request) => (req.body ?? {}) as Record<string, unknown>;

/** Record a driver step in order: REACHED_PICKUP, LOADED (needs eta unless one is known), LOCATION (needs location), REACHED_DROP. */
loadsRouter.post(
  '/loads/:id/events',
  canRun,
  asyncHandler(async (req, res) => {
    const carrierId = req.user!.companyId;
    await loadFor(req.params.id, carrierId);
    const v = new Validator(body(req));
    const type = v.oneOf('type', 'a step', TRACKING_EVENTS);
    const location = v.text('location', 'the location', { max: 80, required: body(req).type === 'LOCATION' });
    const eta = isoDateTime(v, 'eta', 'the ETA');
    v.done();
    await recordEvent(req.params.id, carrierId, actorOf(req), { type: type!, location, eta });
    res.json({ ok: true });
  }),
);

/** Delivered: quantities received in good order and damaged. Needs Reached drop first. */
loadsRouter.post(
  '/loads/:id/delivered',
  canRun,
  asyncHandler(async (req, res) => {
    const carrierId = req.user!.companyId;
    await loadFor(req.params.id, carrierId);
    const v = new Validator(body(req));
    const goodQty = v.int('goodQty', 'units received in good order', 0, 1_000_000);
    const damagedQty = v.int('damagedQty', 'damaged or short units', 0, 1_000_000);
    const remarks = v.text('remarks', 'remarks', { max: 200 });
    v.done();
    await markDelivered(req.params.id, carrierId, actorOf(req), { goodQty: goodQty!, damagedQty: damagedQty!, remarks });
    res.json({ ok: true });
  }),
);

/** Reads a fix: { fix, label, newEta?, extraCost?, payer, swap?: { truckId, driverId, override?: { reason } } }. */
function readFix(v: Validator, raw: unknown, prefix = ''): ProposalInput | null {
  if (!raw || typeof raw !== 'object') {
    v.fail(prefix ? prefix.replace(/\.$/, '') : 'proposal', 'Describe the fix.');
    return null;
  }
  const o = raw as Record<string, unknown>;
  const p = new Validator(o);
  const fix = p.oneOf('fix', 'a fix', FIX_KINDS);
  const label = p.text('label', 'what the fix is', { required: true, max: 120 });
  const newEta = isoDateTime(p, 'newEta', 'the new ETA');
  const extraCost = o.extraCost != null && o.extraCost !== '' && Number(o.extraCost) !== 0 ? p.money('extraCost', 'the extra cost') : 0;
  const payer = p.oneOf('payer', 'who pays', ['CARRIER', 'SHIPPER'] as const);
  let swap: ProposalInput['swap'] = null;
  if (fix === 'SWAP') {
    const swRaw = (o.swap as Record<string, unknown> | undefined) ?? {};
    const sw = new Validator(swRaw);
    const truckId = sw.text('truckId', 'the truck to swap to', { required: true, max: 60 });
    const driverId = sw.text('driverId', 'the driver', { required: true, max: 60 });
    let override: { reason: string } | null = null;
    if (swRaw.override != null && swRaw.override !== false) {
      const ovv = new Validator((swRaw.override as Record<string, unknown>) ?? {});
      const reason = ovv.text('reason', 'the reason for the override', { required: true, max: 200 });
      if (ovv.fields.reason) sw.fields.override = ovv.fields.reason;
      else override = { reason: reason! };
    }
    for (const [k, m] of Object.entries(sw.fields)) p.fields[`swap.${k}`] = m;
    if (truckId && driverId) swap = { truckId, driverId, override };
  }
  for (const [k, m] of Object.entries(p.fields)) v.fail(prefix + k, m);
  return fix && label && payer ? { fix, label, newEta, extraCost: extraCost ?? 0, payer, swap } : null;
}

/** Report a problem on the road (trip goes ON_HOLD, except a plain delay, which is a notice). The fix may come with it. */
loadsRouter.post(
  '/loads/:id/exceptions',
  canRun,
  asyncHandler(async (req, res) => {
    const carrierId = req.user!.companyId;
    await loadFor(req.params.id, carrierId);
    const v = new Validator(body(req));
    const kind = v.oneOf('kind', 'a problem type', EXCEPTION_KINDS);
    const description = v.text('description', 'what happened', { required: true, max: 200 });
    const proposal = body(req).proposal != null ? readFix(v, body(req).proposal, 'proposal.') : null;
    v.done();
    const exceptionId = await reportProblem(req.params.id, carrierId, actorOf(req), { kind: kind!, description: description!, proposal });
    res.status(201).json({ ok: true, exceptionId });
  }),
);

/** Propose (or replace) the fix for an open problem. A cost charged to the shipper waits for the shipper's decision. */
loadsRouter.post(
  '/exceptions/:id/proposal',
  canRun,
  asyncHandler(async (req, res) => {
    const v = new Validator({});
    const proposal = readFix(v, req.body, '');
    v.done();
    await proposeCarrierFix(req.params.id, req.user!.companyId, actorOf(req), proposal!);
    res.json({ ok: true });
  }),
);

/** The fix is done: back on the road (after a swap, the new truck and driver are checked again). Optional newEta (ISO). */
loadsRouter.post(
  '/exceptions/:id/resolve',
  canRun,
  asyncHandler(async (req, res) => {
    const v = new Validator(body(req));
    const newEta = isoDateTime(v, 'newEta', 'the new ETA');
    v.done();
    await resumeTrip(req.params.id, req.user!.companyId, actorOf(req), { newEta });
    res.json({ ok: true });
  }),
);

/** Signed POD: the LR number as on the signed copy (compared with the issued LR), optional link to the photo, optional remarks (remarks send it to the shipper for review). */
loadsRouter.post(
  '/loads/:id/pod',
  canRun,
  asyncHandler(async (req, res) => {
    const carrierId = req.user!.companyId;
    await loadFor(req.params.id, carrierId);
    const v = new Validator(body(req));
    const lrNumber = v.text('lrNumber', 'the LR number on the signed copy', { required: true, max: 30 });
    const photoUrl = v.text('photoUrl', 'the photo link', { max: 500 });
    if (photoUrl && !/^https?:\/\//i.test(photoUrl)) v.fail('photoUrl', 'Enter a link that starts with http:// or https://.');
    const remarks = v.text('remarks', 'remarks', { max: 200 });
    v.done();
    await uploadPod(req.params.id, carrierId, actorOf(req), { lrNumber: lrNumber!, photoUrl, remarks });
    res.json({ ok: true });
  }),
);

/** Answer a claim the shipper raised: { accept: true } or { accept: false, note } (a reason is required to dispute). */
loadsRouter.post(
  '/claims/:id/respond',
  canRun,
  asyncHandler(async (req, res) => {
    const v = new Validator(body(req));
    const note = v.text('note', 'a note', { max: 200 });
    if (typeof body(req).accept !== 'boolean') v.fail('accept', 'Send accept: true or false.');
    v.done();
    await respondClaim(req.params.id, req.user!.companyId, actorOf(req), body(req).accept === true, note);
    res.json({ ok: true });
  }),
);

// ---------- Phase 6: billing ----------

/** Send the invoice (amounts are computed: award + detention - accepted claims). Body: { detention? }. Above the limit, non-owners get { sent: false, approvalId } and the owner decides. */
loadsRouter.post(
  '/loads/:id/invoice',
  canBill,
  asyncHandler(async (req, res) => {
    const carrierId = req.user!.companyId;
    await loadFor(req.params.id, carrierId);
    const v = new Validator(body(req));
    const raw = body(req).detention;
    const detention = raw != null && raw !== '' && Number(raw) !== 0 ? v.money('detention', 'the detention charge') : 0;
    v.done();
    res.json({ ok: true, ...(await sendInvoice(req.params.id, carrierId, actorOf(req), { detention: detention ?? 0 })) });
  }),
);

loadsRouter.post(
  '/loads/:id/invoice/remind',
  canBill,
  asyncHandler(async (req, res) => {
    const carrierId = req.user!.companyId;
    await loadFor(req.params.id, carrierId);
    await remindPayment(req.params.id, carrierId, actorOf(req));
    res.json({ ok: true });
  }),
);

// ---------- Approvals (owner: invoices above the limit) ----------

loadsRouter.get(
  '/approvals',
  asyncHandler(async (req, res) => {
    const items = req.user!.roles.includes('OWNER') ? await pendingInvoiceApprovals(req.user!.companyId) : [];
    res.json({ count: items.length, items });
  }),
);

const decideApproval = (approve: boolean) =>
  asyncHandler(async (req, res) => {
    const v = new Validator(body(req));
    const reason = v.text('reason', 'a reason', { max: 200 });
    v.done();
    res.json({ ok: true, ...(await decideInvoiceApproval(req.params.id, req.user!.companyId, actorOf(req), approve, reason)) });
  });
loadsRouter.post('/approvals/:id/approve', decideApproval(true));
loadsRouter.post('/approvals/:id/reject', decideApproval(false));

// ---------- Home (spec C2) ----------

loadsRouter.get(
  '/home',
  asyncHandler(async (req, res) => {
    const carrierId = req.user!.companyId;
    await syncOpen();
    const [trips, trucks, cards] = await Promise.all([
      myTrips(carrierId, {}, LIST_LIMIT), prisma.truck.findMany({ where: { carrierId, isActive: true } }), activeRateCards(carrierId),
    ]);
    const extras = await loadExtras(trips.map((t) => t.id));
    const loads = trips.map((t) => summary(t, carrierId, extras));
    const requests = loads.filter((l) => l.panel === 'offer').sort((a, b) => +new Date(a.respondBy!) - +new Date(b.respondBy!));
    const tomorrow = new Date(Date.now() + 86400_000);
    const freeTomorrow = (await Promise.all([...new Set(trucks.map((t) => t.truckType))].map((tt) => freeTrucks(carrierId, tt, tomorrow)))).flat();
    const unbilled = trips.filter((t) => t.carrierId === carrierId && t.status === 'POD_RECEIVED');
    const unpaid = trips.filter((t) => t.carrierId === carrierId && t.status === 'INVOICED');

    // Average margin on won trips with a known trip cost (fixed rule: (freight − cost) / freight).
    const margins: number[] = [];
    for (const t of trips.filter((x) => x.carrierId === carrierId && x.awardedAmount != null && x.status !== 'CANCELLED')) {
      const card = pickRate(cards, t, t.pickupAddress?.city ?? null, t.dropAddress?.city ?? null);
      const cost = card ? toNumber(card.tripCost) : null;
      const amt = toNumber(t.awardedAmount)!;
      if (cost != null && amt > 0) margins.push(((amt - cost) / amt) * 100);
    }
    const policy = await getCarrierPolicy(carrierId);
    const invoiceApprovals = req.user!.roles.includes('OWNER') ? await pendingInvoiceApprovals(carrierId) : [];
    const sum = (xs: typeof trips) => xs.reduce((s, t) => s + (toNumber(t.awardedAmount) ?? 0), 0);
    res.json({
      stats: {
        openRequests: { count: requests.length, firstClosesAt: requests[0]?.respondBy ?? null },
        freeTomorrow: { count: freeTomorrow.length, of: trucks.length },
        unbilled: { amount: sum(unbilled), trips: unbilled.length },
        unpaid: { amount: unpaid.reduce((s, t) => s + (toNumber(currentInvoice(t)?.total ?? null) ?? 0), 0), trips: unpaid.length },
        margin: { pct: margins.length ? Math.round((margins.reduce((a, b) => a + b, 0) / margins.length) * 10) / 10 : null, floorPct: toNumber(policy.marginFloorPct), trips: margins.length },
        onRoad: loads.filter((l) => l.panel === 'transit' || l.panel === 'hold').length,
      },
      approvals: invoiceApprovals.slice(0, 3),
      approvalsCount: invoiceApprovals.length,
      active: loads.filter((l) => l.group !== 'closed').sort((a, b) => RANK[a.group] - RANK[b.group]).slice(0, 6),
    });
  }),
);

