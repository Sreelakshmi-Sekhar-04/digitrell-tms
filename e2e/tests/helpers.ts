import { expect, test as base, type Page } from '@playwright/test';
import { API_URL } from '../test-env';

/** Seeded test users (see backend/prisma/seed.ts). */
export const USERS = {
  shipperHead: { email: 'anita@sunrisefoods.test', password: 'Shipper@123', name: 'Anita Rao', company: 'Sunrise Foods Pvt Ltd' },
  shipperExec: { email: 'karthik@sunrisefoods.test', password: 'Shipper@123', name: 'Karthik S', company: 'Sunrise Foods Pvt Ltd' },
  inactive: { email: 'inactive@sunrisefoods.test', password: 'Shipper@123' },
  carrier: { email: 'vijay@kaveri.test', password: 'Carrier@123', name: 'Vijay Kumar', company: 'Kaveri Roadlines' },
};

export const NAV = ['Home', 'Trips', 'New booking', 'Approvals', 'Carriers and lanes', 'Reports', 'Policies'];

/**
 * `test` with a guard that fails any UI test which logs a browser console error or an
 * uncaught page error (expected 4xx responses from deliberate negative tests are allowed).
 */
export const test = base.extend<{ consoleErrors: string[]; allowedConsole: RegExp[] }>({
  /** Extra console-error patterns a describe block expects, e.g. `test.use({ allowedConsole: [/404/] })`. */
  allowedConsole: [[], { option: true }],
  consoleErrors: [
    async ({ page, allowedConsole }, use) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
      page.on('console', (m) => {
        if (m.type() !== 'error') return;
        const text = m.text();
        if (/status of 40[013]/.test(text)) return; // deliberate auth failures in negative tests
        if (allowedConsole.some((re) => re.test(text))) return;
        errors.push(`console: ${text}`);
      });
      await use(errors);
      expect(errors, 'browser console errors').toEqual([]);
    },
    { auto: true },
  ],
});
export { expect };

export async function loginUi(page: Page, user: { email: string; password: string }, next?: string) {
  await page.goto(next ? `/login?next=${encodeURIComponent(next)}` : '/login');
  await page.getByRole('textbox', { name: 'Work email' }).fill(user.email);
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill(user.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

export async function apiLogin(request: import('@playwright/test').APIRequestContext, user: { email: string; password: string }) {
  const res = await request.post(`${API_URL}/auth/login`, { data: user });
  expect(res.status()).toBe(200);
  return (await res.json()).token as string;
}
