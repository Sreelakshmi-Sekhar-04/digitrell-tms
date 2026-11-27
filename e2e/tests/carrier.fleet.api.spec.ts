import { expect, test } from '@playwright/test';
import { USERS, asUser, uniq } from './helpers';

const day = (n: number) => {
  const d = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const validDocs = { rcExpiry: day(900), insuranceExpiry: day(300), permitExpiry: day(300), fitnessExpiry: day(300), pucExpiry: day(100) };
/** A random valid registration number that won't collide between runs. */
const truckNo = () => `TN${String(10 + Math.floor(Math.random() * 89))}ZZ${String(1000 + Math.floor(Math.random() * 8999))}`;
const mobile = () => `+9197${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
const licence = () => `TN09${String(Math.floor(Math.random() * 1e11)).padStart(11, '0')}`;

test.describe('Carrier fleet API: trucks', () => {
  test('seeded trucks show status from their documents', async ({ request }) => {
    const vijay = await asUser(request, USERS.carrier);
    const { trucks, counts } = await (await vijay.get('/carrier/trucks')).json();
    const by = (n: string) => trucks.find((t: { number: string }) => t.number === n);
    expect(by('TN 09 BX 4471').status).toBe('EXPIRING'); // insurance expires in 3 days
    expect(by('TN 09 BX 4471').note).toContain('Insurance');
    expect(by('TN 10 AZ 2210')).toMatchObject({ status: 'READY', ownership: 'ATTACHED', ownerName: 'Senthil Transports', usualDriver: { name: 'Murugan V' } });
    expect(by('TN 11 CC 9087')).toMatchObject({ status: 'BLOCKED', note: 'Permit expired' });
    expect(trucks[0].status).toBe('BLOCKED'); // problems first
    expect(counts.total).toBeGreaterThanOrEqual(5);
  });

  test('a carrier never sees another carrier’s trucks', async ({ request }) => {
    const vijay = await asUser(request, USERS.carrier);
    const arjun = await asUser(request, USERS.otherCarrier);
    const mine = (await (await vijay.get('/carrier/trucks')).json()).trucks.map((t: { number: string }) => t.number);
    const theirs = (await (await arjun.get('/carrier/trucks')).json()).trucks;
    expect(mine).not.toContain('KA 01 NS 1001');
    expect(theirs.map((t: { number: string }) => t.number)).toEqual(['KA 01 NS 1001']);
    expect((await vijay.patch(`/carrier/trucks/${theirs[0].id}`, { make: 'Hacked' })).status()).toBe(404);
  });

  test('traffic manager adds a truck; number is normalised and formatted', async ({ request }) => {
    const divya = await asUser(request, USERS.carrierTraffic);
    const n = truckNo();
    const res = await divya.post('/carrier/trucks', { number: `${n.slice(0, 2).toLowerCase()} ${n.slice(2, 4)}-${n.slice(4, 6)} ${n.slice(6)}`, truckType: '32ft MXL', ownership: 'OWN', ...validDocs });
    expect(res.status()).toBe(201);
    const { truck } = await res.json();
    expect(truck.number).toBe(`${n.slice(0, 2)} ${n.slice(2, 4)} ${n.slice(4, 6)} ${n.slice(6)}`);
    expect(truck.status).toBe('READY');
    // Same number again, in any spacing, is a duplicate.
    const dup = await divya.post('/carrier/trucks', { number: n, truckType: '32ft MXL', ownership: 'OWN', ...validDocs });
    expect(dup.status()).toBe(409);
    expect((await dup.json()).error.fields.number).toContain('already added');
  });

  test('validation: number format, type, ownership, every document date, attached owner', async ({ request }) => {
    const divya = await asUser(request, USERS.carrierTraffic);
    const res = await divya.post('/carrier/trucks', { number: 'ABC', truckType: 'Lorry', ownership: 'ATTACHED', rcExpiry: '31-12-2027' });
    expect(res.status()).toBe(400);
    const { fields } = (await res.json()).error;
    expect(fields.number).toContain('as on the RC');
    expect(fields.truckType).toContain('valid truck type');
    expect(fields.rcExpiry).toContain('as a date');
    for (const k of ['insuranceExpiry', 'permitExpiry', 'fitnessExpiry', 'pucExpiry']) expect(fields[k], k).toContain('Enter the');
    expect(fields.ownerName).toContain("owner's name");
  });

  test('an expired document blocks the truck; renewing it clears the block', async ({ request }) => {
    const divya = await asUser(request, USERS.carrierTraffic);
    const { truck } = await (await divya.post('/carrier/trucks', { number: truckNo(), truckType: '19ft', ownership: 'OWN', ...validDocs, fitnessExpiry: day(-1) })).json();
    expect(truck).toMatchObject({ status: 'BLOCKED', note: 'Fitness expired' });
    const fixed = await (await divya.patch(`/carrier/trucks/${truck.id}`, { fitnessExpiry: day(400) })).json();
    expect(fixed.truck.status).toBe('READY');
    const soon = await (await divya.patch(`/carrier/trucks/${truck.id}`, { pucExpiry: day(10) })).json();
    expect(soon.truck.status).toBe('EXPIRING');
  });

  test('owner (without traffic manager role) and accounts can view but not change trucks', async ({ request }) => {
    const arjun = await asUser(request, USERS.otherCarrier); // owner only
    const suresh = await asUser(request, USERS.carrierAccounts);
    expect((await suresh.get('/carrier/trucks')).status()).toBe(200);
    for (const u of [arjun, suresh]) {
      const res = await u.post('/carrier/trucks', { number: truckNo(), truckType: '19ft', ownership: 'OWN', ...validDocs });
      expect(res.status()).toBe(403);
      expect((await res.json()).error.message).toBe('Only the traffic manager can change trucks and drivers.');
    }
  });

  test('deactivate and reactivate; deactivated trucks are hidden unless asked for', async ({ request }) => {
    const divya = await asUser(request, USERS.carrierTraffic);
    const { truck } = await (await divya.post('/carrier/trucks', { number: truckNo(), truckType: '19ft', ownership: 'OWN', ...validDocs })).json();
    expect((await (await divya.patch(`/carrier/trucks/${truck.id}`, { isActive: false })).json()).truck.status).toBe('INACTIVE');
    const visible = (await (await divya.get('/carrier/trucks')).json()).trucks.map((t: { id: string }) => t.id);
    const all = (await (await divya.get('/carrier/trucks?includeInactive=true')).json()).trucks.map((t: { id: string }) => t.id);
    expect(visible).not.toContain(truck.id);
    expect(all).toContain(truck.id);
    expect((await (await divya.patch(`/carrier/trucks/${truck.id}`, { isActive: true })).json()).truck.status).toBe('READY');
  });
});

test.describe('Carrier fleet API: drivers', () => {
  test('seeded drivers: licence rules and UPI state', async ({ request }) => {
    const divya = await asUser(request, USERS.carrierTraffic);
    const { drivers } = await (await divya.get('/carrier/drivers')).json();
    const by = (n: string) => drivers.find((d: { name: string }) => d.name === n);
    expect(by('Ramesh K')).toMatchObject({ status: 'FREE', licenceClass: 'HGMV', upi: { id: 'ramesh.k@okaxis', verified: true } });
    expect(by('Murugan V').upi.verified).toBe(false);
    expect(by('Selvam P')).toMatchObject({ status: 'BLOCKED', note: 'Licence expired' });
    expect(drivers.map((d: { name: string }) => d.name)).not.toContain('Harish B'); // NorthStar's driver
  });

  test('add a driver: validation, then save; duplicate mobile refused', async ({ request }) => {
    const divya = await asUser(request, USERS.carrierTraffic);
    const bad = await divya.post('/carrier/drivers', { name: '', phone: '123', licenceNumber: 'X1', licenceClass: 'BUS', licenceExpiry: 'soon', upiId: 'no-at-sign' });
    expect(bad.status()).toBe(400);
    const f = (await bad.json()).error.fields;
    expect(Object.keys(f).sort()).toEqual(['licenceClass', 'licenceExpiry', 'licenceNumber', 'name', 'phone', 'upiId']);

    const phone = mobile();
    const ok = await divya.post('/carrier/drivers', { name: `Driver ${uniq()}`, phone, licenceNumber: licence(), licenceClass: 'HMV', licenceExpiry: day(700), language: 'ta', upiId: 'New.Driver@OKSBI' });
    expect(ok.status()).toBe(201);
    const { driver } = await ok.json();
    expect(driver).toMatchObject({ status: 'FREE', upi: { id: 'new.driver@oksbi', verified: false, pending: null } });
    expect((await divya.post('/carrier/drivers', { name: 'Twin', phone, licenceNumber: licence(), licenceClass: 'HMV', licenceExpiry: day(700) })).status()).toBe(409);
  });

  test('UPI change needs a second person; the requester cannot approve it', async ({ request }) => {
    const divya = await asUser(request, USERS.carrierTraffic);
    const vijay = await asUser(request, USERS.carrier);
    const { driver } = await (await divya.post('/carrier/drivers', { name: `Upi ${uniq()}`, phone: mobile(), licenceNumber: licence(), licenceClass: 'HGMV', licenceExpiry: day(700), upiId: 'first@okaxis' })).json();

    // First ID is saved straight away (unverified). Verify needs a reference.
    expect((await divya.post(`/carrier/drivers/${driver.id}/upi/verify`, {})).status()).toBe(400);
    const verified = await (await divya.post(`/carrier/drivers/${driver.id}/upi/verify`, { reference: '432198765012' })).json();
    expect(verified.driver.upi.verified).toBe(true);

    // Changing it waits for someone else.
    const changed = await (await divya.patch(`/carrier/drivers/${driver.id}`, { upiId: 'second@okhdfc' })).json();
    expect(changed.driver.upi).toMatchObject({ id: 'first@okaxis', verified: true, pending: { upiId: 'second@okhdfc', byMe: true } });
    const self = await divya.post(`/carrier/drivers/${driver.id}/upi/approve`);
    expect(self.status()).toBe(403);
    expect((await self.json()).error.message).toContain('someone else must approve');

    const approved = await (await vijay.post(`/carrier/drivers/${driver.id}/upi/approve`)).json();
    expect(approved.driver.upi).toMatchObject({ id: 'second@okhdfc', verified: false, pending: null }); // must be verified again
    expect((await vijay.post(`/carrier/drivers/${driver.id}/upi/approve`)).status()).toBe(400); // nothing pending
  });

  test('a UPI change can be rejected, and a UPI ID cannot be removed', async ({ request }) => {
    const divya = await asUser(request, USERS.carrierTraffic);
    const vijay = await asUser(request, USERS.carrier);
    const { driver } = await (await divya.post('/carrier/drivers', { name: `Rej ${uniq()}`, phone: mobile(), licenceNumber: licence(), licenceClass: 'HGMV', licenceExpiry: day(700), upiId: 'keep@okaxis' })).json();
    await divya.patch(`/carrier/drivers/${driver.id}`, { upiId: 'fraud@okaxis' });
    const rejected = await (await vijay.post(`/carrier/drivers/${driver.id}/upi/reject`)).json();
    expect(rejected.driver.upi).toMatchObject({ id: 'keep@okaxis', pending: null });
    expect((await divya.patch(`/carrier/drivers/${driver.id}`, { upiId: '' })).status()).toBe(400);
  });

  test('accounts can view drivers and verify UPI, but not edit drivers or approve changes', async ({ request }) => {
    const suresh = await asUser(request, USERS.carrierAccounts);
    const divya = await asUser(request, USERS.carrierTraffic);
    const { driver } = await (await divya.post('/carrier/drivers', { name: `Acc ${uniq()}`, phone: mobile(), licenceNumber: licence(), licenceClass: 'HGMV', licenceExpiry: day(700), upiId: 'acc@okaxis' })).json();
    expect((await suresh.patch(`/carrier/drivers/${driver.id}`, { name: 'X' })).status()).toBe(403);
    expect((await suresh.post(`/carrier/drivers/${driver.id}/upi/verify`, { reference: 'UTR1234567' })).status()).toBe(200);
    await divya.patch(`/carrier/drivers/${driver.id}`, { upiId: 'acc2@okaxis' });
    expect((await suresh.post(`/carrier/drivers/${driver.id}/upi/approve`)).status()).toBe(403);
  });
});

test.describe('Carrier setup API: rate cards', () => {
  test('seeded rate cards with band, margin and status; expired lines listed last', async ({ request }) => {
    const suresh = await asUser(request, USERS.carrierAccounts);
    const { rateCards } = await (await suresh.get('/carrier/rate-cards')).json();
    const cb = rateCards.find((r: { origin: string; destination: string }) => r.origin === 'Chennai' && r.destination === 'Bengaluru');
    expect(cb).toMatchObject({ shipper: { name: 'Sunrise Foods Pvt Ltd' }, rate: 42500, bandPct: 5, bandLow: 40375, bandHigh: 44625, marginPct: 10.6, status: 'ACTIVE' });
    expect(rateCards.find((r: { origin: string }) => r.origin === 'Pune').shipper).toBeNull(); // any shipper
    expect(rateCards[rateCards.length - 1]).toMatchObject({ destination: 'Madurai', status: 'EXPIRED' });
  });

  test('owner adds a rate; overlapping dates for the same lane are refused', async ({ request }) => {
    const vijay = await asUser(request, USERS.carrier);
    const city = `Salem${uniq()}`;
    const base = { shipperId: null, origin: 'Chennai', destination: city, truckType: '20ft SXL', rate: '39,000', bandPct: 4, tripCost: 35000, validFrom: day(0), validTo: day(200) };
    const ok = await vijay.post('/carrier/rate-cards', base);
    expect(ok.status()).toBe(201);
    expect((await ok.json()).rateCard).toMatchObject({ rate: 39000, bandLow: 37440, bandHigh: 40560, marginPct: 10.3 });
    const clash = await vijay.post('/carrier/rate-cards', { ...base, validFrom: day(100), validTo: day(300) });
    expect(clash.status()).toBe(409);
    expect((await clash.json()).error.fields.validFrom).toContain('overlap');
    // After the first one ends, a new one is fine.
    expect((await vijay.post('/carrier/rate-cards', { ...base, validFrom: day(201), validTo: day(400) })).status()).toBe(201);
  });

  test('rate validation: dates in order, cost below rate, band range, shipper must be one of mine', async ({ request }) => {
    const vijay = await asUser(request, USERS.carrier);
    const res = await vijay.post('/carrier/rate-cards', { shipperId: 'not-mine', origin: 'Pune', destination: 'pune', truckType: '19ft', rate: 20000, bandPct: 40, tripCost: 25000, validFrom: day(10), validTo: day(5) });
    expect(res.status()).toBe(400);
    const f = (await res.json()).error.fields;
    expect(f.shipperId).toContain('shipper you work with');
    expect(f.destination).toContain('different');
    expect(f.bandPct).toContain('between 0 and 25');
    expect(f.tripCost).toContain('below the rate');
    expect(f.validTo).toContain('on or after');
  });

  test('only the owner changes rates; others are told who can', async ({ request }) => {
    const divya = await asUser(request, USERS.carrierTraffic);
    const res = await divya.post('/carrier/rate-cards', { origin: 'A', destination: 'B', truckType: '19ft', rate: 1000, bandPct: 5, validFrom: day(0), validTo: day(10) });
    expect(res.status()).toBe(403);
    expect((await res.json()).error.message).toContain('Only the owner');
  });
});

test.describe('Carrier setup API: profile, policies, users', () => {
  test('profile: seeded values; no LR series (the shipper issues LRs)', async ({ request }) => {
    const vijay = await asUser(request, USERS.carrier);
    const { profile } = await (await vijay.get('/carrier/profile')).json();
    expect(profile).toMatchObject({ gstin: '33AAKFK1234M1Z8', pan: 'AAKFK1234M', gstOption: 'RCM', tdsDeclared: true, missing: [] });
    expect(profile).not.toHaveProperty('lrSeries');
  });

  test('profile validation: GSTIN, PAN must match it, IFSC, account number', async ({ request }) => {
    const arjun = await asUser(request, USERS.otherCarrier);
    const res = await arjun.put('/carrier/profile', { gstin: '29AABCN1234P1Z2', pan: 'ZZZZZ9999Z', bankAccountNo: '12', bankIfsc: 'HDFC1234' });
    expect(res.status()).toBe(400);
    const f = (await res.json()).error.fields;
    expect(f.pan).toContain('does not match the GSTIN');
    expect(f.bankAccountNo).toContain('9 to 18 digits');
    expect(f.bankIfsc).toContain('11-character IFSC');
    const ok = await arjun.put('/carrier/profile', { gstin: '29AABCN1234P1Z2', pan: 'AABCN1234P', gstOption: 'FCM' });
    expect(ok.status()).toBe(200);
    expect((await ok.json()).profile).toMatchObject({ pan: 'AABCN1234P' });
  });

  test('profile is owner-only to change', async ({ request }) => {
    const suresh = await asUser(request, USERS.carrierAccounts);
    expect((await suresh.get('/carrier/profile')).status()).toBe(200);
    expect((await suresh.put('/carrier/profile', { address: 'X' })).status()).toBe(403);
  });

  test('policies: defaults, owner saves, values checked, others cannot', async ({ request }) => {
    const vijay = await asUser(request, USERS.carrier);
    const divya = await asUser(request, USERS.carrierTraffic);
    const { policy } = await (await divya.get('/carrier/policies')).json();
    expect(policy).toMatchObject({ bandPct: 5, marginFloorPct: 8, invoiceApprovalAbove: 25000, autonomy: { quote: 1, truckAssignment: 1, documents: 2, billing: 0 } });
    expect((await divya.put('/carrier/policies', { bandPct: 6 })).status()).toBe(403);

    const bad = await vijay.put('/carrier/policies', { bandPct: 30, marginFloorPct: -1, invoiceApprovalAbove: 0, autonomy: { quote: 5 }, backupApproverId: 'nobody' });
    expect(bad.status()).toBe(400);
    expect(Object.keys((await bad.json()).error.fields).sort()).toEqual(['autonomy.quote', 'backupApproverId', 'bandPct', 'invoiceApprovalAbove', 'marginFloorPct']);

    const divyaId = policy.approvers.find((a: { name: string }) => a.name === 'Divya R').id;
    const saved = await (await vijay.put('/carrier/policies', { bandPct: 6, autonomy: { quote: 2 }, backupApproverId: divyaId })).json();
    expect(saved.policy).toMatchObject({ bandPct: 6, backupApproverId: divyaId, autonomy: { quote: 2, truckAssignment: 1 } });
    await vijay.put('/carrier/policies', { bandPct: 5, autonomy: { quote: 1 }, backupApproverId: null }); // restore
  });

  test('users: owner invites with several roles; guards keep an owner', async ({ request }) => {
    const vijay = await asUser(request, USERS.carrier);
    const bad = await vijay.post('/carrier/users', { name: 'X', phone: mobile(), roles: [] });
    expect((await bad.json()).error.fields.roles).toContain('at least one role');

    const res = await vijay.post('/carrier/users', { name: `Desk ${uniq()}`, phone: mobile(), roles: ['ACCOUNTS', 'TRAFFIC_MANAGER'] });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.user).toMatchObject({ roles: ['TRAFFIC_MANAGER', 'ACCOUNTS'], status: 'INVITED' });
    expect(body.invitePath).toMatch(/^\/invite\/[0-9a-f]{64}$/);

    const me = (await (await vijay.get('/carrier/users')).json()).users.find((u: { name: string }) => u.name === 'Vijay Kumar');
    expect((await vijay.patch(`/carrier/users/${me.id}`, { roles: ['TRAFFIC_MANAGER'] })).status()).toBe(400);
    expect((await vijay.patch(`/carrier/users/${me.id}`, { isActive: false })).status()).toBe(400);
    const divya = await asUser(request, USERS.carrierTraffic);
    expect((await divya.post('/carrier/users', { name: 'Y', phone: mobile(), roles: ['OWNER'] })).status()).toBe(403);
  });
});
