import { NAV, USERS, expect, loginUi, test } from './helpers';

test.describe('Login', () => {
  test('shows inline errors for empty fields and stays on the page', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Enter your work email.')).toBeVisible();
    await expect(page.getByText('Enter your password.')).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Work email' })).toBeFocused();
    await expect(page).toHaveURL(/\/login/);
  });

  test('rejects a badly formed email before calling the server', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('textbox', { name: 'Work email' }).fill('anita');
    await page.getByRole('textbox', { name: 'Password', exact: true }).fill('whatever');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Enter a valid email, like name@company.com.')).toBeVisible();
  });

  test('wrong password shows an error, keeps the email and clears the password', async ({ page }) => {
    await loginUi(page, { email: USERS.shipperHead.email, password: 'wrong-password' });
    await expect(page.getByRole('alert').filter({ hasText: 'Email or password is incorrect.' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Work email' })).toHaveValue(USERS.shipperHead.email);
    await expect(page.getByRole('textbox', { name: 'Password', exact: true })).toHaveValue('');
  });

  test('show/hide toggles the password', async ({ page }) => {
    await page.goto('/login');
    const pw = page.getByRole('textbox', { name: 'Password', exact: true });
    await pw.fill('secret');
    await expect(pw).toHaveAttribute('type', 'password');
    await page.getByRole('button', { name: 'Show' }).click();
    await expect(pw).toHaveAttribute('type', 'text');
  });

  test('successful login lands on Home with the user and company in the header', async ({ page }) => {
    await loginUi(page, USERS.shipperHead);
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Anita');
    await expect(page.getByTestId('user-name')).toHaveText('Anita Rao');
    await expect(page.getByTestId('company-name')).toHaveText(USERS.shipperHead.company);
  });
});

test.describe('Access control', () => {
  test('signed-out visit to a screen redirects to login, then returns there after sign-in', async ({ page }) => {
    await page.goto('/approvals');
    await expect(page).toHaveURL(/\/login\?next=%2Fapprovals/);
    await expect(page.getByText('Please sign in to continue.')).toBeVisible();
    await page.getByRole('textbox', { name: 'Work email' }).fill(USERS.shipperExec.email);
    await page.getByRole('textbox', { name: 'Password', exact: true }).fill(USERS.shipperExec.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/approvals$/);
    await expect(page.getByRole('heading', { name: 'Approvals', level: 1 })).toBeVisible();
  });

  test('an external "next" target is ignored', async ({ page }) => {
    await loginUi(page, USERS.shipperHead, '//evil.example.com');
    await expect(page).toHaveURL(/localhost:3100\/$/);
  });

  test('carrier users are told this workspace is for shippers', async ({ page }) => {
    await loginUi(page, USERS.carrier);
    await expect(page.getByRole('heading', { name: 'This workspace is for shippers' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login/);
  });

  test('sign out ends the session and protects screens again', async ({ page }) => {
    await loginUi(page, USERS.shipperHead);
    await expect(page.getByTestId('user-name')).toBeVisible();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto('/trips');
    await expect(page).toHaveURL(/\/login\?next=%2Ftrips/);
  });

  test('session survives a page reload', async ({ page }) => {
    await loginUi(page, USERS.shipperHead);
    await expect(page.getByTestId('user-name')).toBeVisible();
    await page.reload();
    await expect(page.getByTestId('user-name')).toHaveText('Anita Rao');
  });
});

test.describe('App shell and navigation', () => {
  test.beforeEach(async ({ page }) => {
    await loginUi(page, USERS.shipperHead);
    await expect(page.getByTestId('user-name')).toBeVisible();
  });

  test('sidebar lists the 7 shipper items in design order', async ({ page }) => {
    const nav = page.getByRole('navigation', { name: 'Main', exact: true });
    await expect(nav.getByRole('link')).toHaveText(NAV.map((n) => new RegExp(`^${n}`))); // Approvals may carry a count
  });

  test('every menu item opens its screen and is marked current', async ({ page }) => {
    const nav = page.getByRole('navigation', { name: 'Main', exact: true });
    const expected: Record<string, { url: RegExp; heading: string | RegExp }> = {
      Trips: { url: /\/trips$/, heading: 'Trips' },
      Approvals: { url: /\/approvals$/, heading: 'Approvals' },
      'Master data': { url: /\/masters$/, heading: 'Master data' },
      Reports: { url: /\/reports$/, heading: 'Reports' },
      Policies: { url: /\/policies$/, heading: 'Policies and approvals' },
      Home: { url: /\/$/, heading: /Good (morning|afternoon|evening), Anita/ },
    };
    for (const [label, exp] of Object.entries(expected)) {
      await nav.getByRole('link', { name: new RegExp(`^${label}`) }).click();
      await expect(page).toHaveURL(exp.url);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(exp.heading);
      await expect(nav.getByRole('link', { name: new RegExp(`^${label}`) })).toHaveAttribute('aria-current', 'page');
      await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
    }
  });

  test('every shipper screen is built: no "arrives in phase" placeholders remain', async ({ page }) => {
    // (Phases 1–5 showed placeholders for screens still to come; after phase 6 there are none.)
    for (const path of ['/', '/trips', '/bookings/new', '/approvals', '/masters', '/reports', '/policies', '/reports/activity', '/profile/messages']) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.getByText(/Arrives in phase/)).toHaveCount(0);
    }
  });

  test('design tokens: primary teal, Inter body, Space Grotesk headings, canvas background', async ({ page }) => {
    const active = page.getByRole('navigation', { name: 'Main', exact: true }).locator('[aria-current="page"]');
    await expect(active).toHaveCSS('color', 'rgb(14, 107, 122)');
    await expect(active).toHaveCSS('background-color', 'rgb(230, 242, 243)');
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(245, 247, 246)');
    expect(await page.locator('body').evaluate((el) => getComputedStyle(el).fontFamily)).toContain('Inter');
    expect(await page.getByRole('heading', { level: 1 }).evaluate((el) => getComputedStyle(el).fontFamily)).toContain('Space Grotesk');
  });

  test('menu items meet the 44px touch target', async ({ page }) => {
    const links = page.getByRole('navigation', { name: 'Main', exact: true }).getByRole('link');
    for (let i = 0; i < (await links.count()); i++) {
      const box = await links.nth(i).boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
  });

});

test.describe('Not found', () => {
  test.use({ allowedConsole: /status of 404/ }); // the browser logs the page's own 404 status

  test('unknown page shows a branded not-found screen with a way home', async ({ page }) => {
    const res = await page.goto('/no-such-page');
    expect(res?.status()).toBe(404);
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
    await page.getByRole('link', { name: 'Go to Home' }).click();
    await expect(page).toHaveURL(/\/login\?next=%2F$/); // signed out, so Home asks to sign in first
  });
});
