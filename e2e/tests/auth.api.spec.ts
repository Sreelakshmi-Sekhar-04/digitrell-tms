import { expect, test } from '@playwright/test';
import { API_URL } from '../test-env';
import { USERS, apiLogin } from './helpers';

test.describe('Auth API', () => {
  test('health check responds', async ({ request }) => {
    const res = await request.get(API_URL.replace('/api', '/health'));
    expect(res.ok()).toBeTruthy();
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  test('login succeeds with valid shipper credentials and returns company', async ({ request }) => {
    const res = await request.post(`${API_URL}/auth/login`, { data: { email: USERS.shipperHead.email, password: USERS.shipperHead.password } });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.token).toMatch(/^[0-9a-f]{64}$/);
    expect(body.user).toMatchObject({ name: 'Anita Rao', role: 'LOGISTICS_HEAD', companyType: 'SHIPPER', companyName: USERS.shipperHead.company });
    expect(body.user.passwordHash).toBeUndefined();
  });

  test('email is case-insensitive and trimmed', async ({ request }) => {
    const res = await request.post(`${API_URL}/auth/login`, { data: { email: '  ANITA@SunriseFoods.test ', password: USERS.shipperHead.password } });
    expect(res.status()).toBe(200);
  });

  test('missing fields return 400 with field messages', async ({ request }) => {
    const res = await request.post(`${API_URL}/auth/login`, { data: {} });
    expect(res.status()).toBe(400);
    const { error } = await res.json();
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.fields).toEqual({ email: 'Enter your work email.', password: 'Enter your password.' });
  });

  test('badly formed email returns 400', async ({ request }) => {
    const res = await request.post(`${API_URL}/auth/login`, { data: { email: 'anita', password: 'x' } });
    expect(res.status()).toBe(400);
    expect((await res.json()).error.fields.email).toContain('valid email');
  });

  test('wrong password and unknown email give the same 401 message', async ({ request }) => {
    const wrong = await request.post(`${API_URL}/auth/login`, { data: { email: USERS.shipperHead.email, password: 'nope' } });
    const unknown = await request.post(`${API_URL}/auth/login`, { data: { email: 'nobody@sunrisefoods.test', password: 'nope' } });
    expect(wrong.status()).toBe(401);
    expect(unknown.status()).toBe(401);
    expect((await wrong.json()).error.message).toBe((await unknown.json()).error.message);
  });

  test('deactivated user cannot sign in', async ({ request }) => {
    const res = await request.post(`${API_URL}/auth/login`, { data: USERS.inactive });
    expect(res.status()).toBe(401);
  });

  test('malformed JSON body returns 400', async ({ request }) => {
    const res = await request.post(`${API_URL}/auth/login`, { headers: { 'Content-Type': 'application/json' }, data: '{bad json' });
    expect(res.status()).toBe(400);
    expect((await res.json()).error.code).toBe('BAD_JSON');
  });

  test('/me needs a valid token', async ({ request }) => {
    expect((await request.get(`${API_URL}/auth/me`)).status()).toBe(401);
    expect((await request.get(`${API_URL}/auth/me`, { headers: { Authorization: 'Bearer not-a-token' } })).status()).toBe(401);
    const token = await apiLogin(request, USERS.shipperExec);
    const me = await request.get(`${API_URL}/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
    expect(me.status()).toBe(200);
    expect((await me.json()).user).toMatchObject({ name: 'Karthik S', role: 'BOOKING_EXECUTIVE' });
  });

  test('logout ends the session', async ({ request }) => {
    const token = await apiLogin(request, USERS.shipperHead);
    const headers = { Authorization: `Bearer ${token}` };
    expect((await request.post(`${API_URL}/auth/logout`, { headers })).status()).toBe(204);
    expect((await request.get(`${API_URL}/auth/me`, { headers })).status()).toBe(401);
  });

  test('unknown API route returns JSON 404', async ({ request }) => {
    const res = await request.get(`${API_URL}/does-not-exist`);
    expect(res.status()).toBe(404);
    expect((await res.json()).error.code).toBe('NOT_FOUND');
  });
});
