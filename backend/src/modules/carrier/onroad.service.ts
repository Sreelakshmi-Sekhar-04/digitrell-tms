import { prisma } from '../../lib/prisma';
import { audit } from '../../lib/audit';
import { HttpError, badRequest, forbidden, notFound } from '../../lib/errors';
import { formatTruckNumber } from '../../shared/carrier';
import { loadTrip } from '../trips/tender.service';
import { claimResponse, delivered, podReceived, trackingEvent, type TRACKING_EVENTS } from '../trips/billing.service';
import { proposeFix, reportException, resolveException, type EXCEPTION_KINDS, type Proposal } from '../trips/exceptions.service';
import { busyIds, complianceIssues, type Actor } from './execution.service';

/**
 * Carrier phase 5: on the road. The Traffic Manager records the driver's steps from the load page (plan §7.6).
 * Every write goes through the same shared services as the integration stand-ins (trips/billing.service.ts and
 * trips/exceptions.service.ts), so the shipper sees the same status, data and audit events. The functions here add
 * only the carrier's own checks: it is this carrier's load, the steps come in order, swaps pass the assignment rules.
 */

type EventType = (typeof TRACKING_EVENTS)[number];
const wrongState = (code: string, m: string) => new HttpError(409, code, m);

async function ownTrip(tripId: string, carrierId: string) {
  const trip = await loadTrip(tripId);
  if (trip.carrierId !== carrierId) throw notFound('That load no longer exists, or it is not assigned to your company.');
  return trip;
}

/** Which driver steps are already recorded (from the audit log; there is no separate event table). */
export async function trackFlags(tripIds: string[]) {
  const rows = tripIds.length
    ? await prisma.auditLog.findMany({ where: { tripId: { in: tripIds }, action: { in: ['TRACK_REACHED_PICKUP', 'TRACK_REACHED_DROP'] } }, select: { tripId: true, action: true } })
    : [];
  const out = new Map<string, { pickup: boolean; drop: boolean }>();
  for (const r of rows) {
    const f = out.get(r.tripId!) ?? { pickup: false, drop: false };
    if (r.action === 'TRACK_REACHED_PICKUP') f.pickup = true;
    else f.drop = true;
    out.set(r.tripId!, f);
  }
  return out;
}

const EVENT_LABEL: Record<string, string> = {
  TRACK_REACHED_PICKUP: 'Reached pickup',
  TRACK_LOADED: 'Loaded; on the road',
  TRACK_LOCATION: 'Location update',
  TRACK_REACHED_DROP: 'Reached drop',
  DELIVERED: 'Delivered',
};

/** The event timeline of a trip, oldest first. */
export async function eventTimeline(tripId: string) {
  const rows = await prisma.auditLog.findMany({ where: { tripId, action: { in: Object.keys(EVENT_LABEL) } }, orderBy: { createdAt: 'asc' } });
  return rows.map((r) => {
    const d = (r.data ?? {}) as Record<string, unknown>;
    const detail = r.action === 'DELIVERED' ? `${d.goodQty ?? 0} good, ${d.damagedQty ?? 0} damaged${d.remarks ? `: ${d.remarks}` : ''}` : null;
    return {
      type: r.action.replace('TRACK_', ''),
      label: EVENT_LABEL[r.action],
      at: r.createdAt,
      location: (d.location as string | null) ?? null,
      eta: (d.eta as string | null) ?? null,
      detail,
    };
  });
}

export async function recordEvent(tripId: string, carrierId: string, by: Actor, d: { type: EventType; location: string | null; eta: Date | null }) {
  const trip = await ownTrip(tripId, carrierId);
  const flags = (await trackFlags([trip.id])).get(trip.id) ?? { pickup: false, drop: false };
  let location = d.location;
  if (d.type === 'REACHED_PICKUP') {
    if (flags.pickup) throw wrongState('ALREADY_RECORDED', 'Reached pickup is already recorded.');
    location = location ?? trip.pickupAddress?.name ?? null;
  } else if (d.type === 'LOADED') {
    if (trip.status === 'READY_FOR_PICKUP' && !flags.pickup) throw wrongState('OUT_OF_ORDER', 'Record “Reached pickup” first.');
    // The first ETA at drop is the promise "on time" is measured against.
    if (!d.eta && !trip.eta && !trip.promisedEta) throw badRequest('Give the expected arrival at the drop.', { eta: 'Enter the expected arrival at the drop.' });
    location = location ?? trip.pickupAddress?.name ?? null;
  } else if (d.type === 'LOCATION') {
    if (!location) throw badRequest('Enter where the truck is.', { location: 'Enter where the truck is.' });
  } else if (d.type === 'REACHED_DROP') {
    if (flags.drop) throw wrongState('ALREADY_RECORDED', 'Reached drop is already recorded.');
    location = location ?? trip.dropAddress?.name ?? null;
  }
  const eta = d.eta ?? (d.type === 'LOADED' ? trip.eta : null);
  await trackingEvent(trip.id, d.type, location, eta, by.id);
  if (d.type === 'LOADED' && !trip.promisedEta && !d.eta && trip.eta) await prisma.trip.update({ where: { id: trip.id }, data: { promisedEta: trip.eta } });
}

