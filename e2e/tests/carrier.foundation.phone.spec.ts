import { USERS, expect, loginUi, test } from './helpers';

test.describe('Carrier desk on a phone (390 × 844)', () => {
  test('bottom tabs are Home, Loads, Approvals; More holds the rest plus sign out', async ({ page }) => {
    await loginUi(page, USERS.carrierTraffic);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Divya');
    await expect(page.getByRole('navigation', { name: 'Main', exact: true })).toBeHidden();

    const tabs = page.getByRole('navigation', { name: 'Main (phone)' });
    await expect(tabs.getByRole('link')).toHaveText([/^Home/, /^Loads/, /^Approvals/]);

    await tabs.getByRole('link', { name: 'Loads' }).click();
    await expect(page).toHaveURL(/\/carrier\/loads$/);
    await expect(tabs.getByRole('link', { name: 'Loads' })).toHaveAttribute('aria-current', 'page');

    await tabs.getByRole('button', { name: 'More' }).click();
    const more = page.locator('#more-menu');
    await expect(more.getByRole('link')).toHaveText(['Fleet and rates', 'Reports', 'Policies']);
    await more.getByRole('link', { name: 'Fleet and rates' }).click();
    await expect(page).toHaveURL(/\/carrier\/fleet$/);
    await expect(more).toBeHidden();

    await tabs.getByRole('button', { name: 'More' }).click();
    await page.locator('#more-menu').getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login/);
  });

  test('no sideways scroll on any carrier screen', async ({ page }) => {
    await loginUi(page, USERS.carrier);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    for (const path of ['/carrier', '/carrier/loads', '/carrier/approvals', '/carrier/fleet', '/carrier/reports', '/carrier/policies']) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
  });
});
