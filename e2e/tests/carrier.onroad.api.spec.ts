import { expect, test } from '@playwright/test';
import { USERS, asUser } from './helpers';
import { assignedTrip, deliveredByCarrier, freshFleet, loadedTrip, readyTrip } from './lr.helpers';
import { refs, setPolicy, shipperHead } from './trips.helpers';

const INVOICE_NO = /^[A-Z0-9]+\/\d{2}-\d{2}\/\d{4}$/;
const detail = async (c: Awaited<ReturnType<typeof asUser>>, id: string) => (await (await c.get(`/carrier/loads/${id}`)).json()).load;
const shipperTrip = async (c: Awaited<ReturnType<typeof asUser>>, id: string) => (await (await c.get(`/trips/${id}`)).json()).trip;
const errCode = async (res: { json(): Promise<any> }) => (await res.json()).error.code;

test.describe('Carrier journey API: the whole load, no integration endpoints', () => {
  test('book, accept, assign, shipper LR, events, delivered, POD, shipper accepts, invoice, approve and pay, closed', async ({ request }) => {
    const anita = await shipperHead(request);
    await setPolicy(anita);
    const vijay = await asUser(request, USERS.carrier);
    const divya = await asUser(request, USERS.carrierTraffic);

    const trip = await assignedTrip(request, anita, await refs(anita));
    expect(await detail(vijay, trip.id)).toMatchObject({ label: 'Truck assigned', nextStep: 'Waiting for the shipper to issue the LR' });
    const lrNumber = (await (await anita.post(`/trips/${trip.id}/lr`, {})).json()).lrNumber as string;
    expect(await detail(vijay, trip.id)).toMatchObject({ label: 'Ready for pickup', nextStep: expect.stringContaining('record Reached pickup') });

    // Order is enforced.
    const early = await divya.post(`/carrier/loads/${trip.id}/events`, { type: 'LOADED', eta: new Date(Date.now() + 86400_000).toISOString() });
    expect(early.status()).toBe(409);
    expect(await errCode(early)).toBe('OUT_OF_ORDER');
    expect((await divya.post(`/carrier/loads/${trip.id}/events`, { type: 'REACHED_PICKUP', location: 'Chakan' })).status()).toBe(200);
    expect(await errCode(await divya.post(`/carrier/loads/${trip.id}/events`, { type: 'REACHED_PICKUP' }))).toBe('ALREADY_RECORDED');
    expect(await detail(vijay, trip.id)).toMatchObject({ nextStep: expect.stringContaining('record Loaded') });
    expect((await divya.post(`/carrier/loads/${trip.id}/events`, { type: 'LOADED', eta: new Date(Date.now() + 86400_000).toISOString() })).status()).toBe(200);

    let d = await detail(vijay, trip.id);
    expect(d).toMatchObject({ label: 'In transit', group: 'transit', nextStep: expect.stringMatching(/^On the road, ETA /) });
    expect((await shipperTrip(anita, trip.id)).status).toBe('IN_TRANSIT');
    expect((await divya.post(`/carrier/loads/${trip.id}/events`, { type: 'LOCATION', location: 'Solapur' })).status()).toBe(200);
    expect((await shipperTrip(anita, trip.id)).lastLocation).toBe('Solapur');
    expect((await divya.post(`/carrier/loads/${trip.id}/delivered`, { goodQty: 220, damagedQty: 0 })).status()).toBe(409); // before Reached drop

    expect((await divya.post(`/carrier/loads/${trip.id}/events`, { type: 'REACHED_DROP' })).status()).toBe(200);
    d = await detail(vijay, trip.id);
    expect(d.nextStep).toBe('Reached drop: record the delivery');
    expect((await divya.post(`/carrier/loads/${trip.id}/delivered`, { goodQty: 220, damagedQty: 0 })).status()).toBe(200);
    d = await detail(vijay, trip.id);
    expect(d).toMatchObject({ label: 'Delivered', group: 'action', nextStep: 'Upload the signed POD' });
    expect((await shipperTrip(anita, trip.id)).status).toBe('DELIVERED');

    // POD: wrong LR is not matched, so it waits for the shipper; here the right LR is accepted by rule.
    expect((await divya.post(`/carrier/loads/${trip.id}/pod`, { lrNumber, photoUrl: 'https://example.test/pod.jpg' })).status()).toBe(200);
    expect(await errCode(await divya.post(`/carrier/loads/${trip.id}/pod`, { lrNumber }))).toBe('WRONG_STATE'); // already accepted by rule
    d = await detail(vijay, trip.id);
    expect(d).toMatchObject({ label: 'POD received', nextStep: 'Send the invoice' });
    expect(d.execution.pod).toMatchObject({ uploaded: true, accepted: true });
    expect((await shipperTrip(anita, trip.id)).status).toBe('POD_RECEIVED');

    // Invoice: owner sends directly, number from the carrier's own series.
    const inv = await vijay.post(`/carrier/loads/${trip.id}/invoice`, {});
    expect(inv.status(), await inv.text()).toBe(200);
    const sent = await inv.json();
    expect(sent).toMatchObject({ ok: true, sent: true });
    expect(sent.number).toMatch(INVOICE_NO);
    d = await detail(vijay, trip.id);
    expect(d).toMatchObject({ label: 'Invoiced', group: 'delivered', nextStep: expect.stringMatching(/^Payment due /) });
    expect(await errCode(await vijay.post(`/carrier/loads/${trip.id}/invoice`, {}))).toBe('WRONG_STATE');
    expect(await errCode(await vijay.post(`/carrier/loads/${trip.id}/invoice/remind`, {}))).toBe('NOT_DUE');

    let t = await shipperTrip(anita, trip.id);
    expect(t.status).toBe('INVOICED');
    expect(t.invoice).toMatchObject({ number: sent.number, total: 38500 });
    expect((await anita.post(`/trips/${trip.id}/invoice/approve`)).status()).toBe(200);
    expect((await anita.post(`/trips/${trip.id}/invoice/pay`, { mode: 'UPI', reference: `UPI-${Date.now()}` })).status()).toBe(200);
    d = await detail(vijay, trip.id);
    expect(d).toMatchObject({ label: 'Closed', group: 'closed', nextStep: expect.stringMatching(/^Paid /) });
    t = await shipperTrip(anita, trip.id);
    expect(t.status).toBe('CLOSED');
  });

  test('events: validation and roles', async ({ request }) => {
    const anita = await shipperHead(request);
    const trip = await readyTrip(request, anita, await refs(anita));
    const divya = await asUser(request, USERS.carrierTraffic);
    const bad = await divya.post(`/carrier/loads/${trip.id}/events`, { type: 'NOPE' });
    expect(bad.status()).toBe(400);
    expect(await errCode(bad)).toBe('VALIDATION_FAILED');
    await divya.post(`/carrier/loads/${trip.id}/events`, { type: 'REACHED_PICKUP' });
    const noEta = await divya.post(`/carrier/loads/${trip.id}/events`, { type: 'LOADED' });
    expect(noEta.status()).toBe(400);
    expect((await noEta.json()).error.fields.eta).toBeTruthy();
    const loc = await divya.post(`/carrier/loads/${trip.id}/events`, { type: 'LOCATION' });
    expect(loc.status()).toBe(400);
    expect((await loc.json()).error.fields.location).toBeTruthy();

    const suresh = await asUser(request, USERS.carrierAccounts);
    expect((await suresh.post(`/carrier/loads/${trip.id}/events`, { type: 'LOADED', eta: new Date(Date.now() + 86400_000).toISOString() })).status()).toBe(403);
    const arjun = await asUser(request, USERS.otherCarrier);
    expect((await arjun.post(`/carrier/loads/${trip.id}/events`, { type: 'REACHED_DROP' })).status()).toBe(404);
    expect((await anita.post(`/carrier/loads/${trip.id}/events`, { type: 'REACHED_DROP' })).status()).toBe(403);
    expect((await shipperTrip(anita, trip.id)).status).toBe('READY_FOR_PICKUP'); // nothing above moved it
  });

  test('delivered: quantities validated; WRONG_STATE once delivered', async ({ request }) => {
    const anita = await shipperHead(request);
    const trip = await loadedTrip(request, anita, await refs(anita));
    const divya = await asUser(request, USERS.carrierTraffic);
    await divya.post(`/carrier/loads/${trip.id}/events`, { type: 'REACHED_DROP' });
    const bad = await divya.post(`/carrier/loads/${trip.id}/delivered`, { goodQty: 'x', damagedQty: -1 });
    expect(bad.status()).toBe(400);
    expect(Object.keys((await bad.json()).error.fields).sort()).toEqual(['damagedQty', 'goodQty']);
    expect((await divya.post(`/carrier/loads/${trip.id}/delivered`, { goodQty: 0, damagedQty: 0 })).status()).toBe(400);
    expect((await divya.post(`/carrier/loads/${trip.id}/delivered`, { goodQty: 220, damagedQty: 0 })).status()).toBe(200);
    expect((await divya.post(`/carrier/loads/${trip.id}/delivered`, { goodQty: 220, damagedQty: 0 })).status()).toBe(409);
  });
});

