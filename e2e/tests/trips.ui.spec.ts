import type { Page } from '@playwright/test';
import { USERS, asUser, expect, loginUi, test } from './helpers';
import { book, carrierQuotes, refs } from './trips.helpers';

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
    await field(page, 'Budget per trip (₹)').fill('46000');
    await page.getByRole('button', { name: '+ Receiver contact, reference, notes' }).click();
    await field(page, 'Your reference').fill('PO-77810');
    await page.getByRole('button', { name: 'Review and confirm' }).click();

    await expect(page.getByRole('heading', { name: 'Check and confirm' })).toBeVisible();
    await expect(page.getByText('4 approved carriers: ')).toContainText('Kaveri Roadlines');
    await expect(page.getByText('₹46,000 per trip')).toBeVisible();
    await page.getByLabel('Quote window').selectOption('4');
    await page.getByRole('button', { name: 'Confirm and ask for quotes' }).click();

    await expect(page).toHaveURL(/\/trips\/[a-z0-9]+$/);
    // (The "TR-… booked." toast shows for 6 s; the first dev-server compile of this page can take longer, so it isn't asserted here.)
    await expect(page.getByRole('heading', { name: 'Chennai → Bengaluru', level: 1 })).toBeVisible();
    await expect(page.getByText(/Booked on the web · Anita Rao/)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Waiting for quotes' })).toBeVisible();
    await expect(page.locator('dd').filter({ hasText: 'PO-77810' })).toBeVisible();
    await expect(page.locator('[aria-current="step"]')).toContainText('Quotes');
  });

  test('a lane with no approved carriers explains what to do and keeps the form', async ({ page }) => {
    await loginUi(page, USERS.shipperHead, '/bookings/new');
    await page.getByRole('button', { name: 'Clear' }).click();
    await field(page, 'Pickup').selectOption({ label: 'Ambattur DC, Chennai' });
    await field(page, 'Drop').selectOption({ label: 'Medchal DC, Hyderabad' });
    await field(page, 'Weight (tonnes)').fill('5');
    await page.getByText('14ft', { exact: true }).click();
    await field(page, 'Material').fill('Snacks');
    await page.getByRole('button', { name: 'Review and confirm' }).click();
    const alert = page.getByRole('alert').filter({ hasText: 'No approved carriers for Chennai → Hyderabad with 14ft' });
    await expect(alert).toBeVisible();
    await expect(alert.getByRole('link', { name: 'Open Master data → Lanes' })).toHaveAttribute('href', '/masters?tab=lanes');
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

test.describe('Compare quotes and award', () => {
  test('recommended carrier is pre-selected with reasons; award another, undo, then award', async ({ page, request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const r = await refs(anita);
    const trip = await book(anita, r);
    await carrierQuotes(request, trip.number, r.kaveri, 42500);
    await carrierQuotes(request, trip.number, r.northstar, 45900);
    await carrierQuotes(request, trip.number, r.deccan, 41800);

    await loginUi(page, USERS.shipperHead, `/trips/${trip.id}`);
    await expect(page.getByRole('heading', { name: 'Choose a carrier' })).toBeVisible();
    await expect(page.getByText('3 of 4 carriers quoted. Budget for this trip: ₹46,000.')).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Pick Kaveri Roadlines' })).toBeChecked();
    await expect(page.getByText('Why Kaveri Roadlines:')).toBeVisible();
    await expect(page.getByRole('row', { name: /Sai Ganesh Transport/ })).toContainText('Waiting');

    await page.getByRole('row', { name: /Deccan Freight Carriers/ }).click();
    const award = page.getByRole('button', { name: 'Award to Deccan Freight Carriers · ₹41,800' });
    await award.click();
    await expect(page.getByRole('status').filter({ hasText: 'Awarded to Deccan Freight Carriers.' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Awarded to Deccan Freight Carriers · ₹41,800' })).toBeVisible();
    await expect(page.locator('[aria-current="step"]')).toContainText('Awarded');
    await expect(page.getByText(/Awarded to Deccan Freight Carriers at ₹41,800 \(not the recommended carrier\)/)).toBeVisible();

    await page.getByRole('button', { name: 'Undo award' }).click();
    await expect(page.getByRole('heading', { name: 'Choose a carrier' })).toBeVisible();
    await page.getByRole('button', { name: 'Award to Kaveri Roadlines · ₹42,500' }).click();
    await expect(page.getByRole('heading', { name: 'Awarded to Kaveri Roadlines · ₹42,500' })).toBeVisible();
  });

  test('reject all needs a reason, then the trip waits for fresh quotes', async ({ page, request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const r = await refs(anita);
    const trip = await book(anita, r);
    await carrierQuotes(request, trip.number, r.kaveri, 55000);
    await loginUi(page, USERS.shipperHead, `/trips/${trip.id}`);
    await page.getByRole('button', { name: 'Reject all and ask again' }).click();
    await page.getByRole('button', { name: 'Reject all and ask again' }).click();
    await expect(page.getByText('Say why, e.g. "All quotes above budget".')).toBeVisible();
    await field(page, 'Reason').fill('Quote above budget');
    await page.getByRole('button', { name: 'Reject all and ask again' }).click();
    await expect(page.getByRole('heading', { name: 'Waiting for quotes' })).toBeVisible();
    await expect(page.getByText(/All quotes rejected; 4 carriers asked again — “Quote above budget”/)).toBeVisible();
  });

  test('booking executive sees why they cannot award', async ({ page, request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const r = await refs(anita);
    const trip = await book(anita, r);
    await carrierQuotes(request, trip.number, r.kaveri, 42500);
    await loginUi(page, USERS.shipperExec, `/trips/${trip.id}`);
    await expect(page.getByText("Your role can't approve awards.")).toBeVisible();
    await expect(page.getByRole('button', { name: /^Award to/ })).toBeDisabled();
  });
});

test.describe('Approvals inbox', () => {
  test('badge shows the count; approve awards the recommended carrier; reject asks for a reason', async ({ page, request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const r = await refs(anita);
    const a = await book(anita, r, { reference: 'INBOX-A' });
    const b = await book(anita, r, { reference: 'INBOX-B' });
    await carrierQuotes(request, a.number, r.kaveri, 42500);
    await carrierQuotes(request, b.number, r.northstar, 44000);

    await loginUi(page, USERS.shipperHead, '/approvals');
    const badge = page.getByRole('navigation', { name: 'Main', exact: true }).getByTestId('approvals-badge');
    const before = Number(await badge.textContent());
    expect(before).toBeGreaterThanOrEqual(2);

    const rowA = page.getByRole('row', { name: new RegExp(a.number) });
    await expect(rowA).toContainText('Award Chennai → Bengaluru to Kaveri Roadlines');
    await expect(rowA).toContainText('₹42,500');
    await rowA.getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByRole('status').filter({ hasText: `${a.number} awarded.` })).toBeVisible();
    await expect(page.getByRole('row', { name: new RegExp(a.number) })).toHaveCount(0);
    await expect(badge).toHaveText(String(before - 1));

    const rowB = page.getByRole('row', { name: new RegExp(b.number) });
    await rowB.getByRole('button', { name: 'Reject' }).click();
    await page.getByRole('button', { name: 'Reject and ask again' }).click();
    await expect(page.getByText('Say why. It is logged with the trip.')).toBeVisible();
    await field(page, `Why reject all quotes for ${b.number}?`).fill('Need a 2nd quote');
    await page.getByRole('button', { name: 'Reject and ask again' }).click();
    await expect(page.getByRole('row', { name: new RegExp(b.number) })).toHaveCount(0);

    await page.getByRole('link', { name: a.number }).count(); // gone from inbox; open it from Trips instead
    await page.goto(`/trips/${a.id}`);
    await expect(page.getByRole('heading', { name: 'Awarded to Kaveri Roadlines · ₹42,500' })).toBeVisible();
  });

  test('approver above their limit cannot approve but can see the item', async ({ page, request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const r = await refs(anita);
    const trip = await book(anita, r);
    await carrierQuotes(request, trip.number, r.kaveri, 42500);
    await loginUi(page, { email: 'priya@sunrisefoods.test', password: 'Shipper@123' }, '/approvals');
    const row = page.getByRole('row', { name: new RegExp(trip.number) });
    await expect(row.getByRole('button', { name: 'Approve' })).toBeDisabled();
    await expect(row.getByRole('button', { name: 'Approve' })).toHaveAttribute('title', 'Above your limit of ₹40,000');
  });
});

test.describe('Trips list', () => {
  test('search, tabs with counts, row opens the trip, clear filters', async ({ page, request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const r = await refs(anita);
    const trip = await book(anita, r, { reference: 'FIND-ME-42' });
    await carrierQuotes(request, trip.number, r.kaveri, 42000);

    await loginUi(page, USERS.shipperHead, '/trips');
    await expect(page.getByRole('tab', { name: /^All \d+/ })).toBeVisible();
    await page.getByRole('textbox', { name: 'Search trips' }).fill('find-me-42');
    await expect(page.getByRole('row')).toHaveCount(2); // header + 1
    await expect(page).toHaveURL(/q=find-me-42/);
    const row = page.getByRole('row', { name: new RegExp(trip.number) });
    await expect(row).toContainText('Quotes received');
    await expect(row).toContainText('Choose a carrier (1 of 4 quoted)');

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
