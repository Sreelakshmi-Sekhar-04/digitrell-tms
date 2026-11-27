import { USERS, asUser, expect, loginUi, test } from './helpers';
import { book, carrierAccepts, refs } from './trips.helpers';

test.describe('Notification bell (shipper)', () => {
  test('a carrier accept shows in the bell with a badge; clicking opens the trip and marks it read; Mark all read clears the rest', async ({ page, request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const r = await refs(anita);
    const trip = await book(anita, r);
    const other = await book(anita, r);
    await carrierAccepts(request, trip.number, r.deccan);
    await carrierAccepts(request, other.number, r.deccan);

    await loginUi(page, USERS.shipperHead);
    const badge = page.getByTestId('notif-badge');
    await expect(badge).toBeVisible();
    const before = Number((await badge.textContent())!.replace(/[^0-9]/g, ''));
    expect(before).toBeGreaterThanOrEqual(2);

    await page.getByTestId('notif-bell').click();
    const list = page.getByTestId('notif-list');
    const item = list.getByText(`Deccan Freight Carriers accepted ${trip.number} (Chennai → Bengaluru) at ₹43,800`);
    await expect(item).toBeVisible();
    await item.click();
    await expect(page).toHaveURL(new RegExp(`/trips/${trip.id}$`));
    await expect(page.getByRole('heading', { name: 'Accepted by Deccan Freight Carriers at ₹43,800 (contract rate)' })).toBeVisible();
    await expect(page.getByTestId('notif-badge')).toHaveText(String(before - 1));

    await page.getByTestId('notif-bell').click();
    await page.getByRole('button', { name: 'Mark all read' }).click();
    await expect(page.getByTestId('notif-badge')).toHaveCount(0);
  });

  test('the bell is only in the shipper header', async ({ page }) => {
    await loginUi(page, USERS.carrier, '/carrier');
    await expect(page.getByRole('navigation', { name: 'Main', exact: true })).toBeVisible();
    await expect(page.getByTestId('notif-bell')).toHaveCount(0);
  });
});
