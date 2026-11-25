import { Router, type NextFunction, type Request, type Response } from 'express';
import { prisma } from '../../lib/prisma';
import { HttpError, asyncHandler, notFound } from '../../lib/errors';
import { Validator } from '../../lib/validate';
import { receiveQuote, syncTrip } from '../trips/tender.service';

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
