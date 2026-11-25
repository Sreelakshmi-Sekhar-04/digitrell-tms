import { expect, test } from '@playwright/test';
import { USERS, asUser } from './helpers';
import { awardedTrip, deliveredTrip, integration, refs, setPolicy } from './trips.helpers';

const PRIYA = { email: 'priya@sunrisefoods.test', password: 'Shipper@123' };

test.describe('Execution and billing API', () => {
  test('happy path: truck → in transit → delivered → clean POD → invoice → approve → pay → closed', async ({ request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const r = await refs(anita);
    await setPolicy(anita); // digital POD, billing asks first, payments above ₹50,000 need approval
    const trip = await awardedTrip(request, anita, r);
    const get = async () => (await (await anita.get(`/trips/${trip.id}`)).json()).trip;

    expect((await integration.truck(request, trip.number)).status()).toBe(200);
    let t = await get();
    expect(t).toMatchObject({ status: 'READY_FOR_PICKUP', truck: { number: 'TN 10 AZ 2210', driverName: 'Murugan V', driverPhone: '+919790000008' } });
    expect(t.nextStep).toBe('Truck TN 10 AZ 2210 reporting for pickup');
    expect(t.documents.map((d: { kind: string }) => d.kind)).toEqual(['LR', 'EWAY_BILL']);

    await integration.event(request, trip.number, 'REACHED_PICKUP');
    const eta = new Date(Date.now() + 86400_000).toISOString();
    await integration.event(request, trip.number, 'LOADED', { eta });
    await integration.event(request, trip.number, 'LOCATION', { location: 'Krishnagiri' });
    t = await get();
    expect(t).toMatchObject({ status: 'IN_TRANSIT', lastLocation: 'Krishnagiri' });
    expect(t.nextStep).toMatch(/^ETA /);

    await integration.event(request, trip.number, 'REACHED_DROP');
    await integration.delivered(request, trip.number, 220, 0);
    t = await get();
    expect(t.status).toBe('DELIVERED');
    expect(t.nextStep).toBe('Waiting for the POD photo');

    await integration.pod(request, trip.number);
    t = await get();
    expect(t.status).toBe('POD_RECEIVED'); // clean and QR matched: accepted by rule
    expect(t.pod).toMatchObject({ photo: true, accepted: true, readyToBill: true, readyToPay: true });
    expect(t.nextStep).toBe('Waiting for the carrier invoice');

    expect((await integration.invoice(request, trip.number, { number: 'INV-0902', freight: 42500 })).status()).toBe(200);
    t = await get();
    expect(t.status).toBe('INVOICED');
    expect(t.invoice).toMatchObject({ number: 'INV-0902', total: 42500, status: 'RECEIVED', needsApproval: true });
    expect(t.invoice.checks.every((c: { ok: boolean }) => c.ok)).toBe(true);
    expect(t.nextStep).toBe('Approve invoice ₹42,500');

    const item = (await (await anita.get('/approvals')).json()).approvals.find((a: { ref: string }) => a.ref === 'INV-0902');
    expect(item).toMatchObject({ kind: 'PAYMENT', amount: 42500, reason: 'POD accepted, invoice matches the award.' });
    expect((await anita.post(`/approvals/${item.id}/approve`)).status()).toBe(200);

    const noRef = await anita.post(`/trips/${trip.id}/invoice/pay`, { mode: 'UPI' });
    expect((await noRef.json()).error.fields.reference).toBeTruthy();
    expect((await anita.post(`/trips/${trip.id}/invoice/pay`, { mode: 'UPI', reference: 'UPI-4471-0902' })).status()).toBe(200);
    t = await get();
    expect(t.status).toBe('CLOSED');
    expect(t.invoice).toMatchObject({ status: 'PAID', paymentMode: 'UPI', paymentRef: 'UPI-4471-0902' });
    expect(t.nextStep).toMatch(/^Paid /);
    const texts = t.activity.map((a: { text: string }) => a.text);
    for (const s of ['Truck TN 10 AZ 2210 confirmed, driver Murugan V', 'Loaded; on the way', 'Delivered: 220 good', 'POD accepted', 'Invoice INV-0902 received: ₹42,500', 'Paid ₹42,500 by UPI, ref UPI-4471-0902', 'Trip closed']) {
      expect(texts).toContain(s);
    }
  });

  test('steps out of order are refused', async ({ request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const r = await refs(anita);
    const trip = await awardedTrip(request, anita, r);
    expect((await integration.event(request, trip.number, 'LOADED')).status()).toBe(409);
    expect((await integration.delivered(request, trip.number)).status()).toBe(409);
    expect((await integration.pod(request, trip.number)).status()).toBe(409);
    expect((await integration.invoice(request, trip.number, { number: 'X', freight: 1 })).status()).toBe(409);
    await integration.truck(request, trip.number);
    expect((await integration.truck(request, trip.number)).status()).toBe(409);
    expect((await anita.post(`/trips/${trip.id}/pod/accept`)).status()).toBe(409);
  });

  test('damaged POD waits for review; claim, carrier accepts, invoice deducts it and passes checks', async ({ request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const r = await refs(anita);
    await setPolicy(anita);
    const trip = await deliveredTrip(request, anita, r, 2);
    await integration.pod(request, trip.number, { remarks: '2 ctn damaged' });
    let t = (await (await anita.get(`/trips/${trip.id}`)).json()).trip;
    expect(t.status).toBe('DELIVERED');
    expect(t.nextStep).toBe('Review the POD');
    expect(t.delivery).toMatchObject({ goodQty: 218, damagedQty: 2 });

    const bad = await anita.post(`/trips/${trip.id}/claims`, { kind: 'DAMAGE', qty: 0 });
    expect(Object.keys((await bad.json()).error.fields).sort()).toEqual(['description', 'qty', 'unitValue']);
    const raised = await anita.post(`/trips/${trip.id}/claims`, { kind: 'DAMAGE', qty: 2, unitValue: '1,600', description: '2 cartons crushed' });
    expect(raised.status()).toBe(201);
    const claim = (await raised.json()).claim;
    expect(claim.number).toMatch(/^CL-\d+$/);
    expect((await anita.post(`/trips/${trip.id}/pod/accept`)).status()).toBe(200);

    // Invoice while the claim is still open fails the claims check.
    await integration.invoice(request, trip.number, { number: 'INV-C1', freight: 42500 });
    t = (await (await anita.get(`/trips/${trip.id}`)).json()).trip;
    expect(t.invoice.checks.find((c: { label: string }) => c.label === 'Claims')).toMatchObject({ ok: false, detail: `${claim.number} still waiting for the carrier` });
    const inbox = (await (await anita.get('/approvals')).json()).approvals.find((a: { ref: string }) => a.ref === 'INV-C1');
    expect(inbox.reason).toContain('still waiting for the carrier');
    expect((await anita.post(`/approvals/${inbox.id}/reject`, { reason: 'Deduct claim once agreed' })).status()).toBe(200);

    await integration.claimResponse(request, claim.number, true, 'Agreed');
    expect((await integration.claimResponse(request, claim.number, true)).status()).toBe(409);
    expect((await integration.invoice(request, trip.number, { number: 'INV-C2', freight: 42500, claimDeduction: 3200 })).status()).toBe(200);
    t = (await (await anita.get(`/trips/${trip.id}`)).json()).trip;
    expect(t.invoice).toMatchObject({ number: 'INV-C2', total: 39300, claimDeduction: 3200 });
    expect(t.invoice.checks.every((c: { ok: boolean }) => c.ok)).toBe(true);
    expect(t.claims[0]).toMatchObject({ status: 'ACCEPTED', amount: 3200, carrierNote: 'Agreed' });
    expect(t.activity.map((a: { text: string }) => a.text)).toContain('Invoice INV-C1 queried — “Deduct claim once agreed”');
  });

  test('invoice that does not match the award is flagged; a disputed claim can be withdrawn', async ({ request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const r = await refs(anita);
    await setPolicy(anita);
    const trip = await deliveredTrip(request, anita, r, 1);
    await integration.pod(request, trip.number, { remarks: '1 ctn wet' });
    const claim = (await (await anita.post(`/trips/${trip.id}/claims`, { kind: 'DAMAGE', qty: 1, unitValue: 1600, description: 'Wet carton' })).json()).claim;
    await integration.claimResponse(request, claim.number, false, 'Was wet at loading');
    expect((await anita.post(`/trips/${trip.id}/claims/${claim.id}/withdraw`)).status()).toBe(200);
    await anita.post(`/trips/${trip.id}/pod/accept`);
    await integration.invoice(request, trip.number, { number: 'INV-M1', freight: 45000, detention: 1500 });
    const t = (await (await anita.get(`/trips/${trip.id}`)).json()).trip;
    const checks = Object.fromEntries(t.invoice.checks.map((c: { label: string; ok: boolean; detail: string }) => [c.label, c]));
    expect(checks.Freight).toMatchObject({ ok: false, detail: '₹45,000 billed, award was ₹42,500' });
    expect(checks.Detention).toMatchObject({ ok: false });
    expect(checks.Claims).toMatchObject({ ok: true, detail: 'No claims' });
    expect(t.invoice.total).toBe(46500);
  });

  test('POD rule "hard copy required": no invoice until the original LR arrives', async ({ request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const r = await refs(anita);
    await setPolicy(anita, { podRule: 'HARD_COPY' });
    const trip = await deliveredTrip(request, anita, r);
    await integration.pod(request, trip.number);
    let t = (await (await anita.get(`/trips/${trip.id}`)).json()).trip;
    expect(t.nextStep).toBe('Waiting for the POD hard copy');
    const early = await integration.invoice(request, trip.number, { number: 'INV-H1', freight: 42500 });
    expect(early.status()).toBe(409);
    expect((await early.json()).error.code).toBe('POD_RULE');
    expect((await anita.post(`/trips/${trip.id}/pod/hard-copy`)).status()).toBe(200);
    expect((await integration.invoice(request, trip.number, { number: 'INV-H1', freight: 42500 })).status()).toBe(200);
    t = (await (await anita.get(`/trips/${trip.id}`)).json()).trip;
    expect(t.pod).toMatchObject({ hardCopy: true, readyToPay: true });
    await setPolicy(anita);
  });

  test('POD rule "both": invoice on the photo, payment only after the hard copy', async ({ request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const r = await refs(anita);
    await setPolicy(anita, { podRule: 'BOTH' });
    const trip = await deliveredTrip(request, anita, r);
    await integration.pod(request, trip.number);
    expect((await integration.invoice(request, trip.number, { number: 'INV-B1', freight: 42500 })).status()).toBe(200);
    await anita.post(`/trips/${trip.id}/invoice/approve`);
    const t = (await (await anita.get(`/trips/${trip.id}`)).json()).trip;
    expect(t.nextStep).toBe('Pay after the POD hard copy arrives');
    const early = await anita.post(`/trips/${trip.id}/invoice/pay`, { mode: 'BANK', reference: 'NEFT123' });
    expect(early.status()).toBe(409);
    await anita.post(`/trips/${trip.id}/pod/hard-copy`);
    expect((await anita.post(`/trips/${trip.id}/invoice/pay`, { mode: 'BANK', reference: 'NEFT123' })).status()).toBe(200);
    await setPolicy(anita);
  });

  test('billing may act within limits: a clean invoice under the limit is approved by rule', async ({ request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const r = await refs(anita);
    await setPolicy(anita, { billing: 2, paymentApprovalAbove: 50000 });
    const small = await deliveredTrip(request, anita, r);
    await integration.pod(request, small.number);
    await integration.invoice(request, small.number, { number: 'INV-A1', freight: 42500 });
    let t = (await (await anita.get(`/trips/${small.id}`)).json()).trip;
    expect(t.invoice.status).toBe('APPROVED');
    expect(t.activity.map((a: { text: string }) => a.text)).toContain('Invoice INV-A1 approved (rule: within ₹50,000 and all checks passed)');
    expect((await (await anita.get('/approvals')).json()).approvals.some((a: { ref: string }) => a.ref === 'INV-A1')).toBe(false);

    const large = await deliveredTrip(request, anita, r, 0, 45000);
    await integration.pod(request, large.number);
    await integration.invoice(request, large.number, { number: 'INV-A2', freight: 45000 });
    t = (await (await anita.get(`/trips/${large.id}`)).json()).trip;
    expect(t.invoice.status).toBe('APPROVED'); // ₹45,000 is still within ₹50,000
    await setPolicy(anita, { billing: 2, paymentApprovalAbove: 44000 });
    const above = await deliveredTrip(request, anita, r, 0, 45000);
    await integration.pod(request, above.number);
    await integration.invoice(request, above.number, { number: 'INV-A3', freight: 45000 });
    t = (await (await anita.get(`/trips/${above.id}`)).json()).trip;
    expect(t.invoice.status).toBe('RECEIVED'); // above the limit: a person decides
    await setPolicy(anita);
  });

  test('who may approve and pay: booking executive no; approver only within limit', async ({ request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const r = await refs(anita);
    await setPolicy(anita);
    const trip = await deliveredTrip(request, anita, r);
    await integration.pod(request, trip.number);
    await integration.invoice(request, trip.number, { number: 'INV-P1', freight: 42500 });
    const karthik = await asUser(request, USERS.shipperExec);
    expect((await karthik.post(`/trips/${trip.id}/invoice/approve`)).status()).toBe(403);
    const priya = await asUser(request, PRIYA);
    const over = await priya.post(`/trips/${trip.id}/invoice/approve`);
    expect(over.status()).toBe(403);
    expect((await over.json()).error.message).toContain('above your approval limit of ₹40,000');
    expect((await anita.post(`/trips/${trip.id}/invoice/approve`)).status()).toBe(200);
    expect((await karthik.post(`/trips/${trip.id}/invoice/pay`, { mode: 'UPI', reference: 'X1' })).status()).toBe(403);
    const meera = await asUser(request, USERS.otherShipper);
    expect((await meera.post(`/trips/${trip.id}/invoice/pay`, { mode: 'UPI', reference: 'X1' })).status()).toBe(404);
  });
});
