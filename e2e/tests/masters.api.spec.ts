import { expect, test } from '@playwright/test';
import { API_URL } from '../test-env';
import { USERS, asUser, uniq } from './helpers';

test.describe('Masters API: access', () => {
  test('all master routes need a signed-in shipper', async ({ request }) => {
    for (const path of ['/addresses', '/carriers', '/lanes', '/users', '/policies']) {
      expect((await request.get(`${API_URL}${path}`)).status(), path).toBe(401);
    }
    const carrier = await asUser(request, USERS.carrier);
    expect((await carrier.get('/lanes')).status()).toBe(403);
  });

  test("a shipper never sees another shipper's data", async ({ request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const meera = await asUser(request, USERS.otherShipper);
    const anitaLanes = (await (await anita.get('/lanes')).json()).lanes;
    const meeraLanes = (await (await meera.get('/lanes')).json()).lanes;
    expect(anitaLanes.map((l: { origin: string }) => l.origin)).not.toContain('Kochi');
    expect(meeraLanes.map((l: { origin: string }) => l.origin)).toEqual(['Kochi']);

    const ambattur = (await (await anita.get('/addresses')).json()).addresses.find((a: { name: string }) => a.name === 'Ambattur DC');
    expect((await meera.patch(`/addresses/${ambattur.id}`, { city: 'Hacked' })).status()).toBe(404);
    expect((await meera.patch(`/lanes/${anitaLanes[0].id}`, { isActive: false })).status()).toBe(404);
    const anitaUsers = (await (await anita.get('/users')).json()).users;
    expect((await meera.patch(`/users/${anitaUsers[0].id}`, { isActive: false })).status()).toBe(404);
  });

  test('booking executive can manage addresses but not lanes, carriers, users or policies', async ({ request }) => {
    const karthik = await asUser(request, USERS.shipperExec);
    const add = await karthik.post('/addresses', { name: `Guindy Store ${uniq()}`, city: 'Chennai', line1: 'Mount Road', kind: 'DROP' });
    expect(add.status()).toBe(201);
    expect((await karthik.post('/lanes', { origin: 'Chennai', destination: 'Madurai', truckType: '14ft' })).status()).toBe(403);
    expect((await karthik.post('/carriers', { name: 'X', phone: '9876500000' })).status()).toBe(403);
    expect((await karthik.post('/users', { name: 'X', phone: '9876500001', role: 'BOOKING_EXECUTIVE' })).status()).toBe(403);
    expect((await karthik.put('/policies', { paymentApprovalAbove: 1, quoteWindowHours: 2, podRule: 'DIGITAL' })).status()).toBe(403);
    expect((await karthik.get('/policies')).status()).toBe(200);
  });
});

test.describe('Addresses API', () => {
  test('create, normalise phone, edit, deactivate and list', async ({ request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const name = `Sriperumbudur Hub ${uniq()}`;
    const res = await anita.post('/addresses', { name, city: ' Chennai ', line1: 'SIPCOT,  Phase 1', kind: 'PICKUP', contactPhone: '098765-43210' });
    expect(res.status()).toBe(201);
    const { address } = await res.json();
    expect(address).toMatchObject({ name, city: 'Chennai', line1: 'SIPCOT, Phase 1', contactPhone: '+919876543210', isActive: true });

    const edit = await anita.patch(`/addresses/${address.id}`, { hours: '24 h' });
    expect((await edit.json()).address.hours).toBe('24 h');

    await anita.patch(`/addresses/${address.id}`, { isActive: false });
    const active = (await (await anita.get('/addresses')).json()).addresses;
    expect(active.find((a: { id: string }) => a.id === address.id)).toBeUndefined();
    const all = (await (await anita.get('/addresses?includeInactive=true')).json()).addresses;
    expect(all.find((a: { id: string }) => a.id === address.id).isActive).toBe(false);
  });

  test('missing and invalid fields come back together', async ({ request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const res = await anita.post('/addresses', { contactPhone: '12345' });
    expect(res.status()).toBe(400);
    const { fields } = (await res.json()).error;
    expect(Object.keys(fields).sort()).toEqual(['city', 'contactPhone', 'kind', 'line1', 'name']);
  });

  test('duplicate name (any case) is refused with 409', async ({ request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const res = await anita.post('/addresses', { name: 'ambattur dc', city: 'Chennai', line1: 'x', kind: 'PICKUP' });
    expect(res.status()).toBe(409);
    expect((await res.json()).error.fields.name).toContain('already used');
  });
});

test.describe('Lanes and carriers API', () => {
  test('create a lane with approved carriers; city names are tidied', async ({ request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const carriers = (await (await anita.get('/carriers')).json()).carriers;
    const kaveri = carriers.find((c: { name: string }) => c.name === 'Kaveri Roadlines');
    // A budget or award rule sent by an older client is ignored: prices come from the rate cards and awards need the shipper's approval.
    const res = await anita.post('/lanes', { origin: 'chennai', destination: 'madurai', truckType: '14ft', budget: '18,500', awardRule: 'AUTO_LOWEST', carrierIds: [kaveri.id] });
    expect(res.status()).toBe(201);
    const { lane } = await res.json();
    expect(lane).toMatchObject({ origin: 'Chennai', destination: 'Madurai', truckType: '14ft' });
    expect(lane).not.toHaveProperty('budget');
    expect(lane).not.toHaveProperty('awardRule');
    expect(lane.carriers.map((c: { name: string }) => c.name)).toEqual(['Kaveri Roadlines']);
  });

  test('duplicate lane is refused', async ({ request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const res = await anita.post('/lanes', { origin: 'CHENNAI', destination: 'Bengaluru', truckType: '32ft MXL' });
    expect(res.status()).toBe(409);
  });

  test('lane rules: same city, unknown truck type, unknown carrier', async ({ request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const res = await anita.post('/lanes', { origin: 'Pune', destination: 'pune', truckType: '99ft', carrierIds: ['nope'] });
    expect(res.status()).toBe(400);
    const { fields } = (await res.json()).error;
    expect(fields.destination).toContain('must differ');
    expect(fields.truckType).toBeTruthy();
    expect(fields.carrierIds).toContain('not in your carrier list');
    expect(fields.budget).toBeUndefined();
  });

  test('a lane can be saved without carriers: offers come from the rate cards, not from the lane', async ({ request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const res = await anita.post('/lanes', { origin: 'Salem', destination: 'Erode', truckType: '17ft', awardRule: 'AUTO_LOWEST', carrierIds: [] });
    expect(res.status(), await res.text()).toBe(201);
    const { lane } = await res.json();
    expect(lane.carriers).toEqual([]);
    expect(lane).not.toHaveProperty('awardRule');
  });

  test("a carrier outside the shipper's own carrier list can't be approved on a lane", async ({ request }) => {
    const meera = await asUser(request, USERS.otherShipper);
    const anita = await asUser(request, USERS.shipperHead);
    const kaveri = (await (await anita.get('/carriers')).json()).carriers.find((c: { name: string }) => c.name === 'Kaveri Roadlines');
    expect((await (await meera.get('/carriers')).json()).carriers.map((c: { name: string }) => c.name)).not.toContain('Kaveri Roadlines');
    const res = await meera.post('/lanes', { origin: 'Kochi', destination: 'Madurai', truckType: '19ft', carrierIds: [kaveri.id] });
    expect(res.status()).toBe(400);
    expect((await res.json()).error.fields.carrierIds).toContain('not in your carrier list');
  });

  test('edit replaces approved carriers; deactivate keeps the lane', async ({ request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const carriers = (await (await anita.get('/carriers')).json()).carriers;
    const byName = (n: string) => carriers.find((c: { name: string }) => c.name === n).id;
    const deccan = { id: byName('Deccan Freight Carriers') };
    // Its own lane, so the seeded lanes stay as they are for the booking tests.
    const created = await anita.post('/lanes', { origin: 'Nashik', destination: 'Surat', truckType: '22ft', carrierIds: [byName('Kaveri Roadlines'), byName('NorthStar Logistics')] });
    const { lane } = await created.json();
    const res = await anita.patch(`/lanes/${lane.id}`, { carrierIds: [deccan.id], isActive: false });
    expect(res.status()).toBe(200);
    const { lane: updated } = await res.json();
    expect(updated.carriers.map((c: { name: string }) => c.name)).toEqual(['Deccan Freight Carriers']);
    expect(updated.isActive).toBe(false);
    expect(updated).toMatchObject({ origin: 'Nashik', destination: 'Surat', truckType: '22ft' }); // untouched fields stay
  });

  test('add a carrier not on DigitRell; duplicates by name or phone refused', async ({ request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const phone = `98${Math.floor(10000000 + Math.random() * 89999999)}`;
    const res = await anita.post('/carriers', { name: `Velan Transports ${uniq()}`, phone });
    expect(res.status()).toBe(201);
    expect((await res.json()).carrier.status).toBe('INVITED');
    expect((await anita.post('/carriers', { name: 'kaveri roadlines', phone: '9000000001' })).status()).toBe(409);
    const byPhone = await anita.post('/carriers', { name: 'Another Name', phone });
    expect(byPhone.status()).toBe(409);
    expect((await byPhone.json()).error.fields.phone).toContain('belongs to');
  });
});

test.describe('Users and invites API', () => {
  test('invite → open link → set password → signed in → link no longer works', async ({ request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const email = `rahul.${uniq()}@sunrisefoods.test`;
    const res = await anita.post('/users', { name: 'Rahul Menon', phone: `97${Math.floor(10000000 + Math.random() * 89999999)}`, email, role: 'APPROVER', approvalLimit: 75000, language: 'ml' });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.user).toMatchObject({ status: 'INVITED', approvalLimit: 75000, role: 'APPROVER' });
    const token = body.invitePath.split('/').pop();

    const info = await request.get(`${API_URL}/invites/${token}`);
    expect((await info.json()).invite).toMatchObject({ name: 'Rahul Menon', companyName: USERS.shipperHead.company });

    const weak = await request.post(`${API_URL}/invites/${token}`, { data: { password: 'short' } });
    expect(weak.status()).toBe(400);
    const ok = await request.post(`${API_URL}/invites/${token}`, { data: { password: 'Sunrise2026' } });
    expect(ok.status()).toBe(200);
    expect((await ok.json()).user.email).toBe(email);
    expect((await request.get(`${API_URL}/invites/${token}`)).status()).toBe(404);
    expect((await request.post(`${API_URL}/auth/login`, { data: { email, password: 'Sunrise2026' } })).status()).toBe(200);
  });

  test('role and limit rules', async ({ request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const phone = () => `96${Math.floor(10000000 + Math.random() * 89999999)}`;
    const noLimit = await anita.post('/users', { name: 'A', phone: phone(), role: 'APPROVER' });
    expect((await noLimit.json()).error.fields.approvalLimit).toContain('Set how much');
    const execWithLimit = await anita.post('/users', { name: 'B', phone: phone(), role: 'BOOKING_EXECUTIVE', approvalLimit: 1000 });
    expect((await execWithLimit.json()).error.fields.approvalLimit).toContain('cannot approve');
    const aboveMine = await anita.post('/users', { name: 'C', phone: phone(), role: 'APPROVER', approvalLimit: 500000 });
    expect((await aboveMine.json()).error.fields.approvalLimit).toContain('₹2,00,000');
  });

  test('duplicate email or mobile is refused', async ({ request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const dupEmail = await anita.post('/users', { name: 'X', phone: '9555512345', email: USERS.shipperExec.email, role: 'BOOKING_EXECUTIVE' });
    expect(dupEmail.status()).toBe(409);
    const dupPhone = await anita.post('/users', { name: 'X', phone: '98000 00002', email: `x.${Date.now()}@sunrisefoods.test`, role: 'BOOKING_EXECUTIVE' });
    expect(dupPhone.status()).toBe(409);
  });

  test('cannot deactivate yourself; deactivating someone signs them out', async ({ request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const users = (await (await anita.get('/users')).json()).users;
    const me = users.find((u: { name: string }) => u.name === 'Anita Rao');
    expect((await anita.patch(`/users/${me.id}`, { isActive: false })).status()).toBe(400);
    expect((await anita.patch(`/users/${me.id}`, { role: 'APPROVER' })).status()).toBe(400);

    const email = `temp.${uniq()}@sunrisefoods.test`;
    const created = await (await anita.post('/users', { name: 'Temp User', phone: `95${Math.floor(10000000 + Math.random() * 89999999)}`, email, role: 'BOOKING_EXECUTIVE' })).json();
    const token = created.invitePath.split('/').pop();
    const session = (await (await request.post(`${API_URL}/invites/${token}`, { data: { password: 'Temp12345' } })).json()).token;
    expect((await request.get(`${API_URL}/auth/me`, { headers: { Authorization: `Bearer ${session}` } })).status()).toBe(200);
    await anita.patch(`/users/${created.user.id}`, { isActive: false });
    expect((await request.get(`${API_URL}/auth/me`, { headers: { Authorization: `Bearer ${session}` } })).status()).toBe(401);
  });

  test('a new invite link replaces the old one', async ({ request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const created = await (await anita.post('/users', { name: 'Late Joiner', phone: `94${Math.floor(10000000 + Math.random() * 89999999)}`, email: `late.${uniq()}@sunrisefoods.test`, role: 'BOOKING_EXECUTIVE' })).json();
    const oldToken = created.invitePath.split('/').pop();
    const again = await (await anita.post(`/users/${created.user.id}/invite`)).json();
    expect(again.invitePath).not.toBe(created.invitePath);
    expect((await request.get(`${API_URL}/invites/${oldToken}`)).status()).toBe(404);
  });
});

test.describe('Policies API', () => {
  test('defaults, save, and Release 1 limits on autonomy', async ({ request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const { policy } = await (await anita.get('/policies')).json();
    expect(policy).toMatchObject({ paymentApprovalAbove: 50000, quoteWindowHours: 2, podRule: 'DIGITAL', autonomy: { tender: 2, bidEvaluation: 1, billing: 1 } });

    const saved = await anita.put('/policies', { paymentApprovalAbove: '75,000', quoteWindowHours: 3, podRule: 'BOTH', autonomy: { billing: 2, tender: 0 } });
    expect(saved.status()).toBe(200);
    expect((await saved.json()).policy).toMatchObject({ paymentApprovalAbove: 75000, quoteWindowHours: 3, podRule: 'BOTH', autonomy: { tender: 0, bidEvaluation: 1, billing: 2 } });

    const autoAward = await anita.put('/policies', { paymentApprovalAbove: 75000, quoteWindowHours: 3, podRule: 'BOTH', autonomy: { bidEvaluation: 2 } });
    expect(autoAward.status()).toBe(400);
    expect((await autoAward.json()).error.fields['autonomy.bidEvaluation']).toContain('always asks');

    const bad = await anita.put('/policies', { paymentApprovalAbove: 0, quoteWindowHours: 99, podRule: 'FAX' });
    expect(Object.keys((await bad.json()).error.fields).sort()).toEqual(['paymentApprovalAbove', 'podRule', 'quoteWindowHours']);

    // put it back for the UI tests
    await anita.put('/policies', { paymentApprovalAbove: 50000, quoteWindowHours: 2, podRule: 'DIGITAL', autonomy: { tender: 2, bidEvaluation: 1, billing: 1 } });
  });
});
