import { expect, test, type APIRequestContext } from '@playwright/test';
import { API_URL } from '../test-env';
import { USERS, asUser, apiLogin } from './helpers';
import { book, carrierAccepts, integration, ownLane, refs } from './trips.helpers';

type Client = Awaited<ReturnType<typeof asUser>>;

/** Runs a trip on its own lane to POD, delivered before (on time) or after (late) the promised ETA. */
async function deliveredOn(request: APIRequestContext, client: Client, own: Awaited<ReturnType<typeof ownLane>>, late: boolean) {
  const trip = await book(client, await refs(client), own.booking);
  expect((await carrierAccepts(request, trip.number, own.carriers[0].id)).status()).toBe(200); // the lowest contract rate (₹19,000) is offered first
  await integration.truck(request, trip.number);
  const eta = new Date(Date.now() + (late ? -3600_000 : 86400_000)).toISOString();
  await integration.event(request, trip.number, 'LOADED', { eta });
  await integration.delivered(request, trip.number);
  await integration.pod(request, trip.number);
  return trip;
}

test.describe('Home dashboard API', () => {
  test('a shipper with no trips gets the first-time setup checklist', async ({ request }) => {
    const meera = await asUser(request, USERS.otherShipper);
    const d = await (await meera.get('/insights/dashboard')).json();
    expect(d.firstTime).toBe(true);
    expect(Object.fromEntries(d.setup.map((s: { id: string; done: boolean }) => [s.id, s.done]))).toEqual({ addresses: true, lanes: true, carriers: true, limits: false, booking: false });
    expect(d.activeTrips).toEqual([]);
  });

  test('a busy shipper gets decisions (top 3 + count), active trips and this month', async ({ request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const r = await refs(anita);
    const trip = await book(anita, r);
    await carrierAccepts(request, trip.number, r.deccan);
    const d = await (await anita.get('/insights/dashboard')).json();
    expect(d.firstTime).toBe(false);
    expect(d.approvals.length).toBeLessThanOrEqual(3);
    expect(d.approvalsCount).toBeGreaterThanOrEqual(d.approvals.length);
    expect(d.approvalsCount).toBe((await (await anita.get('/approvals')).json()).count);
    expect(d.activeTrips.length).toBeLessThanOrEqual(5);
    expect(d.activeTrips.every((t: { status: string }) => !['CLOSED', 'CANCELLED'].includes(t.status))).toBe(true);
    expect(d.month.trips).toBeGreaterThan(0);
    expect(d.setup.find((s: { id: string }) => s.id === 'booking').done).toBe(true);
  });
});

test.describe('Reports API', () => {
  test('on-time, POD days, spend, by lane and carrier scorecard follow the trip records', async ({ request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const own = await ownLane(anita, 1); // its carrier's contract rate is ₹19,000, so each trip is awarded at that
    await deliveredOn(request, anita, own, false);
    await deliveredOn(request, anita, own, true);
    const rep = await (await anita.get('/insights/reports?period=month')).json();
    expect(rep.period.key).toBe('month');
    const lane = rep.byLane.find((l: { lane: string }) => l.lane === `Madurai → ${own.lane.destination}`) ?? rep.byLane.find((l: { lane: string }) => l.lane.toLowerCase() === `madurai → ${own.lane.destination.toLowerCase()}`);
    expect(lane).toMatchObject({ trips: 2, spend: 38000 });
    const card = rep.scorecard.find((c: { carrier: string }) => c.carrier === own.carriers[0].name);
    expect(card).toMatchObject({ trips: 2, delivered: 2, onTimePct: 50, vsBudgetPct: null }); // no budget any more, so no comparison
    expect(card.avgPodDays).toBeLessThan(0.1); // POD accepted right after delivery
    expect(rep.kpis.spend).toBeGreaterThanOrEqual(38000);
    expect(rep.kpis.onTimePct).not.toBeNull();

    const last = await (await anita.get('/insights/reports?period=last-month')).json();
    expect(last.kpis.awarded).toBe(0); // the test database only has this month's trips
  });

  test('trips CSV export has a header row and the trip numbers', async ({ request }) => {
    const token = await apiLogin(request, USERS.shipperHead);
    const res = await request.get(`${API_URL}/insights/reports/trips.csv?period=month`, { headers: { Authorization: `Bearer ${token}` } });
    expect(res.headers()['content-type']).toContain('text/csv');
    expect(res.headers()['content-disposition']).toContain('trips-month.csv');
    const body = await res.text();
    expect(body.split('\r\n')[0]).toContain('Trip,Booked (IST),From,To');
    expect(body).toMatch(/TR-\d{5}/);
  });
});

test.describe('Activity log API', () => {
  test('filters by trip, people/agents and type; another shipper sees none of it', async ({ request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const r = await refs(anita);
    const trip = await book(anita, r);
    await carrierAccepts(request, trip.number, r.deccan);

    const forTrip = await (await anita.get(`/activity?q=${trip.number}&days=7`)).json();
    expect(forTrip.entries.length).toBeGreaterThanOrEqual(3);
    expect(forTrip.entries.every((e: { record: string }) => e.record === trip.number)).toBe(true);
    expect(forTrip.entries.some((e: { text: string }) => e.text.includes('Deccan Freight Carriers') && e.text.includes('₹43,800') && /accepted|Awarded/.test(e.text))).toBe(true);

    const people = await (await anita.get('/activity?who=people')).json();
    expect(people.entries.every((e: { isPerson: boolean }) => e.isPerson)).toBe(true);
    const agents = await (await anita.get('/activity?who=agents')).json();
    expect(agents.entries.every((e: { isPerson: boolean }) => !e.isPerson)).toBe(true);
    const settings = await (await anita.get('/activity?type=settings')).json();
    expect(settings.entries.length).toBeGreaterThan(0);
    expect(settings.entries.every((e: { record: string | null }) => e.record == null)).toBe(true);
    expect(settings.entries.some((e: { action: string }) => e.action === 'LOGIN')).toBe(false);

    const meera = await asUser(request, USERS.otherShipper);
    const theirs = await (await meera.get(`/activity?q=${trip.number}`)).json();
    expect(theirs.entries).toEqual([]);
  });

  test('CSV export of the log', async ({ request }) => {
    const token = await apiLogin(request, USERS.shipperHead);
    const res = await request.get(`${API_URL}/activity/export.csv?days=7`, { headers: { Authorization: `Bearer ${token}` } });
    expect(res.headers()['content-type']).toContain('text/csv');
    expect((await res.text()).replace(/^﻿/, '').split('\r\n')[0]).toBe('Time (IST),Who,Action,Record,Reason');
  });
});

test.describe('My messages API', () => {
  test('defaults, validation and saving', async ({ request }) => {
    const karthik = await asUser(request, USERS.shipperExec);
    const { messages } = await (await karthik.get('/profile/messages')).json();
    expect(messages).not.toHaveProperty('channel');
    expect(messages).toMatchObject({ language: 'en', quietHours: '', prefs: { truckConfirmed: true, tracking: true, delivered: true, dailySummary: false, invoices: false } });
    const bad = await karthik.put('/profile/messages', { language: 'xx', quietHours: '01:00-02:00' });
    expect(Object.keys((await bad.json()).error.fields).sort()).toEqual(['language', 'quietHours']);
    const ok = await karthik.put('/profile/messages', { language: 'ta', quietHours: '22:00-07:00', prefs: { dailySummary: true, tracking: false } });
    expect(ok.status()).toBe(200);
    expect((await (await karthik.get('/profile/messages')).json()).messages).toMatchObject({ language: 'ta', quietHours: '22:00-07:00', prefs: { dailySummary: true, tracking: false, delivered: true } });
    await karthik.put('/profile/messages', { language: 'en', quietHours: '', prefs: {} });
  });
});
