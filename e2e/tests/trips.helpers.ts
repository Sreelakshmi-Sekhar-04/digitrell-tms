import { expect, type APIRequestContext } from '@playwright/test';
import { API_URL } from '../test-env';
import { USERS, asUser } from './helpers';

type Client = Awaited<ReturnType<typeof asUser>>;

/** Tomorrow in India, YYYY-MM-DD. */
export const tomorrow = () => new Date(Date.now() + 5.5 * 3600_000 + 86400_000).toISOString().slice(0, 10);

/** Ids of seeded addresses and carriers, looked up once per test. */
export async function refs(client: Client) {
  const addresses = (await (await client.get('/addresses')).json()).addresses as { id: string; name: string }[];
  const carriers = (await (await client.get('/carriers')).json()).carriers as { id: string; name: string }[];
  const a = (n: string) => addresses.find((x) => x.name === n)!.id;
  const c = (n: string) => carriers.find((x) => x.name === n)!.id;
  return {
    ambattur: a('Ambattur DC'), hosur: a('Hosur Plant'), chakan: a('Chakan Warehouse'), medchal: a('Medchal DC'),
    kaveri: c('Kaveri Roadlines'), northstar: c('NorthStar Logistics'), deccan: c('Deccan Freight Carriers'), sai: c('Sai Ganesh Transport'),
  };
}

