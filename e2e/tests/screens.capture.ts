import path from 'path';
import { USERS, asUser, expect, loginUi, test } from './helpers';
import { book, carrierQuotes, deliveredTrip, integration, refs, setPolicy } from './trips.helpers';

/**
 * Captures the key shipper screens for the design check against the approved UI design.
 * Run with `npm run capture`; images go to docs/shipper/screenshots.
 */
const OUT = path.join(__dirname, '..', '..', 'docs', 'shipper', 'screenshots');

test('capture key screens', async ({ page, request }) => {
  test.setTimeout(300_000);
  const anita = await asUser(request, USERS.shipperHead);
  const r = await refs(anita);
  await setPolicy(anita);
  const compare = await book(anita, r, { reference: 'PO-77810' });
  await carrierQuotes(request, compare.number, r.kaveri, 42500);
  await carrierQuotes(request, compare.number, r.northstar, 45900);
  await carrierQuotes(request, compare.number, r.deccan, 41800);
  const billed = await deliveredTrip(request, anita, r);
  await integration.pod(request, billed.number);
  await integration.invoice(request, billed.number, { number: 'INV-0902', freight: 42500 });
  const damaged = await deliveredTrip(request, anita, r, 2);
  await integration.pod(request, damaged.number, { remarks: '2 ctn damaged' });

  const shot = async (name: string) => {
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
  };

  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await shot('01-login');
  await loginUi(page, USERS.shipperHead);
  await expect(page.getByRole('heading', { name: 'Needs your decision' })).toBeVisible();
  await shot('02-home');
  await page.goto('/trips');
  await expect(page.getByRole('table', { name: 'Trips' })).toBeVisible();
  await shot('03-trips');
  await page.goto(`/trips/${compare.id}`);
  await expect(page.getByRole('heading', { name: 'Choose a carrier' })).toBeVisible();
  await shot('04-trip-compare-quotes');
  await page.goto(`/trips/${damaged.id}`);
  await expect(page.getByRole('heading', { name: 'Delivered · POD needs a look' })).toBeVisible();
  await shot('05-trip-pod-review');
  await page.goto(`/trips/${billed.id}`);
  await expect(page.getByRole('heading', { name: /^Invoice INV-0902/ })).toBeVisible();
  await shot('06-trip-invoice');
  await page.goto('/bookings/new?repeat=last');
  await expect(page.getByRole('radio', { name: '32ft MXL' })).toBeChecked();
  await page.getByRole('button', { name: 'Review and confirm' }).click();
  await expect(page.getByRole('heading', { name: 'Check and confirm' })).toBeVisible();
  await shot('07-new-booking-confirm');
  await page.goto('/approvals');
  await expect(page.getByRole('table', { name: 'Approvals' })).toBeVisible();
  await shot('08-approvals');
  await page.goto('/masters');
  await expect(page.getByRole('table', { name: 'Lanes' })).toBeVisible();
  await shot('09-carriers-and-lanes');
  await page.goto('/masters?tab=users');
  await page.getByRole('button', { name: '+ Add user' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await shot('10-invite-user-drawer');
  await page.goto('/policies');
  await expect(page.getByRole('heading', { name: 'Policies and approvals' })).toBeVisible();
  await shot('11-policies');
  await page.goto('/reports');
  await expect(page.getByRole('table', { name: 'Carrier scorecard' })).toBeVisible();
  await shot('12-reports');
  await page.goto('/reports/activity');
  await expect(page.getByRole('table', { name: 'Activity' })).toBeVisible();
  await shot('13-activity-log');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Needs your decision' })).toBeVisible();
  await shot('14-phone-home');
  await page.goto(`/trips/${compare.id}`);
  await expect(page.getByRole('heading', { name: 'Choose a carrier' })).toBeVisible();
  await shot('15-phone-compare-quotes');
});
