import { expect, test, type APIRequestContext } from '@playwright/test';
import { API_URL } from '../test-env';
import { USERS, apiLogin, asUser, uniq } from './helpers';
import { awardedTrip, bookPune, refs, shipperHead } from './trips.helpers';

type Client = Awaited<ReturnType<typeof asUser>>;

const day = (n: number) => {
  const d = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const validDocs = { rcExpiry: day(900), insuranceExpiry: day(300), permitExpiry: day(300), fitnessExpiry: day(300), pucExpiry: day(100) };
const truckNo = () => `TN${String(10 + Math.floor(Math.random() * 89))}ZY${String(1000 + Math.floor(Math.random() * 8999))}`;
const mobile = () => `+9196${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
const licence = () => `TN09${String(Math.floor(Math.random() * 1e11)).padStart(11, '0')}`;

/** Fresh truck and driver per test (shared seed trucks stay "busy" once assigned, which would couple tests). */
async function truck(c: Client, over: Record<string, unknown> = {}) {
  const res = await c.post('/carrier/trucks', { number: truckNo(), truckType: '20ft SXL', ownership: 'OWN', capacityKg: 9000, ...validDocs, ...over });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).truck as { id: string; number: string };
}
async function driver(c: Client, over: Record<string, unknown> = {}) {
  const res = await c.post('/carrier/drivers', { name: `Exec Driver ${uniq()}`, phone: mobile(), licenceNumber: licence(), licenceClass: 'HGMV', licenceExpiry: day(700), ...over });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).driver as { id: string; name: string };
}
/** A Pune → Hyderabad load awarded to Kaveri (₹38,500) and waiting for a truck. */
async function wonLoad(request: APIRequestContext) {
  const anita = await shipperHead(request);
  const trip = await awardedTrip(request, anita, await refs(anita), { pune: true });
  return { anita, trip };
}
const detail = async (c: Client, id: string) => (await (await c.get(`/carrier/loads/${id}`)).json()).load;
const shipperTrip = async (c: Client, id: string) => (await (await c.get(`/trips/${id}`)).json()).trip;

test.describe('Carrier execution API: assign truck and driver', () => {
  test('assign → Truck assigned / waiting for the LR; the form lists trucks and drivers with status and note', async ({ request }) => {
    const { anita, trip } = await wonLoad(request);
    const vijay = await asUser(request, USERS.carrier);
    const t = await truck(vijay);
    const d = await driver(vijay);

    const before = await detail(vijay, trip.id);
    expect(before.panel).toBe('won');
    const opts = before.execution.assignment;
    const row = opts.trucks.find((x: { id: string }) => x.id === t.id);
    expect(row).toMatchObject({ matchesType: true, status: 'READY' });
    expect(row.note).toBeTruthy();
    expect(opts.drivers.find((x: { id: string }) => x.id === d.id)).toMatchObject({ status: 'FREE', note: 'Licence valid' });
    expect(opts.trucks.some((x: { status: string }) => x.status === 'BLOCKED')).toBe(true); // seeded TN11CC9087 has an expired permit
    expect(opts.drivers.some((x: { status: string }) => x.status === 'BLOCKED')).toBe(true); // seeded Selvam P: licence expired
    expect(before.execution.lr).toBeNull();

    const eta = new Date(Date.now() + 6 * 3600_000).toISOString();
    const res = await vijay.post(`/carrier/loads/${trip.id}/assign`, { truckId: t.id, driverId: d.id, pickupEta: eta });
    expect(res.status(), await res.text()).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const after = await detail(vijay, trip.id);
    expect(after).toMatchObject({ panel: 'assigned', label: 'Truck assigned', nextStep: 'Waiting for the shipper to issue the LR', tone: 'progress', group: 'transit' });
    expect(after.execution).toMatchObject({ lr: null, truckNumber: expect.any(String) });
    expect((await shipperTrip(anita, trip.id)).status).toBe('TRUCK_CONFIRMED');
  });

  test('wrong state: not awarded yet, and after the shipper issues the LR', async ({ request }) => {
    const anita = await shipperHead(request);
    const r = await refs(anita);
    const vijay = await asUser(request, USERS.carrier);
    const t = await truck(vijay);
    const d = await driver(vijay);
    const offered = await bookPune(anita, r); // Kaveri holds the offer; nothing awarded
    const early = await vijay.post(`/carrier/loads/${offered.id}/assign`, { truckId: t.id, driverId: d.id });
    expect(early.status()).toBe(409);
    expect((await early.json()).error.code).toBe('WRONG_STATE');

    const { anita: head, trip } = await wonLoad(request);
    expect((await vijay.post(`/carrier/loads/${trip.id}/assign`, { truckId: t.id, driverId: d.id })).status()).toBe(200);
    expect((await head.post(`/trips/${trip.id}/lr`, {})).status()).toBe(200);
    const late = await vijay.post(`/carrier/loads/${trip.id}/assign`, { truckId: t.id, driverId: d.id });
    expect(late.status()).toBe(409);
    expect((await late.json()).error.code).toBe('WRONG_STATE');
  });

  test('validation and roles: ids required, accounts and shippers cannot assign', async ({ request }) => {
    const { trip } = await wonLoad(request);
    const vijay = await asUser(request, USERS.carrier);
    const bad = await vijay.post(`/carrier/loads/${trip.id}/assign`, {});
    expect(bad.status()).toBe(400);
    expect(Object.keys((await bad.json()).error.fields).sort()).toEqual(['driverId', 'truckId']);
    const t = await truck(vijay);
    const d = await driver(vijay);
    expect((await vijay.post(`/carrier/loads/${trip.id}/assign`, { truckId: 'nope', driverId: d.id })).status()).toBe(400);
    const suresh = await asUser(request, USERS.carrierAccounts);
    expect((await suresh.post(`/carrier/loads/${trip.id}/assign`, { truckId: t.id, driverId: d.id })).status()).toBe(403);
    expect((await suresh.post(`/carrier/loads/${trip.id}/lr`, {})).status()).toBe(404);
    const anita = await shipperHead(request);
    expect((await anita.post(`/carrier/loads/${trip.id}/assign`, { truckId: t.id, driverId: d.id })).status()).toBe(403);
    const arjun = await asUser(request, USERS.otherCarrier);
    expect((await arjun.post(`/carrier/loads/${trip.id}/assign`, { truckId: t.id, driverId: d.id })).status()).toBe(404); // not their load
  });

  test('compliance: each block is 409 COMPLIANCE_BLOCKED; only the owner can override, with a reason', async ({ request }) => {
    const { trip } = await wonLoad(request);
    const vijay = await asUser(request, USERS.carrier);
    const divya = await asUser(request, USERS.carrierTraffic);
    const goodTruck = await truck(vijay);
    const goodDriver = await driver(vijay);
    const cases: [string, { truckId: string; driverId: string }, RegExp][] = [
      ['expired truck paper', { truckId: (await truck(vijay, { pucExpiry: day(-3) })).id, driverId: goodDriver.id }, /PUC expired/i],
      ['expired licence', { truckId: goodTruck.id, driverId: (await driver(vijay, { licenceExpiry: day(-10) })).id }, /licence expired/],
      ['LMV driver on a 20ft truck', { truckId: goodTruck.id, driverId: (await driver(vijay, { licenceClass: 'LMV' })).id }, /LMV licence does not cover a 20ft SXL truck/],
      ['truck type mismatch', { truckId: (await truck(vijay, { truckType: '32ft MXL', capacityKg: 18000 })).id, driverId: goodDriver.id }, /32ft MXL; the load needs 20ft SXL/],
    ];
    for (const [label, ids, issue] of cases) {
      const res = await vijay.post(`/carrier/loads/${trip.id}/assign`, ids);
      expect(res.status(), label).toBe(409);
      const { error } = await res.json();
      expect(error.code, label).toBe('COMPLIANCE_BLOCKED');
      expect(error.message, label).toMatch(issue);
      // A traffic manager cannot override; an override without a reason is refused; the owner with a reason succeeds.
      expect((await divya.post(`/carrier/loads/${trip.id}/assign`, { ...ids, override: { reason: 'Urgent' } })).status(), label).toBe(403);
    }
    const noReason = await vijay.post(`/carrier/loads/${trip.id}/assign`, { ...cases[0][1], override: {} });
    expect(noReason.status()).toBe(400);
    expect((await noReason.json()).error.fields.override).toBeTruthy();
    expect((await detail(vijay, trip.id)).panel).toBe('won'); // nothing changed by the refusals
    const ok = await vijay.post(`/carrier/loads/${trip.id}/assign`, { ...cases[0][1], override: { reason: 'PUC renewal is booked for tomorrow' } });
    expect(ok.status(), await ok.text()).toBe(200);
    expect(await detail(vijay, trip.id)).toMatchObject({ panel: 'assigned', label: 'Truck assigned' });
  });

  test('busy truck or driver on another load: TRUCK_BUSY / DRIVER_BUSY; re-assigning the same load is allowed until the LR', async ({ request }) => {
    const vijay = await asUser(request, USERS.carrier);
    const t1 = await truck(vijay);
    const t2 = await truck(vijay);
    const d1 = await driver(vijay);
    const d2 = await driver(vijay);
    const a = await wonLoad(request);
    const b = await wonLoad(request);
    expect((await vijay.post(`/carrier/loads/${a.trip.id}/assign`, { truckId: t1.id, driverId: d1.id })).status()).toBe(200);

    const truckBusy = await vijay.post(`/carrier/loads/${b.trip.id}/assign`, { truckId: t1.id, driverId: d2.id });
    expect(truckBusy.status()).toBe(409);
    expect((await truckBusy.json()).error.code).toBe('TRUCK_BUSY');
    const driverBusy = await vijay.post(`/carrier/loads/${b.trip.id}/assign`, { truckId: t2.id, driverId: d1.id });
    expect(driverBusy.status()).toBe(409);
    expect((await driverBusy.json()).error.code).toBe('DRIVER_BUSY');

    // Change load A to the second pair (allowed: no LR yet); the first pair is free again for load B.
    expect((await vijay.post(`/carrier/loads/${a.trip.id}/assign`, { truckId: t2.id, driverId: d2.id })).status()).toBe(200);
    expect((await vijay.post(`/carrier/loads/${b.trip.id}/assign`, { truckId: t1.id, driverId: d1.id })).status()).toBe(200);
    // Same pair again on the same load is not "busy with itself".
    expect((await vijay.post(`/carrier/loads/${a.trip.id}/assign`, { truckId: t2.id, driverId: d2.id })).status()).toBe(200);
    const opts = (await detail(vijay, a.trip.id)).execution.assignment;
    expect(opts.trucks.find((x: { id: string }) => x.id === t1.id).status).toBe('ON_TRIP');
    expect(opts.drivers.find((x: { id: string }) => x.id === d1.id).status).toBe('ON_TRIP');
  });
});

test.describe('Carrier execution API: the carrier does not issue the LR', () => {
  test('carrier cannot issue or reissue (404); LR page is 404 until the shipper issues it, then read-only for the owning carrier', async ({ request }) => {
    const { anita, trip } = await wonLoad(request);
    const vijay = await asUser(request, USERS.carrier);
    await vijay.post(`/carrier/loads/${trip.id}/assign`, { truckId: (await truck(vijay)).id, driverId: (await driver(vijay)).id });

    expect((await vijay.post(`/carrier/loads/${trip.id}/lr`, {})).status()).toBe(404);
    expect((await vijay.post(`/carrier/loads/${trip.id}/lr/reissue`, { reason: 'x' })).status()).toBe(404);
    const token = await apiLogin(request, USERS.carrierTraffic);
    const lrUrl = `${API_URL}/carrier/loads/${trip.id}/lr`;
    expect((await request.get(lrUrl, { headers: { Authorization: `Bearer ${token}` } })).status()).toBe(404); // no LR yet
    expect((await shipperTrip(anita, trip.id)).status).toBe('TRUCK_CONFIRMED'); // the refusals changed nothing

    const issued = await anita.post(`/trips/${trip.id}/lr`, { ewayBill: '331012345678' });
    expect(issued.status(), await issued.text()).toBe(200);
    const { lrNumber } = await issued.json();

    const d = await detail(vijay, trip.id);
    expect(d).toMatchObject({ panel: 'ready', label: 'Ready for pickup', group: 'transit' });
    expect(d.execution.lr).toMatchObject({ number: lrNumber, ewayBill: '331012345678' });
    expect(d.execution).not.toHaveProperty('lrSeriesSet');
    expect(d.execution).not.toHaveProperty('canReissueLr');

    const html = await request.get(lrUrl, { headers: { Authorization: `Bearer ${token}` } });
    expect(html.status()).toBe(200);
    expect(html.headers()['content-type']).toContain('text/html');
    expect(await html.text()).toContain(lrNumber);
    const other = await apiLogin(request, USERS.otherCarrier);
    expect((await request.get(lrUrl, { headers: { Authorization: `Bearer ${other}` } })).status()).toBe(404);
    expect((await vijay.post(`/carrier/loads/${trip.id}/lr`, {})).status()).toBe(404); // still not a carrier action
  });

  test('carrier profile no longer carries an LR series', async ({ request }) => {
    const vijay = await asUser(request, USERS.carrier);
    const { profile } = await (await vijay.get('/carrier/profile')).json();
    expect(profile).not.toHaveProperty('lrSeries');
    const res = await vijay.put('/carrier/profile', { lrPrefix: 'KV' });
    expect(res.status(), await res.text()).toBeLessThan(500);
    expect((await (await vijay.get('/carrier/profile')).json()).profile).not.toHaveProperty('lrSeries');
  });
});
