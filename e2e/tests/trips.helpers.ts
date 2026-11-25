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
