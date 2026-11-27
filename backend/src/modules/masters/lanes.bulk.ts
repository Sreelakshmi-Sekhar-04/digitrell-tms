import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { conflict, notFound } from '../../lib/errors';
import { audit } from '../../lib/audit';
import { type BulkSpec, type Checked, byName, fieldsOf, splitList } from '../../lib/bulk';
import { TRUCK_TYPES } from '../../shared/masters';
import { readLane, type LaneRow, type ListedCarrier } from './lanes.routes';

type LaneData =
  | { mode: 'create'; origin: string; destination: string; truckType: string; awardRule: string; carrierIds: string[] }
  | { mode: 'add'; laneId: string; label: string; carrierIds: string[] };

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
const canonTruck = (s: string) => TRUCK_TYPES.find((t) => t.toLowerCase() === norm(s)) ?? s.trim();

const ASK_ME = 'Ask me';
const AUTO = 'Lowest within budget, automatic';

/** Sheet text to ASK / AUTO_LOWEST (blank = ASK, codes accepted); unknown text is returned for the form check to refuse. */
function awardCode(s: string) {
  const t = norm(s).replace(/,/g, '');
  if (!t || t === 'ask me' || t === 'ask') return 'ASK';
  if (t === 'lowest within budget automatic' || t === 'auto lowest' || t === 'auto_lowest' || t === 'automatic') return 'AUTO_LOWEST';
  return s.trim();
}

