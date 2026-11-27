import { expect, test, type APIRequestContext } from '@playwright/test';
import { USERS, asUser } from './helpers';
import { awardedTrip, bookPune, carrierAccepts, carrierPasses, expireQuotes, integration, refs, shipperHead } from './trips.helpers';

type Client = Awaited<ReturnType<typeof asUser>>;

/** A fresh Pune → Hyderabad booking by Sunrise Foods: Kaveri is offered first at its contract rate of ₹38,500, NorthStar waits at ₹39,000. */
async function newOffer(request: APIRequestContext) {
  const anita = await shipperHead(request);
  const r = await refs(anita);
  const trip = await bookPune(anita, r);
  return { anita, r, trip };
}
const detail = async (c: Client, id: string) => (await (await c.get(`/carrier/loads/${id}`)).json()).load;

test.describe('Carrier loads API: offers', () => {
  test('a new booking reaches the lowest-rate carrier as an offer at its fixed contract rate', async ({ request }) => {
    const { trip } = await newOffer(request);
    const vijay = await asUser(request, USERS.carrier);
    const { loads, counts } = await (await vijay.get('/carrier/loads?group=action')).json();
    const row = loads.find((l: { id: string }) => l.id === trip.id);
    expect(row).toMatchObject({ number: trip.number, shipper: 'Sunrise Foods Pvt Ltd', origin: 'Pune', destination: 'Hyderabad', panel: 'offer', label: 'New offer', group: 'action', amount: 38500 });
    expect(row.nextStep).toMatch(/^Accept or pass by /);
    expect(row.respondBy).toBeTruthy();
    expect(row).not.toHaveProperty('quoteDeadline');
    expect(counts.action).toBeGreaterThanOrEqual(1);
    const d = await detail(vijay, trip.id);
    expect(d.offer).toMatchObject({ amount: 38500 });
    expect(Array.isArray(d.offer.freeTrucks)).toBe(true);
    expect(d.offer.respondBy).toBeTruthy();
    expect(d.activity.map((a: { text: string }) => a.text)).toContain('Load offered to you at ₹38,500');
  });

  test("never shows the shipper's other carriers, their rates or any budget", async ({ request }) => {
    const { trip } = await newOffer(request);
    const vijay = await asUser(request, USERS.carrier);
    const body = await (await vijay.get(`/carrier/loads/${trip.id}`)).text();
    expect(body).not.toContain('39000'); // NorthStar's contract rate
    expect(body).not.toContain('NorthStar');
    expect(body).not.toMatch(/budget|score|recommend/i);
    expect(await (await vijay.get('/carrier/loads')).text()).not.toContain('39000');
  });

  test('accept awards the load at the fixed rate; the amount in a body is ignored; a second answer is 409', async ({ request }) => {
    const { anita, trip } = await newOffer(request);
    const divya = await asUser(request, USERS.carrierTraffic);
    const res = await divya.post(`/carrier/loads/${trip.id}/accept`, { amount: 1000 });
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const d = await detail(divya, trip.id);
    expect(d).toMatchObject({ panel: 'won', label: 'Won', amount: 38500, group: 'action', nextStep: 'Assign truck and driver' });
    expect(d.activity.map((a: { text: string }) => a.text)).toContain('Awarded to you at ₹38,500');
    const shipperView = (await (await anita.get(`/trips/${trip.id}`)).json()).trip;
    expect(shipperView).toMatchObject({ status: 'AWARDED', amount: 38500 });
    for (const again of [divya.post(`/carrier/loads/${trip.id}/accept`), divya.post(`/carrier/loads/${trip.id}/decline`, {})]) {
      const x = await again;
      expect(x.status()).toBe(409);
      expect((await x.json()).error.code).toBe('OFFER_CLOSED');
    }
    // The carrier cannot price its own answer: the quote endpoint is gone.
    expect([404, 405]).toContain((await divya.post(`/carrier/loads/${trip.id}/quote`, { amount: 1000 })).status());
  });

  test('a carrier in line sees the load only after the earlier ones pass, and never once it is awarded elsewhere', async ({ request }) => {
    const { trip } = await newOffer(request);
    const vijay = await asUser(request, USERS.carrier);
    const arjun = await asUser(request, USERS.otherCarrier);
    expect((await arjun.get(`/carrier/loads/${trip.id}`)).status()).toBe(404);
    await vijay.post(`/carrier/loads/${trip.id}/decline`, { reason: 'No truck' });
    expect(await detail(arjun, trip.id)).toMatchObject({ panel: 'offer', amount: 39000 });
    expect((await arjun.post(`/carrier/loads/${trip.id}/accept`)).status()).toBe(200);
    expect(await detail(arjun, trip.id)).toMatchObject({ panel: 'won', amount: 39000 });
    expect(await detail(vijay, trip.id)).toMatchObject({ label: 'You passed', group: 'closed' });
  });

  test('pass: optional reason, the next carrier is offered; accounts cannot answer; an expired offer closes', async ({ request }) => {
    const { trip } = await newOffer(request);
    const suresh = await asUser(request, USERS.carrierAccounts);
    expect((await suresh.post(`/carrier/loads/${trip.id}/accept`)).status()).toBe(403);
    expect((await suresh.post(`/carrier/loads/${trip.id}/decline`, {})).status()).toBe(403);
    const divya = await asUser(request, USERS.carrierTraffic);
    expect((await divya.post(`/carrier/loads/${trip.id}/pass`, { reason: 'No truck free' })).status()).toBe(200);
    expect(await detail(divya, trip.id)).toMatchObject({ label: 'You passed', group: 'closed' });
    const arjun = await asUser(request, USERS.otherCarrier);
    expect(await detail(arjun, trip.id)).toMatchObject({ panel: 'offer', label: 'New offer' });

    const second = await newOffer(request);
    await expireQuotes(request, second.trip.number);
    expect(await detail(divya, second.trip.id)).toMatchObject({ label: 'Offer expired', group: 'closed' });
    expect((await divya.post(`/carrier/loads/${second.trip.id}/accept`)).status()).toBe(409);
  });

  test("a carrier never sees another carrier's answer on the same load", async ({ request }) => {
    const { trip, r } = await newOffer(request);
    const vijay = await asUser(request, USERS.carrier);
    const arjun = await asUser(request, USERS.otherCarrier);
    expect((await arjun.get(`/carrier/loads/${trip.id}`)).status()).toBe(404); // queued: invisible
    await vijay.post(`/carrier/loads/${trip.id}/decline`, { reason: 'Secret reason XYZ' });
    const theirs = await (await arjun.get(`/carrier/loads/${trip.id}`)).text();
    expect(theirs).not.toContain('Kaveri');
    expect(theirs).not.toContain('38500');
    expect(theirs).not.toContain('Secret reason XYZ');
    expect((await carrierAccepts(request, trip.number, r.northstar)).status()).toBe(200);
    expect((await vijay.get('/carrier/loads/not-a-real-id')).status()).toBe(404);
  });
});

