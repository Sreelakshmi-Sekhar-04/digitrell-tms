import { expect, test } from '@playwright/test';
import { API_URL } from '../test-env';
import { USERS, asUser } from './helpers';
import { ageAward, book, carrierQuotes, expireQuotes, refs, tomorrow } from './trips.helpers';

test.describe('Booking API', () => {
  test('preview shows the carriers and close time; booking sends quote requests to all of them', async ({ request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const r = await refs(anita);
    const body = { pickupAddressId: r.ambattur, dropAddressId: r.hosur, pickupDate: tomorrow(), truckType: '32ft MXL', material: 'Biscuits', weightTonnes: '14' };
    const preview = await (await anita.post('/bookings/preview', body)).json();
    expect(preview.carriers.map((c: { name: string }) => c.name).sort()).toEqual(['Deccan Freight Carriers', 'Kaveri Roadlines', 'NorthStar Logistics', 'Sai Ganesh Transport']);
    expect(preview.quoteWindowHours).toBe(2);
    expect(preview.lane).toMatchObject({ origin: 'Chennai', destination: 'Bengaluru', budget: 46000 });

    const first = await book(anita, r);
    const second = await book(anita, r, { quoteWindowHours: 1 });
    expect(first.number).toMatch(/^TR-\d{5}$/);
    expect(Number(second.number.slice(3))).toBe(Number(first.number.slice(3)) + 1); // sequential, never reused

    const { trip } = await (await anita.get(`/trips/${first.id}`)).json();
    expect(trip).toMatchObject({ status: 'QUOTES_REQUESTED', origin: 'Chennai', destination: 'Bengaluru', weightTonnes: 14, truckType: '32ft MXL' });
    expect(trip.quotes).toHaveLength(4);
    expect(trip.quotes.every((q: { status: string }) => q.status === 'REQUESTED')).toBe(true);
    expect(trip.activity.map((a: { text: string }) => a.text)).toContain('Quote request sent to 4 carriers');
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

  test('no lane with approved carriers → clear message, nothing created', async ({ request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const r = await refs(anita);
    const before = (await (await anita.get('/trips')).json()).total;
    const res = await anita.post('/bookings', { pickupAddressId: r.ambattur, dropAddressId: r.medchal, pickupDate: tomorrow(), truckType: '32ft MXL', material: 'x', weightTonnes: 5 });
    expect(res.status()).toBe(400);
    const { error } = await res.json();
    expect(error.code).toBe('NO_LANE');
    expect(error.message).toContain('Chennai → Hyderabad');
    expect((await (await anita.get('/trips')).json()).total).toBe(before);
  });

  test('another shipper cannot see or act on the trip', async ({ request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const meera = await asUser(request, USERS.otherShipper);
    const trip = await book(anita, await refs(anita));
    expect((await meera.get(`/trips/${trip.id}`)).status()).toBe(404);
    expect((await meera.post(`/trips/${trip.id}/award`, { quoteId: 'x' })).status()).toBe(404);
    const list = (await (await meera.get('/trips')).json()).trips;
    expect(list.find((t: { id: string }) => t.id === trip.id)).toBeUndefined();
  });
});

test.describe('Quotes, recommendation and award API', () => {
  test('quotes arrive → scored and recommended with reasons → in the approvals inbox', async ({ request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const r = await refs(anita);
    const trip = await book(anita, r);
    expect((await carrierQuotes(request, trip.number, r.kaveri, 42500)).status()).toBe(200);
    await carrierQuotes(request, trip.number, r.northstar, 45900);
    await carrierQuotes(request, trip.number, r.deccan, 41800);

    const { trip: t } = await (await anita.get(`/trips/${trip.id}`)).json();
    expect(t.status).toBe('QUOTES_RECEIVED');
    expect(t.nextStep).toBe('Choose a carrier (3 of 4 quoted)');
    expect(t.recommendation).toMatchObject({ carrier: 'Kaveri Roadlines', amount: 42500 });
    expect(t.recommendation.reason).toContain('₹700 more than the cheapest quote');
    expect(t.recommendation.reason).toContain('₹3,500 under budget');
    expect(t.recommendation.reason).toContain('Deccan Freight Carriers is cheapest at ₹41,800');
    const ranked = t.quotes.filter((q: { rank: number | null }) => q.rank).sort((a: { rank: number }, b: { rank: number }) => a.rank - b.rank);
    expect(ranked.map((q: { carrier: string }) => q.carrier)).toEqual(['Kaveri Roadlines', 'NorthStar Logistics', 'Deccan Freight Carriers']);
    expect(t.quotes.find((q: { carrier: string }) => q.carrier === 'Sai Ganesh Transport').status).toBe('REQUESTED');

    const inbox = (await (await anita.get('/approvals')).json()).approvals;
    const item = inbox.find((a: { ref: string }) => a.ref === trip.number);
    expect(item).toMatchObject({ kind: 'AWARD', amount: 42500, quoted: 3, asked: 4 });
    expect(item.summary).toBe('Award Chennai → Bengaluru to Kaveri Roadlines');
  });

  test('approval limits: booking executive cannot award; approver cannot go above their limit', async ({ request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const r = await refs(anita);
    const trip = await book(anita, r);
    await carrierQuotes(request, trip.number, r.kaveri, 42500);
    await carrierQuotes(request, trip.number, r.deccan, 39000);
    const { trip: t } = await (await anita.get(`/trips/${trip.id}`)).json();
    const kaveriQuote = t.quotes.find((q: { carrier: string }) => q.carrier === 'Kaveri Roadlines').id;
    const deccanQuote = t.quotes.find((q: { carrier: string }) => q.carrier === 'Deccan Freight Carriers').id;

    const karthik = await asUser(request, USERS.shipperExec);
    const exec = await karthik.post(`/trips/${trip.id}/award`, { quoteId: kaveriQuote });
    expect(exec.status()).toBe(403);
    expect((await exec.json()).error.message).toContain("can't approve awards");

    const priya = await asUser(request, { email: 'priya@sunrisefoods.test', password: 'Shipper@123' });
    const over = await priya.post(`/trips/${trip.id}/award`, { quoteId: kaveriQuote });
    expect(over.status()).toBe(403);
    expect((await over.json()).error.message).toContain('above your approval limit of ₹40,000');
    expect((await priya.post(`/trips/${trip.id}/award`, { quoteId: deccanQuote })).status()).toBe(200);
  });

  test('award a non-recommended carrier: others lose, inbox clears, late quotes are refused', async ({ request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const r = await refs(anita);
    const trip = await book(anita, r);
    await carrierQuotes(request, trip.number, r.kaveri, 42500);
    await carrierQuotes(request, trip.number, r.northstar, 45900);
    const { trip: before } = await (await anita.get(`/trips/${trip.id}`)).json();
    const northstarQuote = before.quotes.find((q: { carrier: string }) => q.carrier === 'NorthStar Logistics').id;

    expect((await anita.post(`/trips/${trip.id}/award`, { quoteId: northstarQuote })).status()).toBe(200);
    const { trip: t } = await (await anita.get(`/trips/${trip.id}`)).json();
    expect(t).toMatchObject({ status: 'AWARDED', carrier: 'NorthStar Logistics', amount: 45900, nextStep: 'Carrier assigning truck' });
    const byCarrier = Object.fromEntries(t.quotes.map((q: { carrier: string; status: string }) => [q.carrier, q.status]));
    expect(byCarrier).toMatchObject({ 'NorthStar Logistics': 'AWARDED', 'Kaveri Roadlines': 'LOST', 'Deccan Freight Carriers': 'WITHDRAWN', 'Sai Ganesh Transport': 'WITHDRAWN' });
    expect(t.activity[0].text).toBe('Awarded to NorthStar Logistics at ₹45,900 (not the recommended carrier)');
    expect(t.activity[0].actor).toBe('Anita Rao');

    const inbox = (await (await anita.get('/approvals')).json()).approvals;
    expect(inbox.find((a: { ref: string }) => a.ref === trip.number)).toBeUndefined();
    const late = await carrierQuotes(request, trip.number, r.sai, 40000);
    expect(late.status()).toBe(409);
    expect((await anita.post(`/trips/${trip.id}/award`, { quoteId: northstarQuote })).status()).toBe(409);
  });

  test('undo within the window reopens the award; after the window it is refused', async ({ request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const r = await refs(anita);
    const trip = await book(anita, r);
    await carrierQuotes(request, trip.number, r.kaveri, 42500);
    const approval = (await (await anita.get('/approvals')).json()).approvals.find((a: { ref: string }) => a.ref === trip.number);
    expect((await anita.post(`/approvals/${approval.id}/approve`)).status()).toBe(200);
    expect((await anita.post(`/approvals/${approval.id}/approve`)).status()).toBe(409); // already decided

    let t = (await (await anita.get(`/trips/${trip.id}`)).json()).trip;
    expect(t.status).toBe('AWARDED');
    expect(new Date(t.undoUntil).getTime() - new Date(t.awardedAt).getTime()).toBe(10 * 60_000);
    expect((await anita.post(`/trips/${trip.id}/undo-award`)).status()).toBe(200);
    t = (await (await anita.get(`/trips/${trip.id}`)).json()).trip;
    expect(t).toMatchObject({ status: 'QUOTES_RECEIVED', carrier: null });
    expect(t.quotes.find((q: { carrier: string }) => q.carrier === 'Deccan Freight Carriers').status).toBe('REQUESTED'); // deadline not passed: still open
    expect((await (await anita.get('/approvals')).json()).approvals.some((a: { ref: string }) => a.ref === trip.number)).toBe(true);

    const q = t.quotes.find((x: { carrier: string }) => x.carrier === 'Kaveri Roadlines').id;
    await anita.post(`/trips/${trip.id}/award`, { quoteId: q });
    await ageAward(request, trip.number);
    const tooLate = await anita.post(`/trips/${trip.id}/undo-award`);
    expect(tooLate.status()).toBe(409);
    expect((await tooLate.json()).error.code).toBe('TOO_LATE');
  });

  test('reject all needs a reason, then asks the same carriers again with a new deadline', async ({ request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const r = await refs(anita);
    const trip = await book(anita, r);
    await carrierQuotes(request, trip.number, r.kaveri, 52000);
    const approval = (await (await anita.get('/approvals')).json()).approvals.find((a: { ref: string }) => a.ref === trip.number);
    const noReason = await anita.post(`/approvals/${approval.id}/reject`, {});
    expect((await noReason.json()).error.fields.reason).toBeTruthy();
    expect((await anita.post(`/approvals/${approval.id}/reject`, { reason: 'All quotes above budget' })).status()).toBe(200);

    const { trip: t } = await (await anita.get(`/trips/${trip.id}`)).json();
    expect(t.status).toBe('QUOTES_REQUESTED');
    expect(t.quotes.every((q: { status: string; amount: number | null }) => q.status === 'REQUESTED' && q.amount == null)).toBe(true);
    expect(t.activity[0].text).toBe('All quotes rejected; 4 carriers asked again — “All quotes above budget”');
    expect((await (await anita.get('/approvals')).json()).approvals.some((a: { ref: string }) => a.ref === trip.number)).toBe(false);
  });

  test('deadline with no quotes → "Needs action" with next step; all carriers answering closes early', async ({ request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const r = await refs(anita);
    const silent = await book(anita, r);
    await expireQuotes(request, silent.number);
    const list = await (await anita.get('/trips?tab=action')).json();
    const row = list.trips.find((t: { number: string }) => t.number === silent.number);
    expect(row.nextStep).toBe('No quotes: ask again or change carriers');
    expect((await anita.post(`/trips/${silent.id}/retender`, { reason: 'No replies' })).status()).toBe(200);

    const quick = await book(anita, r);
    await carrierQuotes(request, quick.number, r.kaveri, 43000);
    await carrierQuotes(request, quick.number, r.northstar, null);
    await carrierQuotes(request, quick.number, r.deccan, null);
    await carrierQuotes(request, quick.number, r.sai, 44000);
    const { trip: t } = await (await anita.get(`/trips/${quick.id}`)).json();
    expect(t.quotesClosedAt).not.toBeNull();
    expect(t.nextStep).toBe('Choose a carrier');
    expect(t.activity.map((a: { text: string }) => a.text)).toContain('Quotes closed: 2 of 4 quoted (all replied)');
  });

  test('automatic award lane: first trip with a carrier needs a person; after that the lowest within budget is awarded', async ({ request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const r = await refs(anita);
    // Own lane with two brand-new carriers, so "first trip" doesn't depend on other tests.
    const tag = Math.random().toString(36).slice(2, 6);
    const phone = () => `9${Math.floor(100000000 + Math.random() * 899999999)}`;
    const carrierA = (await (await anita.post('/carriers', { name: `Alpha Haulers ${tag}`, phone: phone() })).json()).carrier;
    const carrierB = (await (await anita.post('/carriers', { name: `Beta Movers ${tag}`, phone: phone() })).json()).carrier;
    const from = (await (await anita.post('/addresses', { name: `Nagpur Yard ${tag}`, city: 'Nagpur', line1: 'MIDC Hingna', kind: 'PICKUP' })).json()).address;
    const to = (await (await anita.post('/addresses', { name: `Raipur DC ${tag}`, city: 'Raipur', line1: 'Urla Industrial Area', kind: 'DROP' })).json()).address;
    await anita.post('/lanes', { origin: 'Nagpur', destination: 'Raipur', truckType: '20ft SXL', budget: 40000, awardRule: 'AUTO_LOWEST', carrierIds: [carrierA.id, carrierB.id] });
    const lane = { pickupAddressId: from.id, dropAddressId: to.id, truckType: '20ft SXL', material: 'Snacks', weightTonnes: 8 };

    const first = await book(anita, r, lane);
    await carrierQuotes(request, first.number, carrierA.id, 38200);
    await carrierQuotes(request, first.number, carrierB.id, 39500);
    let t = (await (await anita.get(`/trips/${first.id}`)).json()).trip;
    expect(t.status).toBe('QUOTES_RECEIVED'); // first trip with this carrier for this shipper
    expect(t.activity.map((a: { text: string }) => a.text)).toContain('Automatic award skipped: first trip with this carrier');
    await anita.post(`/trips/${first.id}/award`, { quoteId: t.quotes.find((q: { carrierId: string }) => q.carrierId === carrierA.id).id });

    const second = await book(anita, r, lane);
    await carrierQuotes(request, second.number, carrierB.id, 39900);
    await carrierQuotes(request, second.number, carrierA.id, 37800);
    t = (await (await anita.get(`/trips/${second.id}`)).json()).trip;
    expect(t).toMatchObject({ status: 'AWARDED', carrier: carrierA.name, amount: 37800 });
    expect(t.activity[0].actor).toBe('Bid evaluation agent');

    const over = await book(anita, r, lane);
    await carrierQuotes(request, over.number, carrierA.id, 41000);
    await carrierQuotes(request, over.number, carrierB.id, 42000);
    t = (await (await anita.get(`/trips/${over.id}`)).json()).trip;
    expect(t.status).toBe('QUOTES_RECEIVED'); // lowest is over the ₹40,000 budget
    expect(t.activity.map((a: { text: string }) => a.text)).toContain('Automatic award skipped: over budget');
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
    expect(transit.trips.every((t: { status: string }) => ['AWARDED', 'SOURCING_TRUCK', 'TRUCK_CONFIRMED', 'IN_TRANSIT'].includes(t.status))).toBe(true);

    const lanes = (await (await anita.get('/lanes')).json()).lanes;
    const pune = lanes.find((l: { origin: string }) => l.origin === 'Pune');
    const byLane = await (await anita.get(`/trips?laneId=${pune.id}`)).json();
    expect(byLane.trips.every((t: { origin: string }) => t.origin === 'Pune')).toBe(true);
  });

  test('integration endpoints need the key', async ({ request }) => {
    const res = await request.post(`${API_URL}/integration/quotes`, { data: { tripNumber: 'TR-1', carrierId: 'x', amount: 1 } });
    expect(res.status()).toBe(401);
  });
});
