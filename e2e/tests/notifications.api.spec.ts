import { expect, test } from '@playwright/test';
import { API_URL } from '../test-env';
import { USERS, asUser } from './helpers';
import { book, carrierAccepts, carrierPasses, refs } from './trips.helpers';

type N = { id: string; kind: string; tripId: string | null; title: string; body?: string | null; read: boolean; createdAt: string };
type Client = Awaited<ReturnType<typeof asUser>>;
const PRIYA = { email: 'priya@sunrisefoods.test', password: 'Shipper@123' };
const list = async (c: Client) => (await (await c.get('/notifications')).json()) as { notifications: N[]; unreadCount: number };
const text = (n: N) => `${n.title} ${n.body ?? ''}`;
const forTrip = (l: { notifications: N[] }, tripId: string, number: string) => l.notifications.filter((n) => n.tripId === tripId || text(n).includes(number));

test.describe('Shipper notifications API', () => {
  test('a carrier accept notifies every active user of the shipper company, and nobody else', async ({ request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const r = await refs(anita);
    const trip = await book(anita, r);
    const people = [anita, await asUser(request, USERS.shipperExec), await asUser(request, PRIYA)];
    const meera = await asUser(request, USERS.otherShipper);
    const before = await Promise.all([...people, meera].map(list));

    expect((await carrierAccepts(request, trip.number, r.deccan)).status()).toBe(200);

    for (const [i, c] of people.entries()) {
      const l = await list(c);
      const mine = forTrip(l, trip.id, trip.number);
      expect(mine, `user ${i}`).toHaveLength(1);
      expect(text(mine[0])).toContain(`Deccan Freight Carriers accepted ${trip.number} (Chennai → Bengaluru) at ₹43,800`);
      expect(mine[0]).toMatchObject({ tripId: trip.id, read: false });
      expect(l.unreadCount).toBe(before[i].unreadCount + 1);
    }
    // Another company sees nothing about it, and its count does not move.
    const theirs = await list(meera);
    expect(forTrip(theirs, trip.id, trip.number)).toEqual([]);
    expect(theirs.unreadCount).toBe(before[3].unreadCount);
  });

  test('reading is per user: mark one read, the others stay unread; read-all clears only my own', async ({ request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const karthik = await asUser(request, USERS.shipperExec);
    const r = await refs(anita);
    const a = await book(anita, r);
    const b = await book(anita, r);
    await carrierAccepts(request, a.number, r.deccan);
    await carrierAccepts(request, b.number, r.deccan);

    const start = await list(anita);
    const mineA = forTrip(start, a.id, a.number)[0];
    const read = await anita.post(`/notifications/${mineA.id}/read`);
    expect(read.status()).toBe(200);
    const after = await list(anita);
    expect(after.unreadCount).toBe(start.unreadCount - 1);
    expect(forTrip(after, a.id, a.number)[0].read).toBe(true);
    expect((await anita.post(`/notifications/${mineA.id}/read`)).status()).toBe(200); // reading twice is harmless
    expect((await list(anita)).unreadCount).toBe(start.unreadCount - 1);

    // Karthik's copy of the same event is untouched, and he cannot read or mark Anita's.
    const kStart = await list(karthik);
    expect(forTrip(kStart, a.id, a.number)[0].read).toBe(false);
    expect((await karthik.post(`/notifications/${mineA.id}/read`)).status()).toBe(404);
    expect((await asUser(request, USERS.otherShipper).then((m) => m.post(`/notifications/${mineA.id}/read`))).status()).toBe(404);
    expect((await karthik.post('/notifications/not-a-real-id/read')).status()).toBe(404);

    expect((await anita.post('/notifications/read-all')).status()).toBe(200);
    expect((await list(anita)).unreadCount).toBe(0);
    expect((await list(karthik)).unreadCount).toBe(kStart.unreadCount);
  });

  test('"No carrier accepted" notifies the shipper when the offers run out', async ({ request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const r = await refs(anita);
    const trip = await book(anita, r);
    await carrierPasses(request, trip.number, r.deccan);
    await carrierPasses(request, trip.number, r.kaveri);
    expect(forTrip(await list(anita), trip.id, trip.number)).toEqual([]); // still one carrier left: nothing to tell yet
    await carrierPasses(request, trip.number, r.northstar);
    const mine = forTrip(await list(anita), trip.id, trip.number);
    expect(mine).toHaveLength(1);
    expect(text(mine[0])).toContain(`No carrier accepted ${trip.number}`);
    expect(mine[0].tripId).toBe(trip.id);
  });

  test('a passed offer on its own does not notify; the list is capped and newest first; sign-in is required', async ({ request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const r = await refs(anita);
    const trip = await book(anita, r);
    await carrierPasses(request, trip.number, r.deccan);
    expect(forTrip(await list(anita), trip.id, trip.number)).toEqual([]);
    const l = await list(anita);
    expect(l.notifications.length).toBeLessThanOrEqual(30);
    const times = l.notifications.map((n) => +new Date(n.createdAt));
    expect(times).toEqual([...times].sort((x, y) => y - x));

    const anon = await request.get(`${API_URL}/notifications`);
    expect(anon.status()).toBe(401);
  });
});
