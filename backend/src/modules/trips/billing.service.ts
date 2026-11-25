import { Prisma, type Invoice } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError, forbidden } from '../../lib/errors';
import { toNumber } from '../../lib/validate';
import { audit } from '../../lib/audit';
import { getPolicy } from '../policies/policies.routes';
import { DEFAULT_AUTONOMY, type Autonomy } from '../policies/policy.defaults';
import { loadTrip, type TripFull } from './tender.service';

/*
 * Trip execution, POD, claims and billing for the shipper (BRD §4.8–4.11, §6 "POD and billing").
 * Carrier/driver steps arrive through integration points; the shipper's decisions are made here.
 * All money amounts are fixed rules, never AI.
 */

type Actor = { id: string; name: string };
const inr = (n: number) => '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
const conflict = (code: string, message: string) => new HttpError(409, code, message);

// ---------- POD rule ----------

export interface PodState {
  rule: string; // DIGITAL | HARD_COPY | BOTH
  photo: boolean;
  accepted: boolean;
  hardCopy: boolean;
  /** Carrier may invoice. DIGITAL/BOTH: accepted photo. HARD_COPY: original received. */
  readyToBill: boolean;
  /** Shipper may pay. HARD_COPY/BOTH need the original LR. */
  readyToPay: boolean;
}

export function podState(trip: TripFull, rule: string): PodState {
  const photo = trip.documents.some((d) => d.kind === 'POD' && !d.isVoid);
  const accepted = !!trip.podAcceptedAt;
  const hardCopy = !!trip.podHardCopyAt;
  const readyToBill = accepted && (rule === 'HARD_COPY' ? hardCopy : true);
  const readyToPay = readyToBill && (rule === 'DIGITAL' ? true : hardCopy);
  return { rule, photo, accepted, hardCopy, readyToBill, readyToPay };
}

export const currentInvoice = (trip: TripFull) => trip.invoices.find((i) => i.status !== 'REPLACED') ?? null;
export const acceptedClaims = (trip: TripFull) => trip.claims.filter((c) => c.status === 'ACCEPTED').reduce((s, c) => s + toNumber(c.amount)!, 0);

export interface Check {
  label: string;
  ok: boolean;
  detail: string;
}

/** What the billing agent checks on every invoice before anyone pays it (BRD §4.11 step 4). */
export function invoiceChecks(trip: TripFull, inv: Invoice): Check[] {
  const awarded = toNumber(trip.awardedAmount) ?? 0;
  const freight = toNumber(inv.freight)!;
  const deduction = toNumber(inv.claimDeduction)!;
  const detention = toNumber(inv.detention)!;
  const expectedDeduction = acceptedClaims(trip);
  const pending = trip.claims.filter((c) => c.status === 'RAISED');
  const checks: Check[] = [
    { label: 'Freight', ok: freight === awarded, detail: freight === awarded ? 'Matches the award' : `${inr(freight)} billed, award was ${inr(awarded)}` },
    { label: 'Detention', ok: detention === 0, detail: detention === 0 ? 'None billed' : `${inr(detention)} billed; no delay is logged on this trip` },
    {
      label: 'Claims',
      ok: deduction === expectedDeduction && pending.length === 0,
      detail: pending.length
        ? `${pending.map((c) => c.number).join(', ')} still waiting for the carrier`
        : deduction === expectedDeduction
          ? expectedDeduction ? `${inr(expectedDeduction)} deducted as agreed` : 'No claims'
          : `${inr(deduction)} deducted, agreed claims are ${inr(expectedDeduction)}`,
    },
    { label: 'POD', ok: !!trip.podAcceptedAt, detail: trip.podAcceptedAt ? 'Accepted' : 'Not accepted yet' },
  ];
  return checks;
}

// ---------- carrier / driver side (integration points) ----------

/** Carrier confirms truck and driver; documents agent issues LR and e-way bill. Trip → Ready for pickup. */
export async function truckConfirmed(tripId: string, d: { truckNumber: string; driverName: string; driverPhone: string; lrNumber: string; ewayBillNumber: string; ewayValidUntil: Date }) {
  const trip = await loadTrip(tripId);
  if (trip.status !== 'AWARDED' && trip.status !== 'SOURCING_TRUCK') throw conflict('WRONG_STATE', 'Truck can only be confirmed after the award.');
  await prisma.$transaction([
    prisma.trip.update({ where: { id: trip.id }, data: { status: 'READY_FOR_PICKUP', truckNumber: d.truckNumber, driverName: d.driverName, driverPhone: d.driverPhone, lastUpdateAt: new Date() } }),
    prisma.document.createMany({
      data: [
        { tripId: trip.id, kind: 'LR', number: d.lrNumber },
        { tripId: trip.id, kind: 'EWAY_BILL', number: d.ewayBillNumber, validUntil: d.ewayValidUntil },
      ],
    }),
  ]);
  await audit(`carrier:${trip.carrierId}`, 'TRUCK_CONFIRMED', { truck: d.truckNumber, driver: d.driverName }, { tripId: trip.id });
  await audit('documents-agent', 'DOCUMENTS_ISSUED', { lr: d.lrNumber, ewayBill: d.ewayBillNumber }, { tripId: trip.id });
}

