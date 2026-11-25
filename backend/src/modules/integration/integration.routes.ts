import { Router, type NextFunction, type Request, type Response } from 'express';
import { prisma } from '../../lib/prisma';
import { HttpError, asyncHandler, notFound } from '../../lib/errors';
import { Validator } from '../../lib/validate';
import { receiveQuote, syncTrip } from '../trips/tender.service';
import { TRACKING_EVENTS, claimResponse, delivered, invoiceRaised, podReceived, trackingEvent, truckConfirmed } from '../trips/billing.service';
import { EXCEPTION_KINDS, FIX_KINDS, proposeFix, reportException, resolveException, type Proposal } from '../trips/exceptions.service';

/**
 * INTEGRATION POINTS for modules that are not built yet (carrier quote agent, test tools).
 * Not used by the shipper web app. Protected by a shared key in the `X-Integration-Key` header.
 * Replace these with the real carrier module when it exists.
 */
export const integrationRouter = Router();

const KEY = process.env.INTEGRATION_KEY || (process.env.NODE_ENV === 'production' ? '' : 'dev-integration-key');

function requireKey(req: Request, _res: Response, next: NextFunction) {
  if (!KEY || req.header('x-integration-key') !== KEY) return next(new HttpError(401, 'UNAUTHENTICATED', 'Integration key missing or wrong.'));
  next();
}
integrationRouter.use(requireKey);

async function tripByNumber(number: string) {
  const trip = await prisma.trip.findUnique({ where: { number } });
  if (!trip) throw notFound(`No trip ${number}.`);
  return trip;
}

/** Carrier quote agent: a carrier quotes an amount, or passes (`amount: null`). */
integrationRouter.post(
  '/quotes',
  asyncHandler(async (req, res) => {
    const v = new Validator(req.body);
    const number = v.text('tripNumber', 'the trip number', { required: true });
    const carrierId = v.text('carrierId', 'the carrier id', { required: true });
    const pass = req.body?.amount === null;
    const amount = pass ? null : v.money('amount', 'the quote amount', { required: true });
    v.done();
    const trip = await tripByNumber(number!);
    await receiveQuote(trip.id, carrierId!, amount);
    res.json({ ok: true });
  }),
);

/** Test tool (non-production only): make a quote request's deadline pass now. */
integrationRouter.post(
  '/trips/:number/expire-quotes',
  asyncHandler(async (req, res) => {
    if (process.env.NODE_ENV === 'production') throw notFound();
    const trip = await tripByNumber(req.params.number);
    await prisma.trip.update({ where: { id: trip.id }, data: { quoteDeadline: new Date(Date.now() - 1000) } });
    await syncTrip(trip.id);
    res.json({ ok: true });
  }),
);

/** Test tool (non-production only): age an award past the undo window. */
integrationRouter.post(
  '/trips/:number/age-award',
  asyncHandler(async (req, res) => {
    if (process.env.NODE_ENV === 'production') throw notFound();
    const trip = await tripByNumber(req.params.number);
    await prisma.trip.update({ where: { id: trip.id }, data: { awardedAt: new Date(Date.now() - 3600_000) } });
    res.json({ ok: true });
  }),
);

const isoDate = (v: Validator, key: string, label: string, required = false) => {
  const s = v.text(key, label, { required });
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) {
    v.fail(key, `Enter ${label} as an ISO date.`);
    return null;
  }
  return d;
};

/** Carrier module: truck and driver confirmed; documents agent issues LR and e-way bill. */
integrationRouter.post(
  '/trips/:number/truck',
  asyncHandler(async (req, res) => {
    const v = new Validator(req.body);
    const truckNumber = v.text('truckNumber', 'the truck number', { required: true, max: 20 });
    const driverName = v.text('driverName', 'the driver name', { required: true, max: 60 });
    const driverPhone = v.phone('driverPhone', 'the driver mobile', { required: true });
    const lrNumber = v.text('lrNumber', 'the LR number', { required: true, max: 30 });
    const ewayBillNumber = v.text('ewayBillNumber', 'the e-way bill number', { required: true, max: 30 });
    const ewayValidUntil = isoDate(v, 'ewayValidUntil', 'the e-way bill expiry', true);
    v.done();
    const trip = await tripByNumber(req.params.number);
    await truckConfirmed(trip.id, { truckNumber: truckNumber!, driverName: driverName!, driverPhone: driverPhone!, lrNumber: lrNumber!, ewayBillNumber: ewayBillNumber!, ewayValidUntil: ewayValidUntil! });
    res.json({ ok: true });
  }),
);

/** Driver bot: Reached pickup / Loaded / location / Reached drop. */
integrationRouter.post(
  '/trips/:number/events',
  asyncHandler(async (req, res) => {
    const v = new Validator(req.body);
    const type = v.oneOf('type', 'an event type', TRACKING_EVENTS);
    const location = v.text('location', 'the location', { max: 80 });
    const eta = isoDate(v, 'eta', 'the ETA');
    v.done();
    const trip = await tripByNumber(req.params.number);
    await trackingEvent(trip.id, type!, location, eta);
    res.json({ ok: true });
  }),
);

