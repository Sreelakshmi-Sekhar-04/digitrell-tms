import type { Page } from '@playwright/test';
import { USERS, asUser, expect, loginUi, test } from './helpers';
import { book, carrierAccepts, carrierPasses, refs } from './trips.helpers';

/** A form field by its visible label, ignoring the "*" / "(optional)" suffix. */
const field = (page: Page, label: string) =>
  page.getByLabel(new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( \\*| \\(optional\\))?$`));

test.describe('New booking', () => {
  test('empty form lists what is missing; a full booking is confirmed and lands on the trip', async ({ page }) => {
    await loginUi(page, USERS.shipperHead, '/bookings/new');
    await page.getByRole('button', { name: 'Clear' }).click();
    await page.getByRole('button', { name: 'Review and confirm' }).click();
    for (const msg of ['Enter the pickup address.', 'Enter the drop address.', 'Choose truck type.', 'Enter what is being moved.', 'Enter the weight in tonnes, e.g. 14.']) {
      await expect(page.getByText(msg)).toBeVisible();
    }

    await field(page, 'Pickup').selectOption({ label: 'Ambattur DC, Chennai' });
    await field(page, 'Drop').selectOption({ label: 'Hosur Plant, Bengaluru' });
    await field(page, 'Weight (tonnes)').fill('14');
    await page.getByText('32ft MXL', { exact: true }).click();
    await field(page, 'Material').fill('Biscuits (packed cartons)');
    await expect(page.getByLabel(/Budget/)).toHaveCount(0); // no price to type
    const onContract = page.getByRole('region', { name: 'Carriers on contract for this lane' });
    await expect(onContract).toContainText('Deccan Freight Carriers');
    await expect(onContract).toContainText('Offered first');
    await expect(onContract).toContainText('₹43,800');
    await expect(onContract).not.toContainText('Sai Ganesh'); // no contract rate
    await page.getByRole('button', { name: '+ Receiver contact, reference, notes' }).click();
    await field(page, 'Your reference').fill('PO-77810');
    await page.getByRole('button', { name: 'Review and confirm' }).click();

    await expect(page.getByRole('heading', { name: 'Check and confirm' })).toBeVisible();
    await expect(page.getByText('Deccan Freight Carriers at ₹43,800 (contract rate)')).toBeVisible();
    await expect(page.getByText('Kaveri Roadlines (₹44,500), then NorthStar Logistics (₹45,200)')).toBeVisible();
    await expect(page.getByText(/2 hours per carrier/)).toBeVisible();
    await page.getByRole('button', { name: 'Confirm and offer the load' }).click();

    await expect(page).toHaveURL(/\/trips\/[a-z0-9]+$/);
    // (The "TR-… booked." toast shows for 6 s; the first dev-server compile of this page can take longer, so it isn't asserted here.)
    await expect(page.getByRole('heading', { name: 'Chennai → Bengaluru', level: 1 })).toBeVisible();
    await expect(page.getByText(/Booked on the web · Anita Rao/)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Offered to Deccan Freight Carriers' })).toBeVisible();
    await expect(page.locator('dd').filter({ hasText: 'PO-77810' })).toBeVisible();
    await expect(page.locator('[aria-current="step"]')).toContainText('Offer');
  });

  test('a lane with no contract rate explains what to do, blocks the booking and keeps the form', async ({ page }) => {
    await loginUi(page, USERS.shipperHead, '/bookings/new');
    await page.getByRole('button', { name: 'Clear' }).click();
    await field(page, 'Pickup').selectOption({ label: 'Ambattur DC, Chennai' });
    await field(page, 'Drop').selectOption({ label: 'Medchal DC, Hyderabad' });
    await field(page, 'Weight (tonnes)').fill('5');
    await page.getByText('14ft', { exact: true }).click();
    await field(page, 'Material').fill('Snacks');
    const alert = page.getByRole('alert').filter({ hasText: 'No contract rate for Chennai → Hyderabad, 14ft' });
    await expect(alert).toBeVisible();
    await expect(alert.getByRole('link', { name: 'Open Master data › Rate cards' })).toHaveAttribute('href', '/masters?tab=rate-cards');
    await expect(page.getByRole('button', { name: 'Review and confirm' })).toBeDisabled();
    await expect(field(page, 'Material')).toHaveValue('Snacks');
  });

  test('draft survives leaving the page; repeat fills the form in one click', async ({ page }) => {
    await loginUi(page, USERS.shipperHead, '/bookings/new');
    await page.getByRole('button', { name: 'Clear' }).click();
    await field(page, 'Weight (tonnes)').fill('9.5');
    await field(page, 'Material').fill('Draft check');
    await page.getByRole('navigation', { name: 'Main', exact: true }).getByRole('link', { name: /^Trips/ }).click();
    await page.getByRole('link', { name: '+ New booking' }).click(); // from the Trips page; no longer in the menu
    await expect(field(page, 'Material')).toHaveValue('Draft check');
    await expect(field(page, 'Weight (tonnes)')).toHaveValue('9.5');

    const repeat = page.getByRole('button', { name: /Chennai → Bengaluru/ }).first();
    await repeat.click();
    await expect(field(page, 'Pickup')).toHaveValue(/.+/);
    await expect(page.getByRole('radio', { name: '32ft MXL' })).toBeChecked();
    await page.getByRole('button', { name: 'Review and confirm' }).click();
    await expect(page.getByRole('heading', { name: 'Check and confirm' })).toBeVisible();
    await page.getByRole('button', { name: 'Edit' }).click();
    await expect(page.getByRole('button', { name: 'Review and confirm' })).toBeVisible();
  });
});

test.describe('Offer and accept', () => {
  test('carriers are listed in offer order; when the first accepts, the trip is awarded at the contract rate', async ({ page, request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const r = await refs(anita);
    const trip = await book(anita, r);
    await loginUi(page, USERS.shipperHead, `/trips/${trip.id}`);
    await expect(page.getByRole('heading', { name: 'Offered to Deccan Freight Carriers' })).toBeVisible();
    const table = page.getByRole('table', { name: 'Carriers in offer order' });
    const rows = table.getByRole('row');
    await expect(rows).toHaveCount(4); // header + 3; Sai Ganesh has no contract rate
    await expect(rows.nth(1)).toContainText('Deccan Freight Carriers');
    await expect(rows.nth(1)).toContainText('₹43,800');
    await expect(rows.nth(1)).toContainText('Offered');
    await expect(rows.nth(2)).toContainText('Kaveri Roadlines');
    await expect(rows.nth(2)).toContainText('Waiting in line');
    await expect(rows.nth(3)).toContainText('NorthStar Logistics');
    await expect(table).not.toContainText('Sai Ganesh');
    await expect(page.getByRole('button', { name: /^Approve|^Reject/ })).toHaveCount(0); // no approval step

    expect((await carrierAccepts(request, trip.number, r.deccan)).status()).toBe(200);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Accepted by Deccan Freight Carriers at ₹43,800 (contract rate)' })).toBeVisible();
    await expect(page.locator('[aria-current="step"]')).toContainText('Awarded');
    await expect(table.getByRole('row').nth(1)).toContainText('Accepted');
    await expect(table.getByRole('row').nth(2)).toContainText('Withdrawn');
  });

  test('when every carrier passes: No carrier accepted, then Send again starts from the lowest rate', async ({ page, request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const r = await refs(anita);
    const trip = await book(anita, r);
    await carrierPasses(request, trip.number, r.deccan, 'No truck free');
    await carrierPasses(request, trip.number, r.kaveri);
    await carrierPasses(request, trip.number, r.northstar);
    await loginUi(page, USERS.shipperHead, `/trips/${trip.id}`);
    await expect(page.getByRole('heading', { name: 'No carrier accepted' })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Carriers in offer order' }).getByRole('row').filter({ hasText: 'Deccan Freight Carriers' })).toContainText('No truck free');
    await page.getByRole('button', { name: 'Send again' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Offers sent again.' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Offered to Deccan Freight Carriers' })).toBeVisible();
  });
});

test.describe('Trips list', () => {
  test('search, tabs with counts, row opens the trip, clear filters', async ({ page, request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const r = await refs(anita);
    const trip = await book(anita, r, { reference: 'FIND-ME-42' });
    await carrierPasses(request, trip.number, r.deccan);

    await loginUi(page, USERS.shipperHead, '/trips');
    await expect(page.getByRole('tab', { name: /^All \d+/ })).toBeVisible();
    await page.getByRole('textbox', { name: 'Search trips' }).fill('find-me-42');
    await expect(page.getByRole('row')).toHaveCount(2); // header + 1
    await expect(page).toHaveURL(/q=find-me-42/);
    const row = page.getByRole('row', { name: new RegExp(trip.number) });
    await expect(row).toContainText('Quotes requested');
    await expect(row).toContainText('Offered to Kaveri Roadlines at ₹44,500');

    await page.getByRole('tab', { name: /^Closed/ }).click();
    await expect(page.getByRole('heading', { name: 'No trips match' })).toBeVisible();
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(page.getByRole('textbox', { name: 'Search trips' })).toHaveValue('');
    await page.getByRole('tab', { name: /^Needs action/ }).click();
    await page.getByRole('row', { name: new RegExp(trip.number) }).click();
    await expect(page).toHaveURL(new RegExp(`/trips/${trip.id}$`));
    await expect(page.getByRole('link', { name: '← Trips' })).toBeVisible();
  });
});
