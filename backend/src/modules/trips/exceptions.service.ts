import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError, forbidden, notFound } from '../../lib/errors';
import { toNumber } from '../../lib/validate';
import { audit } from '../../lib/audit';
import { loadTrip, rebuildOffers, type TripFull } from './tender.service';

/*
 * Phase 5: when things don't go to plan (BRD §4.9, §5 "On hold" / "Cancelled", §6 Bids).
 * Cancel and edit a booking, extend an offer's response time, and handle problems on the road.
 */

type Actor = { id: string; name: string; role: string };
const conflict = (code: string, message: string) => new HttpError(409, code, message);
const inr = (n: number) => '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
const OPEN_QUOTES = ['QUOTES_REQUESTED', 'QUOTES_RECEIVED'];
const DONE = ['DELIVERED', 'POD_RECEIVED', 'INVOICED', 'CLOSED', 'CANCELLED'];
const ON_ROAD = ['IN_TRANSIT', 'ON_HOLD'];

// ---------- cancel ----------

export const CANCEL_REASONS = ['ORDER_CANCELLED', 'WRONG_DETAILS', 'OTHER_MODE', 'NO_SUITABLE_QUOTE', 'OTHER'] as const;
export const CANCEL_REASON_LABEL: Record<string, string> = {
  ORDER_CANCELLED: 'Order cancelled by the customer',
  WRONG_DETAILS: 'Wrong details, will rebook',
  OTHER_MODE: 'Moved to another mode or vendor',
  NO_SUITABLE_QUOTE: 'No suitable quote',
  OTHER: 'Other',
};

/** What cancelling will do, in plain words; shown in the dialog before anything happens. */
export function cancelPreview(trip: TripFull, role: string) {
  if (DONE.includes(trip.status)) return { allowed: false, roleOnly: false, reason: 'Delivered, billed or closed trips cannot be cancelled.', consequences: [] as string[] };
  const onRoad = ON_ROAD.includes(trip.status);
  if (onRoad && role !== 'LOGISTICS_HEAD') {
    return { allowed: false, roleOnly: true, reason: 'The goods are on the truck. Only the logistics head can cancel now.', consequences: [] as string[] };
  }
  const c: string[] = [];
  const live = trip.quotes.find((q) => ['REQUESTED', 'ACCEPTED'].includes(q.status));
  if (OPEN_QUOTES.includes(trip.status) && live) c.push(`${live.carrier.name} is told the offer is withdrawn.`);
  if (trip.carrierId) c.push(`${trip.carrier?.name} is told the award is cancelled.`);
  const docs = trip.documents.filter((d) => ['LR', 'EWAY_BILL'].includes(d.kind) && !d.isVoid);
  if (docs.length) c.push(`${docs.map((d) => (d.kind === 'LR' ? `LR ${d.number}` : `e-way bill ${d.number}`)).join(' and ')} ${docs.length > 1 ? 'are' : 'is'} marked void. The numbers are never reused.`);
  else c.push('No LR has been issued yet, so nothing is voided.');
  if (onRoad) c.push('The goods are on the truck: agree the return and any charges with the carrier directly.');
  if (trip.carrierId && !onRoad) c.push('Any cancellation charge follows your agreement with the carrier; none is calculated here.');
  return { allowed: true, roleOnly: false, reason: null, consequences: c };
}