/** Receiver confirms delivery with the one-time code. */
integrationRouter.post(
  '/trips/:number/delivered',
  asyncHandler(async (req, res) => {
    const v = new Validator(req.body);
    const goodQty = v.int('goodQty', 'units received in good order', 0, 1_000_000);
    const damagedQty = v.int('damagedQty', 'damaged or short units', 0, 1_000_000);
    const remarks = v.text('remarks', 'remarks', { max: 200 });
    v.done();
    const trip = await tripByNumber(req.params.number);
    await delivered(trip.id, { goodQty: goodQty!, damagedQty: damagedQty!, remarks });
    res.json({ ok: true });
  }),
);

/** Driver sends the signed-LR photo; the POD agent reports whether its QR matched the LR. */
integrationRouter.post(
  '/trips/:number/pod',
  asyncHandler(async (req, res) => {
    const v = new Validator(req.body);
    const remarks = v.text('remarks', 'remarks read from the POD', { max: 200 });
    const photoUrl = v.text('photoUrl', 'the photo link', { max: 500 });
    v.done();
    const trip = await tripByNumber(req.params.number);
    await podReceived(trip.id, { qrMatched: req.body?.qrMatched !== false, remarks, photoUrl });
    res.json({ ok: true });
  }),
);

/** Carrier accepts or disputes a claim. */
integrationRouter.post(
  '/claims/:number/response',
  asyncHandler(async (req, res) => {
    const claim = await prisma.claim.findUnique({ where: { number: req.params.number } });
    if (!claim) throw notFound(`No claim ${req.params.number}.`);
    const v = new Validator(req.body);
    const note = v.text('note', 'a note', { max: 200 });
    v.done();
    await claimResponse(claim.id, req.body?.accept === true, note);
    res.json({ ok: true });
  }),
);

/** Carrier billing: invoice for a trip. */
integrationRouter.post(
  '/trips/:number/invoice',
  asyncHandler(async (req, res) => {
    const v = new Validator(req.body);
    const number = v.text('number', 'the invoice number', { required: true, max: 30 });
    const freight = v.money('freight', 'the freight amount', { required: true });
    const detention = req.body?.detention ? v.money('detention', 'detention') : 0;
    const claimDeduction = req.body?.claimDeduction ? v.money('claimDeduction', 'the claim deduction') : 0;
    const dueDate = isoDate(v, 'dueDate', 'the due date');
    v.done();
    const trip = await tripByNumber(req.params.number);
    await invoiceRaised(trip.id, { number: number!, freight: freight!, detention: detention ?? 0, claimDeduction: claimDeduction ?? 0, dueDate });
    res.json({ ok: true });
  }),
);

/** Reads an optional fix proposal: { fix, label, newEta?, extraCost, payer }. */
function readProposal(v: Validator, raw: unknown): Proposal | null {
  if (raw == null) return null;
  const p = new Validator(raw as Record<string, unknown>);
  const fix = p.oneOf('fix', 'a fix', FIX_KINDS);
  const label = p.text('label', 'what the fix is', { required: true, max: 120 });
  const newEta = p.text('newEta', 'the new ETA');
  const extraCost = (raw as Record<string, unknown>).extraCost ? p.money('extraCost', 'the extra cost') : 0;
  const payer = p.oneOf('payer', 'who pays', ['CARRIER', 'SHIPPER'] as const);
  for (const [k, m] of Object.entries(p.fields)) v.fail(`proposal.${k}`, m);
  return fix && label && payer ? { fix, label, newEta: newEta && !Number.isNaN(Date.parse(newEta)) ? new Date(newEta).toISOString() : null, extraCost: extraCost ?? 0, payer } : null;
}

/** Driver bot / exception agent: a problem on the road, optionally with the proposed fix. */
integrationRouter.post(
  '/trips/:number/exceptions',
  asyncHandler(async (req, res) => {
    const v = new Validator(req.body);
    const kind = v.oneOf('kind', 'a problem type', EXCEPTION_KINDS);
    const description = v.text('description', 'what happened', { required: true, max: 200 });
    const proposal = readProposal(v, req.body?.proposal);
    v.done();
    const trip = await tripByNumber(req.params.number);
    await reportException(trip.id, kind!, description!, proposal);
    const ex = await prisma.tripException.findFirst({ where: { tripId: trip.id }, orderBy: { createdAt: 'desc' } });
    res.json({ ok: true, exceptionId: ex?.id });
  }),
);

/** Exception agent: a (new) fix proposal, e.g. after the shipper rejected the first one. */
integrationRouter.post(
  '/exceptions/:id/proposal',
  asyncHandler(async (req, res) => {
    const v = new Validator({});
    const proposal = readProposal(v, req.body);
    if (!proposal) v.fail('proposal', 'Send a complete proposal.');
    v.done();
    await proposeFix(req.params.id, proposal!);
    res.json({ ok: true });
  }),
);

/** Carrier carried out the fix: back on the road. */
integrationRouter.post(
  '/exceptions/:id/resolve',
  asyncHandler(async (req, res) => {
    const v = new Validator(req.body);
    const truckNumber = v.text('truckNumber', 'the new truck number', { max: 20 });
    const eta = v.text('newEta', 'the new ETA');
    v.done();
    await resolveException(req.params.id, { newEta: eta && !Number.isNaN(Date.parse(eta)) ? new Date(eta) : null, truckNumber });
    res.json({ ok: true });
  }),
);
