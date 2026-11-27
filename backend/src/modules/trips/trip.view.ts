import { toNumber } from '../../lib/validate';
import { type TripFull } from './tender.service';
import { acceptedClaims, currentInvoice, invoiceChecks, podState } from './billing.service';

/** Tabs on the Trips list (design: All / Needs action / In transit / Delivered and billed / Closed). */
export const GROUPS = {
  action: ['ON_HOLD', 'DELIVERED'],
  transit: ['AWARDED', 'SOURCING_TRUCK', 'TRUCK_CONFIRMED', 'CLEARED', 'READY_FOR_PICKUP', 'IN_TRANSIT'],
  delivered: ['POD_RECEIVED', 'INVOICED'],
  closed: ['CLOSED', 'CANCELLED'],
} as const;

/** How each offer is shown to the shipper. */
export const OFFER_LABEL: Record<string, string> = {
  QUEUED: 'Waiting in line',
  REQUESTED: 'Offered',
  ACCEPTED: 'Accepted',
  AWARDED: 'Accepted',
  DECLINED: 'Passed',
  EXPIRED: 'No answer',
  REJECTED_BY_SHIPPER: 'Not approved (old)',
  WITHDRAWN: 'Withdrawn',
  QUOTED: 'Quoted',
  LOST: 'Not chosen',
};

const fmtTime = (d: Date) => d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' });

/** A request that closed with no quotes needs the shipper too. */
export const noQuotes = (t: TripFull) => t.status === 'QUOTES_REQUESTED' && !!t.quotesClosedAt;

export function groupOf(t: TripFull): keyof typeof GROUPS | 'waiting' {
  if (noQuotes(t)) return 'action';
  for (const [g, statuses] of Object.entries(GROUPS)) if ((statuses as readonly string[]).includes(t.status)) return g as keyof typeof GROUPS;
  return 'waiting';
}

const fmtDateTime = (d: Date) =>
  d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' });
const fmtDate = (d: Date) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });

/** The problem the trip is on hold for, if any. */
export const openException = (t: TripFull) => t.exceptions.find((x) => !['RESOLVED', 'NOTICE'].includes(x.status)) ?? null;

/** The one-line "Next step" column. */
export function nextStep(t: TripFull, podRule = 'DIGITAL'): string {
  const offered = t.quotes.find((q) => q.status === 'REQUESTED');

  const inv = currentInvoice(t);
  switch (t.status) {
    case 'READY_FOR_PICKUP':
      return `Truck ${t.truckNumber ?? ''} reporting for pickup`.replace('  ', ' ');
    case 'IN_TRANSIT':
      return t.eta ? `ETA ${fmtDateTime(t.eta)}` : 'On the road';
    case 'DELIVERED':
      return t.documents.some((d) => d.kind === 'POD') ? 'Review the POD' : 'Waiting for the POD photo';
    case 'POD_RECEIVED':
      return podRule === 'HARD_COPY' && !t.podHardCopyAt ? 'Waiting for the POD hard copy' : 'Waiting for the carrier invoice';
    case 'INVOICED':
      if (!inv) return '—';
      if (inv.status === 'RECEIVED') return `Approve invoice ₹${Number(inv.total).toLocaleString('en-IN')}`;
      if (inv.status === 'APPROVED') return podRule !== 'DIGITAL' && !t.podHardCopyAt ? 'Pay after the POD hard copy arrives' : `Pay by ${fmtDate(inv.dueDate)}`;
      return 'Invoice queried; waiting for the carrier';
    case 'ON_HOLD': {
      const ex = openException(t);
      if (ex?.status === 'AWAITING_SHIPPER') return 'Approve or reject the proposed fix';
      const p = ex?.proposal as { label?: string } | null;
      return p?.label ? `Carrier fixing: ${p.label}` : 'Problem reported; carrier proposing a fix';
    }
    case 'CLOSED':
      return t.closedAt ? `Paid ${fmtDate(t.closedAt)}` : 'Closed';
    case 'QUOTES_REQUESTED':
      if (t.quotesClosedAt) return 'No carrier accepted: send again or cancel';
      return offered ? `Offered to ${offered.carrier.name} at ₹${Number(offered.amount).toLocaleString('en-IN')}; answer by ${offered.respondBy ? fmtTime(offered.respondBy) : 'soon'}` : 'Offering the load';
    case 'AWARDED':
      return 'Carrier assigning truck';
    case 'TRUCK_CONFIRMED':
      return 'Carrier to issue the LR';
    case 'CANCELLED':
      return 'Cancelled';
    default:
      return '—';
  }
}

const date = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