export async function markDelivered(tripId: string, carrierId: string, by: Actor, d: { goodQty: number; damagedQty: number; remarks: string | null }) {
  const trip = await ownTrip(tripId, carrierId);
  if (trip.status === 'IN_TRANSIT') {
    const flags = (await trackFlags([trip.id])).get(trip.id);
    if (!flags?.drop) throw wrongState('OUT_OF_ORDER', 'Record “Reached drop” before delivery.');
  }
  if (d.goodQty + d.damagedQty <= 0) throw badRequest('Enter the units received.', { goodQty: 'Enter the units received in good order, or the damaged ones.' });
  await delivered(trip.id, d, by.id);
}

// ---------- problems on the road ----------

export interface ProposalInput {
  fix: Proposal['fix'];
  label: string;
  newEta: Date | null;
  extraCost: number;
  payer: Proposal['payer'];
  swap: { truckId: string; driverId: string; override: { reason: string } | null } | null;
}

/** A swap moves to a truck and driver that pass the same checks as an assignment (execution.service.ts assignTruck). */
async function swapTarget(trip: Awaited<ReturnType<typeof ownTrip>>, carrierId: string, by: Actor, s: NonNullable<ProposalInput['swap']>, recorded = false) {
  const [truck, driver] = await Promise.all([
    prisma.truck.findFirst({ where: { id: s.truckId, carrierId } }),
    prisma.driver.findFirst({ where: { id: s.driverId, carrierId } }),
  ]);
  if (!truck) throw badRequest('Pick one of your trucks.', { truckId: 'Pick one of your trucks.' });
  if (!driver) throw badRequest('Pick one of your drivers.', { driverId: 'Pick one of your drivers.' });
  if (!truck.isActive) throw badRequest('That truck is deactivated.', { truckId: 'That truck is deactivated.' });
  if (!driver.isActive) throw badRequest('That driver is deactivated.', { driverId: 'That driver is deactivated.' });
  const busy = await busyIds(carrierId, trip.id);
  if (busy.truck.has(truck.id)) throw new HttpError(409, 'TRUCK_BUSY', `${formatTruckNumber(truck.number)} is already on ${busy.truck.get(truck.id)}.`);
  if (busy.driver.has(driver.id)) throw new HttpError(409, 'DRIVER_BUSY', `${driver.name} is already on ${busy.driver.get(driver.id)}.`);
  const issues = complianceIssues(truck, driver, trip.truckType);
  let override: { reason: string; by: string } | null = null;
  if (issues.length) {
    if (!s.override) throw new HttpError(409, 'COMPLIANCE_BLOCKED', `Cannot swap: ${issues.join('; ')}. Only the owner can override with a reason.`, { issues: issues.join('; ') });
    if (!recorded && !by.roles.includes('OWNER')) throw forbidden('Only the owner can override a compliance block.');
    override = { reason: s.override.reason, by: by.name };
    if (!recorded) await audit(by.id, 'ASSIGNMENT_OVERRIDE', { owner: by.name, truck: formatTruckNumber(truck.number), driver: driver.name, issues, swap: true }, { tripId: trip.id, reason: s.override.reason });
  }
  return { truckId: truck.id, truckNumber: formatTruckNumber(truck.number), driverId: driver.id, driverName: driver.name, driverPhone: driver.phone, override };
}

async function toProposal(trip: Awaited<ReturnType<typeof ownTrip>>, carrierId: string, by: Actor, p: ProposalInput): Promise<Proposal> {
  const out: Proposal = { fix: p.fix, label: p.label, newEta: p.newEta ? p.newEta.toISOString() : null, extraCost: p.extraCost, payer: p.payer };
  if (p.fix === 'SWAP') {
    if (!p.swap) throw badRequest('Pick the truck and driver to swap to.', { 'swap.truckId': 'Pick the truck to swap to.', 'swap.driverId': 'Pick the driver.' });
    out.swap = await swapTarget(trip, carrierId, by, p.swap);
  }
  return out;
}