export const TRACKING_EVENTS = ['REACHED_PICKUP', 'LOADED', 'LOCATION', 'REACHED_DROP'] as const;

/** Driver status buttons and location (BRD §4.8). LOADED moves the trip to In transit. */
export async function trackingEvent(tripId: string, type: (typeof TRACKING_EVENTS)[number], location: string | null, eta: Date | null) {
  const trip = await loadTrip(tripId);
  const allowed = type === 'REACHED_PICKUP' || type === 'LOADED' ? ['READY_FOR_PICKUP'] : ['IN_TRANSIT'];
  if (!allowed.includes(trip.status)) throw conflict('WRONG_STATE', `“${type}” doesn't fit a trip that is ${trip.status.toLowerCase().replace(/_/g, ' ')}.`);
  await prisma.trip.update({
    where: { id: trip.id },
    data: { status: type === 'LOADED' ? 'IN_TRANSIT' : undefined, lastLocation: location ?? undefined, eta: eta ?? undefined, lastUpdateAt: new Date() },
  });
  await audit('tracking-agent', `TRACK_${type}`, { location, eta }, { tripId: trip.id });
}

/** Receiver confirms with the delivery code: quantities received in good order and damaged. */
export async function delivered(tripId: string, d: { goodQty: number; damagedQty: number; remarks: string | null }) {
  const trip = await loadTrip(tripId);
  if (trip.status !== 'IN_TRANSIT') throw conflict('WRONG_STATE', 'Only a trip in transit can be delivered.');
  await prisma.trip.update({
    where: { id: trip.id },
    data: { status: 'DELIVERED', deliveredAt: new Date(), goodQty: d.goodQty, damagedQty: d.damagedQty, deliveryRemarks: d.remarks, lastUpdateAt: new Date() },
  });
  await audit('pod-agent', 'DELIVERED', { goodQty: d.goodQty, damagedQty: d.damagedQty, remarks: d.remarks }, { tripId: trip.id });
}

/**
 * Driver sends the signed-LR photo. The POD agent checks the QR matches the LR. A clean, matching
 * POD is accepted by rule; a POD with remarks or no QR match waits for a person (BRD §4.10).
 */
export async function podReceived(tripId: string, d: { qrMatched: boolean; remarks: string | null; photoUrl: string | null }) {
  const trip = await loadTrip(tripId);
  if (trip.status !== 'DELIVERED') throw conflict('WRONG_STATE', 'A POD can only be added after delivery.');
  const lr = trip.documents.find((x) => x.kind === 'LR' && !x.isVoid);
  await prisma.document.create({ data: { tripId: trip.id, kind: 'POD', number: lr?.number ?? null, fileUrl: d.photoUrl } });
  const clean = d.qrMatched && !d.remarks && (trip.damagedQty ?? 0) === 0;
  await audit('pod-agent', 'POD_RECEIVED', { qrMatched: d.qrMatched, remarks: d.remarks, clean }, { tripId: trip.id });
  if (clean) {
    await prisma.trip.update({ where: { id: trip.id }, data: { status: 'POD_RECEIVED', podAcceptedAt: new Date() } });
    await audit('pod-agent', 'POD_ACCEPTED', { by: 'rule: clean POD, QR matched' }, { tripId: trip.id });
  }
}

/** Carrier accepts or disputes a claim. */
export async function claimResponse(claimId: string, accept: boolean, note: string | null) {
  const claim = await prisma.claim.findUnique({ where: { id: claimId } });
  if (!claim) throw new HttpError(404, 'NOT_FOUND', 'No such claim.');
  if (claim.status !== 'RAISED') throw conflict('DECIDED', 'This claim has already been answered or withdrawn.');
  await prisma.claim.update({ where: { id: claim.id }, data: { status: accept ? 'ACCEPTED' : 'DISPUTED', carrierNote: note, respondedAt: new Date() } });
  await audit('carrier', accept ? 'CLAIM_ACCEPTED' : 'CLAIM_DISPUTED', { claim: claim.number, amount: toNumber(claim.amount), note }, { tripId: claim.tripId });
}

