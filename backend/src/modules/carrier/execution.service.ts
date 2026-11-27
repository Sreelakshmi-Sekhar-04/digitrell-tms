import type { Driver, Truck } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { audit } from '../../lib/audit';
import { HttpError, badRequest, forbidden } from '../../lib/errors';
import { toNumber } from '../../lib/validate';
import { docState, formatTruckNumber } from '../../shared/carrier';
import { loadTrip } from '../trips/tender.service';
import { truckStatus } from './fleet.routes';

/**
 * Carrier phase 4: assign a truck and driver. The LR is issued by the carrier (trips/lr.service.ts).
 * Status changes match the shared flow: AWARDED → TRUCK_CONFIRMED (truck assigned) → READY_FOR_PICKUP (LR issued).
 * The shipper sees the same fields and the same audit events (TRUCK_CONFIRMED, DOCUMENTS_ISSUED) as before.
 */

export interface Actor { id: string; name: string; roles: string[] }
const wrongState = (m: string) => new HttpError(409, 'WRONG_STATE', m);
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/** Statuses where the carrier can still assign or change the truck (before the LR is issued). */
export const ASSIGNABLE = ['AWARDED', 'SOURCING_TRUCK', 'TRUCK_CONFIRMED'] as const;
const BUSY = ['TRUCK_CONFIRMED', 'CLEARED', 'READY_FOR_PICKUP', 'IN_TRANSIT', 'ON_HOLD'] as const;

const LIGHT_TYPES = ['14ft', '17ft', '19ft'];
/** Licence classes in order of what they may drive. */
const CLASS_RANK: Record<string, number> = { LGV: 1, MGV: 2, HGV: 3, EHV: 4 };
/**
 * Lowest licence class a truck needs: up to 7.5 t (and a light body) → LGV; up to 12 t → MGV; heavier → HGV.
 * With no capacity on record, light bodies (14–19 ft) need LGV and everything else HGV.
 */
export function requiredLicenceClass(truckType: string | null, capacityKg: number | null): 'LGV' | 'MGV' | 'HGV' {
  if (capacityKg != null && capacityKg > 0) {
    if (capacityKg <= 7500 && (!truckType || LIGHT_TYPES.includes(truckType))) return 'LGV';
    if (capacityKg <= 12000) return 'MGV';
    return 'HGV';
  }
  return !truckType || LIGHT_TYPES.includes(truckType) ? 'LGV' : 'HGV';
}
const LICENCE_NAMES: Record<string, string> = { LGV: 'light', MGV: 'medium', HGV: 'heavy', EHV: 'extra heavy' };
/** True when the driver's class does not cover the truck. */
export const licenceTooLow = (licenceClass: string, truckType: string | null, capacityKg: number | null) =>
  (CLASS_RANK[licenceClass] ?? 0) < CLASS_RANK[requiredLicenceClass(truckType, capacityKg)];

/** Problems with a truck/driver pair that only the owner can override. */
export function complianceIssues(truck: Truck, driver: Driver, tripTruckType: string | null) {
  const issues: string[] = [];
  const ts = truckStatus(truck, null);
  for (const d of ts.docs) if (d.state === 'EXPIRED' || d.state === 'MISSING') issues.push(`${formatTruckNumber(truck.number)}: ${d.label} ${d.state === 'EXPIRED' ? 'expired' : 'missing'}`);
  const ls = docState(driver.licenceExpiry);
  if (!driver.licenceNumber || !driver.licenceClass || ls === 'MISSING') issues.push(`${driver.name}: licence details missing`);
  else if (ls === 'EXPIRED') issues.push(`${driver.name}: licence expired`);
  if (driver.licenceClass && licenceTooLow(driver.licenceClass, truck.truckType, toNumber(truck.capacityKg))) {
    const need = requiredLicenceClass(truck.truckType, toNumber(truck.capacityKg));
    issues.push(`${driver.name}: ${driver.licenceClass} licence does not cover a ${truck.truckType} truck (needs ${need}, ${LICENCE_NAMES[need]} goods vehicle, or higher)`);
  }
  if (tripTruckType && truck.truckType !== tripTruckType) issues.push(`${formatTruckNumber(truck.number)} is ${truck.truckType}; the load needs ${tripTruckType}`);
  return issues;
}

export async function busyIds(carrierId: string, exceptTripId: string) {
  const trips = await prisma.trip.findMany({ where: { carrierId, id: { not: exceptTripId }, status: { in: [...BUSY] } }, select: { number: true, truckId: true, driverId: true } });
  return {
    truck: new Map(trips.filter((t) => t.truckId).map((t) => [t.truckId!, t.number])),
    driver: new Map(trips.filter((t) => t.driverId).map((t) => [t.driverId!, t.number])),
  };
}

