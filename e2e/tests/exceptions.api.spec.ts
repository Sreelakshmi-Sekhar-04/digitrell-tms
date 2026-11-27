import { expect, test } from '@playwright/test';
import { USERS, asUser } from './helpers';
import { awardedTrip, book, carrierAccepts, carrierPasses, deliveredTrip, exceptions, expireQuotes, integration, onTheRoad, refs, tomorrow } from './trips.helpers';

const dayAfter = () => new Date(Date.now() + 5.5 * 3600_000 + 2 * 86400_000).toISOString().slice(0, 10);

test.describe('Cancel a booking', () => {
  test('before the award: preview says what happens; reason required; offers withdrawn; nothing more accepted', async ({ request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const r = await refs(anita);
    const trip = await book(anita, r);
    let t = (await (await anita.get(`/trips/${trip.id}`)).json()).trip;
    expect(t.cancel.allowed).toBe(true);
    expect(t.cancel.consequences).toEqual(['Deccan Freight Carriers is told the offer is withdrawn.', 'No LR has been issued yet, so nothing is voided.']);

    expect((await (await anita.post(`/trips/${trip.id}/cancel`, {})).json()).error.fields.reason).toBeTruthy();
    expect((await (await anita.post(`/trips/${trip.id}/cancel`, { reason: 'OTHER' })).json()).error.fields.note).toBe('Say what the reason is.');
    expect((await anita.post(`/trips/${trip.id}/cancel`, { reason: 'ORDER_CANCELLED', note: 'Buyer postponed' })).status()).toBe(200);

    t = (await (await anita.get(`/trips/${trip.id}`)).json()).trip;
    expect(t).toMatchObject({ status: 'CANCELLED', group: 'closed', cancelled: { reason: 'Order cancelled by the customer: Buyer postponed' } });
    expect(t.quotes.every((q: { status: string }) => q.status === 'WITHDRAWN')).toBe(true);
    expect(t.activity[0].text).toBe('Booking cancelled — “Order cancelled by the customer: Buyer postponed”');
    expect((await (await anita.get('/approvals')).json()).approvals.some((a: { ref: string }) => a.ref === trip.number)).toBe(false);
    expect((await carrierAccepts(request, trip.number, r.deccan)).status()).toBe(409);
    expect((await anita.post(`/trips/${trip.id}/cancel`, { reason: 'ORDER_CANCELLED' })).status()).toBe(409);
  });

  test('after the truck is confirmed: LR and e-way bill are voided', async ({ request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const r = await refs(anita);
    const trip = await awardedTrip(request, anita, r);
    await integration.truck(request, trip.number);
    let t = (await (await anita.get(`/trips/${trip.id}`)).json()).trip;
    const lrNo = `KR-${trip.number.slice(3)}`;
    expect(t.cancel.consequences).toContain('Deccan Freight Carriers is told the award is cancelled.');
    expect(t.cancel.consequences.join(' ')).toContain(`LR ${lrNo} and e-way bill`);
    await anita.post(`/trips/${trip.id}/cancel`, { reason: 'WRONG_DETAILS' });
    t = (await (await anita.get(`/trips/${trip.id}`)).json()).trip;
    expect(t.status).toBe('CANCELLED');
    expect(t.documents).toEqual([]); // voided documents are no longer shown as valid
  });

  test('goods on the truck: only the logistics head can cancel; delivered trips cannot be cancelled', async ({ request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const karthik = await asUser(request, USERS.shipperExec);
    const r = await refs(anita);
    const moving = await onTheRoad(request, anita, r);
    const asExec = (await (await karthik.get(`/trips/${moving.id}`)).json()).trip;
    expect(asExec.cancel).toMatchObject({ allowed: false, reason: 'The goods are on the truck. Only the logistics head can cancel now.' });
    expect((await karthik.post(`/trips/${moving.id}/cancel`, { reason: 'ORDER_CANCELLED' })).status()).toBe(403);
    const asHead = (await (await anita.get(`/trips/${moving.id}`)).json()).trip;
    expect(asHead.cancel.consequences).toContain('The goods are on the truck: agree the return and any charges with the carrier directly.');
    expect((await anita.post(`/trips/${moving.id}/cancel`, { reason: 'ORDER_CANCELLED' })).status()).toBe(200);

    const done = await deliveredTrip(request, anita, r);
    expect((await (await anita.get(`/trips/${done.id}`)).json()).trip.cancel.allowed).toBe(false);
    expect((await anita.post(`/trips/${done.id}/cancel`, { reason: 'ORDER_CANCELLED' })).status()).toBe(409);
  });
});

test.describe('Edit a booking', () => {
  test('a new pickup date restarts the offers from the lowest rate; weight and extras do not', async ({ request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const r = await refs(anita);
    const trip = await book(anita, r);
    expect((await (await anita.patch(`/trips/${trip.id}`, { reference: 'PO-1' })).json()).requoted).toBe(false);
    expect((await (await anita.patch(`/trips/${trip.id}`, { weightTonnes: 15 })).json()).requoted).toBe(false); // contract rates do not depend on weight

    await carrierPasses(request, trip.number, r.deccan); // Kaveri now holds the offer
    const res = await anita.patch(`/trips/${trip.id}`, { pickupDate: dayAfter(), weightTonnes: 16 });
    expect((await res.json()).requoted).toBe(true);
    const t = (await (await anita.get(`/trips/${trip.id}`)).json()).trip;
    expect(t).toMatchObject({ status: 'QUOTES_REQUESTED', weightTonnes: 16, pickupDate: dayAfter(), reference: 'PO-1' });
    const live = t.quotes.filter((q: { status: string }) => ['REQUESTED', 'QUEUED'].includes(q.status));
    expect(live.map((q: { carrier: string; status: string }) => [q.carrier, q.status])).toEqual([['Deccan Freight Carriers', 'REQUESTED'], ['Kaveri Roadlines', 'QUEUED'], ['NorthStar Logistics', 'QUEUED']]);
    expect(t.activity[0].text).toBe('Booking edited; offers restarted from the lowest rate');
    expect((await (await anita.get('/approvals')).json()).approvals.some((a: { ref: string }) => a.ref === trip.number)).toBe(false);
  });

  test('after the award only receiver, reference and notes can change; bad values are refused', async ({ request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const r = await refs(anita);
    const trip = await awardedTrip(request, anita, r);
    let t = (await (await anita.get(`/trips/${trip.id}`)).json()).trip;
    expect(t.edit).toEqual({ load: false, extras: true, requotes: false });
    const locked = await anita.patch(`/trips/${trip.id}`, { weightTonnes: 10 });
    expect(locked.status()).toBe(409);
    expect((await locked.json()).error.message).toContain('Cancel and rebook');
    expect((await anita.patch(`/trips/${trip.id}`, { receiverContact: 'Gate office 98400 11111', notes: 'Tarpaulin' })).status()).toBe(200);
    t = (await (await anita.get(`/trips/${trip.id}`)).json()).trip;
    expect(t).toMatchObject({ receiverContact: 'Gate office 98400 11111', notes: 'Tarpaulin', status: 'AWARDED' });

    const open = await book(anita, r);
    const bad = await (await anita.patch(`/trips/${open.id}`, { pickupDate: '2020-01-01', weightTonnes: 0, material: '' })).json();
    expect(Object.keys(bad.error.fields).sort()).toEqual(['material', 'pickupDate', 'weightTonnes']);
    expect((await anita.patch(`/trips/${open.id}`, { pickupDate: tomorrow() })).status()).toBe(200);
  });
});

test.describe('Give the offered carrier more time', () => {
  test('extend adds hours to the open offer; refused once no carrier is holding an offer', async ({ request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const r = await refs(anita);
    const trip = await book(anita, r);
    const bad = await anita.post(`/trips/${trip.id}/extend`, { hours: 99 });
    expect((await bad.json()).error.fields.hours).toBeTruthy();
    const ok = await anita.post(`/trips/${trip.id}/extend`, { hours: 2 });
    expect(ok.status()).toBe(200);
    const t = (await (await anita.get(`/trips/${trip.id}`)).json()).trip;
    expect(t.nextStep).toMatch(/^Offered to Deccan Freight Carriers at ₹43,800; answer by /);
    expect(new Date(t.quoteDeadline).getTime()).toBeGreaterThan(Date.now() + 3.9 * 3600_000); // the 2 h window plus 2 h
    expect(t.activity[0].text).toBe('Response time extended by 2 h');

    // Nobody left to extend once every carrier has passed or not answered; use Send again instead.
    await expireQuotes(request, trip.number);
    await carrierPasses(request, trip.number, r.kaveri);
    await carrierPasses(request, trip.number, r.northstar);
    const refused = await anita.post(`/trips/${trip.id}/extend`, { hours: 1 });
    expect(refused.status()).toBe(409);
    expect((await refused.json()).error.code).toBe('WRONG_STATE');
  });
});

test.describe('Problems on the road', () => {
  test('a plain delay is a notice: ETA moves, trip stays on the road, nothing to approve', async ({ request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const r = await refs(anita);
    const trip = await onTheRoad(request, anita, r);
    const newEta = new Date(Date.now() + 2 * 86400_000).toISOString();
    expect((await exceptions.report(request, trip.number, { kind: 'DELAY', description: 'Traffic at Hosur toll', proposal: { fix: 'WAIT', label: 'Wait it out', newEta, payer: 'CARRIER' } })).status()).toBe(200);
    const t = (await (await anita.get(`/trips/${trip.id}`)).json()).trip;
    expect(t).toMatchObject({ status: 'IN_TRANSIT', exception: null, eta: newEta });
    expect(t.delays[0].description).toBe('Traffic at Hosur toll');
  });

  test('breakdown with a carrier-paid fix: on hold, shipper informed, back on the road when resolved', async ({ request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const r = await refs(anita);
    const trip = await onTheRoad(request, anita, r);
    const rep = await exceptions.report(request, trip.number, { kind: 'BREAKDOWN', description: 'Clutch failure near Hubballi', proposal: { fix: 'SWAP', label: 'Swap to KA 22 TT 5120', extraCost: 3500, payer: 'CARRIER' } });
    const { exceptionId } = await rep.json();
    let t = (await (await anita.get(`/trips/${trip.id}`)).json()).trip;
    expect(t).toMatchObject({ status: 'ON_HOLD', group: 'action', nextStep: 'Carrier fixing: Swap to KA 22 TT 5120', exception: { kind: 'BREAKDOWN', status: 'OPEN' } });
    expect((await (await anita.get('/approvals')).json()).approvals.some((a: { ref: string; kind: string }) => a.ref === trip.number && a.kind === 'EXCEPTION')).toBe(false);
    expect((await integration.delivered(request, trip.number)).status()).toBe(409); // on hold: not deliverable
    expect((await exceptions.resolve(request, exceptionId, { truckNumber: 'KA 22 TT 5120' })).status()).toBe(200);
    t = (await (await anita.get(`/trips/${trip.id}`)).json()).trip;
    expect(t).toMatchObject({ status: 'IN_TRANSIT', exception: null, truck: { number: 'KA 22 TT 5120' } });
    expect(t.activity[0].text).toBe('Back on the road with truck KA 22 TT 5120');
  });

  test('fix that costs the shipper: needs approval (limits apply), reject needs a reason, new proposal, approve, resolve', async ({ request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const karthik = await asUser(request, USERS.shipperExec);
    const r = await refs(anita);
    const trip = await onTheRoad(request, anita, r);
    const { exceptionId } = await (await exceptions.report(request, trip.number, {
      kind: 'BREAKDOWN', description: 'Gearbox failure', proposal: { fix: 'TRANSHIP', label: 'Tranship to a new truck', extraCost: 6000, payer: 'SHIPPER', newEta: new Date(Date.now() + 2 * 86400_000).toISOString() },
    })).json();
    let t = (await (await anita.get(`/trips/${trip.id}`)).json()).trip;
    expect(t.nextStep).toBe('Approve or reject the proposed fix');
    let item = (await (await anita.get('/approvals')).json()).approvals.find((a: { ref: string; kind: string }) => a.ref === trip.number && a.kind === 'EXCEPTION');
    expect(item).toMatchObject({ kindLabel: 'Exception fix', amount: 6000, summary: 'Tranship to a new truck on Chennai → Bengaluru' });
    expect(item.reason).toContain('Extra ₹6,000, billed to you.');

    expect((await exceptions.resolve(request, exceptionId)).status()).toBe(409); // not approved yet
    expect((await karthik.post(`/trips/${trip.id}/exception/approve`)).status()).toBe(403);
    const noReason = await anita.post(`/approvals/${item.id}/reject`, {});
    expect(noReason.status()).toBe(400);
    expect((await anita.post(`/approvals/${item.id}/reject`, { reason: 'Too costly; carrier should pay' })).status()).toBe(200);
    t = (await (await anita.get(`/trips/${trip.id}`)).json()).trip;
    expect(t.exception).toMatchObject({ status: 'REJECTED', decisionReason: 'Too costly; carrier should pay' });

    await exceptions.propose(request, exceptionId, { fix: 'TRANSHIP', label: 'Tranship, cost shared', extraCost: 3000, payer: 'SHIPPER' });
    item = (await (await anita.get('/approvals')).json()).approvals.find((a: { ref: string; kind: string }) => a.ref === trip.number && a.kind === 'EXCEPTION');
    expect(item.amount).toBe(3000);
    expect((await anita.post(`/approvals/${item.id}/approve`)).status()).toBe(200);
    expect((await exceptions.resolve(request, exceptionId)).status()).toBe(200);
    t = (await (await anita.get(`/trips/${trip.id}`)).json()).trip;
    expect(t.status).toBe('IN_TRANSIT');
    const texts = t.activity.map((a: { text: string }) => a.text);
    expect(texts).toContain('Fix rejected: Tranship to a new truck — “Too costly; carrier should pay”');
    expect(texts).toContain('Fix approved: Tranship, cost shared');
  });

  test('problems can only be reported for a trip on the road', async ({ request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const r = await refs(anita);
    const trip = await awardedTrip(request, anita, r);
    expect((await exceptions.report(request, trip.number, { kind: 'BREAKDOWN', description: 'x' })).status()).toBe(409);
  });
});
