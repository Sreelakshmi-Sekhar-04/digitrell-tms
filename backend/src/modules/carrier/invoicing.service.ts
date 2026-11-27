import { prisma } from '../../lib/prisma';
import { audit } from '../../lib/audit';
import { HttpError, badRequest, forbidden, notFound } from '../../lib/errors';
import { toNumber } from '../../lib/validate';
import { getPolicy } from '../policies/policies.routes';
import { acceptedClaims, currentInvoice, invoiceRaised, podState } from '../trips/billing.service';
import { loadTrip, notifyShipper, type TripFull } from '../trips/tender.service';
import { getCarrierPolicy } from './policy.service';
import type { Actor } from './execution.service';

/**
 * Carrier phase 6: billing. The invoice amounts are fixed rules, never AI: the contract amount (Trip.awardedAmount),
 * plus detention the carrier enters, minus claims the carrier accepted. The invoice itself is raised through the same
 * shared service as the integration stand-in (trips/billing.service.ts invoiceRaised), so the shipper's approve,
 * query and pay screens see the same Invoice row, status and audit events.
 */

const round2 = (n: number) => Math.round(n * 100) / 100;
const inr = (n: number) => '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
const APPROVAL_KIND = 'CARRIER_INVOICE';
const TERMS_DAYS = 15;
const REMINDER_GAP_MS = 24 * 3600_000;

/** GST text per the carrier's profile choice. The shared Invoice row holds the freight total only; the tax invoice itself is the carrier's own document. */
export function gstNote(option: string | null) {
  if (option === 'FCM') return { option, text: 'Forward charge: add GST on your tax invoice. Amounts here are before GST.' };
  if (option === 'RCM') return { option, text: 'Reverse charge: the shipper pays the GST directly. Amounts here are the freight.' };
  return { option: null, text: 'Set your GST option in Carrier management, Company profile.' };
}

export interface Draft {
  freight: number;
  detention: number;
  claimDeduction: number;
  total: number;
  dueDate: string;
  gst: ReturnType<typeof gstNote>;
  /** Why the invoice cannot be sent right now (null = it can). */
  blocked: { code: string; message: string } | null;
  /** The owner has to approve it first when this user sends it. */
  limit: number | null;
  overLimit: boolean;
  approval: { id: string; status: 'PENDING' | 'REJECTED'; requestedByName: string; reason: string | null; at: Date } | null;
  /** Shipper's reason when it was queried; the corrected invoice replaces it. */
  queryReason: string | null;
}

export const isBillable = (t: TripFull) => t.status === 'POD_RECEIVED' || (t.status === 'INVOICED' && currentInvoice(t)?.status === 'QUERIED');

export async function latestInvoiceApproval(tripId: string) {
  return prisma.approval.findFirst({ where: { tripId, kind: APPROVAL_KIND }, orderBy: { createdAt: 'desc' } });
}

/** The invoice the carrier would send now. `detention` is what the carrier enters (default: what the queried invoice had). */
export async function draftFor(t: TripFull, carrierId: string, detention?: number): Promise<Draft | null> {
  if (!isBillable(t)) return null;
  const [policy, shipperPolicy, company, last] = await Promise.all([
    getCarrierPolicy(carrierId), getPolicy(t.shipperId), prisma.company.findUniqueOrThrow({ where: { id: carrierId }, select: { gstOption: true } }), latestInvoiceApproval(t.id),
  ]);
  const inv = currentInvoice(t);
  const freight = toNumber(t.awardedAmount) ?? 0;
  const det = round2(detention ?? (inv ? toNumber(inv.detention) ?? 0 : 0));
  const claimDeduction = round2(acceptedClaims(t));
  const total = round2(freight + det - claimDeduction);
  const limit = toNumber(policy.invoiceApprovalAbove);
  const pending = t.claims.filter((c) => c.status === 'RAISED');
  let blocked: Draft['blocked'] = null;
  if (!podState(t, shipperPolicy.podRule).readyToBill) blocked = { code: 'POD_RULE', message: 'The shipper needs the original LR before this load can be invoiced.' };
  else if (pending.length) blocked = { code: 'CLAIM_PENDING', message: `Answer ${pending.map((c) => c.number).join(', ')} first: an unanswered claim holds the invoice.` };
  const startedAfter = inv?.createdAt ?? new Date(0);
  const pa = last && last.status !== 'APPROVED' && last.createdAt >= startedAfter ? last : null;
  const payload = (pa?.payload ?? {}) as { requestedByName?: string };
  return {
    freight, detention: det, claimDeduction, total,
    dueDate: new Date(Date.now() + TERMS_DAYS * 86400_000).toISOString(),
    gst: gstNote(company.gstOption),
    blocked,
    limit, overLimit: limit != null && total > limit,
    approval: pa && (pa.status === 'PENDING' || pa.status === 'REJECTED') ? { id: pa.id, status: pa.status, requestedByName: payload.requestedByName ?? '', reason: pa.reason, at: pa.createdAt } : null,
    queryReason: inv?.status === 'QUERIED' ? inv.queryReason : null,
  };
}

