import { expect, test as base, type Page } from '@playwright/test';
import { API_URL } from '../test-env';

/** Seeded test users (see backend/prisma/seed.ts). */
export const USERS = {
  shipperHead: { email: 'anita@sunrisefoods.test', password: 'Shipper@123', name: 'Anita Rao', company: 'Sunrise Foods Pvt Ltd' },
  shipperExec: { email: 'karthik@sunrisefoods.test', password: 'Shipper@123', name: 'Karthik S', company: 'Sunrise Foods Pvt Ltd' },
  inactive: { email: 'inactive@sunrisefoods.test', password: 'Shipper@123' },
  carrier: { email: 'vijay@kaveri.test', password: 'Carrier@123', name: 'Vijay Kumar', company: 'Kaveri Roadlines' },
  otherShipper: { email: 'meera@coastalpaints.test', password: 'Shipper@123', name: 'Meera Pillai', company: 'Coastal Paints' },
  // Demo company (backend/prisma/demo), loaded into the test database after the seed.
  demoHead: { email: 'lakshmi.menon@vasudhafoods.test', password: 'Demo@123', name: 'Lakshmi Menon', company: 'Vasudha Agro Foods Pvt Ltd' },
  demoAccounts: { email: 'suresh.babu@vasudhafoods.test', password: 'Demo@123', name: 'Suresh Babu', company: 'Vasudha Agro Foods Pvt Ltd' },
  demoExec: { email: 'arjun.reddy@vasudhafoods.test', password: 'Demo@123', name: 'Arjun Reddy', company: 'Vasudha Agro Foods Pvt Ltd' },
};

// New booking is started from Trips (and Home), not the menu; master data lives under one item.
export const NAV = ['Home', 'Trips', 'Approvals', 'Master data', 'Reports', 'Policies'];

/**
 * `test` with a guard that fails any UI test which logs a browser console error or an
 * uncaught page error (expected 4xx responses from deliberate negative tests are allowed).
 */
export const test = base.extend<{ consoleErrors: string[]; allowedConsole: RegExp | null }>({
  /** One extra console-error pattern a describe block expects, e.g. `test.use({ allowedConsole: /status of 404/ })`. */
  allowedConsole: [null, { option: true }],
  consoleErrors: [
    async ({ page, allowedConsole }, use) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
      page.on('console', (m) => {
        if (m.type() !== 'error') return;
        const text = m.text();
        // Deliberate 400/401/403/409 responses in negative tests (validation, auth, duplicates) are
        // shown to the user by the app; the browser still logs the HTTP status, which is expected.
        if (/status of 40[0139]/.test(text)) return;
        if (allowedConsole?.test(text)) return;
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

/** A signed-in API client for one seeded user: `const anita = await asUser(request, USERS.shipperHead)`. */
export async function asUser(request: import('@playwright/test').APIRequestContext, user: { email: string; password: string }) {
  const token = await apiLogin(request, user);
  const headers = { Authorization: `Bearer ${token}` };
  return {
    get: (path: string) => request.get(`${API_URL}${path}`, { headers }),
    post: (path: string, data?: unknown) => request.post(`${API_URL}${path}`, { headers, data }),
    patch: (path: string, data: unknown) => request.patch(`${API_URL}${path}`, { headers, data }),
    put: (path: string, data: unknown) => request.put(`${API_URL}${path}`, { headers, data }),
    delete: (path: string) => request.delete(`${API_URL}${path}`, { headers }),
    /** Raw file upload (bulk check/import): the bytes as application/octet-stream. */
    upload: (path: string, file: Buffer) => request.post(`${API_URL}${path}`, { headers: { ...headers, 'Content-Type': 'application/octet-stream' }, data: file }),
  };
}

/** A short unique suffix so repeated records in one run don't collide. */
export const uniq = () => Math.random().toString(36).slice(2, 7);
