import type { Page } from '@playwright/test';
import { USERS, asUser, expect, loginUi, test } from './helpers';
import { awardedTrip, deliveredTrip, integration, refs, setPolicy } from './trips.helpers';

const field = (page: Page, label: string) =>
  page.getByLabel(new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( \\*| \\(optional\\))?$`));

test.describe('Trip execution on the trip page', () => {
  test('truck confirmed shows truck, driver, LR and e-way bill; loading moves it on the road', async ({ page, request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const r = await refs(anita);
    const trip = await awardedTrip(request, anita, r);
    await integration.truck(request, trip.number);
    await loginUi(page, USERS.shipperHead, `/trips/${trip.id}`);
    await expect(page.getByRole('heading', { name: 'Truck confirmed · reporting for pickup' })).toBeVisible();
    await expect(page.getByText('Murugan V · +91 97900 00008').first()).toBeVisible();
    await expect(page.getByText(`KR-${trip.number.slice(3)}`).first()).toBeVisible();
    await expect(page.locator('[aria-current="step"]')).toContainText('Truck and documents');
    const docs = page.getByRole('heading', { name: 'Documents' }).locator('..');
    await expect(docs).toContainText(/E-way bill \d+/);
    await expect(docs.getByText(/^Valid to /)).toBeVisible();
    await expect(docs.getByText('Issued')).toBeVisible();

    await integration.event(request, trip.number, 'LOADED', { eta: new Date(Date.now() + 86400_000).toISOString() });
    await integration.event(request, trip.number, 'LOCATION', { location: 'Krishnagiri' });
    await page.reload();
    await expect(page.getByRole('heading', { name: 'On the road' })).toBeVisible();
    await expect(page.getByText('Krishnagiri', { exact: true })).toBeVisible();
    await expect(page.locator('[aria-current="step"]')).toContainText('In transit');
  });

  test('damaged POD: raise a claim (validated), then accept the POD', async ({ page, request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const r = await refs(anita);
    await setPolicy(anita);
    const trip = await deliveredTrip(request, anita, r, 2);
    await integration.pod(request, trip.number, { remarks: '2 ctn damaged' });
    await loginUi(page, USERS.shipperHead, `/trips/${trip.id}`);
    await expect(page.getByRole('heading', { name: 'Delivered · POD needs a look' })).toBeVisible();
    await expect(page.getByText('Receiver confirmed 218 good, 2 damaged.')).toBeVisible();
    await expect(field(page, 'Units')).toHaveValue('2');

    await field(page, 'What is wrong').fill('2 cartons crushed');
    await page.getByRole('button', { name: /^Raise claim/ }).click();
    await expect(page.getByText('Enter the value of one unit.')).toBeVisible();
    await field(page, 'Value of one unit (₹)').fill('1600');
    await page.getByRole('button', { name: 'Raise claim ₹3,200' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Claim raised.' })).toBeVisible();
    await expect(page.getByText(/Claim CL-\d+ raised for ₹3,200/)).toBeVisible();
    await expect(page.getByText('Waiting for carrier')).toBeVisible();

    await page.getByRole('button', { name: 'Accept POD', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'POD accepted' })).toBeVisible();
    await expect(page.getByText('The carrier can invoice now')).toBeVisible();
  });

  test('invoice: checks shown, approve, payment needs a reference, then the trip closes', async ({ page, request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const r = await refs(anita);
    await setPolicy(anita);
    const trip = await deliveredTrip(request, anita, r);
    await integration.pod(request, trip.number);
    await integration.invoice(request, trip.number, { number: 'INV-U1', freight: 43800 });
    await loginUi(page, USERS.shipperHead, `/trips/${trip.id}`);
    await expect(page.getByRole('heading', { name: 'Invoice INV-U1 · ₹43,800' })).toBeVisible();
    const checks = page.getByRole('list', { name: 'Checks' });
    await expect(checks).toContainText('Freight: Matches the award');
    await expect(checks).toContainText('POD: Accepted');
    await page.getByRole('button', { name: 'Approve ₹43,800' }).click();
    await expect(page.getByText(/^Approved · due /)).toBeVisible();

    await page.getByRole('button', { name: 'Record payment ₹43,800' }).click();
    await expect(page.getByText('Enter the UPI or bank reference.')).toBeVisible();
    await page.getByText('Bank transfer', { exact: true }).click();
    await field(page, 'Bank (UTR) reference').fill('UTR20261125001');
    await page.getByRole('button', { name: 'Record payment ₹43,800' }).click();
    await expect(page.getByText(/Paid .* by bank transfer, reference UTR20261125001\. Trip closed\./)).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 }).locator('..').getByText('Closed', { exact: true })).toBeVisible();
    await expect(page.locator('[aria-current="step"]')).toHaveCount(0); // every stage done
  });

  test('a mismatched invoice is flagged; querying it from Approvals sends it back', async ({ page, request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const r = await refs(anita);
    await setPolicy(anita);
    const trip = await deliveredTrip(request, anita, r);
    await integration.pod(request, trip.number);
    await integration.invoice(request, trip.number, { number: 'INV-U2', freight: 44000 });
    await loginUi(page, USERS.shipperHead, '/approvals');
    const row = page.getByRole('row', { name: /INV-U2/ });
    await expect(row).toContainText('Payment');
    await expect(row).toContainText('freight — ₹44,000 billed, award was ₹43,800');
    await row.getByRole('button', { name: 'Query' }).click();
    await field(page, 'What is wrong with invoice INV-U2?').fill('Freight should be ₹43,800');
    await page.getByRole('button', { name: 'Send query' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Invoice INV-U2 queried.' })).toBeVisible();
    await page.goto(`/trips/${trip.id}`);
    await expect(page.getByText('You queried this invoice: “Freight should be ₹43,800”.')).toBeVisible();
  });

  test('"both" POD rule: payment waits for the hard copy', async ({ page, request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const r = await refs(anita);
    await setPolicy(anita, { podRule: 'BOTH' });
    const trip = await deliveredTrip(request, anita, r);
    await integration.pod(request, trip.number);
    await integration.invoice(request, trip.number, { number: 'INV-U3', freight: 43800 });
    await anita.post(`/trips/${trip.id}/invoice/approve`);
    await loginUi(page, USERS.shipperHead, `/trips/${trip.id}`);
    await expect(page.getByText('Your POD rule needs the original LR before payment.')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Record payment/ })).toHaveCount(0);
    await page.getByRole('button', { name: 'Mark hard copy received' }).click();
    await expect(page.getByRole('button', { name: 'Record payment ₹43,800' })).toBeVisible();
    await setPolicy(anita);
  });

  test('booking executive sees why they cannot approve the invoice', async ({ page, request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const r = await refs(anita);
    await setPolicy(anita);
    const trip = await deliveredTrip(request, anita, r);
    await integration.pod(request, trip.number);
    await integration.invoice(request, trip.number, { number: 'INV-U4', freight: 43800 });
    await loginUi(page, USERS.shipperExec, `/trips/${trip.id}`);
    await expect(page.getByText("Your role can't approve or record payments.")).toBeVisible();
    await expect(page.getByRole('button', { name: 'Approve ₹43,800' })).toBeDisabled();
  });
});
