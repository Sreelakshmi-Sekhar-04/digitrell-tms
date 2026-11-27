import { execSync } from 'child_process';
import path from 'path';
import { expect, test } from '@playwright/test';
import { API_URL, testDatabaseUrl } from '../test-env';
import { USERS, asUser } from './helpers';

const backend = path.join(__dirname, '..', '..', 'backend');
const runLoader = (cmd: string, env: Record<string, string> = {}) =>
  execSync(`npx ts-node prisma/demo/index.ts ${cmd}`, { cwd: backend, env: { ...process.env, DATABASE_URL: testDatabaseUrl(), ...env }, stdio: 'pipe' }).toString();

interface Trip { id: string; number: string; status: string; createdAt: string }

test.describe('Demo data (API)', () => {
  test('the demo company covers every stage of the workflow', async ({ request }) => {
    const lakshmi = await asUser(request, USERS.demoHead);
    const { counts, total } = await (await lakshmi.get('/trips')).json();
    expect(total).toBe(31);
    // The Closed tab holds 16 paid and 2 cancelled trips as loaded; the UI journey test pays one more.
    expect(counts.all).toBe(31);
    expect([18, 19]).toContain(counts.closed);
    expect(counts.action).toBeGreaterThan(0);
    expect(counts.transit).toBeGreaterThan(0);
    expect(counts.delivered).toBeGreaterThan(0);

    const { approvals } = await (await lakshmi.get('/approvals')).json();
    const kinds = approvals.map((a: { kind: string }) => a.kind).filter((k: string) => k !== 'PAYMENT').sort();
    expect(kinds).toEqual(['EXCEPTION']); // offers are awarded on accept, so no award waits for approval;
    expect([1, 2]).toContain(approvals.filter((a: { kind: string }) => a.kind === 'PAYMENT').length);

    const report = await (await lakshmi.get('/insights/reports?period=90d')).json();
    expect(report.byLane.length).toBe(4);
    expect(report.scorecard.map((c: { carrier: string }) => c.carrier).sort()).toEqual(['Godavari Freight Lines', 'Konkan Cargo Movers', 'Nilgiri Logistics', 'Shivam Transport Co', 'Thirumala Roadways']);
  });

  test('records are dated over the last three months and linked correctly', async ({ request }) => {
    const lakshmi = await asUser(request, USERS.demoHead);
    const trips: Trip[] = [];
    for (let page = 1; trips.length < 31 && page < 10; page++) trips.push(...(await (await lakshmi.get(`/trips?page=${page}`)).json()).trips);
    expect(trips).toHaveLength(31);
    expect(new Set(trips.map((t) => t.number)).size).toBe(31);

    // A closed trip with a damage claim: claim accepted by the carrier and deducted from the paid invoice.
    const found = (await (await lakshmi.get('/trips?q=PO-VAF-10471')).json()).trips;
    expect(found).toHaveLength(1);
    const claimTrip = found[0];
    const { trip } = await (await lakshmi.get(`/trips/${claimTrip.id}`)).json();
    expect(trip.status).toBe('CLOSED');
    expect(trip.claims).toHaveLength(1);
    expect(trip.claims[0]).toMatchObject({ status: 'ACCEPTED', amount: 2480 });
    expect(trip.invoice).toMatchObject({ status: 'PAID', claimDeduction: 2480, total: 20600 - 2480 });
    expect(trip.quotes.filter((q: { status: string }) => q.status === 'AWARDED')).toHaveLength(1);
    const days = (Date.now() - new Date(trip.createdAt).getTime()) / 86400_000;
    expect(days).toBeGreaterThan(70);
    expect(days).toBeLessThan(74);

    // Oldest and newest bookings span about 12 weeks; nothing is dated in the future.
    const dates = trips.map((t) => new Date(t.createdAt).getTime());
    expect((Math.max(...dates) - Math.min(...dates)) / 86400_000).toBeGreaterThan(80);
    expect(Math.max(...dates)).toBeLessThan(Date.now());
  });

  test('demo users sign in with their roles; the invited one has not set a password', async ({ request }) => {
    for (const u of [USERS.demoHead, USERS.demoAccounts, USERS.demoExec]) {
      const res = await request.post(`${API_URL}/auth/login`, { data: { email: u.email, password: u.password } });
      expect(res.status(), u.email).toBe(200);
      expect((await res.json()).user).toMatchObject({ name: u.name, companyName: u.company });
    }
    const lakshmi = await asUser(request, USERS.demoHead);
    const { users } = await (await lakshmi.get('/users')).json();
    expect(users.map((u: { name: string; status: string }) => `${u.name}:${u.status}`).sort()).toEqual([
      'Arjun Reddy:ACTIVE', 'Deepa Iyer:ACTIVE', 'Farhan Sheikh:INVITED', 'Lakshmi Menon:ACTIVE', 'Suresh Babu:ACTIVE',
    ]);
  });

  test('demo data stays inside its own company', async ({ request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    expect((await (await anita.get('/trips?q=PO-VAF')).json()).total).toBe(0);
    const lakshmi = await asUser(request, USERS.demoHead);
    const sunriseTrip = (await (await anita.get('/trips')).json()).trips[0];
    if (sunriseTrip) expect((await lakshmi.get(`/trips/${sunriseTrip.id}`)).status()).toBe(404);
  });

  test('loading again adds nothing, and the loader refuses to run in production', async ({ request }) => {
    expect(runLoader('load')).toContain('already loaded');
    const lakshmi = await asUser(request, USERS.demoHead);
    expect((await (await lakshmi.get('/trips')).json()).total).toBe(31);

    let failed = '';
    try {
      runLoader('load', { NODE_ENV: 'production' });
    } catch (e) {
      failed = String((e as { stderr?: Buffer }).stderr ?? e);
    }
    expect(failed).toContain('never loaded in production');
  });
});
