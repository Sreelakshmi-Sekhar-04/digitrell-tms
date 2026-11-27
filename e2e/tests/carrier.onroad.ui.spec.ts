import { USERS, asUser, expect, loginUi, test } from './helpers';
import { assignedTrip, deliveredByCarrier, loadedTrip, readyTrip } from './lr.helpers';
import { refs, setPolicy, shipperHead } from './trips.helpers';

const status = (page: import('@playwright/test').Page, text: string | RegExp) => page.getByRole('status').filter({ hasText: text });

test.describe('Carrier on the road screens', () => {
  test('the carrier drives the load: pickup, loaded, location, drop, delivered, POD, invoice; the shipper pays and it closes', async ({ page, request }) => {
    const anita = await shipperHead(request);
    await setPolicy(anita);
    const trip = await readyTrip(request, anita, await refs(anita));
    await loginUi(page, USERS.carrierTraffic, `/carrier/loads/${trip.id}`);

    await expect(page.getByRole('heading', { name: 'Truck confirmed, going for pickup' })).toBeVisible({ timeout: 60_000 });
    await page.getByRole('button', { name: 'Reached pickup', exact: true }).click();
    await expect(status(page, 'Reached pickup recorded.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'At pickup' })).toBeVisible();

    const loaded = page.getByRole('button', { name: 'Loaded: start trip' });
    await loaded.click(); // an ETA is required
    await expect(page.getByText('Enter the expected arrival at the drop.')).toBeVisible();
    const eta = new Date(Date.now() + 86400_000 + 5.5 * 3600_000).toISOString().slice(0, 16);
    await page.getByLabel(/^Expected arrival at drop/).fill(eta);
    await loaded.click();
    await expect(status(page, 'Loaded. The trip is in transit.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'On the road' })).toBeVisible();

    await page.getByLabel(/^Where is the truck/).fill('Solapur bypass');
    await page.getByRole('button', { name: /Update location|Share location|Location/ }).first().click();
    await expect(status(page, 'Location updated.')).toBeVisible();
    await expect(page.getByTestId('event-timeline')).toContainText('Solapur bypass');

    await page.getByRole('button', { name: 'Reached drop', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'At the drop' })).toBeVisible();
    await page.getByLabel(/^Units in good order/).fill('220');
    await page.getByLabel(/^Damaged or short/).fill('0');
    await page.getByRole('button', { name: 'Mark delivered' }).click();
    await expect(status(page, /Delivered\. Next: upload the signed POD/)).toBeVisible();

    await page.getByLabel(/^LR number on the signed copy/).fill(trip.lrNumber);
    await page.getByRole('button', { name: 'Upload POD' }).click();
    await expect(status(page, /POD uploaded/)).toBeVisible();
    await expect.poll(async () => (await (await anita.get(`/trips/${trip.id}`)).json()).trip.status).toBe('POD_RECEIVED');

    // Accounts sends the invoice (above the limit the owner approves first); the owner signs in on a second page.
    await page.context().clearCookies();
    await page.evaluate(() => { try { sessionStorage.clear(); localStorage.clear(); } catch { /* none */ } });
    await loginUi(page, USERS.carrier, `/carrier/loads/${trip.id}`);
    await expect(page.getByText(/POD accepted · invoice ₹38,500/)).toBeVisible({ timeout: 60_000 });
    await page.getByRole('button', { name: 'Send invoice' }).click();
    await expect(status(page, 'Invoice sent to the shipper.')).toBeVisible();
    await expect(page.getByRole('heading', { name: /^Invoice [A-Z0-9]+\/\d{2}-\d{2}\/\d{4} · ₹38,500$/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send payment reminder' })).toBeDisabled(); // not due yet

    expect((await anita.post(`/trips/${trip.id}/invoice/approve`)).status()).toBe(200);
    expect((await anita.post(`/trips/${trip.id}/invoice/pay`, { mode: 'UPI', reference: `UPI-${Date.now()}` })).status()).toBe(200);
    await page.reload();
    await expect(page.getByRole('heading', { name: /^Closed · paid / })).toBeVisible({ timeout: 60_000 });
  });

  test('accounts sees no driver-step buttons on a load in transit', async ({ page, request }) => {
    const anita = await shipperHead(request);
    const trip = await loadedTrip(request, anita, await refs(anita));
    await loginUi(page, USERS.carrierAccounts, `/carrier/loads/${trip.id}`);
    await expect(page.getByRole('heading', { name: 'On the road' })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('button', { name: 'Reached drop', exact: true })).toHaveCount(0);
  });

  test('report a breakdown, propose a fix the shipper approves, resume', async ({ page, request }) => {
    const anita = await shipperHead(request);
    const trip = await loadedTrip(request, anita, await refs(anita));
    await loginUi(page, USERS.carrier, `/carrier/loads/${trip.id}`);
    await page.getByRole('button', { name: 'Report breakdown or delay' }).click({ timeout: 60_000 });
    await page.getByLabel(/^What happened/).selectOption('BREAKDOWN');
    await page.getByLabel(/^Details/).fill('Clutch failure near Krishnagiri');
    await page.getByRole('button', { name: 'Report problem' }).click();
    await expect(page.getByRole('heading', { name: 'Breakdown: fix needed' })).toBeVisible();

    await page.getByLabel(/^Fix$/).selectOption('REPAIR');
    await page.getByLabel(/^What will you do/).fill('Roadside repair');
    await page.getByLabel(/^Extra cost/).fill('2500');
    await page.getByLabel(/^Who pays/).selectOption('SHIPPER');
    await page.getByRole('button', { name: 'Propose fix' }).click();
    await expect(page.getByRole('heading', { name: 'Breakdown: fix proposed' })).toBeVisible();

    expect((await anita.post(`/trips/${trip.id}/exception/approve`)).status()).toBe(200);
    await page.reload();
    await page.getByRole('button', { name: /^Fix done: resume/ }).click();
    await expect(status(page, 'Back on the road.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'On the road' })).toBeVisible();
  });

  test('a damaged delivery: accept or dispute the claim in the panel', async ({ page, request }) => {
    const anita = await shipperHead(request);
    await setPolicy(anita);
    const trip = await deliveredByCarrier(request, anita, await refs(anita), 2);
    const divya = await asUser(request, USERS.carrierTraffic);
    await divya.post(`/carrier/loads/${trip.id}/pod`, { lrNumber: trip.lrNumber, remarks: '2 ctn damaged' });
    const claim = (await (await anita.post(`/trips/${trip.id}/claims`, { kind: 'DAMAGE', qty: 2, unitValue: 1600, description: '2 cartons crushed' })).json()).claim;
    await loginUi(page, USERS.carrierTraffic, `/carrier/loads/${trip.id}`);
    await page.getByRole('button', { name: 'Dispute' }).click({ timeout: 60_000 });
    await page.getByRole('button', { name: /^Dispute$/ }).last().isVisible();
    await expect(page.getByLabel(/^Why do you dispute it/)).toBeVisible();
    await page.getByLabel(/^Why do you dispute it/).fill('Packed and sealed at pickup');
    await page.getByRole('button', { name: 'Dispute' }).last().click();
    await expect(status(page, 'Claim disputed. The shipper reviews it.')).toBeVisible();
    expect(claim.number).toMatch(/^CL-/);
  });

  test('invoice above the limit: accounts requests approval; the owner approves it from Approvals', async ({ page, browser, request }) => {
    const anita = await shipperHead(request);
    await setPolicy(anita);
    const trip = await deliveredByCarrier(request, anita, await refs(anita));
    await (await asUser(request, USERS.carrierTraffic)).post(`/carrier/loads/${trip.id}/pod`, { lrNumber: trip.lrNumber });

    await loginUi(page, USERS.carrierAccounts, `/carrier/loads/${trip.id}`);
    await page.getByRole('button', { name: 'Request owner approval' }).click({ timeout: 60_000 });
    await expect(status(page, 'Sent to the owner for approval.')).toBeVisible();
    await expect(page.getByTestId('invoice-approval-pending')).toBeVisible();

    const owner = await (await browser.newContext()).newPage();
    await loginUi(owner, USERS.carrier, '/carrier/approvals');
    await expect(owner.getByText(trip.number).first()).toBeVisible({ timeout: 60_000 });
    await owner.getByRole('button', { name: 'Approve and send' }).first().click();
    await expect(owner.getByRole('status').filter({ hasText: 'Approved. The invoice went to the shipper.' })).toBeVisible();
    await owner.context().close();
    expect((await (await anita.get(`/trips/${trip.id}`)).json()).trip.status).toBe('INVOICED');
  });

  test('a queried invoice shows in Needs action with a corrected-invoice button', async ({ page, request }) => {
    const anita = await shipperHead(request);
    await setPolicy(anita);
    const trip = await deliveredByCarrier(request, anita, await refs(anita));
    const vijay = await asUser(request, USERS.carrier);
    await (await asUser(request, USERS.carrierTraffic)).post(`/carrier/loads/${trip.id}/pod`, { lrNumber: trip.lrNumber });
    const first = (await (await vijay.post(`/carrier/loads/${trip.id}/invoice`, {})).json()).number as string;
    await anita.post(`/trips/${trip.id}/invoice/query`, { reason: 'Freight does not match the contract' });

    await loginUi(page, USERS.carrier, `/carrier/loads/${trip.id}`);
    await expect(page.getByRole('heading', { name: `Invoice ${first} queried: send a corrected one` })).toBeVisible({ timeout: 60_000 });
    await page.getByRole('button', { name: 'Send corrected invoice' }).click();
    await expect(status(page, 'Invoice sent to the shipper.')).toBeVisible();
    await expect(page.getByRole('heading', { name: new RegExp(`^Invoice (?!${first.replace(/\//g, '\\/')}).* · ₹38,500$`) })).toBeVisible();
  });

  test('assigned load before the LR: no driver-step buttons yet', async ({ page, request }) => {
    const anita = await shipperHead(request);
    const trip = await assignedTrip(request, anita, await refs(anita));
    await loginUi(page, USERS.carrier, `/carrier/loads/${trip.id}`);
    await expect(page.getByText('Waiting for the shipper to issue the LR').first()).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('button', { name: 'Reached pickup', exact: true })).toHaveCount(0);
  });
});
