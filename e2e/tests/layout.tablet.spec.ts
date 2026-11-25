import { USERS, asUser, expect, loginUi, test } from './helpers';
import { awardedTrip, refs } from './trips.helpers';

/** Tablet (768 × 1024): the sidebar layout starts here, so every screen must still fit. */
test.describe('Tablet layout (768 × 1024)', () => {
  test('every shipper screen fits without sideways scroll', async ({ page, request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const trip = await awardedTrip(request, anita, await refs(anita));
    await loginUi(page, USERS.shipperHead);
    await expect(page.getByRole('navigation', { name: 'Main', exact: true })).toBeVisible();
    for (const path of ['/', '/trips', `/trips/${trip.id}`, '/bookings/new', '/approvals', '/masters', '/masters?tab=users', '/reports', '/reports/activity', '/policies', '/profile/messages']) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
  });
});