/**
 * Carrier raises an invoice. Refused until the shipper's POD rule allows billing (BRD §6). The billing
 * agent checks it; within the payment limit and with Billing allowed to act, a clean invoice is
 * approved by rule, otherwise it goes to the approvals inbox.
 */
export async function invoiceRaised(tripId: string, d: { number: string; freight: number; detention: number; claimDeduction: number; dueDate: Date | null }) {
  const trip = await loadTrip(tripId);
  if (!['POD_RECEIVED', 'INVOICED'].includes(trip.status)) throw conflict('WRONG_STATE', 'Invoices come after the POD.');
  const policy = await getPolicy(trip.shipperId);
  const pod = podState(trip, policy.podRule);
  if (!pod.readyToBill) throw conflict('POD_RULE', 'The shipper needs the original LR before this trip can be invoiced.');
  const open = currentInvoice(trip);
  if (open && open.status !== 'QUERIED') throw conflict('DUPLICATE', `Invoice ${open.number} is already ${open.status.toLowerCase()}.`);

  const total = Math.round((d.freight + d.detention - d.claimDeduction) * 100) / 100;
  const inv = await prisma.$transaction(async (tx) => {
    if (open) await tx.invoice.update({ where: { id: open.id }, data: { status: 'REPLACED' } });
    const created = await tx.invoice.create({
      data: {
        number: d.number, tripId: trip.id, carrierId: trip.carrierId!, freight: new Prisma.Decimal(d.freight), detention: new Prisma.Decimal(d.detention),
        claimDeduction: new Prisma.Decimal(d.claimDeduction), total: new Prisma.Decimal(total), dueDate: d.dueDate ?? new Date(Date.now() + 15 * 86400_000),
      },
    });
    await tx.trip.update({ where: { id: trip.id }, data: { status: 'INVOICED' } });
    return created;
  });
  await audit(`carrier:${trip.carrierId}`, 'INVOICE_RECEIVED', { invoice: inv.number, total }, { tripId: trip.id });

  const fresh = await loadTrip(trip.id);
  const checks = invoiceChecks(fresh, inv);
  const autonomy = { ...DEFAULT_AUTONOMY, ...(policy.autonomy as Partial<Autonomy>) };
  const threshold = toNumber(policy.paymentApprovalAbove)!;
  if (autonomy.billing === 2 && total <= threshold && checks.every((c) => c.ok)) {
    await prisma.invoice.update({ where: { id: inv.id }, data: { status: 'APPROVED', approvedAt: new Date() } });
    await audit('billing-agent', 'INVOICE_APPROVED', { invoice: inv.number, total, by: `rule: within ${inr(threshold)} and all checks passed` }, { tripId: trip.id });
  } else {
    await prisma.approval.create({ data: { tripId: trip.id, companyId: trip.shipperId, kind: 'PAYMENT', payload: { invoiceId: inv.id } } });
  }
}

// ---------- shipper side ----------

async function assertLimit(actor: Actor, amount: number, what: string) {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: actor.id } });
  const limit = toNumber(u.approvalLimit);
  if (limit == null) throw forbidden(`Your role can't ${what}. Your accounts team or logistics head will get it.`);
  if (amount > limit) throw forbidden(`${inr(amount)} is above your approval limit of ${inr(limit)}.`);
}

/** Shipper accepts a POD that needed review (remarks, damage, or no QR match). */
export async function acceptPod(tripId: string, shipperId: string, actor: Actor) {
  const trip = await loadTrip(tripId, shipperId);
  if (trip.status !== 'DELIVERED') throw conflict('WRONG_STATE', 'There is no POD waiting for review.');
  if (!trip.documents.some((d) => d.kind === 'POD')) throw conflict('NO_POD', 'The driver has not sent the POD photo yet.');
  await prisma.trip.update({ where: { id: trip.id }, data: { status: 'POD_RECEIVED', podAcceptedAt: new Date(), podAcceptedById: actor.id } });
  await audit(actor.id, 'POD_ACCEPTED', { claims: trip.claims.filter((c) => c.status === 'RAISED').length }, { tripId: trip.id });
}

export async function raiseClaim(tripId: string, shipperId: string, actor: Actor, d: { kind: string; qty: number; unitValue: number; description: string }) {
  const trip = await loadTrip(tripId, shipperId);
  if (!['DELIVERED', 'POD_RECEIVED'].includes(trip.status)) throw conflict('WRONG_STATE', 'Claims are raised after delivery and before the invoice.');
  const amount = Math.round(d.qty * d.unitValue * 100) / 100;
  const claim = await prisma.claim.create({
    data: { tripId: trip.id, kind: d.kind, qty: d.qty, unitValue: new Prisma.Decimal(d.unitValue), amount: new Prisma.Decimal(amount), description: d.description, raisedById: actor.id },
  });
  await audit(actor.id, 'CLAIM_RAISED', { claim: claim.number, amount, qty: d.qty }, { tripId: trip.id });
  return claim;
}

