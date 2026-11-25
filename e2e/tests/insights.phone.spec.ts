import { USERS, expect, loginUi, test } from './helpers';

test.describe('Dashboard and reports on a phone (390 × 844)', () => {
  test('Home, Reports and the activity log fit the screen', async ({ page }) => {
    await loginUi(page, USERS.shipperHead);
    await expect(page.getByRole('heading', { name: 'Needs your decision' })).toBeVisible();
    for (const path of ['/', '/reports', '/reports/activity', '/profile/messages']) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), path).toBeLessThanOrEqual(0);
    }
  });
});
