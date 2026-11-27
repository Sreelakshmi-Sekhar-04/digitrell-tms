import { USERS, asUser, expect, loginUi, test } from './helpers';
import { book, carrierAccepts, deliveredTrip, integration, refs } from './trips.helpers';

test.describe('Home dashboard', () => {
  test('first-time shipper sees the setup checklist with what is done', async ({ page }) => {
    await loginUi(page, USERS.otherShipper);
    await expect(page.getByRole('heading', { name: 'Good morning, Meera' }).or(page.getByRole('heading', { name: /Good (afternoon|evening), Meera/ }))).toBeVisible();
    await expect(page.getByText('Welcome to DigitRell. Finish setup, then book your first truck.')).toBeVisible();
    const setup = page.getByRole('heading', { name: 'Set up in five steps' }).locator('..');
    await expect(setup.getByText('Done')).toHaveCount(3); // addresses, lanes, carriers
    await setup.getByRole('link', { name: 'Check limits' }).click();
    await expect(page).toHaveURL(/\/policies$/);
  });

  test('decisions can be approved from Home; month tiles and active trips are shown', async ({ page, request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const r = await refs(anita);
    // A decision for the shipper: a delivered trip whose invoice waits for approval.
    await book(anita, r, { reference: 'HOME-1' });
    const billed = await deliveredTrip(request, anita, r);
    await integration.pod(request, billed.number);
    await integration.invoice(request, billed.number, { number: `INV-H${Date.now() % 100000}`, freight: 43800 });
    await loginUi(page, USERS.shipperHead);
    await expect(page.getByText(/decisions? (is|are) waiting for you\./)).toBeVisible();
    for (const tile of ['Trips booked', 'On time', 'Freight awarded', 'PODs to review']) await expect(page.getByText(tile, { exact: true })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Active trips' })).toBeVisible();

    const decisions = page.getByRole('heading', { name: 'Needs your decision' }).locator('..').locator('..');
    const badge = page.getByRole('navigation', { name: 'Main', exact: true }).getByTestId('approvals-badge');
    const before = Number(await badge.textContent());
    const first = decisions.getByRole('listitem').first();
    // The first line reads "<kind> · <ref>", e.g. "Carrier award · TR-24131" or "Payment · INV-0902".
    const ref = (await first.getByTestId('approval-ref').textContent())!;
    await first.getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByRole('status').filter({ hasText: ref })).toBeVisible();
    // The badge shows the new count, or disappears when nothing is left.
    if (before > 1) {
      await expect(badge).toHaveText(String(before - 1));
      await decisions.getByRole('link', { name: /^See all/ }).click();
      await expect(page).toHaveURL(/\/approvals$/);
    } else {
      await expect(badge).toHaveCount(0);
    }
  });

  test('Repeat last booking fills the booking form', async ({ page }) => {
    await loginUi(page, USERS.shipperHead);
    await page.getByRole('link', { name: 'Repeat last booking' }).click();
    await expect(page).toHaveURL(/\/bookings\/new\?repeat=last$/);
    await expect(page.getByLabel(/^Pickup( \*)?$/)).not.toHaveValue('');
    await expect(page.getByRole('radio', { name: '32ft MXL' })).toBeChecked();
  });

  test('header search finds a trip from any page', async ({ page, request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const trip = await book(anita, await refs(anita), { reference: 'HEADER-SEARCH' });
    await loginUi(page, USERS.shipperHead, '/policies');
    await page.getByRole('textbox', { name: 'Search all trips' }).fill(trip.number);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/trips\\?q=${trip.number}`));
    await expect(page.getByRole('textbox', { name: 'Search trips', exact: true })).toHaveValue(trip.number);
    await expect(page.getByRole('row', { name: new RegExp(trip.number) })).toBeVisible();
    await expect(page.getByRole('row')).toHaveCount(2);
  });
});

test.describe('Reports and activity log', () => {
  test('reports show KPIs, lane bars and scorecard; period changes; trips export downloads', async ({ page }) => {
    await loginUi(page, USERS.shipperHead, '/reports');
    for (const k of ['Freight awarded', 'On-time delivery', 'Average POD time', 'Trips']) await expect(page.getByText(k, { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('table', { name: 'Freight awarded by lane' })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Carrier scorecard' })).toBeVisible();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export trips (CSV)' }).click();
    expect((await download).suggestedFilename()).toBe('trips-month.csv');
    await page.getByLabel('Period').selectOption('last-month');
    await expect(page.getByRole('heading', { name: 'No awards in this period' })).toBeVisible();
  });

  test('activity log filters by trip and by people; export downloads', async ({ page, request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const r = await refs(anita);
    const trip = await book(anita, r);
    await carrierAccepts(request, trip.number, r.deccan);
    await loginUi(page, USERS.shipperHead, '/reports');
    await page.getByRole('link', { name: 'Activity log' }).click();
    await expect(page.getByRole('heading', { name: 'Activity log', level: 1 })).toBeVisible();
    await page.getByRole('textbox', { name: 'Trip number' }).fill(trip.number);
    const rows = page.getByRole('table', { name: 'Activity' }).getByRole('row');
    await expect(rows.filter({ hasText: 'Offered to Deccan Freight Carriers at ₹43,800' })).toHaveCount(1);
    await expect(rows.filter({ hasText: /Deccan Freight Carriers (accepted|was awarded)|Awarded to Deccan Freight Carriers/ }).first()).toBeVisible();
    await expect(rows.filter({ hasNotText: trip.number })).toHaveCount(1); // only the header row lacks it
    await page.getByLabel('Who').selectOption('people');
    await expect(rows.filter({ hasText: 'Booked on the web' })).toHaveCount(1);
    await expect(rows.filter({ hasText: 'Offered to' })).toHaveCount(0);
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export CSV' }).click();
    expect((await download).suggestedFilename()).toBe('activity-log.csv');
  });
});

test.describe('My messages', () => {
  test('change language and message types, save, and it persists', async ({ page }) => {
    await loginUi(page, USERS.shipperExec);
    await page.getByRole('link', { name: 'My messages' }).click();
    await expect(page.getByRole('heading', { name: 'My messages', level: 1 })).toBeVisible();
    const save = page.getByRole('button', { name: 'Save' });
    await expect(save).toBeDisabled();
    await page.getByLabel('Message language').selectOption('ta');
    const daily = page.getByRole('switch', { name: 'Daily summary at 19:00' });
    await expect(daily).toHaveAttribute('aria-checked', 'false');
    await daily.click();
    await page.getByLabel('Quiet hours').selectOption('22:00-07:00');
    await save.click();
    await expect(page.getByRole('status').filter({ hasText: 'Message settings saved.' })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Message language')).toHaveValue('ta');
    await expect(page.getByRole('switch', { name: 'Daily summary at 19:00' })).toHaveAttribute('aria-checked', 'true');
    // put it back
    await page.getByLabel('Message language').selectOption('en');
    await page.getByRole('switch', { name: 'Daily summary at 19:00' }).click();
    await page.getByLabel('Quiet hours').selectOption('');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Message settings saved.' })).toBeVisible();
  });
});
