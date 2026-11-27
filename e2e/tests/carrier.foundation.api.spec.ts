import { expect, test } from '@playwright/test';
import { API_URL } from '../test-env';
import { USERS, asUser } from './helpers';

test.describe('Carrier API: foundation and access', () => {
  test('carrier users can sign in and get their roles and company', async ({ request }) => {
    const res = await request.post(`${API_URL}/auth/login`, { data: { email: USERS.carrier.email, password: USERS.carrier.password } });
    expect(res.status()).toBe(200);
    const { user } = await res.json();
    expect(user).toMatchObject({ name: 'Vijay Kumar', role: 'OWNER', companyType: 'CARRIER', companyName: 'Kaveri Roadlines' });
    expect(user.roles).toEqual(['OWNER', 'TRAFFIC_MANAGER']); // one person, two roles
    expect(user.passwordHash).toBeUndefined();
  });

  test('a single-role user has just that role', async ({ request }) => {
    const divya = await asUser(request, USERS.carrierTraffic);
    const { user } = await (await divya.get('/auth/me')).json();
    expect(user.roles).toEqual(['TRAFFIC_MANAGER']);
  });

  test('a deactivated carrier user cannot sign in', async ({ request }) => {
    expect((await request.post(`${API_URL}/auth/login`, { data: USERS.carrierInactive })).status()).toBe(401);
  });

  test('carrier routes need a signed-in user', async ({ request }) => {
    for (const path of ['/carrier/me', '/carrier/approvals']) {
      const res = await request.get(`${API_URL}${path}`);
      expect(res.status(), path).toBe(401);
      expect((await res.json()).error.code).toBe('UNAUTHENTICATED');
    }
  });

  test('a bad or expired token is refused', async ({ request }) => {
    const res = await request.get(`${API_URL}/carrier/me`, { headers: { Authorization: 'Bearer not-a-real-token' } });
    expect(res.status()).toBe(401);
  });

  test('shipper users are refused on carrier routes', async ({ request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    for (const path of ['/carrier/me', '/carrier/approvals']) {
      const res = await anita.get(path);
      expect(res.status(), path).toBe(403);
      expect((await res.json()).error.message).toBe('This part of DigitRell is for carrier users.');
    }
  });

  test('carrier users are still refused on shipper routes', async ({ request }) => {
    const vijay = await asUser(request, USERS.carrier);
    for (const path of ['/lanes', '/trips', '/approvals', '/policies', '/users']) {
      expect((await vijay.get(path)).status(), path).toBe(403);
    }
  });

  test('/carrier/me returns only the caller’s own company', async ({ request }) => {
    const vijay = await asUser(request, USERS.carrier);
    const arjun = await asUser(request, USERS.otherCarrier);
    const a = await (await vijay.get('/carrier/me')).json();
    const b = await (await arjun.get('/carrier/me')).json();
    expect(a.company.name).toBe('Kaveri Roadlines');
    expect(b.company.name).toBe('NorthStar Logistics');
    expect(a.company.id).not.toBe(b.company.id);
  });

  test('approvals inbox starts empty and is scoped to the company', async ({ request }) => {
    for (const u of [USERS.carrier, USERS.carrierAccounts, USERS.otherCarrier]) {
      const c = await asUser(request, u);
      const res = await c.get('/carrier/approvals');
      expect(res.status()).toBe(200);
      expect(await res.json()).toEqual({ count: 0, items: [] });
    }
  });

  test('unknown carrier route gives the standard 404 error', async ({ request }) => {
    const vijay = await asUser(request, USERS.carrier);
    const res = await vijay.get('/carrier/no-such-thing');
    expect(res.status()).toBe(404);
    expect((await res.json()).error.code).toBe('NOT_FOUND');
  });
});
