import { expect, test } from '@playwright/test';
import { API_URL } from '../test-env';
import { USERS, asUser } from './helpers';

// The WhatsApp bot was removed: no channel choice, no intake agent, no bot endpoints.
test.describe('WhatsApp bot removed (API)', () => {
  test('My messages has no channel; a channel sent anyway is ignored', async ({ request }) => {
    const karthik = await asUser(request, USERS.shipperExec);
    const res = await karthik.put('/profile/messages', { language: 'en', channel: 'whatsapp', quietHours: '', prefs: {} });
    expect(res.status()).toBe(200);
    expect((await res.json()).messages).not.toHaveProperty('channel');
    expect((await (await karthik.get('/profile/messages')).json()).messages).not.toHaveProperty('channel');
  });

  test('users have no channel, and a new user needs an email (it is how they sign in and get updates)', async ({ request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const { users } = await (await anita.get('/users')).json();
    expect(users.length).toBeGreaterThan(0);
    for (const u of users) expect(u).not.toHaveProperty('channel');

    const phone = `96${Math.floor(10000000 + Math.random() * 89999999)}`;
    const noEmail = await anita.post('/users', { name: 'No Email', phone, role: 'BOOKING_EXECUTIVE', channel: 'whatsapp' });
    expect(noEmail.status()).toBe(400);
    expect((await noEmail.json()).error.fields).toEqual({ email: 'Enter their email.' });

    const me = users.find((u: { email: string }) => u.email === USERS.shipperHead.email);
    const clear = await anita.patch(`/users/${me.id}`, { email: '' });
    expect(clear.status()).toBe(400);
    expect((await clear.json()).error.fields.email).toBe('Enter their email.');
  });

  test('policies list only the tender, bid evaluation and billing agents', async ({ request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const { policy } = await (await anita.get('/policies')).json();
    expect(Object.keys(policy.autonomy).sort()).toEqual(['bidEvaluation', 'billing', 'tender']);
    expect(Object.keys(policy.maxAutonomy).sort()).toEqual(['bidEvaluation', 'billing', 'tender']);
  });

  test('the activity log has no channel column', async ({ request }) => {
    const anita = await asUser(request, USERS.demoHead);
    const { entries } = await (await anita.get('/activity?days=90')).json();
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) expect(e).not.toHaveProperty('channel');
    const csv = await (await anita.get('/activity/export.csv')).text();
    expect(csv.replace(/^﻿/, '').split('\r\n')[0]).toBe('Time (IST),Who,Action,Record,Reason');
  });

  test('there are no bot or WhatsApp endpoints', async ({ request }) => {
    for (const path of ['/bot', '/bot/messages', '/webhooks/whatsapp', '/whatsapp/webhook', '/integration/whatsapp']) {
      const get = await request.get(`${API_URL}${path}`, { headers: { 'x-integration-key': 'dev-integration-key' } });
      const post = await request.post(`${API_URL}${path}`, { headers: { 'x-integration-key': 'dev-integration-key' }, data: {} });
      expect([get.status(), post.status()], path).toEqual([404, 404]);
    }
  });
});
