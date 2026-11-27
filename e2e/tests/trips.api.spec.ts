import { expect, test } from '@playwright/test';
import { API_URL } from '../test-env';
import { USERS, asUser } from './helpers';
import { book, refs, tomorrow } from './trips.helpers';

// The offer flow itself (who is offered first, pass, expiry, accept, approve, reject) is in offers.api.spec.ts.
test.describe('Booking API', () => {
  test('booking sends no price; trip numbers are sequential; the trip opens at the first offer', async ({ request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const r = await refs(anita);
    const first = await book(anita, r);
    const second = await book(anita, r);
    expect(first.number).toMatch(/^TR-\d{5}$/);
    expect(Number(second.number.slice(3))).toBe(Number(first.number.slice(3)) + 1); // sequential, never reused

    const { trip } = await (await anita.get(`/trips/${first.id}`)).json();
    expect(trip).toMatchObject({ status: 'QUOTES_REQUESTED', origin: 'Chennai', destination: 'Bengaluru', weightTonnes: 14, truckType: '32ft MXL' });
    expect(trip.quotes).toHaveLength(3);
    expect(trip.activity.map((a: { text: string }) => a.text)).toContain('Booked on the web');
  });

  test('a budget in the request is ignored: the price always comes from the contract rate', async ({ request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const r = await refs(anita);
    const trip = await book(anita, r, { budget: 1000 });
    expect(trip.offeredTo.rate).toBe(43800);
  });

  test('every booking error comes back on its field', async ({ request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const r = await refs(anita);
    const empty = await (await anita.post('/bookings', {})).json();
    expect(Object.keys(empty.error.fields).sort()).toEqual(['dropAddressId', 'material', 'pickupAddressId', 'pickupDate', 'truckType', 'weightTonnes']);

    const bad = await (await anita.post('/bookings', { pickupAddressId: r.ambattur, dropAddressId: r.ambattur, pickupDate: '2020-01-01', truckType: '32ft MXL', material: 'x', weightTonnes: 80 })).json();
    expect(bad.error.fields.pickupDate).toBe('Pickup date cannot be in the past.');
    expect(bad.error.fields.weightTonnes).toContain('between 0.1 and 60');
    expect(bad.error.fields.dropAddressId).toBeTruthy(); // Ambattur is pickup-only

    const wrongKind = await (await anita.post('/bookings', { pickupAddressId: r.medchal, dropAddressId: r.hosur, pickupDate: tomorrow(), truckType: '32ft MXL', material: 'x', weightTonnes: 5 })).json();
    expect(wrongKind.error.fields.pickupAddressId).toBe('Choose a saved pickup address.');
  });

  test('another shipper cannot see or act on the trip', async ({ request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const meera = await asUser(request, USERS.otherShipper);
    const trip = await book(anita, await refs(anita));
    expect((await meera.get(`/trips/${trip.id}`)).status()).toBe(404);
    expect((await meera.post(`/trips/${trip.id}/approve`)).status()).toBe(404);
    const list = (await (await meera.get('/trips')).json()).trips;
    expect(list.find((t: { id: string }) => t.id === trip.id)).toBeUndefined();
  });
});

test.describe('Trips list API', () => {
  test('tabs, search, lane filter and counts', async ({ request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const r = await refs(anita);
    const trip = await book(anita, r, { reference: 'PO-SEARCH-77' });
    const found = await (await anita.get('/trips?q=po-search-77')).json();
    expect(found.trips.map((t: { number: string }) => t.number)).toEqual([trip.number]);
    expect((await (await anita.get(`/trips?q=${trip.number}`)).json()).total).toBe(1);

    const all = await (await anita.get('/trips')).json();
    expect(all.counts.all).toBe(all.total);
    expect(all.counts.all).toBeGreaterThanOrEqual(all.counts.action + all.counts.transit);
    const transit = await (await anita.get('/trips?tab=transit')).json();
    expect(transit.trips.every((t: { status: string }) => ['AWARDED', 'SOURCING_TRUCK', 'TRUCK_CONFIRMED', 'CLEARED', 'READY_FOR_PICKUP', 'IN_TRANSIT'].includes(t.status))).toBe(true);

    const lanes = (await (await anita.get('/lanes')).json()).lanes;
    const pune = lanes.find((l: { origin: string }) => l.origin === 'Pune');
    const byLane = await (await anita.get(`/trips?laneId=${pune.id}`)).json();
    expect(byLane.trips.every((t: { origin: string }) => t.origin === 'Pune')).toBe(true);
  });

  test('a carrier accept awards the trip at once and moves it to In transit', async ({ request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const r = await refs(anita);
    const trip = await book(anita, r);
    await request.post(`${API_URL}/integration/quotes`, { headers: { 'x-integration-key': 'dev-integration-key' }, data: { tripNumber: trip.number, carrierId: r.deccan, accept: true } });
    const row = (await (await anita.get('/trips?tab=transit')).json()).trips.find((t: { number: string }) => t.number === trip.number);
    expect(row).toMatchObject({ status: 'AWARDED', carrier: 'Deccan Freight Carriers' });
    expect(row.nextStep).toBe('Carrier assigning truck');
  });

  test('integration endpoints need the key', async ({ request }) => {
    const res = await request.post(`${API_URL}/integration/quotes`, { data: { tripNumber: 'TR-1', carrierId: 'x', accept: true } });
    expect(res.status()).toBe(401);
  });
});
