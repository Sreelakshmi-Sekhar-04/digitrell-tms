import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError, forbidden, notFound } from '../../lib/errors';
import { toNumber } from '../../lib/validate';
import { audit } from '../../lib/audit';
import { getPolicy } from '../policies/policies.routes';
import { loadTrip, type TripFull } from './tender.service';

/*
 * Phase 5: when things don't go to plan (BRD §4.9, §5 "On hold" / "Cancelled", §6 Bids).
 * Cancel and edit a booking, extend or widen a quote request, and handle problems on the road.
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
  const asked = trip.quotes.filter((q) => ['REQUESTED', 'QUOTED'].includes(q.status)).length;
  if (OPEN_QUOTES.includes(trip.status)) c.push(`${asked} carrier${asked === 1 ? ' is' : 's are'} told the request is withdrawn.`);
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
    prisma.quote.updateMany({ where: { tripId: trip.id, status: { in: ['REQUESTED', 'QUOTED'] } }, data: { status: 'WITHDRAWN' } }),
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
  const answered = trip.quotes.some((q) => q.status === 'QUOTED' || q.status === 'DECLINED');
  return { load, extras, requotes: load && answered };
}

/**
 * Edits a booking. Changing the load (date, weight, material) after carriers have answered means
 * their prices no longer fit, so every approved carrier is asked again with a fresh deadline.
 */
export async function editBooking(tripId: string, shipperId: string, actor: Actor, e: BookingEdit) {
  const trip = await loadTrip(tripId, shipperId);
  const rules = editRules(trip);
  const loadChanged =
    (e.pickupDate !== undefined && e.pickupDate !== trip.pickupDate?.toISOString().slice(0, 10)) ||
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
  const requote = loadChanged && rules.requotes;
  if (requote) {
    const policy = await getPolicy(shipperId);
    data.status = 'QUOTES_REQUESTED';
    data.quotesClosedAt = null;
    data.quoteDeadline = new Date(Date.now() + policy.quoteWindowHours * 3600_000);
  }
  await prisma.$transaction([
    ...(requote
      ? [
          prisma.quote.updateMany({ where: { tripId: trip.id, status: { in: ['QUOTED', 'DECLINED'] } }, data: { status: 'REQUESTED', amount: null, quotedAt: null } }),
          prisma.approval.updateMany({ where: { tripId: trip.id, kind: 'AWARD', status: 'PENDING' }, data: { status: 'REJECTED', approverId: actor.id, reason: 'Booking changed', decidedAt: new Date() } }),
        ]
      : []),
    prisma.trip.update({ where: { id: trip.id }, data }),
  ]);
  await audit(actor.id, 'BOOKING_EDITED', { changes: Object.keys(e), requoted: requote }, { tripId: trip.id });
  return { requoted: requote };
}

// ---------- widen a quote request ----------

/** Gives carriers more time; reopens a request that closed (with or without quotes). */
export async function extendDeadline(tripId: string, shipperId: string, actor: Actor, hours: number) {
  const trip = await loadTrip(tripId, shipperId);
  if (!OPEN_QUOTES.includes(trip.status)) throw conflict('WRONG_STATE', 'Only an open quote request can be extended.');
  if (!trip.quotes.some((q) => q.status === 'REQUESTED')) throw conflict('ALL_ANSWERED', 'Every carrier has already answered. Ask another carrier instead.');
  const from = Math.max(Date.now(), trip.quoteDeadline?.getTime() ?? Date.now());
  const deadline = new Date(from + hours * 3600_000);
  await prisma.trip.update({ where: { id: trip.id }, data: { quoteDeadline: deadline, quotesClosedAt: null } });
  await audit(actor.id, 'DEADLINE_EXTENDED', { hours, until: deadline }, { tripId: trip.id });
  return deadline;
}

/** Lane carriers not yet asked on this trip (e.g. approved after booking). */
export async function carriersNotAsked(trip: TripFull) {
  if (!trip.laneId) return [];
  const lane = await prisma.laneCarrier.findMany({ where: { laneId: trip.laneId }, include: { carrier: { select: { id: true, name: true, status: true } } } });
  const asked = new Set(trip.quotes.map((q) => q.carrierId));
  return lane.filter((l) => !asked.has(l.carrierId)).map((l) => l.carrier);
}