export async function cancelTrip(tripId: string, shipperId: string, actor: Actor, reasonCode: string, note: string | null) {
  const trip = await loadTrip(tripId, shipperId);
  const p = cancelPreview(trip, actor.role);
  if (!p.allowed) throw p.roleOnly ? forbidden(p.reason!) : conflict('WRONG_STATE', p.reason!);
  const reason = `${CANCEL_REASON_LABEL[reasonCode]}${note ? `: ${note}` : ''}`;
  const now = new Date();
  await prisma.$transaction([
    prisma.quote.updateMany({ where: { tripId: trip.id, status: { in: ['QUEUED', 'REQUESTED', 'ACCEPTED', 'QUOTED'] } }, data: { status: 'WITHDRAWN' } }),
    prisma.approval.updateMany({ where: { tripId: trip.id, status: 'PENDING' }, data: { status: 'REJECTED', approverId: actor.id, reason: 'Trip cancelled', decidedAt: now } }),
    prisma.document.updateMany({ where: { tripId: trip.id, kind: { in: ['LR', 'EWAY_BILL'] } }, data: { isVoid: true } }),
    prisma.tripException.updateMany({ where: { tripId: trip.id, status: { notIn: ['RESOLVED', 'NOTICE'] } }, data: { status: 'RESOLVED', resolvedAt: now } }),
    prisma.trip.update({ where: { id: trip.id }, data: { status: 'CANCELLED', cancelledAt: now, cancelledById: actor.id, cancelReason: reason } }),
  ]);
  await audit(actor.id, 'TRIP_CANCELLED', { from: trip.status, consequences: p.consequences }, { tripId: trip.id, reason });
}

// ---------- edit ----------

export interface BookingEdit {
  pickupDate?: string;
  weightTonnes?: number;
  material?: string;
  receiverContact?: string | null;
  reference?: string | null;
  notes?: string | null;
}

/** Which parts of a booking may still change. Lane, addresses and truck type never: cancel and rebook. */
export function editRules(trip: TripFull) {
  const load = OPEN_QUOTES.includes(trip.status) || trip.status === 'BOOKED';
  const extras = !['CLOSED', 'CANCELLED'].includes(trip.status);
  // A new pickup date can change which rate cards are valid, so offers start again from the lowest carrier.
  return { load, extras, requotes: load };
}

/**
 * Edits a booking. A new pickup date while carriers are being offered the load rebuilds the offer
 * list from the start (prices re-read for that date); weight and material do not change contract rates.
 */
export async function editBooking(tripId: string, shipperId: string, actor: Actor, e: BookingEdit) {
  const trip = await loadTrip(tripId, shipperId);
  const rules = editRules(trip);
  const dateChanged = e.pickupDate !== undefined && e.pickupDate !== trip.pickupDate?.toISOString().slice(0, 10);
  const loadChanged =
    dateChanged ||
    (e.weightTonnes !== undefined && Math.round(e.weightTonnes * 1000) !== toNumber(trip.weightKg)) ||
    (e.material !== undefined && e.material !== trip.material);
  if (loadChanged && !rules.load) throw conflict('LOCKED', 'Date, weight and material are fixed once a carrier is awarded. Cancel and rebook to change them.');
  if (!rules.extras) throw conflict('LOCKED', 'This trip is closed.');

  const data: Prisma.TripUpdateInput = {
    receiverContact: e.receiverContact === undefined ? undefined : e.receiverContact,
    reference: e.reference === undefined ? undefined : e.reference,
    notes: e.notes === undefined ? undefined : e.notes,
  };
  if (loadChanged) {
    if (e.pickupDate !== undefined) data.pickupDate = new Date(`${e.pickupDate}T00:00:00.000Z`);
    if (e.weightTonnes !== undefined) data.weightKg = new Prisma.Decimal(Math.round(e.weightTonnes * 1000));
    if (e.material !== undefined) data.material = e.material;
  }
  const restart = dateChanged && OPEN_QUOTES.includes(trip.status);
  if (restart) await rebuildOffers(trip, e.pickupDate!); // throws NO_CONTRACT_RATE before anything changes
  await prisma.trip.update({ where: { id: trip.id }, data });
  await audit(actor.id, 'BOOKING_EDITED', { changes: Object.keys(e), requoted: restart }, { tripId: trip.id });
  return { requoted: restart };
}

// ---------- give the offered carrier more time ----------

