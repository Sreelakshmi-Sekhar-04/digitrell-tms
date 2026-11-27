import { expect, test } from '@playwright/test';
import { USERS, asUser } from './helpers';
import { book, bookPune, carrierAccepts, carrierPasses, expireQuotes, ownLane, refs, tomorrow } from './trips.helpers';

type Q = { carrier: string; carrierId: string; status: string; statusLabel: string; amount: number; sequence: number; offeredAt: string | null; isWinner: boolean; declineReason: string | null };
const byCarrier = (quotes: Q[]) => Object.fromEntries(quotes.map((q) => [q.carrier, q.status]));
const getTrip = async (client: Awaited<ReturnType<typeof asUser>>, id: string) => (await (await client.get(`/trips/${id}`)).json()).trip;
const texts = (t: { activity: { text: string }[] }) => t.activity.map((a) => a.text);

test.describe('Contract-rate offers: who is offered first', () => {
  test('lane-info and preview list carriers by contract rate; Sai Ganesh (no rate) is never in line', async ({ request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const r = await refs(anita);
    const q = new URLSearchParams({ pickupAddressId: r.ambattur, dropAddressId: r.hosur, truckType: '32ft MXL', pickupDate: tomorrow() });
    const info = await (await anita.get(`/bookings/lane-info?${q}`)).json();
    expect(info).toMatchObject({ ready: true, noContractRate: false });
    expect(info.carriers.map((c: { name: string; rate: number; sequence: number; offeredFirst: boolean }) => [c.sequence, c.name, c.rate, c.offeredFirst])).toEqual([
      [1, 'Deccan Freight Carriers', 43800, true], [2, 'Kaveri Roadlines', 44500, false], [3, 'NorthStar Logistics', 45200, false],
    ]);

    const preview = await (await anita.post('/bookings/preview', { pickupAddressId: r.ambattur, dropAddressId: r.hosur, pickupDate: tomorrow(), truckType: '32ft MXL', material: 'Biscuits', weightTonnes: 14 })).json();
    expect(preview.offeredFirst).toMatchObject({ name: 'Deccan Freight Carriers', rate: 43800 });
    expect(preview.carriers).toHaveLength(3);
    expect(preview.respondHours).toBe(2);
    expect(new Date(preview.respondBy).getTime()).toBeGreaterThan(Date.now());
  });

  test('booking with no price offers only the lowest carrier; the others wait in line', async ({ request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const r = await refs(anita);
    const trip = await book(anita, r);
    expect(trip.carriersInLine).toBe(3);
    expect(trip.offeredTo).toMatchObject({ id: r.deccan, name: 'Deccan Freight Carriers', rate: 43800 });

    const t = await getTrip(anita, trip.id);
    expect(t.status).toBe('QUOTES_REQUESTED');
    expect(t).not.toHaveProperty('budget');
    expect(t).not.toHaveProperty('recommendation');
    expect(t.noCarrierAccepted).toBe(false);
    const quotes = [...t.quotes].sort((a: Q, b: Q) => a.sequence - b.sequence) as Q[];
    expect(quotes.map((x) => [x.sequence, x.carrier, x.status, x.statusLabel, x.amount])).toEqual([
      [1, 'Deccan Freight Carriers', 'REQUESTED', 'Offered', 43800],
      [2, 'Kaveri Roadlines', 'QUEUED', 'Waiting in line', 44500],
      [3, 'NorthStar Logistics', 'QUEUED', 'Waiting in line', 45200],
    ]);
    expect(quotes[0].offeredAt).not.toBeNull();
    expect(quotes[1].offeredAt).toBeNull();
    expect(new Date(t.quoteDeadline).getTime()).toBeGreaterThan(Date.now());
    expect(texts(t)).toContain('Offered to Deccan Freight Carriers at ₹43,800 (contract rate, 1 of 3)');
  });

  test('carriers in line cannot see the load, and the offered one sees only its own rate', async ({ request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const r = await refs(anita);
    const kaveri = await asUser(request, USERS.carrier);
    const northstar = await asUser(request, USERS.otherCarrier);
    const trip = await bookPune(anita, r); // Kaveri ₹38,500 first, NorthStar ₹39,000 second
    expect(trip.offeredTo).toMatchObject({ id: r.kaveri, rate: 38500 });

    const mine = (await (await kaveri.get('/carrier/loads')).json()).loads.find((l: { id: string }) => l.id === trip.id);
    expect(mine).toMatchObject({ amount: 38500, panel: 'offer', label: 'New offer' });
    const detail = await (await kaveri.get(`/carrier/loads/${trip.id}`)).json();
    expect(detail.load.offer.amount).toBe(38500);
    expect(JSON.stringify(detail)).not.toMatch(/39,?000|NorthStar|budget|recommend/i);

    const queued = (await (await northstar.get('/carrier/loads')).json()).loads;
    expect(queued.find((l: { id: string }) => l.id === trip.id)).toBeUndefined();
    expect((await northstar.get(`/carrier/loads/${trip.id}`)).status()).toBe(404);
    expect((await northstar.post(`/carrier/loads/${trip.id}/accept`)).status()).toBe(404);
    expect((await carrierAccepts(request, trip.number, r.northstar)).status()).toBe(409); // not its turn
  });

  test('ties on rate are broken by the carrier name when neither has a track record', async ({ request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const own = await ownLane(anita, 2);
    const [a, b] = own.carriers;
    for (const c of [a, b]) await anita.put(`/rate-cards/${c.id}`, { lines: [{ origin: 'Madurai', destination: own.lane.destination, truckType: '17ft', rate: 18000 }] });
    const trip = await book(anita, await refs(anita), own.booking);
    expect(trip.offeredTo.name).toBe([a.name, b.name].sort()[0]);
  });

  test('an expired rate card is not offered; a booking with no contract line fails with NO_CONTRACT_RATE', async ({ request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const r = await refs(anita);
    const own = await ownLane(anita, 1);
    await anita.put(`/rate-cards/${own.carriers[0].id}`, { validFrom: '2020-01-01', validTo: '2020-12-31', lines: [{ origin: 'Madurai', destination: own.lane.destination, truckType: '17ft', rate: 15000 }] });
    const before = (await (await anita.get('/trips')).json()).total;
    const res = await anita.post('/bookings', { ...own.booking, pickupDate: tomorrow() });
    expect(res.status()).toBe(400);
    const { error } = await res.json();
    expect(error.code).toBe('NO_CONTRACT_RATE');
    expect(error.message.toLowerCase()).toContain(`madurai → ${own.lane.destination.toLowerCase()}, 17ft`);
    expect(error.message).toContain('Rate cards');

    // Chennai → Hyderabad has no contract line at all.
    const none = await anita.post('/bookings', { pickupAddressId: r.ambattur, dropAddressId: r.medchal, pickupDate: tomorrow(), truckType: '32ft MXL', material: 'x', weightTonnes: 5 });
    expect(none.status()).toBe(400);
    expect((await none.json()).error.code).toBe('NO_CONTRACT_RATE');
    const info = await (await anita.get(`/bookings/lane-info?pickupAddressId=${r.ambattur}&dropAddressId=${r.medchal}&truckType=32ft%20MXL&pickupDate=${tomorrow()}`)).json();
    expect(info).toMatchObject({ ready: true, noContractRate: true, carriers: [] });
    expect(info.message).toContain('No contract rate');
    expect((await (await anita.get('/trips')).json()).total).toBe(before); // nothing created
  });

  test('the offer list is rebuilt from the start when the pickup date changes', async ({ request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const own = await ownLane(anita, 2);
    const trip = await book(anita, await refs(anita), own.booking);
    // The cheapest carrier passes; the second now holds the offer.
    expect((await carrierPasses(request, trip.number, trip.offeredTo.id)).status()).toBe(200);
    let t = await getTrip(anita, trip.id);
    expect(byCarrier(t.quotes)[own.carriers[1].name]).toBe('REQUESTED');

    const later = new Date(Date.parse(tomorrow()) + 86400_000).toISOString().slice(0, 10);
    expect((await anita.patch(`/trips/${trip.id}`, { pickupDate: later })).status()).toBe(200);
    t = await getTrip(anita, trip.id);
    expect(byCarrier(t.quotes)).toMatchObject({ [own.carriers[0].name]: 'REQUESTED', [own.carriers[1].name]: 'QUEUED' });
  });
});

test.describe('Contract-rate offers: pass, expiry and exhaustion', () => {
  test('pass moves the offer to the next carrier, with the reason kept for the shipper', async ({ request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const r = await refs(anita);
    const trip = await book(anita, r);
    expect((await carrierPasses(request, trip.number, r.deccan, 'No truck free')).status()).toBe(200);
    const t = await getTrip(anita, trip.id);
    expect(byCarrier(t.quotes)).toMatchObject({ 'Deccan Freight Carriers': 'DECLINED', 'Kaveri Roadlines': 'REQUESTED', 'NorthStar Logistics': 'QUEUED' });
    expect(t.quotes.find((q: Q) => q.carrier === 'Deccan Freight Carriers')).toMatchObject({ statusLabel: 'Passed', declineReason: 'No truck free' });
    expect(t.quotes.find((q: Q) => q.carrier === 'Kaveri Roadlines').offeredAt).not.toBeNull();
    expect(texts(t)).toContain('Deccan Freight Carriers passed — “No truck free”');
    expect((await carrierPasses(request, trip.number, r.deccan)).status()).toBe(409); // the offer already moved on
  });

  test('no answer in time moves the offer on and marks the carrier No answer', async ({ request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const r = await refs(anita);
    const trip = await book(anita, r);
    await expireQuotes(request, trip.number);
    const t = await getTrip(anita, trip.id);
    expect(byCarrier(t.quotes)).toMatchObject({ 'Deccan Freight Carriers': 'EXPIRED', 'Kaveri Roadlines': 'REQUESTED', 'NorthStar Logistics': 'QUEUED' });
    expect(t.quotes.find((q: Q) => q.carrier === 'Deccan Freight Carriers').statusLabel).toBe('No answer');
    expect(new Date(t.quoteDeadline).getTime()).toBeGreaterThan(Date.now()); // the next offer has its own window
    expect(texts(t)).toContain('Deccan Freight Carriers did not answer in time');
  });

  test('everyone passes or stays silent → No carrier accepted; Send again restarts from the lowest rate', async ({ request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const r = await refs(anita);
    const trip = await book(anita, r);
    await carrierPasses(request, trip.number, r.deccan);
    await expireQuotes(request, trip.number); // Kaveri does not answer
    await carrierPasses(request, trip.number, r.northstar, 'Rate too low');

    let t = await getTrip(anita, trip.id);
    expect(t).toMatchObject({ status: 'QUOTES_REQUESTED', noCarrierAccepted: true });
    expect(t.quotesClosedAt).not.toBeNull();
    expect(t.nextStep).toBe('No carrier accepted: send again or cancel');
    expect(t.quotes.some((q: Q) => q.status === 'REQUESTED')).toBe(false);
    expect(texts(t)).toContain('No carrier accepted');

    const again = await anita.post(`/trips/${trip.id}/send-again`);
    expect(again.status(), await again.text()).toBe(200);
    expect(await again.json()).toMatchObject({ ok: true, offeredTo: 'Deccan Freight Carriers', amount: 43800 });
    t = await getTrip(anita, trip.id);
    expect(t.noCarrierAccepted).toBe(false);
    const live = (t.quotes as Q[]).filter((q) => ['REQUESTED', 'QUEUED'].includes(q.status));
    expect(live.map((q) => [q.carrier, q.status])).toEqual([['Deccan Freight Carriers', 'REQUESTED'], ['Kaveri Roadlines', 'QUEUED'], ['NorthStar Logistics', 'QUEUED']]);
    expect((await anita.post(`/trips/${trip.id}/send-again`)).status()).toBe(409); // only valid once the list is exhausted
  });
});

test.describe('Contract-rate offers: accept awards at once', () => {
  test('accept → awarded at the contract rate, others withdrawn, no approval step, carrier sees Won', async ({ request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const r = await refs(anita);
    const trip = await book(anita, r);
    expect((await carrierAccepts(request, trip.number, r.deccan)).status()).toBe(200);

    const t = await getTrip(anita, trip.id);
    expect(t).toMatchObject({ status: 'AWARDED', carrier: 'Deccan Freight Carriers', amount: 43800, nextStep: 'Carrier assigning truck' });
    expect(byCarrier(t.quotes)).toMatchObject({ 'Deccan Freight Carriers': 'AWARDED', 'Kaveri Roadlines': 'WITHDRAWN', 'NorthStar Logistics': 'WITHDRAWN' });
    expect((t.quotes as Q[]).filter((q) => q.isWinner).map((q) => q.carrier)).toEqual(['Deccan Freight Carriers']);
    expect(texts(t).some((x) => x.includes('Deccan Freight Carriers') && x.includes('₹43,800'))).toBe(true);
    expect(t.canApprove).toBeFalsy();
    // Nothing for the shipper to decide.
    expect((await (await anita.get('/approvals')).json()).approvals.some((a: { ref: string }) => a.ref === trip.number)).toBe(false);
    expect((await carrierAccepts(request, trip.number, r.kaveri)).status()).toBe(409); // a withdrawn carrier answering late
    expect((await carrierAccepts(request, trip.number, r.deccan)).status()).toBe(409); // and a second accept
  });

  test('the awarded carrier sees the load as Won at the contract rate', async ({ request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const r = await refs(anita);
    const vijay = await asUser(request, USERS.carrier);
    const trip = await bookPune(anita, r);
    expect((await vijay.post(`/carrier/loads/${trip.id}/accept`)).status()).toBe(200);
    const d = (await (await vijay.get(`/carrier/loads/${trip.id}`)).json()).load;
    expect(d).toMatchObject({ panel: 'won', label: 'Won', amount: 38500, nextStep: 'Assign truck and driver' });
    const arjun = await asUser(request, USERS.otherCarrier);
    expect((await arjun.get(`/carrier/loads/${trip.id}`)).status()).toBe(404); // never offered, never shown
  });

  test('two carrier users accepting at once: one wins, the other gets 409 OFFER_CLOSED', async ({ request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const r = await refs(anita);
    const vijay = await asUser(request, USERS.carrier);
    const divya = await asUser(request, USERS.carrierTraffic);
    const trip = await bookPune(anita, r);
    const results = await Promise.all([vijay.post(`/carrier/loads/${trip.id}/accept`), divya.post(`/carrier/loads/${trip.id}/accept`)]);
    expect(results.map((x) => x.status()).sort()).toEqual([200, 409]);
    const loser = results.find((x) => x.status() === 409)!;
    expect((await loser.json()).error.code).toBe('OFFER_CLOSED');
    const t = await getTrip(anita, trip.id);
    expect(t.status).toBe('AWARDED');
    expect((t.quotes as Q[]).filter((q) => q.isWinner)).toHaveLength(1);
  });

  test('two accepts at once, one through the portal and one through the integration: one wins', async ({ request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const r = await refs(anita);
    const vijay = await asUser(request, USERS.carrier);
    const trip = await bookPune(anita, r);
    const results = await Promise.all([vijay.post(`/carrier/loads/${trip.id}/accept`), carrierAccepts(request, trip.number, r.kaveri)]);
    expect(results.map((x) => x.status()).sort()).toEqual([200, 409]);
    expect((await getTrip(anita, trip.id)).status).toBe('AWARDED');
  });

  test('accepting and passing at once never leaves two answers', async ({ request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const r = await refs(anita);
    const vijay = await asUser(request, USERS.carrier);
    const divya = await asUser(request, USERS.carrierTraffic);
    const trip = await bookPune(anita, r);
    const results = await Promise.all([vijay.post(`/carrier/loads/${trip.id}/accept`), divya.post(`/carrier/loads/${trip.id}/decline`, { reason: 'busy' })]);
    expect(results.map((x) => x.status()).sort()).toEqual([200, 409]);
    const t = await getTrip(anita, trip.id);
    // Whichever came first decides: awarded to Kaveri, or passed on to NorthStar; never both.
    const awarded = t.status === 'AWARDED';
    expect(byCarrier(t.quotes)['Kaveri Roadlines']).toBe(awarded ? 'AWARDED' : 'DECLINED');
    expect(byCarrier(t.quotes)['NorthStar Logistics']).toBe(awarded ? 'WITHDRAWN' : 'REQUESTED');
  });

  test('there is no shipper approval any more: approve, reject, award and friends are gone', async ({ request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const meera = await asUser(request, USERS.otherShipper);
    const r = await refs(anita);
    const trip = await book(anita, r);
    for (const path of ['approve', 'reject', 'award', 'undo-award', 'retender', 'carriers']) {
      expect([404, 405], path).toContain((await anita.post(`/trips/${trip.id}/${path}`, { reason: 'x' })).status());
    }
    expect((await meera.post(`/trips/${trip.id}/send-again`)).status()).toBe(404);
  });
});