export async function askMoreCarriers(tripId: string, shipperId: string, actor: Actor, carrierIds: string[]) {
  const trip = await loadTrip(tripId, shipperId);
  if (!OPEN_QUOTES.includes(trip.status)) throw conflict('WRONG_STATE', 'Carriers can only be added before the award.');
  const allowed = new Set((await carriersNotAsked(trip)).map((c) => c.id));
  const ids = [...new Set(carrierIds)].filter((id) => allowed.has(id));
  if (!ids.length) throw new HttpError(400, 'VALIDATION_FAILED', 'Choose at least one approved carrier who was not asked yet.', { carrierIds: 'Choose at least one carrier.' });
  const policy = await getPolicy(shipperId);
  const reopen = !!trip.quotesClosedAt;
  await prisma.$transaction([
    prisma.quote.createMany({ data: ids.map((carrierId) => ({ tripId: trip.id, carrierId })) }),
    prisma.trip.update({
      where: { id: trip.id },
      data: reopen ? { quotesClosedAt: null, quoteDeadline: new Date(Date.now() + policy.quoteWindowHours * 3600_000) } : {},
    }),
  ]);
  await audit(actor.id, 'CARRIERS_ADDED', { added: ids.length }, { tripId: trip.id });
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
 * Driver reports a problem (integration point for the driver bot / exception agent). A plain delay
 * is a notice: the ETA moves, no approval needed (BRD §4.9). Anything else puts the trip on hold.
 */
export async function reportException(tripId: string, kind: (typeof EXCEPTION_KINDS)[number], description: string, proposal: Proposal | null) {
  const trip = await loadTrip(tripId);
  if (trip.status !== 'IN_TRANSIT') throw conflict('WRONG_STATE', 'Problems can be reported for a trip on the road.');
  if (kind === 'DELAY' && !needsShipper(proposal)) {
    await prisma.tripException.create({ data: { tripId: trip.id, kind, description, proposal: proposal ? (proposal as unknown as Prisma.InputJsonValue) : Prisma.JsonNull, status: 'NOTICE', resolvedAt: new Date() } });
    if (proposal?.newEta) await prisma.trip.update({ where: { id: trip.id }, data: { eta: new Date(proposal.newEta), lastUpdateAt: new Date() } });
    await audit('exception-agent', 'DELAY_NOTICE', { description, newEta: proposal?.newEta ?? null }, { tripId: trip.id });
    return;
  }
  const ex = await prisma.tripException.create({ data: { tripId: trip.id, kind, description } });
  await prisma.trip.update({ where: { id: trip.id }, data: { status: 'ON_HOLD', lastUpdateAt: new Date() } });
  await audit('exception-agent', 'EXCEPTION_REPORTED', { kind, description }, { tripId: trip.id });
  if (proposal) {
    await setProposal(ex.id, trip, proposal);
    await audit('exception-agent', 'FIX_PROPOSED', { label: proposal.label, extraCost: proposal.extraCost, payer: proposal.payer }, { tripId: trip.id });
  }
}

export async function proposeFix(exceptionId: string, proposal: Proposal) {
  const ex = await prisma.tripException.findUnique({ where: { id: exceptionId } });
  if (!ex) throw notFound('No such exception.');
  if (!['OPEN', 'AWAITING_SHIPPER', 'REJECTED'].includes(ex.status)) throw conflict('WRONG_STATE', 'This problem is already being fixed or resolved.');
  const trip = await loadTrip(ex.tripId);
  await setProposal(ex.id, trip, proposal);
  await audit('exception-agent', 'FIX_PROPOSED', { label: proposal.label, extraCost: proposal.extraCost, payer: proposal.payer }, { tripId: trip.id });
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
export async function resolveException(exceptionId: string, d: { newEta: Date | null; truckNumber: string | null }) {
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
  await audit('exception-agent', 'EXCEPTION_RESOLVED', { label: p?.label ?? null, truck: d.truckNumber }, { tripId: ex.tripId });
}
