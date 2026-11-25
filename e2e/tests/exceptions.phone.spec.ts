import { USERS, asUser, expect, loginUi, test } from './helpers';
import { book, exceptions, onTheRoad, refs } from './trips.helpers';

test.describe('Exceptions on a phone (390 × 844)', () => {
  test('cancel dialog and on-hold panel fit the screen', async ({ page, request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const r = await refs(anita);
    const trip = await book(anita, r);
    await loginUi(page, USERS.shipperHead, `/trips/${trip.id}`);
    await page.getByRole('button', { name: 'Cancel booking' }).click();
    const box = await page.getByRole('dialog').boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    await expect(page.getByRole('dialog').getByRole('button', { name: 'Keep booking' })).toBeInViewport();
    await page.keyboard.press('Escape');

    const moving = await onTheRoad(request, anita, r);
    await exceptions.report(request, moving.number, { kind: 'BREAKDOWN', description: 'Flat tyre', proposal: { fix: 'REPAIR', label: 'Repair on site', payer: 'CARRIER' } });
    await page.goto(`/trips/${moving.id}`);
    await expect(page.getByRole('heading', { name: 'Breakdown reported' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  });
});