/** Choices for the assign form: trucks of the load's type first, free and compliant ones first. */
export async function assignmentOptions(carrierId: string, trip: { id: string; truckType: string | null }) {
  const [trucks, drivers, busy] = await Promise.all([
    prisma.truck.findMany({ where: { carrierId, isActive: true } }),
    prisma.driver.findMany({ where: { carrierId, isActive: true }, orderBy: { name: 'asc' } }),
    busyIds(carrierId, trip.id),
  ]);
  const rank = { READY: 0, EXPIRING: 1, ON_TRIP: 2, BLOCKED: 3, INACTIVE: 4 } as const;
  const truckRows = trucks.map((t) => {
    const s = truckStatus(t, busy.truck.get(t.id) ?? null);
    return {
      id: t.id, number: formatTruckNumber(t.number), truckType: t.truckType, matchesType: t.truckType === trip.truckType,
      status: s.status, note: s.note, usualDriverId: t.usualDriverId, capacityKg: toNumber(t.capacityKg),
    };
  }).sort((a, b) => Number(b.matchesType) - Number(a.matchesType) || rank[a.status] - rank[b.status] || a.number.localeCompare(b.number));
  const driverRows = drivers.map((d) => {
    const ls = docState(d.licenceExpiry);
    const blocked = !d.licenceNumber || !d.licenceClass || ls === 'EXPIRED' || ls === 'MISSING';
    const on = busy.driver.get(d.id);
    return {
      id: d.id, name: d.name, phone: d.phone, licenceClass: d.licenceClass, licenceExpiry: iso(d.licenceExpiry),
      status: blocked ? 'BLOCKED' : on ? 'ON_TRIP' : 'FREE',
      note: blocked ? (ls === 'EXPIRED' ? 'Licence expired' : 'Licence details missing') : on ? `On ${on}` : ls === 'EXPIRING' ? `Licence expires ${iso(d.licenceExpiry)}` : 'Licence valid',
    };
  }).sort((a, b) => ({ FREE: 0, ON_TRIP: 1, BLOCKED: 2 }[a.status] ?? 3) - ({ FREE: 0, ON_TRIP: 1, BLOCKED: 2 }[b.status] ?? 3));
  return { trucks: truckRows, drivers: driverRows };
}

const activeLr = <T extends { kind: string; isVoid: boolean }>(docs: T[]) => docs.find((d) => d.kind === 'LR' && !d.isVoid);

async function ownTrip(tripId: string, carrierId: string) {
  const trip = await loadTrip(tripId);
  if (trip.carrierId !== carrierId) throw wrongState('This load is not assigned to your company.');
  return trip;
}

export interface AssignInput { truckId: string; driverId: string; pickupEta: Date | null; override: { reason: string } | null }

/** Assign (or change) the truck and driver. Compliance problems block unless the owner overrides with a reason. */
export async function assignTruck(tripId: string, carrierId: string, by: Actor, d: AssignInput) {
  const trip = await ownTrip(tripId, carrierId);
  if (!(ASSIGNABLE as readonly string[]).includes(trip.status)) throw wrongState('A truck can be assigned only after the shipper approves, and changed only before the LR is issued.');
  if (activeLr(trip.documents)) throw wrongState('The shipper has already issued the LR, so the truck can no longer be changed.');
  const [truck, driver] = await Promise.all([
    prisma.truck.findFirst({ where: { id: d.truckId, carrierId } }),
    prisma.driver.findFirst({ where: { id: d.driverId, carrierId } }),
  ]);
  if (!truck) throw badRequest('Pick one of your trucks.', { truckId: 'Pick one of your trucks.' });
  if (!driver) throw badRequest('Pick one of your drivers.', { driverId: 'Pick one of your drivers.' });
  if (!truck.isActive) throw badRequest('That truck is deactivated.', { truckId: 'That truck is deactivated.' });
  if (!driver.isActive) throw badRequest('That driver is deactivated.', { driverId: 'That driver is deactivated.' });
  const busy = await busyIds(carrierId, trip.id);
  if (busy.truck.has(truck.id)) throw new HttpError(409, 'TRUCK_BUSY', `${formatTruckNumber(truck.number)} is already on ${busy.truck.get(truck.id)}.`);
  if (busy.driver.has(driver.id)) throw new HttpError(409, 'DRIVER_BUSY', `${driver.name} is already on ${busy.driver.get(driver.id)}.`);

  const issues = complianceIssues(truck, driver, trip.truckType);
  if (issues.length) {
    if (!d.override) throw new HttpError(409, 'COMPLIANCE_BLOCKED', `Cannot assign: ${issues.join('; ')}. Only the owner can override with a reason.`, { issues: issues.join('; ') });
    if (!by.roles.includes('OWNER')) throw forbidden('Only the owner can override a compliance block.');
  }

  const reassigned = !!trip.truckId;
  await prisma.trip.update({
    where: { id: trip.id },
    data: {
      status: 'TRUCK_CONFIRMED', truckId: truck.id, driverId: driver.id, truckNumber: formatTruckNumber(truck.number),
      driverName: driver.name, driverPhone: driver.phone, pickupEta: d.pickupEta, lastUpdateAt: new Date(),
    },
  });
  await audit(`carrier:${carrierId}`, 'TRUCK_CONFIRMED', { truck: formatTruckNumber(truck.number), driver: driver.name, by: by.name, reassigned }, { tripId: trip.id });
  if (issues.length) {
    await audit(by.id, 'ASSIGNMENT_OVERRIDE', { owner: by.name, truck: formatTruckNumber(truck.number), driver: driver.name, issues }, { tripId: trip.id, reason: d.override!.reason });
  }
}


