import type { Page } from '@playwright/test';
import { USERS, asUser, expect, loginUi, test } from './helpers';
import { awardedTrip, book, carrierPasses, exceptions, expireQuotes, onTheRoad, refs } from './trips.helpers';

const field = (page: Page, label: string) =>
  page.getByLabel(new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( \\*| \\(optional\\))?$`));

test.describe('Cancel and edit from the trip page', () => {
  test('cancel: dialog lists what happens, needs a reason (and a note for "Other"), then shows Cancelled', async ({ page, request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const r = await refs(anita);
    const trip = await book(anita, r);
    await loginUi(page, USERS.shipperHead, `/trips/${trip.id}`);
    await page.getByRole('button', { name: 'Cancel booking' }).click();
    const dlg = page.getByRole('dialog');
    await expect(dlg.getByRole('heading', { name: `Cancel ${trip.number}, Chennai → Bengaluru?` })).toBeVisible();
    await expect(dlg).toContainText('Deccan Freight Carriers is told the offer is withdrawn.');
    await expect(dlg.getByRole('button', { name: 'Keep booking' })).toBeFocused();

    await dlg.getByRole('button', { name: 'Cancel booking' }).click();
    await expect(dlg.getByText('Choose a reason.')).toBeVisible();
    await field(page, 'Reason').selectOption('OTHER');
    await dlg.getByRole('button', { name: 'Cancel booking' }).click();
    await expect(dlg.getByText('Say what the reason is.')).toBeVisible();
    await field(page, 'Note').fill('Plant shutdown');
    await dlg.getByRole('button', { name: 'Cancel booking' }).click();

    await expect(page.getByRole('heading', { name: 'Cancelled', level: 2 })).toBeVisible();
    await expect(page.getByText(/Other: Plant shutdown/).first()).toBeVisible();
    await expect(page.getByRole('list', { name: 'Trip progress' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Cancel booking' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Edit booking' })).toHaveCount(0);
  });

  test('Keep booking and Esc close the dialog without changing anything', async ({ page, request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const trip = await book(anita, await refs(anita));
    await loginUi(page, USERS.shipperHead, `/trips/${trip.id}`);
    await page.getByRole('button', { name: 'Cancel booking' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Keep booking' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('button', { name: 'Cancel booking' }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Offered to Deccan Freight Carriers' })).toBeVisible();
  });

  test('edit: weight does not restart the offers; a new pickup date warns, then offers start again from the lowest rate', async ({ page, request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const r = await refs(anita);
    const trip = await book(anita, r);
    await carrierPasses(request, trip.number, r.deccan); // Kaveri holds the offer now
    await loginUi(page, USERS.shipperHead, `/trips/${trip.id}`);
    await expect(page.getByRole('heading', { name: 'Offered to Kaveri Roadlines' })).toBeVisible();
    await page.getByRole('button', { name: 'Edit booking' }).click();
    const drawer = page.getByRole('dialog');
    const warning = drawer.getByText('Changing the pickup date restarts the offers from the lowest contract rate', { exact: false });
    await field(page, 'Your reference').fill('PO-EDIT-1');
    await field(page, 'Weight (tonnes)').fill('16');
    await expect(warning).toHaveCount(0);
    const later = new Date(Date.now() + 5.5 * 3600_000 + 2 * 86400_000).toISOString().slice(0, 10);
    await field(page, 'Pickup date').fill(later);
    await expect(warning).toBeVisible();
    await drawer.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('heading', { name: 'Offered to Deccan Freight Carriers' })).toBeVisible();
    await expect(page.getByText(`${trip.number} · Biscuits (packed cartons) · 32ft MXL · 16 t`)).toBeVisible();
    await expect(page.locator('dd').filter({ hasText: 'PO-EDIT-1' })).toBeVisible();
  });

  test('after the award the load fields are locked in the edit drawer', async ({ page, request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const trip = await awardedTrip(request, anita, await refs(anita));
    await loginUi(page, USERS.shipperHead, `/trips/${trip.id}`);
    await page.getByRole('button', { name: 'Edit booking' }).click();
    await expect(page.getByText('Date, weight and material are fixed once a carrier is awarded.')).toBeVisible();
    await expect(field(page, 'Weight (tonnes)')).toBeDisabled();
    await expect(field(page, 'Notes for carrier')).toBeEnabled();
  });
});

test.describe('Give the offered carrier more time', () => {
  test('extend the response time from the trip page; once everyone has passed it is Send again instead', async ({ page, request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const r = await refs(anita);
    const trip = await book(anita, r);
    await loginUi(page, USERS.shipperHead, `/trips/${trip.id}`);
    await expect(page.getByRole('heading', { name: 'Offered to Deccan Freight Carriers' })).toBeVisible();
    await page.getByLabel('Give the carrier more time').selectOption('4');
    await page.getByRole('button', { name: 'Extend response time' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'The carrier has 4 more hours to answer.' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Offered to Deccan Freight Carriers' })).toBeVisible();

    await expireQuotes(request, trip.number);
    await carrierPasses(request, trip.number, r.kaveri);
    await carrierPasses(request, trip.number, r.northstar);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'No carrier accepted' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Extend response time' })).toHaveCount(0);
  });
});

test.describe('On hold', () => {
  test('a fix billed to the shipper: reject needs a reason; a new proposal is approved; back on the road', async ({ page, request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const trip = await onTheRoad(request, anita, await refs(anita));
    const { exceptionId } = await (await exceptions.report(request, trip.number, {
      kind: 'BREAKDOWN', description: 'Clutch failure near Hubballi', proposal: { fix: 'SWAP', label: 'Swap to KA 22 TT 5120', extraCost: 3500, payer: 'SHIPPER' },
    })).json();
    await loginUi(page, USERS.shipperHead, `/trips/${trip.id}`);
    await expect(page.getByRole('heading', { name: 'Breakdown reported' })).toBeVisible();
    await expect(page.getByText('Proposed fix: Swap to KA 22 TT 5120')).toBeVisible();
    await expect(page.getByText('extra ₹3,500, billed to you')).toBeVisible();
    await page.getByRole('button', { name: 'Reject fix' }).click();
    await page.getByRole('button', { name: 'Reject fix' }).click();
    await expect(page.getByText('Say why, so the carrier can propose something else.')).toBeVisible();
    await field(page, 'Why').fill('Carrier should bear this');
    await page.getByRole('button', { name: 'Reject fix' }).click();
    await expect(page.getByText('You rejected this fix: “Carrier should bear this”.')).toBeVisible();

    await exceptions.propose(request, exceptionId, { fix: 'SWAP', label: 'Swap, cost shared', extraCost: 1750, payer: 'SHIPPER' });
    await page.reload();
    await page.getByRole('button', { name: 'Approve fix · ₹1,750' }).click();
    await expect(page.getByText('You approved this fix.')).toBeVisible();
    await exceptions.resolve(request, exceptionId, { truckNumber: 'KA 22 TT 5120' });
    await page.reload();
    await expect(page.getByRole('heading', { name: 'On the road' })).toBeVisible();
    await expect(page.getByText(/Back on the road with truck KA 22 TT 5120/)).toBeVisible();
  });

  test('approvals inbox shows the fix; booking executive cannot cancel a trip on the road', async ({ page, request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const trip = await onTheRoad(request, anita, await refs(anita));
    await exceptions.report(request, trip.number, { kind: 'ACCIDENT', description: 'Minor collision, cargo safe', proposal: { fix: 'TRANSHIP', label: 'Tranship to a new truck', extraCost: 4000, payer: 'SHIPPER' } });
    await loginUi(page, USERS.shipperHead, '/approvals');
    const row = page.getByRole('row', { name: new RegExp(trip.number) });
    await expect(row).toContainText('Exception fix');
    await expect(row).toContainText('Tranship to a new truck on Chennai → Bengaluru');
    await row.getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByRole('status').filter({ hasText: `${trip.number}: fix approved.` })).toBeVisible();

    await page.getByRole('button', { name: 'Sign out' }).click();
    await loginUi(page, USERS.shipperExec, `/trips/${trip.id}`);
    const cancel = page.getByRole('button', { name: 'Cancel booking' });
    await expect(cancel).toBeDisabled();
    await expect(cancel).toHaveAttribute('title', 'The goods are on the truck. Only the logistics head can cancel now.');
  });
});
