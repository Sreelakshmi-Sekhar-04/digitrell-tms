import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler } from '../../lib/errors';
import { Validator, toNumber } from '../../lib/validate';
import { audit } from '../../lib/audit';
import { TRUCK_TYPES } from '../../shared/masters';
import { getPolicy } from '../policies/policies.routes';
import { noContractRate, offerCandidates, offerRows, type Candidate } from './tender.service';

export const bookingsRouter = Router();

const MAX_DAYS_AHEAD = 60;
/** Today in India as YYYY-MM-DD (bookings are domestic). */
const todayIST = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

/**
 * Validates a booking and finds who can carry it. The shipper types no price: every carrier with a
 * valid contract line for the pickup city, drop city and truck type is a candidate, cheapest first.
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

  const candidates = await offerCandidates(companyId, pickup!.city, drop!.city, truckType!, pickupDate!);
  if (!candidates.length) throw noContractRate(pickup!.city, drop!.city, truckType!);
  const lane = await prisma.lane.findFirst({
    where: { shipperId: companyId, isActive: true, truckType: truckType!, origin: { equals: pickup!.city, mode: 'insensitive' }, destination: { equals: drop!.city, mode: 'insensitive' } },
  });
  return {
    pickup: pickup!, drop: drop!, lane, candidates, pickupDate: pickupDate!, truckType: truckType!, material: material!, weight,
    receiverContact, reference, notes, respondHours: policy.quoteWindowHours,
  };
}

/** The ordered offer list as the booking screens show it: the first carrier is offered first. */
const listView = (candidates: Candidate[]) =>
  candidates.map((c, i) => ({ id: c.carrierId, name: c.carrierName, rate: c.rate, transitDays: c.transitDays, sequence: i + 1, offeredFirst: i === 0 }));

/**
 * While the form is filled in: the carriers on contract for this pickup, drop and truck type, in
 * the order they will be offered the load, with their rates. `ready: false` until the form has
 * enough to look up; `noContractRate: true` when nobody has a valid contract line.
 */
bookingsRouter.get(
  '/lane-info',
  asyncHandler(async (req, res) => {
    const companyId = req.user!.companyId;
    const [pickup, drop] = await Promise.all([
      prisma.address.findFirst({ where: { id: String(req.query.pickupAddressId ?? ''), companyId, isActive: true } }),
      prisma.address.findFirst({ where: { id: String(req.query.dropAddressId ?? ''), companyId, isActive: true } }),
    ]);
    const truckType = String(req.query.truckType ?? '');
    if (!pickup || !drop || !(TRUCK_TYPES as readonly string[]).includes(truckType)) return res.json({ ready: false, lane: null, carriers: [] });
    const asked = String(req.query.pickupDate ?? '');
    const day = /^\d{4}-\d{2}-\d{2}$/.test(asked) ? asked : todayIST();
    const candidates = await offerCandidates(companyId, pickup.city, drop.city, truckType, day);
    const lane = await prisma.lane.findFirst({
      where: { shipperId: companyId, isActive: true, truckType, origin: { equals: pickup.city, mode: 'insensitive' }, destination: { equals: drop.city, mode: 'insensitive' } },
    });
    res.json({
      ready: true,
      lane: lane ? { id: lane.id, origin: lane.origin, destination: lane.destination, truckType: lane.truckType } : null,
      route: { origin: pickup.city, destination: drop.city, truckType },
      carriers: listView(candidates),
      noContractRate: candidates.length === 0,
      message: candidates.length ? null : noContractRate(pickup.city, drop.city, truckType).message,
    });
  }),
);

/** Confirm step: shows exactly what will happen before anything is created. */
bookingsRouter.post(
  '/preview',
  asyncHandler(async (req, res) => {
    const b = await readBooking(req.body, req.user!.companyId);
    const carriers = listView(b.candidates);
    res.json({
      lane: b.lane ? { id: b.lane.id, origin: b.lane.origin, destination: b.lane.destination } : null,
      route: { origin: b.pickup.city, destination: b.drop.city, truckType: b.truckType },
      carriers,
      offeredFirst: carriers[0],
      respondHours: b.respondHours,
      respondBy: new Date(Date.now() + b.respondHours * 3600_000),
    });
  }),
);

/** Creates the booking and offers the load to the carrier with the lowest contract rate. */
bookingsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const b = await readBooking(req.body, req.user!.companyId);
    const { rows, respondBy } = offerRows(b.candidates, b.respondHours);
    const trip = await prisma.trip.create({
      data: {
        shipperId: req.user!.companyId, laneId: b.lane?.id ?? null, pickupAddressId: b.pickup.id, dropAddressId: b.drop.id,
        pickupDate: new Date(`${b.pickupDate}T00:00:00.000Z`), truckType: b.truckType, material: b.material,
        weightKg: new Prisma.Decimal(Math.round(b.weight * 1000)), receiverContact: b.receiverContact, reference: b.reference, notes: b.notes,
        status: 'QUOTES_REQUESTED', quoteDeadline: respondBy, createdById: req.user!.id,
        quotes: { create: rows },
      },
    });
    const first = b.candidates[0];
    await audit(req.user!.id, 'BOOKED', { lane: `${b.pickup.city} → ${b.drop.city}`, channel: 'web' }, { tripId: trip.id });
    await audit('tender-agent', 'OFFER_SENT', { carrier: first.carrierName, amount: first.rate, sequence: 1, of: b.candidates.length }, { tripId: trip.id });
    res.status(201).json({
      trip: {
        id: trip.id, number: trip.number, quoteDeadline: trip.quoteDeadline, carriersInLine: b.candidates.length,
        offeredTo: { id: first.carrierId, name: first.carrierName, rate: first.rate },
      },
    });
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
