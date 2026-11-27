import type { Page } from '@playwright/test';
import { NAV, USERS, asUser, expect, loginUi, test, uniq } from './helpers';
import { carrierAccepts } from './trips.helpers';

/** A field by its visible label, ignoring the "*" / "(optional)" suffix. */
const field = (scope: Page | ReturnType<Page['getByRole']>, label: string) =>
  scope.getByLabel(new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( \\*| \\(optional\\))?$`));
const drawer = (page: Page) => page.getByRole('dialog');
const mainNav = (page: Page) => page.getByRole('navigation', { name: 'Main', exact: true });

test.describe('Navigation', () => {
  test('one "Master data" menu holds carriers, rate cards, lanes, addresses and users; New booking is not in the menu', async ({ page }) => {
    await loginUi(page, USERS.shipperHead);
    await expect(mainNav(page).getByRole('link')).toHaveText(NAV.map((n) => new RegExp(`^${n}`)));
    await expect(mainNav(page).getByRole('link', { name: /New booking/ })).toHaveCount(0);
    await expect(mainNav(page).getByRole('link', { name: /Carriers and lanes/ })).toHaveCount(0);

    await mainNav(page).getByRole('link', { name: 'Master data' }).click();
    await expect(page).toHaveURL(/\/masters$/);
    await expect(page.getByRole('heading', { name: 'Master data', level: 1 })).toBeVisible();
    await expect(page.getByRole('tab')).toHaveText(['Carriers', 'Rate cards', 'Lanes', 'Addresses', 'Users and roles']);
    for (const [tab, button] of [['Carriers', '+ Add carrier'], ['Rate cards', '+ Add rate card'], ['Lanes', '+ Add lane'], ['Addresses', '+ Add address'], ['Users and roles', '+ Add user']]) {
      await page.getByRole('tab', { name: tab }).click();
      await expect(page.getByRole('tab', { name: tab })).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByRole('button', { name: button })).toBeVisible();
    }

    // New booking still starts from Trips, and the menu keeps Trips highlighted on the booking page.
    await mainNav(page).getByRole('link', { name: /^Trips/ }).click();
    await page.getByRole('link', { name: '+ New booking' }).click();
    await expect(page).toHaveURL(/\/bookings\/new$/);
    await expect(page.getByRole('heading', { name: 'New booking', level: 1 })).toBeVisible();
    await expect(mainNav(page).getByRole('link', { name: /^Trips/ })).toHaveAttribute('aria-current', 'page');
  });
});

test('master data to booking: carrier → rate card → lane → booking offered at the contract rate', async ({ page, request }) => {
  test.setTimeout(240_000);
  const tag = uniq();
  const carrierName = `Pandian Roadlines ${tag}`;
  // City names are saved in title case, so use one already in that form.
  const dropCity = `Tirunelveli ${tag}`.replace(/\b\w/g, (c) => c.toUpperCase());
  // Addresses for the booking (the address tab has its own tests).
  const anita = await asUser(request, USERS.shipperHead);
  const pickup = (await (await anita.post('/addresses', { name: `Madurai Mill ${tag}`, city: 'Madurai', line1: 'Kappalur Industrial Estate', kind: 'PICKUP' })).json()).address;
  const drop = (await (await anita.post('/addresses', { name: `Tirunelveli DC ${tag}`, city: dropCity, line1: 'Gangaikondan SIPCOT', kind: 'DROP' })).json()).address;

  // 1. Create a carrier.
  await loginUi(page, USERS.shipperHead, '/masters');
  await expect(page.getByRole('tab', { name: 'Carriers' })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: '+ Add carrier' }).click();
  await drawer(page).getByRole('button', { name: 'Save carrier' }).click();
  await expect(drawer(page).getByText('Enter the carrier company name.')).toBeVisible();
  await expect(drawer(page).getByText("Enter the owner's mobile.")).toBeVisible();
  await field(drawer(page), 'Carrier company name').fill(carrierName);
  await field(drawer(page), "Owner's mobile").fill(`97${String(Date.now()).slice(-8)}`);
  await field(drawer(page), 'Contact person').fill('Muthu Pandian');
  await field(drawer(page), 'Contact mobile').fill('94430 55667');
  await field(drawer(page), 'City').fill('Madurai');
  await field(drawer(page), 'GSTIN').fill('33AAB');
  await drawer(page).getByRole('button', { name: 'Save carrier' }).click();
  await expect(drawer(page).getByText('Enter a 15-character GSTIN, e.g. 33AABCK1234F1Z5.')).toBeVisible();
  await expect(field(drawer(page), 'Contact person')).toHaveValue('Muthu Pandian'); // typed values stay
  await field(drawer(page), 'GSTIN').fill('33aabcp4321k1z9');
  await expect(field(drawer(page), 'GSTIN')).toHaveValue('33AABCP4321K1Z9');
  await drawer(page).getByRole('button', { name: 'Save carrier' }).click();
  await expect(page.getByRole('status').filter({ hasText: `${carrierName} added.` })).toBeVisible();
  const carrierRow = page.getByRole('row', { name: new RegExp(carrierName) });
  await expect(carrierRow).toContainText('Muthu Pandian');
  await expect(carrierRow).toContainText('+91 94430 55667');
  await expect(carrierRow).toContainText('33AABCP4321K1Z9');
  await expect(carrierRow).toContainText('Invited');

  // 2. Create its rate card (straight from the carrier's row), then update it.
  await carrierRow.getByRole('button', { name: `Rate card for ${carrierName}` }).click();
  await expect(page.getByRole('tab', { name: 'Rate cards' })).toHaveAttribute('aria-selected', 'true');
  await expect(drawer(page).getByRole('heading', { name: 'Add rate card' })).toBeVisible();
  await expect(field(drawer(page), 'Carrier')).toHaveValue(/.+/);
  await drawer(page).getByRole('button', { name: 'Save rate card' }).click();
  await expect(drawer(page).getByText('Enter the pickup city.')).toBeVisible();
  await expect(drawer(page).getByText('Enter the freight per trip.')).toBeVisible();
  const rate1 = drawer(page).getByRole('listitem', { name: 'Rate 1' });
  await field(rate1, 'Pickup city').fill('Madurai');
  await field(rate1, 'Drop city').fill(dropCity);
  await field(rate1, 'Truck type').selectOption('17ft');
  await field(rate1, 'Freight per trip (₹)').fill('18500');
  await expect(field(rate1, 'Freight per trip (₹)')).toHaveValue('18,500');
  await drawer(page).getByRole('button', { name: '+ Add another rate' }).click();
  const rate2 = drawer(page).getByRole('listitem', { name: 'Rate 2' });
  await field(rate2, 'Pickup city').fill('Madurai');
  await field(rate2, 'Drop city').fill('Trichy');
  await field(rate2, 'Truck type').selectOption('14ft');
  await field(rate2, 'Freight per trip (₹)').fill('9000');
  await field(rate2, 'Transit days').fill('1');
  await drawer(page).getByRole('button', { name: 'Save rate card' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Rate card saved.' })).toBeVisible();
  const cardRow = page.getByRole('row', { name: new RegExp(carrierName) });
  await expect(cardRow).toContainText('2 rates');
  await expect(cardRow).toContainText('₹9,000 – ₹18,500');
  await expect(cardRow).toContainText('Current');

  await cardRow.getByRole('button', { name: `Edit rate card for ${carrierName}` }).click();
  // Rates are listed by lane, so Madurai → Tirunelveli comes before Madurai → Trichy.
  const tirunelveli = drawer(page).getByRole('listitem', { name: 'Rate 1' });
  await expect(field(tirunelveli, 'Drop city')).toHaveValue(dropCity);
  await expect(field(tirunelveli, 'Freight per trip (₹)')).toHaveValue('18,500');
  await field(tirunelveli, 'Freight per trip (₹)').fill('19000');
  await field(tirunelveli, 'Detention per day (₹)').fill('800');
  await drawer(page).getByRole('button', { name: 'Save rate card' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Rate card updated.' })).toBeVisible();
  await expect(cardRow).toContainText('₹9,000 – ₹19,000');

  // 3. Create a lane and approve the carrier on it.
  await page.getByRole('tab', { name: 'Lanes' }).click();
  await page.getByRole('button', { name: '+ Add lane' }).click();
  await expect(drawer(page).getByText('Lowest within budget')).toHaveCount(0); // no award rule or budget on a lane any more
  await field(drawer(page), 'Pickup city').fill('Madurai');
  await field(drawer(page), 'Drop city').fill(dropCity);
  await drawer(page).getByText('17ft', { exact: true }).click();
  await drawer(page).getByRole('checkbox', { name: new RegExp(carrierName) }).check();
  await drawer(page).getByRole('checkbox', { name: /Kaveri Roadlines/ }).check();
  await drawer(page).getByRole('button', { name: 'Save lane' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Lane added.' })).toBeVisible();
  const laneRow = page.getByRole('row', { name: new RegExp(`Madurai → ${dropCity}`) });
  await expect(laneRow).toContainText(carrierName);
  await expect(laneRow).toContainText('Kaveri Roadlines');
  await page.getByRole('tab', { name: 'Carriers' }).click();
  await expect(page.getByRole('row', { name: new RegExp(carrierName) })).toContainText('2 rates');

  // 4. New booking (from Trips): no price to type; the rate card decides who is offered the load.
  await mainNav(page).getByRole('link', { name: /^Trips/ }).click();
  await page.getByRole('link', { name: '+ New booking' }).click();
  await page.getByRole('button', { name: 'Clear' }).click();
  await field(page, 'Pickup').selectOption({ label: `${pickup.name}, Madurai` });
  await field(page, 'Drop').selectOption({ label: `${drop.name}, ${dropCity}` });
  await field(page, 'Weight (tonnes)').fill('6');
  await page.getByText('17ft', { exact: true }).click();
  await field(page, 'Material').fill('Cotton yarn bales');
  await expect(page.getByLabel(/Budget/)).toHaveCount(0);
  const onContract = page.getByRole('region', { name: 'Carriers on contract for this lane' });
  await expect(onContract).toContainText(carrierName);
  await expect(onContract).toContainText('Offered first');
  await expect(onContract).toContainText('₹19,000');
  await expect(onContract).not.toContainText('Kaveri Roadlines'); // on the lane, but no contract rate for it
  await page.getByRole('button', { name: 'Review and confirm' }).click();
  await expect(page.getByRole('heading', { name: 'Check and confirm' })).toBeVisible();
  await expect(page.getByText(`${carrierName} at ₹19,000 (contract rate)`)).toBeVisible();
  await expect(page.getByText('No other carrier on contract for this lane.')).toBeVisible();
  await page.getByRole('button', { name: 'Confirm and offer the load' }).click();
  await expect(page.getByRole('heading', { name: `Offered to ${carrierName}` })).toBeVisible();
  const tripId = page.url().split('/').pop()!;

  // 5. The booking belongs to the lane and only the carrier with the contract rate was offered it, at that rate.
  const { trip } = await (await anita.get(`/trips/${tripId}`)).json();
  expect(trip).toMatchObject({ origin: 'Madurai', destination: dropCity, truckType: '17ft', status: 'QUOTES_REQUESTED' });
  expect(trip).not.toHaveProperty('budget');
  expect(trip.quotes.map((q: { carrier: string; status: string; amount: number }) => [q.carrier, q.status, q.amount])).toEqual([[carrierName, 'REQUESTED', 19000]]);
  const lane = (await (await anita.get('/lanes')).json()).lanes.find((l: { destination: string }) => l.destination === dropCity);
  expect((await (await anita.get(`/trips?laneId=${lane.id}`)).json()).trips.map((t: { id: string }) => t.id)).toEqual([tripId]);

  // The carrier accepts; the load is awarded at once at the contract rate.
  expect((await carrierAccepts(request, trip.number, trip.quotes[0].carrierId)).status()).toBe(200);
  await page.reload();
  await expect(page.getByRole('heading', { name: `Accepted by ${carrierName} at ₹19,000 (contract rate)` })).toBeVisible();
  expect((await (await anita.get(`/trips/${tripId}`)).json()).trip).toMatchObject({ status: 'AWARDED', carrier: carrierName, amount: 19000 });
});
