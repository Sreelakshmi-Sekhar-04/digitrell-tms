import type { Page } from '@playwright/test';
import { USERS, asUser, expect, loginUi, test } from './helpers';
import { carrierAccepts, carrierPasses, exceptions, integration, ownLane } from './trips.helpers';

/**
 * The whole shipper workflow in one go (BRD §5, steps 1–20), with every shipper action done in
 * the browser and the carrier, driver and receiver played through the integration endpoints:
 * book → offer (lowest contract rate first) → carrier passes → next carrier accepts (awarded at once) → truck → on the road → breakdown fixed → delivered with damage → claim →
 * POD accepted → invoice with the claim deducted → approve in Approvals → pay → closed → it shows up
 * in Trips, Reports and the activity log.
 */
const field = (page: Page, label: string) =>
  page.getByLabel(new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( \\*| \\(optional\\))?$`));

test('end-to-end shipper journey: booking to paid and closed', async ({ page, request }) => {
  test.setTimeout(240_000);
  const anita = await asUser(request, USERS.shipperHead);
  const own = await ownLane(anita, 2); // fresh lane with 2 contract carriers: A at ₹19,000, B at ₹19,500
  const [carrierA, carrierB] = own.carriers;
  const pickup = (await (await anita.get('/addresses')).json()).addresses.find((a: { id: string }) => a.id === own.booking.pickupAddressId);
  const drop = (await (await anita.get('/addresses')).json()).addresses.find((a: { id: string }) => a.id === own.booking.dropAddressId);

  // 1–2. Book in the browser.
  await loginUi(page, USERS.shipperHead, '/bookings/new');
  await page.getByRole('button', { name: 'Clear' }).click();
  await field(page, 'Pickup').selectOption({ label: `${pickup.name}, ${pickup.city}` });
  await field(page, 'Drop').selectOption({ label: `${drop.name}, ${drop.city}` });
  await field(page, 'Weight (tonnes)').fill('7');
  await page.getByText('17ft', { exact: true }).click();
  await field(page, 'Material').fill('Rice bags');
  await expect(page.getByLabel(/Budget/)).toHaveCount(0); // no price to type
  await expect(page.getByRole('region', { name: 'Carriers on contract for this lane' })).toContainText(carrierA.name);
  await page.getByRole('button', { name: 'Review and confirm' }).click();
  await expect(page.getByText(`${carrierA.name} at ₹19,000 (contract rate)`)).toBeVisible();
  await expect(page.getByText(`${carrierB.name} (₹19,500)`)).toBeVisible();
  await page.getByRole('button', { name: 'Confirm and offer the load' }).click();
  await expect(page.getByRole('heading', { name: `Offered to ${carrierA.name}` })).toBeVisible();
  const tripId = page.url().split('/').pop()!;
  const number = (await page.getByRole('navigation', { name: 'Breadcrumb' }).textContent())!.match(/TR-\d{5}/)![0];

  // 3–5. The cheapest carrier passes, the next accepts and the load is awarded at once.
  expect((await carrierPasses(request, number, carrierA.id, 'No truck free')).status()).toBe(200);
  await page.reload();
  await expect(page.getByRole('heading', { name: `Offered to ${carrierB.name}` })).toBeVisible();
  expect((await carrierAccepts(request, number, carrierB.id)).status()).toBe(200);
  await page.reload();
  const awardedTo = carrierB.name;
  await expect(page.getByRole('heading', { name: `Accepted by ${awardedTo} at ₹19,500 (contract rate)` })).toBeVisible();

  // 6–12. Truck confirmed, documents issued, loaded.
  await integration.truck(request, number, { truckNumber: 'TN 59 AB 1234', lrNumber: `LR-${number}` });
  await integration.event(request, number, 'LOADED', { eta: new Date(Date.now() + 86400_000).toISOString() });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'On the road' })).toBeVisible();

  // 15. Breakdown, carrier-paid fix, back on the road.
  const { exceptionId } = await (await exceptions.report(request, number, { kind: 'BREAKDOWN', description: 'Puncture near Dindigul', proposal: { fix: 'REPAIR', label: 'Repair on site', payer: 'CARRIER' } })).json();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Breakdown reported' })).toBeVisible();
  await expect(page.getByText('The carrier is handling this at their cost. Nothing is needed from you.')).toBeVisible();
  await exceptions.resolve(request, exceptionId);

  // 16–17. Delivered with 1 damaged bag; claim and accept the POD in the browser.
  await integration.delivered(request, number, 149, 1);
  await integration.pod(request, number, { remarks: '1 bag torn' });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Delivered · POD needs a look' })).toBeVisible();
  await field(page, 'Value of one unit (₹)').fill('1200');
  await field(page, 'What is wrong').fill('1 bag torn');
  await page.getByRole('button', { name: 'Raise claim ₹1,200' }).click();
  await expect(page.getByText(/Claim CL-\d+ raised for ₹1,200/)).toBeVisible();
  const claimNo = (await page.getByText(/Claim CL-\d+ raised for/).textContent())!.match(/CL-\d+/)![0];
  await page.getByRole('button', { name: 'Accept POD', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'POD accepted' })).toBeVisible();

  // 18. Carrier accepts the claim and invoices with it deducted; approve in Approvals.
  await integration.claimResponse(request, claimNo, true);
  const awardedAmount = 19500;
  await integration.invoice(request, number, { number: `INV-${number}`, freight: awardedAmount, claimDeduction: 1200 });
  await page.goto('/approvals');
  const row = page.getByRole('row', { name: new RegExp(`INV-${number}`) });
  await expect(row).toContainText('POD accepted, invoice matches the award.');
  await row.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByRole('status').filter({ hasText: `Invoice INV-${number} approved.` })).toBeVisible();

  // 20. Record the payment; the trip closes.
  await page.goto(`/trips/${tripId}`);
  const total = (awardedAmount - 1200).toLocaleString('en-IN');
  await field(page, 'UPI reference').fill('UPI-JOURNEY-1');
  await page.getByRole('button', { name: `Record payment ₹${total}` }).click();
  await expect(page.getByText(/by UPI, reference UPI-JOURNEY-1\. Trip closed\./)).toBeVisible();

  // It shows up everywhere it should.
  await page.goto(`/trips?tab=closed&q=${number}`);
  await expect(page.getByRole('row', { name: new RegExp(number) })).toContainText('Closed');
  await page.goto(`/reports/activity`);
  await page.getByRole('textbox', { name: 'Trip number' }).fill(number);
  const log = page.getByRole('table', { name: 'Activity' });
  for (const s of ['Booked on the web', `Offered to ${carrierA.name} at ₹19,000 (contract rate, 1 of 2)`, `${carrierA.name} passed — “No truck free”`, `Awarded to ${awardedTo} at ₹19,500 (contract rate)`, 'Truck TN 59 AB 1234 confirmed', 'Problem reported: breakdown', 'Back on the road', 'Delivered: 149 good, 1 damaged', `Claim ${claimNo} raised`, 'POD accepted', `Invoice INV-${number} approved`, 'Paid ₹', 'Trip closed']) {
    await expect(log.getByText(s).first()).toBeVisible();
  }
  await page.goto('/');
  await expect(page.getByRole('table', { name: 'Active trips' }).getByText(number)).toHaveCount(0);
});
