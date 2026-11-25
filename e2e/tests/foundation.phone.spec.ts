import { USERS, expect, loginUi, test } from './helpers';

test.describe('Phone layout (390 × 844)', () => {
  test('login form fits the screen without sideways scroll', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('sidebar is replaced by 4 bottom tabs, and More holds the rest plus sign out', async ({ page }) => {
    await loginUi(page, USERS.shipperHead);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Anita');
    await expect(page.getByRole('navigation', { name: 'Main', exact: true })).toBeHidden();

    const tabs = page.getByRole('navigation', { name: 'Main (phone)' });
    await expect(tabs.getByRole('link')).toHaveText([/^Home/, /^Trips/, /^Approvals/]);
    await expect(tabs.getByRole('button', { name: 'More' })).toBeVisible();

    await tabs.getByRole('link', { name: 'Trips' }).click();
    await expect(page).toHaveURL(/\/trips$/);
    await expect(tabs.getByRole('link', { name: 'Trips' })).toHaveAttribute('aria-current', 'page');

    await tabs.getByRole('button', { name: 'More' }).click();
    const more = page.locator('#more-menu');
    await expect(more.getByRole('link')).toHaveText(['New booking', 'Carriers and lanes', 'Reports', 'Policies', 'My messages']);
    await more.getByRole('link', { name: 'Reports' }).click();
    await expect(page).toHaveURL(/\/reports$/);
    await expect(more).toBeHidden();

    await tabs.getByRole('button', { name: 'More' }).click();
    await page.locator('#more-menu').getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login/);
  });

  test('no sideways scroll on a signed-in screen', async ({ page }) => {
    await loginUi(page, USERS.shipperHead);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
