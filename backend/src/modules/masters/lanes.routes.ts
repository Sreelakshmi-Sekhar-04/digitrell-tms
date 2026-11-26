import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler, conflict, notFound } from '../../lib/errors';
import { Validator } from '../../lib/validate';
import { audit } from '../../lib/audit';
import { requireRole } from '../../middleware/auth';
import { AWARD_RULES, TRUCK_TYPES } from '../../shared/masters';

export const lanesRouter = Router();

const laneInclude = { carriers: { include: { carrier: { select: { id: true, name: true, status: true } } }, orderBy: { createdAt: 'asc' as const } } };
type LaneRow = Prisma.LaneGetPayload<{ include: typeof laneInclude }>;

const view = (l: LaneRow) => ({
  id: l.id, origin: l.origin, destination: l.destination, truckType: l.truckType,
  awardRule: l.awardRule, isActive: l.isActive,
  carriers: l.carriers.map((lc) => lc.carrier),
});

const cityCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * Validates a lane. The budget is no longer part of a lane: it is entered on each booking
 * (a `budget` sent here is ignored, so older clients keep working).
 */
async function readLane(body: Record<string, unknown>, shipperId: string, current?: LaneRow) {
  const v = new Validator(body);
  const partial = !!current;
  const out: { origin?: string; destination?: string; truckType?: string; awardRule?: string; isActive?: boolean; carrierIds?: string[] } = {};
  if (!partial || v.has('origin')) out.origin = v.text('origin', 'the pickup city', { required: true, max: 60 }) ?? undefined;
  if (!partial || v.has('destination')) out.destination = v.text('destination', 'the drop city', { required: true, max: 60 }) ?? undefined;
  if (!partial || v.has('truckType')) out.truckType = v.oneOf('truckType', 'truck type', TRUCK_TYPES) ?? undefined;
  if (!partial || v.has('awardRule')) out.awardRule = v.oneOf('awardRule', 'how awards are made', AWARD_RULES) ?? undefined;
  if (v.has('isActive')) out.isActive = Boolean(body.isActive);
  if (!partial || v.has('carrierIds')) {
    const ids = Array.isArray(body.carrierIds) ? [...new Set(body.carrierIds.map(String))] : [];
    if (ids.length) {
      // Only carriers in this shipper's carrier master, and in use, can be approved on a lane.
      const listed = await prisma.shipperCarrier.findMany({ where: { shipperId, carrierId: { in: ids } }, include: { carrier: { select: { name: true } } } });
      const keptOn = new Set(current?.carriers.map((c) => c.carrierId));
      if (listed.length !== ids.length) v.fail('carrierIds', 'One of the chosen carriers is not in your carrier list. Refresh and choose again.');
      else {
        const off = listed.find((l) => !l.isActive && !keptOn.has(l.carrierId));
        if (off) v.fail('carrierIds', `${off.carrier.name} is marked not in use in your carrier list. Turn it back on there first.`);
      }
    }
    out.carrierIds = ids;
  }
  if (out.origin) out.origin = cityCase(out.origin);
  if (out.destination) out.destination = cityCase(out.destination);

  const origin = out.origin ?? current?.origin;
  const destination = out.destination ?? current?.destination;
  if (origin && destination && origin.toLowerCase() === destination.toLowerCase()) v.fail('destination', 'Drop city must differ from pickup city.');

  // Automatic award needs at least one approved carrier (and a budget on each booking, checked there).
  const rule = out.awardRule ?? current?.awardRule;
  const carrierCount = out.carrierIds ? out.carrierIds.length : current?.carriers.length ?? 0;
  if (rule === 'AUTO_LOWEST' && carrierCount === 0) v.fail('carrierIds', 'Approve at least one carrier before turning on automatic award.');
  v.done();
  return out;
}

async function assertUnique(shipperId: string, l: { origin?: string; destination?: string; truckType?: string }, exceptId?: string) {
  if (!l.origin || !l.destination || !l.truckType) return;
  const dup = await prisma.lane.findFirst({
    where: { shipperId, origin: { equals: l.origin, mode: 'insensitive' }, destination: { equals: l.destination, mode: 'insensitive' }, truckType: l.truckType, NOT: exceptId ? { id: exceptId } : undefined },
  });
  if (dup) throw conflict(`${dup.origin} → ${dup.destination} with ${dup.truckType} already exists.`, { destination: 'This lane already exists. Edit it instead.' });
}

lanesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const lanes = await prisma.lane.findMany({ where: { shipperId: req.user!.companyId }, include: laneInclude, orderBy: [{ isActive: 'desc' }, { origin: 'asc' }, { destination: 'asc' }] });
    res.json({ lanes: lanes.map(view) });
  }),
);

lanesRouter.post(
  '/',
  requireRole('LOGISTICS_HEAD'),
  asyncHandler(async (req, res) => {
    const d = await readLane(req.body, req.user!.companyId);
    await assertUnique(req.user!.companyId, d);
    const lane = await prisma.lane.create({
      data: {
        shipperId: req.user!.companyId, origin: d.origin!, destination: d.destination!, truckType: d.truckType!, awardRule: d.awardRule!,
        carriers: { create: d.carrierIds!.map((carrierId) => ({ carrierId })) },
      },
      include: laneInclude,
    });
    await audit(req.user!.id, 'LANE_CREATED', { id: lane.id, lane: `${lane.origin} → ${lane.destination}`, carriers: d.carrierIds!.length });
    res.status(201).json({ lane: view(lane) });
  }),
);

lanesRouter.patch(
  '/:id',
  requireRole('LOGISTICS_HEAD'),
  asyncHandler(async (req, res) => {
    const current = await prisma.lane.findFirst({ where: { id: req.params.id, shipperId: req.user!.companyId }, include: laneInclude });
    if (!current) throw notFound('That lane no longer exists.');
    const d = await readLane(req.body, req.user!.companyId, current);
    await assertUnique(req.user!.companyId, { origin: d.origin ?? current.origin, destination: d.destination ?? current.destination, truckType: d.truckType ?? current.truckType }, current.id);
    const lane = await prisma.$transaction(async (tx) => {
      if (d.carrierIds) {
        await tx.laneCarrier.deleteMany({ where: { laneId: current.id } });
        await tx.laneCarrier.createMany({ data: d.carrierIds.map((carrierId) => ({ laneId: current.id, carrierId })) });
      }
      return tx.lane.update({
        where: { id: current.id },
        data: {
          origin: d.origin, destination: d.destination, truckType: d.truckType, awardRule: d.awardRule, isActive: d.isActive,
        },
        include: laneInclude,
      });
    });
    const changes = Object.keys(d);
    await audit(req.user!.id, 'LANE_UPDATED', { id: lane.id, changes, awardRule: d.awardRule ?? undefined });
    res.json({ lane: view(lane) });
  }),
);