test.describe('Carrier on the road API: problems and fixes', () => {
  test('a problem puts the trip on hold; no fix yet cannot resume; a carrier-paid fix resumes the trip', async ({ request }) => {
    const anita = await shipperHead(request);
    const trip = await loadedTrip(request, anita, await refs(anita));
    const vijay = await asUser(request, USERS.carrier);
    const divya = await asUser(request, USERS.carrierTraffic);
    const rep = await divya.post(`/carrier/loads/${trip.id}/exceptions`, { kind: 'BREAKDOWN', description: 'Clutch failure near Kurnool' });
    expect(rep.status(), await rep.text()).toBe(201);
    const { exceptionId } = await rep.json();
    expect((await shipperTrip(anita, trip.id)).status).toBe('ON_HOLD');
    expect(await detail(vijay, trip.id)).toMatchObject({ label: 'On hold', group: 'action', nextStep: 'Problem reported: propose a fix' });
    expect((await divya.post(`/carrier/exceptions/${exceptionId}/resolve`, {})).status()).toBe(409);

    const bad = await divya.post(`/carrier/exceptions/${exceptionId}/proposal`, { fix: 'WAIT' });
    expect(bad.status()).toBe(400);
    expect(Object.keys((await bad.json()).error.fields).sort()).toEqual(['label', 'payer']);
    expect((await divya.post(`/carrier/exceptions/${exceptionId}/proposal`, { fix: 'REPAIR', label: 'Roadside repair', payer: 'CARRIER', newEta: new Date(Date.now() + 2 * 86400_000).toISOString() })).status()).toBe(200);
    const res = await divya.post(`/carrier/exceptions/${exceptionId}/resolve`, {});
    expect(res.status(), await res.text()).toBe(200);
    expect((await shipperTrip(anita, trip.id)).status).toBe('IN_TRANSIT');
    expect(await detail(vijay, trip.id)).toMatchObject({ label: 'In transit' });
  });

  test('a fix that costs the shipper waits for the shipper: NOT_APPROVED, then approved and resumed', async ({ request }) => {
    const anita = await shipperHead(request);
    const trip = await loadedTrip(request, anita, await refs(anita));
    const vijay = await asUser(request, USERS.carrier);
    const rep = await vijay.post(`/carrier/loads/${trip.id}/exceptions`, {
      kind: 'BREAKDOWN', description: 'Gearbox failure',
      proposal: { fix: 'TRANSHIP', label: 'Tranship to a new truck', extraCost: 6000, payer: 'SHIPPER', newEta: new Date(Date.now() + 2 * 86400_000).toISOString() },
    });
    expect(rep.status(), await rep.text()).toBe(201);
    const { exceptionId } = await rep.json();
    expect((await detail(vijay, trip.id)).nextStep).toBe('Fix proposed (Tranship to a new truck): waiting for the shipper');
    const blocked = await vijay.post(`/carrier/exceptions/${exceptionId}/resolve`, {});
    expect(blocked.status()).toBe(409);
    expect(await errCode(blocked)).toBe('NOT_APPROVED');

    expect((await anita.post(`/trips/${trip.id}/exception/reject`, { reason: 'Too costly' })).status()).toBe(200);
    expect((await detail(vijay, trip.id)).nextStep).toBe('Shipper rejected the fix: propose another');
    expect(await errCode(await vijay.post(`/carrier/exceptions/${exceptionId}/resolve`, {}))).toBe('NOT_APPROVED');
    expect((await vijay.post(`/carrier/exceptions/${exceptionId}/proposal`, { fix: 'TRANSHIP', label: 'Tranship, cost shared', extraCost: 3000, payer: 'SHIPPER' })).status()).toBe(200);
    expect((await anita.post(`/trips/${trip.id}/exception/approve`)).status()).toBe(200);
    expect((await detail(vijay, trip.id)).nextStep).toContain('resume the trip when done');
    expect((await vijay.post(`/carrier/exceptions/${exceptionId}/resolve`, {})).status()).toBe(200);
    expect((await shipperTrip(anita, trip.id)).status).toBe('IN_TRANSIT');
  });

  test('swap: options listed on hold; blocked driver is COMPLIANCE_BLOCKED, only the owner overrides; busy truck is TRUCK_BUSY; a good swap moves the trip to the new truck', async ({ request }) => {
    const anita = await shipperHead(request);
    const trip = await loadedTrip(request, anita, await refs(anita));
    const vijay = await asUser(request, USERS.carrier);
    const divya = await asUser(request, USERS.carrierTraffic);
    const { exceptionId } = await (await vijay.post(`/carrier/loads/${trip.id}/exceptions`, { kind: 'BREAKDOWN', description: 'Axle broken' })).json();
    const d = await detail(vijay, trip.id);
    expect(d.execution.swapOptions.trucks.length).toBeGreaterThan(0);

    const next = await freshFleet(request);
    const bad = await freshFleet(request);
    // Expired licence for the swap driver: blocked.
    const old = await vijay.post('/carrier/drivers', { name: 'Expired Swap Driver', phone: `+9196${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`, licenceNumber: `TN09${String(Math.floor(Math.random() * 1e11)).padStart(11, '0')}`, licenceClass: 'HGMV', licenceExpiry: '2020-01-01' });
    const oldDriver = (await old.json()).driver;
    const blocked = await divya.post(`/carrier/exceptions/${exceptionId}/proposal`, { fix: 'SWAP', label: 'Swap truck', payer: 'CARRIER', swap: { truckId: next.truck.id, driverId: oldDriver.id } });
    expect(blocked.status()).toBe(409);
    expect(await errCode(blocked)).toBe('COMPLIANCE_BLOCKED');
    const nonOwner = await divya.post(`/carrier/exceptions/${exceptionId}/proposal`, { fix: 'SWAP', label: 'Swap truck', payer: 'CARRIER', swap: { truckId: next.truck.id, driverId: oldDriver.id, override: { reason: 'Urgent' } } });
    expect(nonOwner.status()).toBe(403);

    const other = await assignedTrip(request, anita, await refs(anita)); // its truck and driver are on another load
    const busy = await vijay.post(`/carrier/exceptions/${exceptionId}/proposal`, { fix: 'SWAP', label: 'Swap truck', payer: 'CARRIER', swap: { truckId: other.truck.id, driverId: bad.driver.id } });
    expect(busy.status()).toBe(409);
    expect(await errCode(busy)).toBe('TRUCK_BUSY');
  });

  test('swap to a free truck and driver resumes on the new truck', async ({ request }) => {
    const anita = await shipperHead(request);
    const trip = await loadedTrip(request, anita, await refs(anita));
    const vijay = await asUser(request, USERS.carrier);
    const { exceptionId } = await (await vijay.post(`/carrier/loads/${trip.id}/exceptions`, { kind: 'BREAKDOWN', description: 'Axle broken' })).json();
    const next = await freshFleet(request);
    const prop = await vijay.post(`/carrier/exceptions/${exceptionId}/proposal`, { fix: 'SWAP', label: 'Swap to a spare truck', payer: 'CARRIER', swap: { truckId: next.truck.id, driverId: next.driver.id } });
    expect(prop.status(), await prop.text()).toBe(200);
    const res = await vijay.post(`/carrier/exceptions/${exceptionId}/resolve`, {});
    expect(res.status(), await res.text()).toBe(200);
    const t = await shipperTrip(anita, trip.id);
    expect(t.status).toBe('IN_TRANSIT');
    expect(t.truck.driverName).toBe(next.driver.name);
  });

  test('problems only on a load on the road; accounts cannot report', async ({ request }) => {
    const anita = await shipperHead(request);
    const trip = await readyTrip(request, anita, await refs(anita));
    const vijay = await asUser(request, USERS.carrier);
    expect((await vijay.post(`/carrier/loads/${trip.id}/exceptions`, { kind: 'BREAKDOWN', description: 'x' })).status()).toBe(409);
    const bad = await vijay.post(`/carrier/loads/${trip.id}/exceptions`, { kind: 'NOPE' });
    expect(bad.status()).toBe(400);
    expect(Object.keys((await bad.json()).error.fields).sort()).toEqual(['description', 'kind']);
    const suresh = await asUser(request, USERS.carrierAccounts);
    expect((await suresh.post(`/carrier/loads/${trip.id}/exceptions`, { kind: 'DELAY', description: 'x' })).status()).toBe(403);
  });
});