/** Bulk upload for Master data > Lanes: a lane with its approved carriers. */
export const lanesBulk: BulkSpec<LaneData> = {
  kind: 'lanes',
  title: 'Lanes',
  noun: 'lane',
  roles: ['LOGISTICS_HEAD'],
  columns: [
    { key: 'origin', header: 'Pickup city', required: true, example: 'Chennai', help: 'City trucks load in.' },
    { key: 'destination', header: 'Drop city', required: true, example: 'Bengaluru', help: 'City trucks unload in. Must differ from the pickup city.' },
    { key: 'truckType', header: 'Truck type', required: true, example: '17ft', help: 'Choose from the list.', options: TRUCK_TYPES },
    { key: 'awardRule', header: 'Award rule', example: ASK_ME, help: `"${ASK_ME}" (every award needs approval) or "${AUTO}" (needs a budget on each booking and at least one carrier). Blank means "${ASK_ME}". Not changed on a lane that already exists.`, options: [ASK_ME, AUTO] },
    { key: 'carriers', header: 'Approved carriers', example: 'NorthStar Logistics; Sri Ram Transport', help: 'Carrier names from your carrier list (see the Lists sheet), separated by ";". On an existing lane these are added; none are removed.' },
  ],

  async lists(ctx) {
    const shipperId = ctx.user.companyId;
    const [links, addresses] = await Promise.all([
      prisma.shipperCarrier.findMany({ where: { shipperId, isActive: true }, include: { carrier: { select: { name: true } } } }),
      prisma.address.findMany({ where: { companyId: shipperId, isActive: true }, select: { city: true } }),
    ]);
    const cities = [...new Map(addresses.map((a) => [norm(a.city), a.city])).values()].sort((a, b) => a.localeCompare(b));
    return { Carriers: links.map((l) => l.carrier.name).sort((a, b) => a.localeCompare(b)), Cities: cities };
  },

  async check(rows, ctx) {
    const shipperId = ctx.user.companyId;
    const [links, lanes] = await Promise.all([
      prisma.shipperCarrier.findMany({ where: { shipperId }, include: { carrier: { select: { name: true } } } }),
      prisma.lane.findMany({ where: { shipperId }, include: { carriers: { include: { carrier: { select: { id: true, name: true, status: true } } }, orderBy: { createdAt: 'asc' } } } }),
    ]);
    const carrierOf = byName(links.map((l) => ({ name: l.carrier.name, id: l.carrierId })));
    const laneOf = new Map(lanes.map((l) => [[norm(l.origin), norm(l.destination), l.truckType].join('|'), l as LaneRow]));

    return Promise.all(rows.map(async (r): Promise<Checked<LaneData>> => {
      const errors: Record<string, string> = {};
      const ids: string[] = [];
      for (const n of splitList(r.carriers)) {
        const c = carrierOf(n);
        if (!c) errors.carriers = `${n} is not in your carrier list. Add it under Carriers first.`;
        else if (!ids.includes(c.id)) ids.push(c.id);
      }
      const truckType = canonTruck(r.truckType);
      const rule = awardCode(r.awardRule);
      const existing = laneOf.get([norm(r.origin), norm(r.destination), truckType].join('|'));

      // An existing lane keeps its award rule and its carriers; the row can only add carriers.
      const body: Record<string, unknown> = {
        origin: r.origin, destination: r.destination, truckType,
        awardRule: existing ? existing.awardRule : rule,
        carrierIds: existing ? [...new Set([...existing.carriers.map((c) => c.carrierId), ...ids])] : ids,
      };
      const res = await fieldsOf(() => readLane(body, shipperId, existing, links));
      for (const [k, m] of Object.entries(res.errors)) errors[k === 'carrierIds' ? 'carriers' : k] = m;
      if (existing && r.awardRule.trim() && !errors.awardRule && rule !== 'ASK' && rule !== 'AUTO_LOWEST') errors.awardRule = `Choose "${ASK_ME}" or "${AUTO}".`;
      if (Object.keys(errors).length || !res.value) return { status: 'INVALID', errors };

      const v = res.value;
      const key = [norm(v.origin!), norm(v.destination!), v.truckType].join('|');
      if (!existing) return { status: 'NEW', errors: {}, key, data: { mode: 'create', origin: v.origin!, destination: v.destination!, truckType: v.truckType!, awardRule: v.awardRule!, carrierIds: ids } };

      const have = new Set(existing.carriers.map((c) => c.carrierId));
      const added = ids.filter((id) => !have.has(id));
      if (!added.length) return { status: 'DUPLICATE', errors: {}, key, note: 'This lane already exists' };
      const names = added.map((id) => links.find((l) => l.carrierId === id)!.carrier.name);
      const ruleNote = r.awardRule.trim() && rule !== existing.awardRule ? ' (award rule stays as it is)' : '';
      return { status: 'UPDATE', errors: {}, key, note: `Adds ${names.join(', ')} to this lane${ruleNote}`, data: { mode: 'add', laneId: existing.id, label: `${existing.origin} → ${existing.destination}`, carrierIds: added } };
    }));
  },

  async apply(row, ctx) {
    const d = row.data!;
    const shipperId = ctx.user.companyId;
    if (d.mode === 'create') {
      try {
        const lane = await prisma.lane.create({
          data: { shipperId, origin: d.origin, destination: d.destination, truckType: d.truckType, awardRule: d.awardRule, carriers: { create: d.carrierIds.map((carrierId) => ({ carrierId })) } },
        });
        await audit(ctx.user.id, 'LANE_CREATED', { id: lane.id, lane: `${lane.origin} → ${lane.destination}`, carriers: d.carrierIds.length, bulk: true });
        return { ref: lane.id };
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw conflict(`${d.origin} → ${d.destination} with ${d.truckType} already exists.`, { destination: 'This lane already exists. Edit it instead.' });
        }
        throw err;
      }
    }
    // Existing lane: only adds carriers (skipping any added meanwhile), inside one transaction.
    await prisma.$transaction(async (tx) => {
      const lane = await tx.lane.findFirst({ where: { id: d.laneId, shipperId } });
      if (!lane) throw notFound('That lane no longer exists.');
      const listed = await tx.shipperCarrier.count({ where: { shipperId, carrierId: { in: d.carrierIds } } });
      if (listed !== d.carrierIds.length) throw conflict('One of these carriers is no longer in your carrier list.', { carriers: 'One of these carriers is no longer in your carrier list.' });
      await tx.laneCarrier.createMany({ data: d.carrierIds.map((carrierId) => ({ laneId: d.laneId, carrierId })), skipDuplicates: true });
    });
    await audit(ctx.user.id, 'LANE_UPDATED', { id: d.laneId, changes: ['carrierIds'], added: d.carrierIds.length, bulk: true });
    return { ref: d.laneId };
  },
};
