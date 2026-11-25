import { expect, test } from '@playwright/test';
import { API_URL } from '../test-env';
import { USERS } from './helpers';

test.describe('Security hardening', () => {
  test('repeated failed sign-ins for one email are throttled; other emails are unaffected', async ({ request }) => {
    const email = `throttle.${Date.now()}@sunrisefoods.test`;
    for (let i = 0; i < 5; i++) {
      expect((await request.post(`${API_URL}/auth/login`, { data: { email, password: 'wrong' } })).status()).toBe(401);
    }
    const locked = await request.post(`${API_URL}/auth/login`, { data: { email, password: 'wrong' } });
    expect(locked.status()).toBe(429);
    expect((await locked.json()).error.message).toContain('Too many failed sign-ins');
    expect((await request.post(`${API_URL}/auth/login`, { data: USERS.shipperExec })).status()).toBe(200);
  });

  test('a successful sign-in clears earlier failures', async ({ request }) => {
    for (let i = 0; i < 4; i++) await request.post(`${API_URL}/auth/login`, { data: { email: USERS.shipperHead.email, password: 'wrong' } });
    expect((await request.post(`${API_URL}/auth/login`, { data: USERS.shipperHead })).status()).toBe(200);
    for (let i = 0; i < 4; i++) await request.post(`${API_URL}/auth/login`, { data: { email: USERS.shipperHead.email, password: 'wrong' } });
    expect((await request.post(`${API_URL}/auth/login`, { data: USERS.shipperHead })).status()).toBe(200);
  });

  test('responses carry basic security headers and no framework banner', async ({ request }) => {
    const res = await request.get(API_URL.replace('/api', '/health'));
    const h = res.headers();
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['x-frame-options']).toBe('DENY');
    expect(h['referrer-policy']).toBe('no-referrer');
    expect(h['x-powered-by']).toBeUndefined();
  });

  test('passwords, hashes and invite tokens never appear in API responses', async ({ request }) => {
    const login = await (await request.post(`${API_URL}/auth/login`, { data: USERS.shipperHead })).json();
    const headers = { Authorization: `Bearer ${login.token}` };
    const users = await (await request.get(`${API_URL}/users`, { headers })).text();
    for (const secret of ['passwordHash', 'inviteToken', 'scrypt$']) expect(users).not.toContain(secret);
    expect(JSON.stringify(login.user)).not.toContain('passwordHash');
  });
});