test.describe('Carrier POD, claims and invoices API', () => {
  test('POD: wrong LR or remarks send it to the shipper for review; WRONG_STATE before delivery; link validated', async ({ request }) => {
    const anita = await shipperHead(request);
    await setPolicy(anita);
    const early = await loadedTrip(request, anita, await refs(anita));
    const divya = await asUser(request, USERS.carrierTraffic);
    expect(await errCode(await divya.post(`/carrier/loads/${early.id}/pod`, { lrNumber: early.lrNumber }))).toBe('WRONG_STATE');

    const trip = await deliveredByCarrier(request, anita, await refs(anita));
    const noLr = await divya.post(`/carrier/loads/${trip.id}/pod`, {});
    expect(noLr.status()).toBe(400);
    expect((await noLr.json()).error.fields.lrNumber).toBeTruthy();
    const badUrl = await divya.post(`/carrier/loads/${trip.id}/pod`, { lrNumber: trip.lrNumber, photoUrl: 'ftp://x' });
    expect(badUrl.status()).toBe(400);
    expect((await badUrl.json()).error.fields.photoUrl).toBeTruthy();

    expect((await divya.post(`/carrier/loads/${trip.id}/pod`, { lrNumber: 'XX-000001' })).status()).toBe(200); // not the issued LR
    let t = await shipperTrip(anita, trip.id);
    expect(t.status).toBe('DELIVERED'); // waits for the shipper
    expect((await detail(divya, trip.id)).nextStep).toBe('POD with the shipper for review');
    expect(await errCode(await divya.post(`/carrier/loads/${trip.id}/pod`, { lrNumber: trip.lrNumber }))).toBe('DUPLICATE');
    expect((await anita.post(`/trips/${trip.id}/pod/accept`)).status()).toBe(200);
    expect((await shipperTrip(anita, trip.id)).status).toBe('POD_RECEIVED');
  });

  test('damaged delivery: claim must be answered; dispute needs a note; accepted claim is deducted from the invoice', async ({ request }) => {
    const anita = await shipperHead(request);
    await setPolicy(anita);
    const trip = await deliveredByCarrier(request, anita, await refs(anita), 2);
    const vijay = await asUser(request, USERS.carrier);
    const divya = await asUser(request, USERS.carrierTraffic);
    expect((await divya.post(`/carrier/loads/${trip.id}/pod`, { lrNumber: trip.lrNumber, remarks: '2 ctn damaged' })).status()).toBe(200);
    expect((await shipperTrip(anita, trip.id)).status).toBe('DELIVERED'); // remarks: shipper review
    const claim = (await (await anita.post(`/trips/${trip.id}/claims`, { kind: 'DAMAGE', qty: 2, unitValue: 1600, description: '2 cartons crushed' })).json()).claim;
    expect(await detail(vijay, trip.id)).toMatchObject({ group: 'action', nextStep: `Claim ${claim.number} needs your answer` });

    const noNote = await divya.post(`/carrier/claims/${claim.id}/respond`, { accept: false });
    expect(noNote.status()).toBe(400);
    expect((await noNote.json()).error.fields.note).toBeTruthy();
    expect((await divya.post(`/carrier/claims/${claim.id}/respond`, {})).status()).toBe(400); // accept must be true or false
    expect((await divya.post(`/carrier/claims/${claim.id}/respond`, { accept: true })).status()).toBe(200);
    expect((await anita.post(`/trips/${trip.id}/pod/accept`)).status()).toBe(200);

    const inv = await vijay.post(`/carrier/loads/${trip.id}/invoice`, {});
    expect(inv.status(), await inv.text()).toBe(200);
    const t = await shipperTrip(anita, trip.id);
    expect(t.invoice).toMatchObject({ total: 35300, claimDeduction: 3200 }); // 38,500 less the accepted claim
  });

  test('invoice above the limit: accounts gets an approval for the owner; owner rejects with a reason, accounts resends, owner approves; numbers are never reused', async ({ request }) => {
    const anita = await shipperHead(request);
    await setPolicy(anita);
    const trip = await deliveredByCarrier(request, anita, await refs(anita));
    const vijay = await asUser(request, USERS.carrier);
    const suresh = await asUser(request, USERS.carrierAccounts);
    const divya = await asUser(request, USERS.carrierTraffic);
    await divya.post(`/carrier/loads/${trip.id}/pod`, { lrNumber: trip.lrNumber });
    expect((await divya.post(`/carrier/loads/${trip.id}/invoice`, {})).status()).toBe(403); // traffic manager cannot bill

    const first = await suresh.post(`/carrier/loads/${trip.id}/invoice`, {});
    expect(first.status(), await first.text()).toBe(200);
    const { sent, approvalId } = await first.json();
    expect(sent).toBe(false);
    expect(approvalId).toBeTruthy();
    expect(await errCode(await suresh.post(`/carrier/loads/${trip.id}/invoice`, {}))).toBe('APPROVAL_PENDING');
    expect((await detail(vijay, trip.id)).nextStep).toBe('Invoice waiting for the owner’s approval');
    expect((await shipperTrip(anita, trip.id)).status).toBe('POD_RECEIVED');

    expect((await (await suresh.get('/carrier/approvals')).json()).count).toBe(0); // only the owner sees them
    const pending = (await (await vijay.get('/carrier/approvals')).json()).items.find((i: { id: string }) => i.id === approvalId);
    expect(pending).toBeTruthy();
    expect((await suresh.post(`/carrier/approvals/${approvalId}/approve`, {})).status()).toBe(403);
    const noReason = await vijay.post(`/carrier/approvals/${approvalId}/reject`, {});
    expect(noReason.status()).toBe(400);
    expect((await noReason.json()).error.fields.reason).toBeTruthy();
    expect((await vijay.post(`/carrier/approvals/${approvalId}/reject`, { reason: 'Add detention first' })).status()).toBe(200);
    expect(await errCode(await vijay.post(`/carrier/approvals/${approvalId}/approve`, {}))).toBe('DECIDED');
    expect((await detail(vijay, trip.id)).nextStep).toBe('Owner rejected the invoice: fix and send again');

    const second = await (await suresh.post(`/carrier/loads/${trip.id}/invoice`, { detention: 1500 })).json();
    expect(second.sent).toBe(false);
    const ok = await vijay.post(`/carrier/approvals/${second.approvalId}/approve`, {});
    expect(ok.status(), await ok.text()).toBe(200);
    const number = (await ok.json()).number as string;
    expect(number).toMatch(INVOICE_NO);
    expect((await shipperTrip(anita, trip.id)).invoice).toMatchObject({ number, total: 40000 });
  });

  test('shipper queries the invoice: carrier sees Invoice queried, sends a corrected one with a new number', async ({ request }) => {
    const anita = await shipperHead(request);
    await setPolicy(anita);
    const trip = await deliveredByCarrier(request, anita, await refs(anita));
    const vijay = await asUser(request, USERS.carrier);
    await (await asUser(request, USERS.carrierTraffic)).post(`/carrier/loads/${trip.id}/pod`, { lrNumber: trip.lrNumber });
    const first = (await (await vijay.post(`/carrier/loads/${trip.id}/invoice`, {})).json()).number as string;
    const q = await anita.post(`/trips/${trip.id}/invoice/query`, { reason: 'Freight does not match the contract' });
    expect(q.status(), await q.text()).toBe(200);
    expect(await detail(vijay, trip.id)).toMatchObject({ label: 'Invoice queried', group: 'action', nextStep: 'Invoice queried: send a corrected one' });
    const second = (await (await vijay.post(`/carrier/loads/${trip.id}/invoice`, {})).json()).number as string;
    expect(second).toMatch(INVOICE_NO);
    expect(second).not.toBe(first);
    expect(Number(second.slice(-4))).toBeGreaterThan(Number(first.slice(-4)));
  });

  test('invoice before the POD is accepted is refused; cross-company access is 404', async ({ request }) => {
    const anita = await shipperHead(request);
    const trip = await deliveredByCarrier(request, anita, await refs(anita));
    const vijay = await asUser(request, USERS.carrier);
    const res = await vijay.post(`/carrier/loads/${trip.id}/invoice`, {});
    expect(res.status()).toBe(409);
    const arjun = await asUser(request, USERS.otherCarrier);
    expect((await arjun.post(`/carrier/loads/${trip.id}/invoice`, {})).status()).toBe(404);
    expect((await arjun.post(`/carrier/loads/${trip.id}/pod`, { lrNumber: trip.lrNumber })).status()).toBe(404);
  });
});