export async function withdrawClaim(claimId: string, shipperId: string, actor: Actor) {
  const claim = await prisma.claim.findFirst({ where: { id: claimId, trip: { shipperId } } });
  if (!claim) throw new HttpError(404, 'NOT_FOUND', 'That claim no longer exists.');
  if (claim.status !== 'RAISED' && claim.status !== 'DISPUTED') throw conflict('DECIDED', 'An accepted claim stays on the invoice.');
  await prisma.claim.update({ where: { id: claim.id }, data: { status: 'WITHDRAWN' } });
  await audit(actor.id, 'CLAIM_WITHDRAWN', { claim: claim.number }, { tripId: claim.tripId });
}

export async function markHardCopy(tripId: string, shipperId: string, actor: Actor) {
  const trip = await loadTrip(tripId, shipperId);
  if (!trip.podAcceptedAt) throw conflict('WRONG_STATE', 'Accept the POD photo first.');
  if (trip.podHardCopyAt) throw conflict('DUPLICATE', 'The hard copy is already marked as received.');
  await prisma.trip.update({ where: { id: trip.id }, data: { podHardCopyAt: new Date() } });
  await audit(actor.id, 'POD_HARD_COPY_RECEIVED', {}, { tripId: trip.id });
}

export async function approveInvoice(tripId: string, shipperId: string, actor: Actor) {
  const trip = await loadTrip(tripId, shipperId);
  const inv = currentInvoice(trip);
  if (!inv || inv.status !== 'RECEIVED') throw conflict('WRONG_STATE', 'There is no invoice waiting for approval.');
  const total = toNumber(inv.total)!;
  await assertLimit(actor, total, 'approve payments');
  const now = new Date();
  await prisma.$transaction([
    prisma.invoice.update({ where: { id: inv.id }, data: { status: 'APPROVED', approvedById: actor.id, approvedAt: now } }),
    prisma.approval.updateMany({ where: { tripId: trip.id, kind: 'PAYMENT', status: 'PENDING' }, data: { status: 'APPROVED', approverId: actor.id, decidedAt: now } }),
  ]);
  const failed = invoiceChecks(trip, inv).filter((c) => !c.ok).map((c) => c.label);
  await audit(actor.id, 'INVOICE_APPROVED', { invoice: inv.number, total, overriddenChecks: failed }, { tripId: trip.id });
}

export async function queryInvoice(tripId: string, shipperId: string, actor: Actor, reason: string) {
  const trip = await loadTrip(tripId, shipperId);
  const inv = currentInvoice(trip);
  if (!inv || !['RECEIVED', 'APPROVED'].includes(inv.status)) throw conflict('WRONG_STATE', 'There is no open invoice to query.');
  await prisma.$transaction([
    prisma.invoice.update({ where: { id: inv.id }, data: { status: 'QUERIED', queryReason: reason } }),
    prisma.approval.updateMany({ where: { tripId: trip.id, kind: 'PAYMENT', status: 'PENDING' }, data: { status: 'REJECTED', approverId: actor.id, reason, decidedAt: new Date() } }),
  ]);
  await audit(actor.id, 'INVOICE_QUERIED', { invoice: inv.number }, { tripId: trip.id, reason });
}

/**
 * Records the payment (Release 1: the shipper pays by UPI or bank transfer and records the reference
 * here; a real payment link is an open question, plan §7.7). Closes the trip.
 */
export async function payInvoice(tripId: string, shipperId: string, actor: Actor, mode: string, reference: string) {
  const trip = await loadTrip(tripId, shipperId);
  const inv = currentInvoice(trip);
  if (!inv || inv.status !== 'APPROVED') throw conflict('WRONG_STATE', 'Approve the invoice before paying it.');
  const policy = await getPolicy(shipperId);
  if (!podState(trip, policy.podRule).readyToPay) throw conflict('POD_RULE', 'Your POD rule needs the original LR before payment. Mark the hard copy as received first.');
  const total = toNumber(inv.total)!;
  await assertLimit(actor, total, 'record payments');
  const now = new Date();
  await prisma.$transaction([
    prisma.invoice.update({ where: { id: inv.id }, data: { status: 'PAID', paidAt: now, paymentMode: mode, paymentRef: reference } }),
    prisma.trip.update({ where: { id: trip.id }, data: { status: 'CLOSED', closedAt: now } }),
  ]);
  await audit(actor.id, 'INVOICE_PAID', { invoice: inv.number, total, mode, reference }, { tripId: trip.id });
  await audit('coordinator', 'TRIP_CLOSED', {}, { tripId: trip.id });
}
