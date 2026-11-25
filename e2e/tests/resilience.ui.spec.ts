import { USERS, expect, loginUi, test } from './helpers';

test.describe('When the network or server fails', () => {
  // Blocked requests are logged by the browser; these tests cause them on purpose.
  test.use({ allowedConsole: /ERR_FAILED|status of 500/ });

  test('a list that cannot load says so and recovers with Try again', async ({ page }) => {
    await loginUi(page, USERS.shipperHead);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.route('**/api/trips?**', (route) => route.abort());
    await page.getByRole('navigation', { name: 'Main', exact: true }).getByRole('link', { name: /^Trips/ }).click();
    await expect(page.getByRole('heading', { name: "Couldn't load trips" })).toBeVisible();
    await expect(page.getByText("Can't reach DigitRell. Check your connection and try again.")).toBeVisible();
    await page.unroute('**/api/trips?**');
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByRole('table', { name: 'Trips' })).toBeVisible();
  });

  test('a server error while saving keeps what was typed', async ({ page }) => {
    await loginUi(page, USERS.shipperHead, '/masters?tab=addresses');
    await page.getByRole('button', { name: '+ Add address' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(/^Short name/).fill('Server Error Test');
    await dialog.getByLabel(/^City/).fill('Chennai');
    await dialog.getByLabel(/^Street address/).fill('Anna Salai');
    await dialog.getByText('Drop', { exact: true }).click();
    await page.route('**/api/addresses', (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INTERNAL', message: 'Something went wrong on our side. Please try again.' } }) })
        : route.continue(),
    );
    await dialog.getByRole('button', { name: 'Save address' }).click();
    await expect(dialog.getByRole('alert').filter({ hasText: 'Something went wrong on our side. Please try again.' })).toBeVisible();
    await expect(dialog.getByLabel(/^Short name/)).toHaveValue('Server Error Test');
    await page.unroute('**/api/addresses');
    await dialog.getByRole('button', { name: 'Save address' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Server Error Test added.' })).toBeVisible();
  });

  test('an expired session sends you to sign in and back to the same page', async ({ page }) => {
    await loginUi(page, USERS.shipperHead, '/reports');
    await expect(page.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible();
    await page.evaluate(() => window.localStorage.setItem('dtms.token', 'expired-token'));
    await page.reload();
    await expect(page).toHaveURL(/\/login\?next=%2Freports/);
    await page.getByRole('textbox', { name: 'Work email' }).fill(USERS.shipperHead.email);
    await page.getByRole('textbox', { name: 'Password', exact: true }).fill(USERS.shipperHead.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/reports$/);
  });
});

test.describe('Keyboard only', () => {
  test('sign in, move through the menu and switch tabs without a mouse', async ({ page }) => {
    await page.goto('/login');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('textbox', { name: 'Work email' })).toBeFocused();
    await page.keyboard.type(USERS.shipperHead.email);
    await page.keyboard.press('Tab');
    await page.keyboard.type(USERS.shipperHead.password);
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('user-name')).toBeVisible();

    await page.goto('/masters');
    await page.getByRole('tab', { name: 'Lanes and carriers' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Addresses' })).toBeFocused();
    await expect(page.getByRole('tab', { name: 'Addresses' })).toHaveAttribute('aria-selected', 'true');

    await page.getByRole('button', { name: '+ Add address' }).press('Enter');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});