export function tripSummary(t: TripFull, podRule = 'DIGITAL') {
  return {
    id: t.id,
    number: t.number,
    status: t.status,
    group: groupOf(t),
    origin: t.pickupAddress?.city ?? t.lane?.origin ?? null,
    destination: t.dropAddress?.city ?? t.lane?.destination ?? null,
    material: t.material,
    weightTonnes: t.weightKg != null ? toNumber(t.weightKg)! / 1000 : null,
    truckType: t.truckType,
    pickupDate: date(t.pickupDate),
    carrier: t.carrier?.name ?? null,
    amount: toNumber(t.awardedAmount),
    nextStep: nextStep(t, podRule),
    createdAt: t.createdAt,
  };
}

export function tripDetail(
  t: TripFull,
  activity: { at: Date; actor: string; action: string; text: string }[],
  policy: { podRule: string; paymentApprovalAbove: number },
) {
  const inv = currentInvoice(t);
  return {
    ...tripSummary(t, policy.podRule),
    truck: t.truckNumber ? { number: t.truckNumber, driverName: t.driverName, driverPhone: t.driverPhone } : null,
    eta: t.eta,
    lastLocation: t.lastLocation,
    lastUpdateAt: t.lastUpdateAt,
    delivery: t.deliveredAt ? { at: t.deliveredAt, goodQty: t.goodQty, damagedQty: t.damagedQty, remarks: t.deliveryRemarks } : null,
    pod: { ...podState(t, policy.podRule), acceptedAt: t.podAcceptedAt, hardCopyAt: t.podHardCopyAt },
    documents: t.documents.filter((d) => !d.isVoid).map((d) => ({ id: d.id, kind: d.kind, number: d.number, validUntil: d.validUntil, fileUrl: d.fileUrl, at: d.createdAt })),
    claims: t.claims.map((c) => ({
      id: c.id, number: c.number, kind: c.kind, qty: c.qty, unitValue: toNumber(c.unitValue), amount: toNumber(c.amount),
      description: c.description, status: c.status, carrierNote: c.carrierNote, at: c.createdAt,
    })),
    acceptedClaims: acceptedClaims(t),
    invoice: inv && {
      id: inv.id, number: inv.number, status: inv.status, freight: toNumber(inv.freight), detention: toNumber(inv.detention),
      claimDeduction: toNumber(inv.claimDeduction), total: toNumber(inv.total), dueDate: inv.dueDate, queryReason: inv.queryReason,
      approvedAt: inv.approvedAt, paidAt: inv.paidAt, paymentMode: inv.paymentMode, paymentRef: inv.paymentRef, receivedAt: inv.createdAt,
      checks: invoiceChecks(t, inv),
      needsApproval: inv.status === 'RECEIVED',
      aboveThreshold: toNumber(inv.total)! > policy.paymentApprovalAbove,
    },
    paymentApprovalAbove: policy.paymentApprovalAbove,
    exception: (() => {
      const x = openException(t);
      return x && { id: x.id, kind: x.kind, description: x.description, status: x.status, proposal: x.proposal, decisionReason: x.decisionReason, at: x.createdAt };
    })(),
    delays: t.exceptions.filter((x) => x.status === 'NOTICE').map((x) => ({ description: x.description, at: x.createdAt })),
    cancelled: t.cancelledAt ? { at: t.cancelledAt, reason: t.cancelReason } : null,
    pickup: t.pickupAddress && { id: t.pickupAddress.id, name: t.pickupAddress.name, city: t.pickupAddress.city, line1: t.pickupAddress.line1 },
    drop: t.dropAddress && { id: t.dropAddress.id, name: t.dropAddress.name, city: t.dropAddress.city, line1: t.dropAddress.line1 },
    laneId: t.laneId,
    receiverContact: t.receiverContact,
    reference: t.reference,
    notes: t.notes,
    quoteDeadline: t.quoteDeadline,
    quotesClosedAt: t.quotesClosedAt,
    noQuotes: noQuotes(t),
    awardedAt: t.awardedAt,
    noCarrierAccepted: noQuotes(t),
    /** The offer list in order: every contract-rate carrier with its fixed rate and where it stands. */
    quotes: t.quotes.map((q) => ({
      id: q.id,
      carrierId: q.carrierId,
      carrier: q.carrier.name,
      carrierStatus: q.carrier.status,
      sequence: q.sequence,
      status: q.status,
      statusLabel: OFFER_LABEL[q.status] ?? q.status,
      amount: toNumber(q.amount),
      offeredAt: q.offeredAt,
      respondBy: q.respondBy,
      answeredAt: q.quotedAt,
      declineReason: q.declineReason,
      isWinner: q.isWinner,
    })),
    activity,
  };
}
