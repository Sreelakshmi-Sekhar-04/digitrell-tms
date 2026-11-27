import { CARRIER_NAV, USERS, asUser, expect, loginUi, test } from './helpers';

test.describe('Carrier login and access', () => {
  test('carrier login lands on the carrier Home with user, role and company in the header', async ({ page }) => {
    await loginUi(page, USERS.carrier);
    await expect(page).toHaveURL(/\/carrier$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Good (morning|afternoon|evening), Vijay/);
    await expect(page.getByTestId('user-name')).toHaveText('Vijay Kumar');
    await expect(page.getByTestId('company-name')).toHaveText('Kaveri Roadlines');
    await expect(page.getByText('Owner (approver)')).toBeVisible();
  });

  test('signed-out visit to a carrier screen asks to sign in, then returns there', async ({ page }) => {
    await page.goto('/carrier/fleet');
    await expect(page).toHaveURL(/\/login\?next=%2Fcarrier%2Ffleet/);
    await page.getByRole('textbox', { name: 'Work email' }).fill(USERS.carrierTraffic.email);
    await page.getByRole('textbox', { name: 'Password', exact: true }).fill(USERS.carrierTraffic.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/carrier\/fleet$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Fleet and rates');
  });

  test('a shipper "next" link is ignored for a carrier, who lands on the carrier Home', async ({ page }) => {
    await loginUi(page, USERS.carrier, '/trips');
    await expect(page).toHaveURL(/\/carrier$/);
  });

  test('a carrier "next" link is ignored for a shipper, who lands on the shipper Home', async ({ page }) => {
    await loginUi(page, USERS.shipperHead, '/carrier/loads');
    await expect(page).toHaveURL(/localhost:\d+\/$/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Anita');
  });

  test('a shipper opening a carrier screen is taken to the shipper Home', async ({ page }) => {
    await loginUi(page, USERS.shipperHead);
    await expect(page.getByTestId('user-name')).toHaveText('Anita Rao');
    await page.goto('/carrier/policies');
    await expect(page).toHaveURL(/localhost:\d+\/$/);
    await expect(page.getByRole('navigation', { name: 'Main', exact: true }).getByRole('link', { name: 'Loads' })).toHaveCount(0);
  });

  test('carrier session survives a reload and sign out protects the screens again', async ({ page }) => {
    await loginUi(page, USERS.carrierAccounts);
    await expect(page.getByTestId('user-name')).toHaveText('Suresh M');
    await page.reload();
    await expect(page.getByTestId('user-name')).toHaveText('Suresh M');
    await expect(page.getByText('Accounts', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto('/carrier/loads');
    await expect(page).toHaveURL(/\/login\?next=%2Fcarrier%2Floads/);
  });

  test('a deactivated carrier user sees the login error', async ({ page }) => {
    await loginUi(page, USERS.carrierInactive);
    await expect(page.getByRole('alert').filter({ hasText: 'Email or password is incorrect.' })).toBeVisible();
  });
});

test.describe('Carrier app shell and navigation', () => {
  test.beforeEach(async ({ page }) => {
    await loginUi(page, USERS.carrier);
    await expect(page.getByTestId('user-name')).toBeVisible();
  });

  test('sidebar lists the 6 carrier items in design order', async ({ page }) => {
    const nav = page.getByRole('navigation', { name: 'Main', exact: true });
    await expect(nav.getByRole('link')).toHaveText(CARRIER_NAV.map((n) => new RegExp(`^${n}`)));
  });

  test('every menu item opens its screen and is marked current', async ({ page }) => {
    const nav = page.getByRole('navigation', { name: 'Main', exact: true });
    const expected: Record<string, { url: RegExp; heading: string | RegExp }> = {
      Loads: { url: /\/carrier\/loads$/, heading: 'Loads' },
      Approvals: { url: /\/carrier\/approvals$/, heading: 'Approvals' },
      'Fleet and rates': { url: /\/carrier\/fleet$/, heading: 'Fleet and rates' },
      Reports: { url: /\/carrier\/reports$/, heading: 'Reports' },
      Policies: { url: /\/carrier\/policies$/, heading: 'Policies' },
      Home: { url: /\/carrier$/, heading: /Good (morning|afternoon|evening), Vijay/ },
    };
    for (const [label, exp] of Object.entries(expected)) {
      await nav.getByRole('link', { name: new RegExp(`^${label}`) }).click();
      await expect(page).toHaveURL(exp.url);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(exp.heading);
      await expect(nav.getByRole('link', { name: new RegExp(`^${label}`) })).toHaveAttribute('aria-current', 'page');
      await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
    }
  });

  test('the logo goes to the carrier Home', async ({ page }) => {
    await page.goto('/carrier/reports');
    await page.getByRole('link', { name: 'DigitRell TMS home' }).click();
    await expect(page).toHaveURL(/\/carrier$/);
  });

  test('the screen not built yet (Reports) says which phase brings it, with no dead controls', async ({ page }) => {
    await page.goto('/carrier/reports');
    await expect(page.getByRole('heading', { name: 'Arrives in phase 7' })).toBeVisible();
    await expect(page.locator('main').getByRole('button')).toHaveCount(0);
  });

  test('the approvals badge matches the carrier inbox', async ({ page, request }) => {
    const vijay = await asUser(request, USERS.carrier);
    const { count } = await (await vijay.get('/carrier/approvals')).json();
    const badge = page.getByRole('navigation', { name: 'Main', exact: true }).getByTestId('approvals-badge');
    if (count === 0) await expect(badge).toHaveCount(0);
    else await expect(badge).toHaveText(String(count));
  });

  test('design tokens and 44px touch targets match the shipper desk', async ({ page }) => {
    const nav = page.getByRole('navigation', { name: 'Main', exact: true });
    const active = nav.locator('[aria-current="page"]');
    await expect(active).toHaveCSS('color', 'rgb(14, 107, 122)');
    await expect(active).toHaveCSS('background-color', 'rgb(230, 242, 243)');
    expect(await page.getByRole('heading', { level: 1 }).evaluate((el) => getComputedStyle(el).fontFamily)).toContain('Space Grotesk');
    const links = nav.getByRole('link');
    for (let i = 0; i < (await links.count()); i++) expect((await links.nth(i).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  });
});

test.describe('Carrier not found', () => {
  test.use({ allowedConsole: /status of 404/ });

  test('an unknown carrier page shows the branded not-found screen', async ({ page }) => {
    const res = await page.goto('/carrier/no-such-page');
    expect(res?.status()).toBe(404);
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  });
});