test.describe('Carrier loads API: won and Home', () => {
  test('a won load shows as Won, then Ready for pickup with truck and LR', async ({ request }) => {
    const anita = await shipperHead(request);
    const r = await refs(anita);
    const trip = await awardedTrip(request, anita, r, { pune: true });
    const vijay = await asUser(request, USERS.carrier);
    expect(await detail(vijay, trip.id)).toMatchObject({ panel: 'won', label: 'Won', group: 'action', amount: 38500, nextStep: 'Assign truck and driver' });
    await integration.truck(request, trip.number);
    const d = await detail(vijay, trip.id);
    expect(d).toMatchObject({ panel: 'ready', group: 'transit', execution: { truckNumber: 'TN 10 AZ 2210', driverName: 'Murugan V' } });
    expect(d.execution.documents.map((x: { kind: string }) => x.kind)).toEqual(['LR', 'EWAY_BILL']);
    expect(d.activity.map((a: { text: string }) => a.text)).toContain('Awarded to you at ₹38,500');
  });

  test('a load that went to the next carrier shows You passed with no winner details', async ({ request }) => {
    const { anita, r, trip } = await newOffer(request);
    await carrierPasses(request, trip.number, r.kaveri);
    await carrierAccepts(request, trip.number, r.northstar);
    const vijay = await asUser(request, USERS.carrier);
    const body = await (await vijay.get(`/carrier/loads/${trip.id}`)).text();
    expect(JSON.parse(body).load).toMatchObject({ label: 'You passed', group: 'closed', execution: null });
    expect(body).not.toContain('NorthStar');
    expect(body).not.toContain('39000');
  });

  test('Home: stats, open offers and active loads; no approvals', async ({ request }) => {
    const { trip } = await newOffer(request);
    const vijay = await asUser(request, USERS.carrier);
    const home = await (await vijay.get('/carrier/home')).json();
    expect(home.stats.openRequests.count).toBeGreaterThanOrEqual(1);
    expect(home.stats.freeTomorrow.of).toBeGreaterThanOrEqual(5);
    expect(home.approvalsCount).toBe(0);
    expect(home.active.some((l: { id: string }) => l.id === trip.id)).toBe(true);
    expect(await (await vijay.get('/carrier/approvals')).json()).toEqual({ count: 0, items: [] });
  });

  test('shippers cannot use carrier load routes', async ({ request }) => {
    const anita = await shipperHead(request);
    for (const p of ['/carrier/loads', '/carrier/home', '/carrier/approvals']) expect((await anita.get(p)).status(), p).toBe(403);
  });
});