/** Extends the current offer's response time. Not possible once every carrier has answered. */
export async function extendDeadline(tripId: string, shipperId: string, actor: Actor, hours: number) {
  const trip = await loadTrip(tripId, shipperId);
  const offer = trip.status === 'QUOTES_REQUESTED' ? trip.quotes.find((q) => q.status === 'REQUESTED') : undefined;
  if (!offer) throw conflict('WRONG_STATE', 'There is no open offer to extend. Use Send again if no carrier accepted.');
  const from = Math.max(Date.now(), offer.respondBy?.getTime() ?? Date.now());
  const deadline = new Date(from + hours * 3600_000);
  await prisma.$transaction([
    prisma.quote.update({ where: { id: offer.id }, data: { respondBy: deadline } }),
    prisma.trip.update({ where: { id: trip.id }, data: { quoteDeadline: deadline } }),
  ]);
  await audit(actor.id, 'DEADLINE_EXTENDED', { hours, until: deadline }, { tripId: trip.id });
  return deadline;
}

// ---------- problems on the road ----------

export const EXCEPTION_KINDS = ['BREAKDOWN', 'ACCIDENT', 'DELAY', 'OTHER'] as const;
export const FIX_KINDS = ['SWAP', 'WAIT', 'REPAIR', 'TRANSHIP'] as const;

export interface Proposal {
  fix: (typeof FIX_KINDS)[number];
  label: string;
  newEta: string | null;
  extraCost: number;
  payer: 'CARRIER' | 'SHIPPER';
  /** Carrier module: the truck and driver a SWAP moves to (checked against the assignment rules before it is proposed). */
  swap?: { truckId: string; truckNumber: string; driverId: string; driverName: string; driverPhone: string; override?: { reason: string; by: string } | null };
}

const needsShipper = (p: Proposal | null) => !!p && p.payer === 'SHIPPER' && p.extraCost > 0;

async function setProposal(exceptionId: string, trip: TripFull, p: Proposal | null) {
  const status = needsShipper(p) ? 'AWAITING_SHIPPER' : 'OPEN';
  await prisma.tripException.update({ where: { id: exceptionId }, data: { proposal: p ? (p as unknown as Prisma.InputJsonValue) : Prisma.JsonNull, status, decidedById: null, decidedAt: null, decisionReason: null } });
  await prisma.approval.updateMany({ where: { tripId: trip.id, kind: 'EXCEPTION', status: 'PENDING' }, data: { status: 'REJECTED', reason: 'Replaced by a new proposal', decidedAt: new Date() } });
  if (status === 'AWAITING_SHIPPER') {
    await prisma.approval.create({ data: { tripId: trip.id, companyId: trip.shipperId, kind: 'EXCEPTION', payload: { exceptionId } } });
  }
  return status;
}

/**
 * Driver reports a problem (integration point for the driver / exception agent). A plain delay
 * is a notice: the ETA moves, no approval needed (BRD §4.9). Anything else puts the trip on hold.
 */
export async function reportException(tripId: string, kind: (typeof EXCEPTION_KINDS)[number], description: string, proposal: Proposal | null, by = 'exception-agent') {
  const trip = await loadTrip(tripId);
  if (trip.status !== 'IN_TRANSIT') throw conflict('WRONG_STATE', 'Problems can be reported for a trip on the road.');
  if (kind === 'DELAY' && !needsShipper(proposal)) {
    await prisma.tripException.create({ data: { tripId: trip.id, kind, description, proposal: proposal ? (proposal as unknown as Prisma.InputJsonValue) : Prisma.JsonNull, status: 'NOTICE', resolvedAt: new Date() } });
    if (proposal?.newEta) await prisma.trip.update({ where: { id: trip.id }, data: { eta: new Date(proposal.newEta), lastUpdateAt: new Date() } });
    await audit(by, 'DELAY_NOTICE', { description, newEta: proposal?.newEta ?? null }, { tripId: trip.id });
    return;
  }
  const ex = await prisma.tripException.create({ data: { tripId: trip.id, kind, description } });
  await prisma.trip.update({ where: { id: trip.id }, data: { status: 'ON_HOLD', lastUpdateAt: new Date() } });
  await audit(by, 'EXCEPTION_REPORTED', { kind, description }, { tripId: trip.id });
  if (proposal) {
    await setProposal(ex.id, trip, proposal);
    await audit(by, 'FIX_PROPOSED', { label: proposal.label, extraCost: proposal.extraCost, payer: proposal.payer }, { tripId: trip.id });
  }
}