/** Report a problem on the road. A plain delay with no cost to the shipper is a notice; anything else puts the trip on hold. */
export async function reportProblem(tripId: string, carrierId: string, by: Actor, d: { kind: (typeof EXCEPTION_KINDS)[number]; description: string; proposal: ProposalInput | null }) {
  const trip = await ownTrip(tripId, carrierId);
  const proposal = d.proposal ? await toProposal(trip, carrierId, by, d.proposal) : null;
  await reportException(trip.id, d.kind, d.description, proposal, by.id);
  const ex = await prisma.tripException.findFirst({ where: { tripId: trip.id }, orderBy: { createdAt: 'desc' } });
  return ex!.id;
}

async function ownException(exceptionId: string, carrierId: string) {
  const ex = await prisma.tripException.findUnique({ where: { id: exceptionId } });
  if (!ex) throw notFound('No such problem.');
  const trip = await ownTrip(ex.tripId, carrierId);
  return { ex, trip };
}

/** Propose (or re-propose after a rejection) the fix. Costs charged to the shipper wait for the shipper's decision. */
export async function proposeCarrierFix(exceptionId: string, carrierId: string, by: Actor, p: ProposalInput) {
  const { ex, trip } = await ownException(exceptionId, carrierId);
  const proposal = await toProposal(trip, carrierId, by, p);
  await proposeFix(ex.id, proposal, by.id);
}

/** The fix is done: back on the road. After a swap the trip moves to the new truck and driver, checked again first. */
export async function resumeTrip(exceptionId: string, carrierId: string, by: Actor, d: { newEta: Date | null }) {
  const { ex, trip } = await ownException(exceptionId, carrierId);
  const p = ex.proposal as unknown as Proposal | null;
  if (!['OPEN', 'APPROVED'].includes(ex.status)) {
    throw wrongState('NOT_APPROVED', ex.status === 'AWAITING_SHIPPER' ? 'The shipper has not approved this fix yet.' : ex.status === 'REJECTED' ? 'The shipper rejected this fix. Propose another.' : 'This problem is not open.');
  }
  if (!p) throw wrongState('NO_PROPOSAL', 'Propose a fix first.');
  let truckNumber: string | null = null;
  if (p.fix === 'SWAP' && p.swap) {
    // Papers can lapse between the proposal and the swap: run the assignment check again. An owner override on the proposal still stands.
    await swapTarget(trip, carrierId, by, { truckId: p.swap.truckId, driverId: p.swap.driverId, override: p.swap.override ? { reason: p.swap.override.reason } : null }, true);
    truckNumber = p.swap.truckNumber;
  }
  await resolveException(ex.id, { newEta: d.newEta, truckNumber }, by.id);
  if (p.fix === 'SWAP' && p.swap) {
    await prisma.trip.update({ where: { id: trip.id }, data: { truckId: p.swap.truckId, driverId: p.swap.driverId, driverName: p.swap.driverName, driverPhone: p.swap.driverPhone } });
  }
}

// ---------- POD and claims ----------

/** The signed POD: the LR number as printed on the signed copy (checked against the LR) and an optional link to the photo. */
export async function uploadPod(tripId: string, carrierId: string, by: Actor, d: { lrNumber: string; photoUrl: string | null; remarks: string | null }) {
  const trip = await ownTrip(tripId, carrierId);
  if (trip.status !== 'DELIVERED') throw wrongState('WRONG_STATE', 'A POD can be uploaded once the load is delivered.');
  if (trip.documents.some((x) => x.kind === 'POD' && !x.isVoid)) throw wrongState('DUPLICATE', 'The POD is already uploaded and with the shipper.');
  const lr = trip.documents.find((x) => x.kind === 'LR' && !x.isVoid);
  const matched = !!lr?.number && lr.number.replace(/\s+/g, '').toLowerCase() === d.lrNumber.replace(/\s+/g, '').toLowerCase();
  await podReceived(trip.id, { qrMatched: matched, remarks: d.remarks, photoUrl: d.photoUrl }, by.id);
}

export async function respondClaim(claimId: string, carrierId: string, by: Actor, accept: boolean, note: string | null) {
  const claim = await prisma.claim.findFirst({ where: { id: claimId, trip: { carrierId } } });
  if (!claim) throw notFound('That claim no longer exists.');
  if (!accept && !note) throw badRequest('Say why you dispute it.', { note: 'Say why you dispute this claim, so the shipper can review it.' });
  await claimResponse(claim.id, accept, note, by.id);
}
