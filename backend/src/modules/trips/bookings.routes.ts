import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError, asyncHandler } from '../../lib/errors';
import { Validator, toNumber } from '../../lib/validate';
import { audit } from '../../lib/audit';
import { TRUCK_TYPES } from '../../shared/masters';
import { getPolicy } from '../policies/policies.routes';

export const bookingsRouter = Router();

const MAX_DAYS_AHEAD = 60;
/** Today in India as YYYY-MM-DD (bookings are domestic). */
const todayIST = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

/**
 * Validates a booking and finds its lane (pickup city → drop city, truck type). Booking needs an
 * active lane with approved carriers: quote requests only go to those (BRD §4.2).
 */
async function readBooking(body: Record<string, unknown>, companyId: string) {
  const v = new Validator(body);
  const pickupAddressId = v.text('pickupAddressId', 'the pickup address', { required: true });
  const dropAddressId = v.text('dropAddressId', 'the drop address', { required: true });
  const pickupDate = v.text('pickupDate', 'the pickup date', { required: true });
  const truckType = v.oneOf('truckType', 'truck type', TRUCK_TYPES);
  const material = v.text('material', 'what is being moved', { required: true, max: 80 });
  const weightRaw = body.weightTonnes;
  const weight = typeof weightRaw === 'number' ? weightRaw : Number(String(weightRaw ?? '').replace(',', '.'));
  if (weightRaw == null || weightRaw === '' || !Number.isFinite(weight)) v.fail('weightTonnes', 'Enter the weight in tonnes, e.g. 14.');
  else if (weight <= 0 || weight > 60) v.fail('weightTonnes', 'Weight must be between 0.1 and 60 tonnes.');
  const receiverContact = v.text('receiverContact', 'the receiver contact', { max: 80 });
  const reference = v.text('reference', 'your reference', { max: 40 });
  const notes = v.text('notes', 'notes', { max: 200 });
  const policy = await getPolicy(companyId);
  const quoteWindowHours = body.quoteWindowHours == null || body.quoteWindowHours === '' ? policy.quoteWindowHours : v.int('quoteWindowHours', 'the quote window', 1, 48);

  if (pickupDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(pickupDate) || Number.isNaN(Date.parse(pickupDate))) v.fail('pickupDate', 'Choose a valid date.');
    else if (pickupDate < todayIST()) v.fail('pickupDate', 'Pickup date cannot be in the past.');
    else if (Date.parse(pickupDate) - Date.parse(todayIST()) > MAX_DAYS_AHEAD * 86400_000) v.fail('pickupDate', `Book at most ${MAX_DAYS_AHEAD} days ahead.`);
  }
  const [pickup, drop] = await Promise.all([
    pickupAddressId ? prisma.address.findFirst({ where: { id: pickupAddressId, companyId, isActive: true } }) : null,
    dropAddressId ? prisma.address.findFirst({ where: { id: dropAddressId, companyId, isActive: true } }) : null,
  ]);
  if (pickupAddressId && (!pickup || pickup.kind === 'DROP')) v.fail('pickupAddressId', 'Choose a saved pickup address.');
  if (dropAddressId && (!drop || drop.kind === 'PICKUP')) v.fail('dropAddressId', 'Choose a saved drop address.');
  if (pickup && drop && pickup.id === drop.id) v.fail('dropAddressId', 'Drop must differ from pickup.');
  v.done();

  const lane = await prisma.lane.findFirst({
    where: { shipperId: companyId, isActive: true, truckType: truckType!, origin: { equals: pickup!.city, mode: 'insensitive' }, destination: { equals: drop!.city, mode: 'insensitive' } },
    include: { carriers: { include: { carrier: { select: { id: true, name: true, status: true } } } } },
  });
  if (!lane || lane.carriers.length === 0) {
    throw new HttpError(400, 'NO_LANE', `No approved carriers for ${pickup!.city} → ${drop!.city} with ${truckType}. Add or update this lane in Carriers and lanes first.`, {
      lane: `No approved carriers for ${pickup!.city} → ${drop!.city}, ${truckType}.`,
    });
  }
  return {
    pickup: pickup!, drop: drop!, lane, pickupDate: pickupDate!, truckType: truckType!, material: material!, weight,
    receiverContact, reference, notes, quoteWindowHours: quoteWindowHours!,
  };
}

/** Confirm step: shows exactly what will happen before anything is created. */
bookingsRouter.post(
  '/preview',
  asyncHandler(async (req, res) => {
    const b = await readBooking(req.body, req.user!.companyId);
    res.json({
      lane: { id: b.lane.id, origin: b.lane.origin, destination: b.lane.destination, budget: toNumber(b.lane.budget), awardRule: b.lane.awardRule },
      carriers: b.lane.carriers.map((c) => c.carrier),
      quoteWindowHours: b.quoteWindowHours,
      quotesClose: new Date(Date.now() + b.quoteWindowHours * 3600_000),
    });
  }),
);

/** Creates the booking and sends the quote request to every approved carrier on the lane. */
bookingsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const b = await readBooking(req.body, req.user!.companyId);
    const trip = await prisma.trip.create({
      data: {
        shipperId: req.user!.companyId, laneId: b.lane.id, pickupAddressId: b.pickup.id, dropAddressId: b.drop.id,
        pickupDate: new Date(`${b.pickupDate}T00:00:00.000Z`), truckType: b.truckType, material: b.material,
        weightKg: new Prisma.Decimal(Math.round(b.weight * 1000)), receiverContact: b.receiverContact, reference: b.reference, notes: b.notes,
        status: 'QUOTES_REQUESTED', quoteDeadline: new Date(Date.now() + b.quoteWindowHours * 3600_000), createdById: req.user!.id,
        quotes: { create: b.lane.carriers.map((c) => ({ carrierId: c.carrierId })) },
      },
    });
    await audit(req.user!.id, 'BOOKED', { lane: `${b.pickup.city} → ${b.drop.city}`, channel: 'web' }, { tripId: trip.id });
    await audit('tender-agent', 'QUOTES_REQUESTED', { carriers: b.lane.carriers.map((c) => c.carrier.name), windowHours: b.quoteWindowHours }, { tripId: trip.id });
    res.status(201).json({ trip: { id: trip.id, number: trip.number, quoteDeadline: trip.quoteDeadline, carriersAsked: b.lane.carriers.length } });
  }),
);

/** Last distinct bookings, for "Repeat a recent booking". */
bookingsRouter.get(
  '/recent',
  asyncHandler(async (req, res) => {
    const trips = await prisma.trip.findMany({
      where: { shipperId: req.user!.companyId, pickupAddress: { isActive: true }, dropAddress: { isActive: true } },
      include: { pickupAddress: true, dropAddress: true },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });
    const seen = new Set<string>();
    const recent = [];
    for (const t of trips) {
      const key = [t.pickupAddressId, t.dropAddressId, t.truckType, t.material, String(t.weightKg)].join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      recent.push({
        pickupAddressId: t.pickupAddressId, dropAddressId: t.dropAddressId,
        lane: `${t.pickupAddress!.city} → ${t.dropAddress!.city}`,
        pickupName: t.pickupAddress!.name, dropName: t.dropAddress!.name,
        truckType: t.truckType, material: t.material, weightTonnes: t.weightKg != null ? toNumber(t.weightKg)! / 1000 : null,
        lastBooked: t.createdAt,
      });
      if (recent.length === 3) break;
    }
    res.json({ recent });
  }),
);
