import { expect, type APIRequestContext } from '@playwright/test';
import { USERS, asUser } from './helpers';
import { awardedTrip, refs } from './trips.helpers';

type Client = Awaited<ReturnType<typeof asUser>>;

// Shipper-issued LR: an awarded trip with a truck assigned by the carrier.

const isoDay = (n: number) => {
  const d = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const rnd = (n: number) => String(Math.floor(Math.random() * 10 ** n)).padStart(n, '0');

/** A fresh Kaveri truck and driver (shared seed ones stay "busy" once assigned). */
export async function freshFleet(request: APIRequestContext) {
  const vijay = await asUser(request, USERS.carrier);
  const tRes = await vijay.post('/carrier/trucks', {
    number: `TN${10 + Math.floor(Math.random() * 89)}LR${1000 + Math.floor(Math.random() * 8999)}`, truckType: '20ft SXL', ownership: 'OWN', capacityKg: 9000,
    rcExpiry: isoDay(900), insuranceExpiry: isoDay(300), permitExpiry: isoDay(300), fitnessExpiry: isoDay(300), pucExpiry: isoDay(100),
  });
  expect(tRes.status(), await tRes.text()).toBe(201);
  const dRes = await vijay.post('/carrier/drivers', { name: `Lr Driver ${rnd(4)}`, phone: `+9197${rnd(8)}`, licenceNumber: `TN09${rnd(11)}`, licenceClass: 'HGMV', licenceExpiry: isoDay(700) });
  expect(dRes.status(), await dRes.text()).toBe(201);
  return { truck: (await tRes.json()).truck as { id: string; number: string }, driver: (await dRes.json()).driver as { id: string; name: string } };
}

/** Pune to Hyderabad trip awarded to Kaveri, then Kaveri assigns a truck and driver: TRUCK_CONFIRMED, no LR yet. */
export async function assignedTrip(request: APIRequestContext, client: Client, r: Awaited<ReturnType<typeof refs>>) {
  const trip = await awardedTrip(request, client, r, { pune: true });
  const f = await freshFleet(request);
  const vijay = await asUser(request, USERS.carrier);
  const res = await vijay.post(`/carrier/loads/${trip.id}/assign`, { truckId: f.truck.id, driverId: f.driver.id });
  expect(res.status(), await res.text()).toBe(200);
  return { ...trip, ...f };
}

export const PRIYA = { email: 'priya@sunrisefoods.test', password: 'Shipper@123' }; // Sunrise approver

/** Assigned trip whose LR the shipper has issued: READY_FOR_PICKUP. */
export async function readyTrip(request: APIRequestContext, client: Client, r: Awaited<ReturnType<typeof refs>>) {
  const trip = await assignedTrip(request, client, r);
  const res = await client.post(`/trips/${trip.id}/lr`, {});
  expect(res.status(), await res.text()).toBe(200);
  return { ...trip, lrNumber: (await res.json()).lrNumber as string };
}

/** The carrier's own steps (no integration endpoints): reached pickup, loaded with an ETA. */
export async function loadedTrip(request: APIRequestContext, client: Client, r: Awaited<ReturnType<typeof refs>>) {
  const trip = await readyTrip(request, client, r);
  const divya = await asUser(request, USERS.carrierTraffic);
  expect((await divya.post(`/carrier/loads/${trip.id}/events`, { type: 'REACHED_PICKUP' })).status()).toBe(200);
  expect((await divya.post(`/carrier/loads/${trip.id}/events`, { type: 'LOADED', eta: new Date(Date.now() + 86400_000).toISOString() })).status()).toBe(200);
  return trip;
}

/** In transit, reached drop and delivered by the carrier. */
export async function deliveredByCarrier(request: APIRequestContext, client: Client, r: Awaited<ReturnType<typeof refs>>, damaged = 0) {
  const trip = await loadedTrip(request, client, r);
  const divya = await asUser(request, USERS.carrierTraffic);
  expect((await divya.post(`/carrier/loads/${trip.id}/events`, { type: 'REACHED_DROP' })).status()).toBe(200);
  const res = await divya.post(`/carrier/loads/${trip.id}/delivered`, { goodQty: 220 - damaged, damagedQty: damaged });
  expect(res.status(), await res.text()).toBe(200);
  return trip;
}
