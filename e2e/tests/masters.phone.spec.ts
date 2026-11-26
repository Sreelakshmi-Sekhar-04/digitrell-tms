import { USERS, expect, loginUi, test } from './helpers';

test.describe('Masters on a phone (390 × 844)', () => {
  test('drawer fills the screen and the table scrolls inside its card', async ({ page }) => {
    await loginUi(page, USERS.shipperHead, '/masters?tab=addresses');
    await expect(page.getByRole('heading', { name: 'Master data', level: 1 })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    await page.getByRole('button', { name: '+ Add address' }).click();
    const box = await page.getByRole('dialog').boundingBox();
    expect(Math.round(box!.width)).toBe(390);
    await expect(page.getByRole('dialog').getByRole('button', { name: 'Save address' })).toBeInViewport();
  });

  test('policies page has no sideways scroll', async ({ page }) => {
    await loginUi(page, USERS.shipperHead, '/policies');
    await expect(page.getByRole('heading', { name: 'Policies and approvals', level: 1 })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