export async function proposeFix(exceptionId: string, proposal: Proposal, by = 'exception-agent') {
  const ex = await prisma.tripException.findUnique({ where: { id: exceptionId } });
  if (!ex) throw notFound('No such exception.');
  if (!['OPEN', 'AWAITING_SHIPPER', 'REJECTED'].includes(ex.status)) throw conflict('WRONG_STATE', 'This problem is already being fixed or resolved.');
  const trip = await loadTrip(ex.tripId);
  await setProposal(ex.id, trip, proposal);
  await audit(by, 'FIX_PROPOSED', { label: proposal.label, extraCost: proposal.extraCost, payer: proposal.payer }, { tripId: trip.id });
}

/** Shipper approves or rejects a fix that costs the shipper money. */
export async function decideFix(tripId: string, shipperId: string, actor: Actor, approve: boolean, reason: string | null) {
  const trip = await loadTrip(tripId, shipperId);
  const ex = trip.exceptions.find((x) => x.status === 'AWAITING_SHIPPER');
  if (!ex) throw conflict('WRONG_STATE', 'There is no fix waiting for your decision.');
  const p = ex.proposal as unknown as Proposal;
  if (approve) {
    const u = await prisma.user.findUniqueOrThrow({ where: { id: actor.id } });
    const limit = toNumber(u.approvalLimit);
    if (limit == null) throw forbidden("Your role can't approve extra costs.");
    if (p.extraCost > limit) throw forbidden(`${inr(p.extraCost)} is above your approval limit of ${inr(limit)}.`);
  } else if (!reason) {
    throw new HttpError(400, 'VALIDATION_FAILED', 'Please fix the highlighted fields.', { reason: 'Say why, so the carrier can propose something else.' });
  }
  const now = new Date();
  await prisma.$transaction([
    prisma.tripException.update({ where: { id: ex.id }, data: { status: approve ? 'APPROVED' : 'REJECTED', decidedById: actor.id, decidedAt: now, decisionReason: reason } }),
    prisma.approval.updateMany({ where: { tripId: trip.id, kind: 'EXCEPTION', status: 'PENDING' }, data: { status: approve ? 'APPROVED' : 'REJECTED', approverId: actor.id, reason, decidedAt: now } }),
  ]);
  await audit(actor.id, approve ? 'FIX_APPROVED' : 'FIX_REJECTED', { label: p.label, extraCost: p.extraCost }, { tripId: trip.id, reason: reason ?? undefined });
}

/** Carrier has carried out the fix: back on the road with the new ETA (and truck, after a swap). */
export async function resolveException(exceptionId: string, d: { newEta: Date | null; truckNumber: string | null }, by = 'exception-agent') {
  const ex = await prisma.tripException.findUnique({ where: { id: exceptionId } });
  if (!ex) throw notFound('No such exception.');
  if (!['OPEN', 'APPROVED'].includes(ex.status)) throw conflict('NOT_APPROVED', ex.status === 'AWAITING_SHIPPER' ? 'The shipper has not approved this fix yet.' : 'This problem is not open.');
  const p = ex.proposal as unknown as Proposal | null;
  await prisma.$transaction([
    prisma.tripException.update({ where: { id: ex.id }, data: { status: 'RESOLVED', resolvedAt: new Date() } }),
    prisma.trip.update({
      where: { id: ex.tripId },
      data: {
        status: 'IN_TRANSIT', lastUpdateAt: new Date(),
        eta: d.newEta ?? (p?.newEta ? new Date(p.newEta) : undefined),
        truckNumber: d.truckNumber ?? undefined,
      },
    }),
  ]);
  await audit(by, 'EXCEPTION_RESOLVED', { label: p?.label ?? null, truck: d.truckNumber }, { tripId: ex.tripId });
}
