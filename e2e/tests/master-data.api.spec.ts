import { expect, test } from '@playwright/test';
import { USERS, asUser, uniq } from './helpers';
import { book, carrierQuotes, ownLane, refs, tomorrow } from './trips.helpers';

const mobile = () => `9${Math.floor(100000000 + Math.random() * 899999999)}`;

test.describe('Carrier master API', () => {
  test('add a carrier with contact details; bad GSTIN and PAN are caught; edit it', async ({ request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const bad = await anita.post('/carriers', { name: `Annamalai Logistics ${uniq()}`, phone: mobile(), gstin: '33ABC', pan: '123', email: 'nope' });
    expect(bad.status()).toBe(400);
    const { fields } = (await bad.json()).error;
    expect(fields.gstin).toContain('15-character GSTIN');
    expect(fields.pan).toContain('10-character PAN');
    expect(fields.email).toBeTruthy();

    const name = `Annamalai Logistics ${uniq()}`;
    const res = await anita.post('/carriers', {
      name, phone: mobile(), contactName: 'Senthil K', contactPhone: '094440 12345', email: 'Ops@Annamalai.test', city: 'Madurai', gstin: '33aabca1234f1z5', pan: 'aabca1234f',
    });
    expect(res.status(), await res.text()).toBe(201);
    const { carrier, alreadyOnDigitRell } = await res.json();
    expect(alreadyOnDigitRell).toBe(false);
    expect(carrier).toMatchObject({
      name, status: 'INVITED', contactName: 'Senthil K', contactPhone: '+919444012345', email: 'ops@annamalai.test', city: 'Madurai',
      gstin: '33AABCA1234F1Z5', pan: 'AABCA1234F', isActive: true, approvedLanes: 0, rateCard: null, canEditIdentity: true,
    });

    const edit = await anita.patch(`/carriers/${carrier.id}`, { name: `${name} Pvt Ltd`, notes: 'Good on south lanes' });
    expect(edit.status()).toBe(200);
    expect((await edit.json()).carrier).toMatchObject({ name: `${name} Pvt Ltd`, notes: 'Good on south lanes' });
    expect((await (await anita.get('/carriers')).json()).carriers.map((c: { id: string }) => c.id)).toContain(carrier.id);
  });

  test('a carrier already on DigitRell joins the list as is; its name stays the carrier’s', async ({ request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const meera = await asUser(request, USERS.otherShipper);
    // Anita's carrier, not yet in Meera's list.
    const own = (await (await anita.post('/carriers', { name: `Thamirabarani Roadways ${uniq()}`, phone: mobile() })).json()).carrier;
    expect((await (await meera.get('/carriers')).json()).carriers.map((c: { id: string }) => c.id)).not.toContain(own.id);

    const res = await meera.post('/carriers', { name: own.name.toUpperCase(), phone: own.phone, contactName: 'Meera’s contact' });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.alreadyOnDigitRell).toBe(true);
    expect(body.carrier).toMatchObject({ id: own.id, name: own.name, contactName: 'Meera’s contact', canEditIdentity: false });
    // Contact details are per shipper: Anita's record is untouched.
    expect((await (await anita.get(`/carriers/${own.id}`)).json()).carrier.contactName).toBeNull();
    // Two shippers list it now, so neither can rename it.
    const rename = await anita.patch(`/carriers/${own.id}`, { name: 'Renamed' });
    expect(rename.status()).toBe(400);
    expect((await rename.json()).error.fields.name).toContain('cannot be changed');
    // Adding it again is a duplicate.
    expect((await meera.post('/carriers', { name: own.name, phone: own.phone })).status()).toBe(409);
  });

  test('a carrier on an active lane cannot be set "not in use"; a booking executive cannot change carriers', async ({ request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const karthik = await asUser(request, USERS.shipperExec);
    const r = await refs(anita);
    const res = await anita.patch(`/carriers/${r.kaveri}`, { isActive: false });
    expect(res.status()).toBe(400);
    expect((await res.json()).error.fields.isActive).toContain('active lane');
    expect((await karthik.patch(`/carriers/${r.kaveri}`, { notes: 'x' })).status()).toBe(403);
    expect((await karthik.get('/carriers')).status()).toBe(200);
  });
});

test.describe('Rate cards API', () => {
  test('create, read, update and delete a rate card; validation per line', async ({ request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const carrier = (await (await anita.post('/carriers', { name: `Vaigai Freight ${uniq()}`, phone: mobile() })).json()).carrier;

    const empty = await anita.put(`/rate-cards/${carrier.id}`, { lines: [] });
    expect(empty.status()).toBe(400);
    expect((await empty.json()).error.fields.lines).toContain('at least one rate');

    const bad = await anita.put(`/rate-cards/${carrier.id}`, {
      validFrom: '2026-12-31', validTo: '2026-01-01',
      lines: [
        { origin: 'Madurai', destination: 'madurai', truckType: '17ft', rate: 0 },
        { origin: 'Madurai', destination: 'Trichy', truckType: '99ft', rate: 9000, transitDays: 40 },
        { origin: 'Madurai', destination: 'Salem', truckType: '14ft', rate: 9000 },
        { origin: 'madurai', destination: 'SALEM', truckType: '14ft', rate: 9500 },
      ],
    });
    expect(bad.status()).toBe(400);
    const f = (await bad.json()).error.fields;
    expect(f.validTo).toContain('on or after');
    expect(f['lines.0.destination']).toContain('must differ');
    expect(f['lines.0.rate']).toBeTruthy();
    expect(f['lines.1.truckType']).toBeTruthy();
    expect(f['lines.1.transitDays']).toContain('between 1 and 15');
    expect(f['lines.3.destination']).toContain('Same lane and truck type as rate 3');

    const created = await anita.put(`/rate-cards/${carrier.id}`, {
      notes: 'Includes loading',
      lines: [
        { origin: 'madurai', destination: 'trichy', truckType: '14ft', rate: '9,000', transitDays: 1 },
        { origin: 'Madurai', destination: 'Salem', truckType: '17ft', rate: 14500, detentionPerDay: 800 },
      ],
    });
    expect(created.status(), await created.text()).toBe(201);
    const card = (await created.json()).rateCard;
    expect(card).toMatchObject({ carrier: { id: carrier.id }, validity: 'CURRENT', notes: 'Includes loading' });
    expect(card.lines).toEqual([
      expect.objectContaining({ origin: 'Madurai', destination: 'Salem', truckType: '17ft', rate: 14500, detentionPerDay: 800, transitDays: null }),
      expect.objectContaining({ origin: 'Madurai', destination: 'Trichy', truckType: '14ft', rate: 9000, detentionPerDay: null, transitDays: 1 }),
    ]);
    expect((await (await anita.get(`/carriers/${carrier.id}`)).json()).carrier.rateCard).toEqual({ rates: 2, validTo: null });

    const updated = await anita.put(`/rate-cards/${carrier.id}`, { validTo: '2099-03-31', lines: [{ origin: 'Madurai', destination: 'Trichy', truckType: '14ft', rate: 9400 }] });
    expect(updated.status()).toBe(200);
    expect((await updated.json()).rateCard).toMatchObject({ validTo: '2099-03-31', lines: [expect.objectContaining({ rate: 9400 })] });
    expect((await (await anita.get(`/rate-cards/${carrier.id}`)).json()).rateCard.lines).toHaveLength(1);

    expect((await anita.delete(`/rate-cards/${carrier.id}`)).status()).toBe(204);
    expect((await (await anita.get(`/rate-cards/${carrier.id}`)).json()).rateCard).toBeNull();
  });

  test("rate cards are private to the shipper; only the logistics head changes them", async ({ request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const meera = await asUser(request, USERS.otherShipper);
    const karthik = await asUser(request, USERS.shipperExec);
    const r = await refs(anita);
    const line = { origin: 'Kochi', destination: 'Coimbatore', truckType: '19ft', rate: 1 };
    // Kaveri isn't in Meera's carrier list.
    expect((await meera.put(`/rate-cards/${r.kaveri}`, { lines: [line] })).status()).toBe(404);
    expect((await meera.get(`/rate-cards/${r.kaveri}`)).status()).toBe(404);
    expect((await (await meera.get('/rate-cards')).json()).rateCards.map((c: { carrier: { name: string } }) => c.carrier.name)).not.toContain('Kaveri Roadlines');
    expect((await karthik.put(`/rate-cards/${r.kaveri}`, { lines: [line] })).status()).toBe(403);
    const seeded = (await (await karthik.get(`/rate-cards/${r.kaveri}`)).json()).rateCard;
    expect(seeded.lines.find((l: { destination: string }) => l.destination === 'Bengaluru').rate).toBe(44500);
  });
});

test.describe('Budget per trip at booking', () => {
  test('lane info shows agreed rates (lowest first, expired cards left out) and the last budget', async ({ request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const own = await ownLane(anita, 3);
    const [a, b, c] = own.carriers;
    const line = (rate: number) => ({ origin: 'Madurai', destination: own.lane.destination, truckType: '17ft', rate });
    await anita.put(`/rate-cards/${a.id}`, { lines: [line(21000)] });
    await anita.put(`/rate-cards/${b.id}`, { lines: [line(19500)] });
    await anita.put(`/rate-cards/${c.id}`, { validFrom: '2020-01-01', validTo: '2020-12-31', lines: [line(15000)] }); // expired

    const q = new URLSearchParams({ pickupAddressId: own.booking.pickupAddressId, dropAddressId: own.booking.dropAddressId, truckType: '17ft' });
    let info = await (await anita.get(`/bookings/lane-info?${q}`)).json();
    expect(info.lane).toMatchObject({ id: own.lane.id, awardRule: 'ASK' });
    expect(info.carriers.map((x: { name: string; rate: number | null }) => [x.name, x.rate])).toEqual([[b.name, 19500], [a.name, 21000], [c.name, null]]);
    expect(info.lastBudget).toBeNull();

    await book(anita, await refs(anita), { ...own.booking, budget: '19,800' });
    info = await (await anita.get(`/bookings/lane-info?${q}`)).json();
    expect(info.lastBudget).toBe(19800);

    const none = await (await anita.get(`/bookings/lane-info?${new URLSearchParams({ ...Object.fromEntries(q), truckType: '14ft' })}`)).json();
    expect(none.lane).toBeNull();
  });

  test('the budget is stored on the trip, drives quote comparison, and is optional on "Ask me" lanes', async ({ request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const r = await refs(anita);
    const withBudget = await book(anita, r, { budget: 45000 });
    await carrierQuotes(request, withBudget.number, r.kaveri, 46200);
    const t = (await (await anita.get(`/trips/${withBudget.id}`)).json()).trip;
    expect(t.budget).toBe(45000);
    expect(t.quotes.find((q: { carrierId: string }) => q.carrierId === r.kaveri)).toMatchObject({ amount: 46200, overBudget: true, vsBudget: 1200 });

    const noBudget = await book(anita, r, { budget: null });
    expect((await (await anita.get(`/trips/${noBudget.id}`)).json()).trip.budget).toBeNull();

    const bad = await anita.post('/bookings/preview', { pickupAddressId: r.ambattur, dropAddressId: r.hosur, pickupDate: tomorrow(), truckType: '32ft MXL', material: 'x', weightTonnes: 5, budget: -10 });
    expect(bad.status()).toBe(400);
    expect((await bad.json()).error.fields.budget).toContain('amount in rupees');
  });

  test('an automatic-award lane needs a budget on every booking', async ({ request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const r = await refs(anita);
    // Seeded Pune → Hyderabad, 20ft SXL: lowest within budget, automatic.
    const body = { pickupAddressId: r.chakan, dropAddressId: r.medchal, pickupDate: tomorrow(), truckType: '20ft SXL', material: 'Snacks', weightTonnes: 8 };
    const res = await anita.post('/bookings/preview', body);
    expect(res.status()).toBe(400);
    expect((await res.json()).error.fields.budget).toContain('awarded automatically');
    const ok = await (await anita.post('/bookings/preview', { ...body, budget: 39000 })).json();
    expect(ok.budget).toBe(39000);
    expect(ok.lane.awardRule).toBe('AUTO_LOWEST');
    // Agreed rates of the lane's carriers come with the preview.
    expect(ok.carriers.map((c: { name: string; rate: number }) => [c.name, c.rate])).toEqual([['Kaveri Roadlines', 38500], ['NorthStar Logistics', 39000]]);
  });
});