/** Books Chennai → Bengaluru, 32ft MXL (seeded "Ask me" lane with 4 carriers) unless overridden. */
export async function book(client: Client, r: Awaited<ReturnType<typeof refs>>, over: Record<string, unknown> = {}) {
  const res = await client.post('/bookings', {
    pickupAddressId: r.ambattur, dropAddressId: r.hosur, pickupDate: tomorrow(), truckType: '32ft MXL',
    material: 'Biscuits (packed cartons)', weightTonnes: 14, ...over,
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).trip as { id: string; number: string };
}

const KEY = { 'x-integration-key': 'dev-integration-key' };

/** Plays the carrier module: the carrier quotes `amount`, or passes when `amount` is null. */
export async function carrierQuotes(request: APIRequestContext, tripNumber: string, carrierId: string, amount: number | null) {
  const res = await request.post(`${API_URL}/integration/quotes`, { headers: KEY, data: { tripNumber, carrierId, amount } });
  return res;
}

export async function expireQuotes(request: APIRequestContext, tripNumber: string) {
  expect((await request.post(`${API_URL}/integration/trips/${tripNumber}/expire-quotes`, { headers: KEY })).status()).toBe(200);
}

export async function ageAward(request: APIRequestContext, tripNumber: string) {
  expect((await request.post(`${API_URL}/integration/trips/${tripNumber}/age-award`, { headers: KEY })).status()).toBe(200);
}

export const shipperHead = (request: APIRequestContext) => asUser(request, USERS.shipperHead);

// ---------- Phase 4: execution and billing (carrier / driver / receiver stand-ins) ----------

const post = (request: APIRequestContext, path: string, data: unknown = {}) => request.post(`${API_URL}/integration${path}`, { headers: KEY, data });

export const integration = {
  truck: (request: APIRequestContext, n: string, over: Record<string, unknown> = {}) =>
    post(request, `/trips/${n}/truck`, {
      truckNumber: 'TN 10 AZ 2210', driverName: 'Murugan V', driverPhone: '9790000008', lrNumber: `KR-${n.slice(3)}`,
      ewayBillNumber: `1810${n.slice(3)}7731`, ewayValidUntil: new Date(Date.now() + 3 * 86400_000).toISOString(), ...over,
    }),
  event: (request: APIRequestContext, n: string, type: string, extra: Record<string, unknown> = {}) => post(request, `/trips/${n}/events`, { type, ...extra }),
  delivered: (request: APIRequestContext, n: string, goodQty = 220, damagedQty = 0, remarks?: string) => post(request, `/trips/${n}/delivered`, { goodQty, damagedQty, remarks }),
  pod: (request: APIRequestContext, n: string, extra: Record<string, unknown> = {}) => post(request, `/trips/${n}/pod`, { qrMatched: true, ...extra }),
  invoice: (request: APIRequestContext, n: string, data: Record<string, unknown>) => post(request, `/trips/${n}/invoice`, data),
  claimResponse: (request: APIRequestContext, claimNumber: string, accept: boolean, note?: string) => post(request, `/claims/${claimNumber}/response`, { accept, note }),
};

/** Sets Sunrise Foods' policy for a test (other tests may change it). */
export async function setPolicy(client: Client, p: { podRule?: string; billing?: number; paymentApprovalAbove?: number } = {}) {
  const res = await client.put('/policies', {
    paymentApprovalAbove: p.paymentApprovalAbove ?? 50000, quoteWindowHours: 2, podRule: p.podRule ?? 'DIGITAL',
    autonomy: { intake: 2, tender: 2, bidEvaluation: 1, billing: p.billing ?? 1 },
  });
  expect(res.status(), await res.text()).toBe(200);
}

/** Books Chennai → Bengaluru, gets a ₹42,500 Kaveri quote and awards it. */
export async function awardedTrip(request: APIRequestContext, client: Client, r: Awaited<ReturnType<typeof refs>>, amount = 42500) {
  const trip = await book(client, r);
  await carrierQuotes(request, trip.number, r.kaveri, amount);
  const t = (await (await client.get(`/trips/${trip.id}`)).json()).trip;
  const res = await client.post(`/trips/${trip.id}/award`, { quoteId: t.quotes.find((q: { carrierId: string }) => q.carrierId === r.kaveri).id });
  expect(res.status()).toBe(200);
  return trip;
}

/** Runs an awarded trip through truck, loading and delivery. */
export async function deliveredTrip(request: APIRequestContext, client: Client, r: Awaited<ReturnType<typeof refs>>, damaged = 0, amount = 42500) {
  const trip = await awardedTrip(request, client, r, amount);
  expect((await integration.truck(request, trip.number)).status()).toBe(200);
  await integration.event(request, trip.number, 'REACHED_PICKUP');
  await integration.event(request, trip.number, 'LOADED', { eta: new Date(Date.now() + 86400_000).toISOString() });
  expect((await integration.delivered(request, trip.number, 220 - damaged, damaged)).status()).toBe(200);
  return trip;
}

// ---------- Phase 5: exceptions ----------

export const exceptions = {
  report: (request: APIRequestContext, n: string, body: Record<string, unknown>) => post(request, `/trips/${n}/exceptions`, body),
  propose: (request: APIRequestContext, id: string, body: Record<string, unknown>) => post(request, `/exceptions/${id}/proposal`, body),
  resolve: (request: APIRequestContext, id: string, body: Record<string, unknown> = {}) => post(request, `/exceptions/${id}/resolve`, body),
};

/** Awarded trip that is loaded and on the road. */
export async function onTheRoad(request: APIRequestContext, client: Client, r: Awaited<ReturnType<typeof refs>>) {
  const trip = await awardedTrip(request, client, r);
  await integration.truck(request, trip.number);
  await integration.event(request, trip.number, 'LOADED', { eta: new Date(Date.now() + 86400_000).toISOString() });
  return trip;
}

/** A lane of its own (fresh addresses and carriers) so tests can change it freely. */
export async function ownLane(client: Client, carriers = 1) {
  const tag = Math.random().toString(36).slice(2, 6);
  const phone = () => `9${Math.floor(100000000 + Math.random() * 899999999)}`;
  const made = [];
  for (let i = 0; i < carriers + 1; i++) made.push((await (await client.post('/carriers', { name: `Lane Carrier ${i} ${tag}`, phone: phone() })).json()).carrier);
  const from = (await (await client.post('/addresses', { name: `Madurai Hub ${tag}`, city: 'Madurai', line1: 'Kappalur SIDCO', kind: 'PICKUP' })).json()).address;
  // A city of its own per call: lanes are unique per pickup city, drop city and truck type.
  const city = `Karur ${tag}`;
  const to = (await (await client.post('/addresses', { name: `Karur DC ${tag}`, city, line1: 'Thanthonimalai', kind: 'DROP' })).json()).address;
  const lane = (await (await client.post('/lanes', { origin: 'Madurai', destination: city, truckType: '17ft', budget: 20000, awardRule: 'ASK', carrierIds: made.slice(0, carriers).map((c) => c.id) })).json()).lane;
  return { lane, carriers: made, spare: made[carriers], booking: { pickupAddressId: from.id, dropAddressId: to.id, truckType: '17ft', material: 'Rice bags', weightTonnes: 7 } };
}