/** Next number from the carrier's own series: PREFIX/26-27/0001. One running count; a number is never reused, even for a corrected invoice. */
export async function nextInvoiceNumber(carrierId: string) {
  const company = await prisma.company.findUniqueOrThrow({ where: { id: carrierId }, select: { name: true } });
  const prefix = company.name.replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase() || 'INV';
  const row = await prisma.carrierInvoiceSeries.upsert({
    where: { companyId: carrierId },
    create: { companyId: carrierId, prefix, nextNumber: 2 },
    update: { nextNumber: { increment: 1 } },
  });
  const seq = row.nextNumber - 1;
  const ist = new Date(Date.now() + 5.5 * 3600_000);
  const y = ist.getUTCFullYear();
  const fy = ist.getUTCMonth() >= 3 ? y : y - 1;
  return `${row.prefix}/${String(fy).slice(2)}-${String(fy + 1).slice(2)}/${String(seq).padStart(4, '0')}`;
}

async function ownTrip(tripId: string, carrierId: string) {
  const trip = await loadTrip(tripId);
  if (trip.carrierId !== carrierId) throw notFound('That load no longer exists, or it is not assigned to your company.');
  return trip;
}

/** Raises the invoice through the shared service. Eligibility was checked by the caller. */
async function raise(t: TripFull, carrierId: string, by: Actor, d: Draft) {
  const number = await nextInvoiceNumber(carrierId);
  await invoiceRaised(t.id, { number, freight: d.freight, detention: d.detention, claimDeduction: d.claimDeduction, dueDate: new Date(d.dueDate) }, by.id);
  return number;
}

function assertSendable(t: TripFull, d: Draft | null): asserts d is Draft {
  if (!d) throw new HttpError(409, 'WRONG_STATE', 'This load has no invoice to send. Invoices come after the POD is accepted, or when the shipper queries one.');
  if (d.blocked) throw new HttpError(409, d.blocked.code, d.blocked.message);
  if (d.total <= 0) throw badRequest('The invoice total is zero or less after claims.', { detention: 'Check the detention and the accepted claims: the total must be above zero.' });
}

/**
 * Send the invoice to the shipper. Above the carrier's approval limit, anyone but the owner only requests approval
 * (an item in the owner's inbox); the owner's own invoices go straight out.
 */
export async function sendInvoice(tripId: string, carrierId: string, by: Actor, input: { detention?: number }): Promise<{ sent: boolean; number?: string; approvalId?: string }> {
  const t = await ownTrip(tripId, carrierId);
  const d = await draftFor(t, carrierId, input.detention);
  assertSendable(t, d);
  if (d.overLimit && !by.roles.includes('OWNER')) {
    if (d.approval?.status === 'PENDING') throw new HttpError(409, 'APPROVAL_PENDING', 'This invoice is already waiting for the owner’s approval.');
    const a = await prisma.approval.create({
      data: { tripId: t.id, companyId: carrierId, kind: APPROVAL_KIND, payload: { detention: d.detention, total: d.total, requestedById: by.id, requestedByName: by.name } },
    });
    // Internal to the carrier: logged without the trip so the shipper's activity never shows it.
    await audit(by.id, 'CARRIER_INVOICE_APPROVAL_REQUESTED', { trip: t.number, total: d.total, limit: d.limit });
    return { sent: false, approvalId: a.id };
  }
  const number = await raise(t, carrierId, by, d);
  // An earlier approval request for this load is closed by sending.
  await prisma.approval.updateMany({ where: { tripId: t.id, kind: APPROVAL_KIND, status: 'PENDING' }, data: { status: 'APPROVED', approverId: by.id, decidedAt: new Date() } });
  return { sent: true, number };
}

