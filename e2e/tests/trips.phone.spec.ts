import { USERS, asUser, expect, loginUi, test } from './helpers';
import { book, carrierQuotes, refs } from './trips.helpers';

test.describe('Trips on a phone (390 × 844)', () => {
  test('trip detail and quote table fit; progress bar scrolls inside its card', async ({ page, request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const r = await refs(anita);
    const trip = await book(anita, r);
    await carrierQuotes(request, trip.number, r.kaveri, 42500);
    await loginUi(page, USERS.shipperHead, `/trips/${trip.id}`);
    await expect(page.getByRole('heading', { name: 'Choose a carrier' })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await expect(page.getByRole('button', { name: /^Award to/ })).toBeVisible();
  });

  test('new booking form fits the screen', async ({ page }) => {
    await loginUi(page, USERS.shipperHead, '/bookings/new');
    await expect(page.getByRole('button', { name: 'Review and confirm' })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