/** The owner approves (the invoice goes out) or rejects (with a reason; the draft goes back to the sender). */
export async function decideInvoiceApproval(approvalId: string, carrierId: string, by: Actor, approve: boolean, reason: string | null) {
  if (!by.roles.includes('OWNER')) throw forbidden('Only the owner can decide invoice approvals.');
  const a = await prisma.approval.findFirst({ where: { id: approvalId, companyId: carrierId, kind: APPROVAL_KIND } });
  if (!a) throw notFound('That approval no longer exists.');
  if (a.status !== 'PENDING') throw new HttpError(409, 'DECIDED', 'This approval has already been decided.');
  if (!approve && !reason) throw badRequest('Say why, so the sender can fix it.', { reason: 'Say why you are rejecting it.' });
  const t = await ownTrip(a.tripId!, carrierId);
  const payload = a.payload as { detention?: number };
  const now = new Date();
  if (!approve) {
    await prisma.approval.update({ where: { id: a.id }, data: { status: 'REJECTED', approverId: by.id, reason, decidedAt: now } });
    await audit(by.id, 'CARRIER_INVOICE_REJECTED', { trip: t.number }, { reason: reason! });
    return { sent: false };
  }
  const d = await draftFor(t, carrierId, payload.detention ?? 0);
  assertSendable(t, d);
  await prisma.approval.update({ where: { id: a.id }, data: { status: 'APPROVED', approverId: by.id, decidedAt: now } });
  const number = await raise(t, carrierId, by, d);
  await audit(by.id, 'CARRIER_INVOICE_APPROVED', { trip: t.number, invoice: number, total: d.total });
  return { sent: true, number };
}

/** Owner's inbox: invoices above the limit that someone else prepared. */
export async function pendingInvoiceApprovals(carrierId: string) {
  const rows = await prisma.approval.findMany({ where: { companyId: carrierId, kind: APPROVAL_KIND, status: 'PENDING' }, orderBy: { createdAt: 'asc' }, include: { trip: { include: { shipper: { select: { name: true } } } } } });
  const policy = await getCarrierPolicy(carrierId);
  return rows.map((a) => {
    const p = a.payload as { total?: number; requestedByName?: string };
    return {
      id: a.id, kind: 'INVOICE' as const, kindLabel: 'Invoice above limit', tripId: a.tripId, ref: a.trip?.number ?? '',
      summary: `Invoice of ${inr(p.total ?? 0)} to ${a.trip?.shipper.name ?? 'the shipper'}`,
      reason: `Prepared by ${p.requestedByName ?? 'your team'}. Above your invoice limit of ${inr(toNumber(policy.invoiceApprovalAbove) ?? 0)}.`,
      amount: p.total ?? 0, createdAt: a.createdAt.toISOString(),
    };
  });
}

/** Payment reminder once the due date has passed: audit entry plus a bell notification to the shipper. At most one a day. */
export async function remindPayment(tripId: string, carrierId: string, by: Actor) {
  const t = await ownTrip(tripId, carrierId);
  const inv = currentInvoice(t);
  if (t.status !== 'INVOICED' || !inv || !['RECEIVED', 'APPROVED'].includes(inv.status)) throw new HttpError(409, 'WRONG_STATE', 'There is no unpaid invoice to remind about.');
  if (inv.dueDate.getTime() > Date.now()) throw new HttpError(409, 'NOT_DUE', `Payment is due on ${inv.dueDate.toISOString().slice(0, 10)}. A reminder can be sent after that.`);
  const last = await prisma.auditLog.findFirst({ where: { tripId: t.id, action: 'PAYMENT_REMINDER' }, orderBy: { createdAt: 'desc' } });
  if (last && Date.now() - last.createdAt.getTime() < REMINDER_GAP_MS) throw new HttpError(409, 'TOO_SOON', 'A reminder was already sent in the last 24 hours.');
  await audit(by.id, 'PAYMENT_REMINDER', { invoice: inv.number, dueDate: inv.dueDate.toISOString(), total: toNumber(inv.total) }, { tripId: t.id });
  const carrier = await prisma.company.findUniqueOrThrow({ where: { id: carrierId }, select: { name: true } });
  await notifyShipper(t.shipperId, { kind: 'PAYMENT_REMINDER', tripId: t.id, title: `${carrier.name}: payment reminder for invoice ${inv.number}`, body: `${inr(toNumber(inv.total)!)} was due on ${inv.dueDate.toISOString().slice(0, 10)}.` });
}
