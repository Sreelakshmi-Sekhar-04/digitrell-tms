import type { Page } from '@playwright/test';
import { NAV, USERS, expect, loginUi, test } from './helpers';

const BOT_WORDS = /whatsapp|\bbots?\b|\bsms\b|voice note/i;
const BOT_REQUEST = /whatsapp|\/bot\b|bot-gateway|webhook/i;

/** Records every request the page makes, to prove nothing calls a removed bot endpoint. */
function watchRequests(page: Page) {
  const urls: string[] = [];
  page.on('request', (r) => urls.push(r.url()));
  return urls;
}

async function openTrip(page: Page) {
  await page.goto('/trips');
  await page.getByRole('row').nth(1).click();
  await expect(page).toHaveURL(/\/trips\/[a-z0-9]+$/);
}

test.describe('WhatsApp bot removed (screens)', () => {
  test('no screen mentions WhatsApp or the bot, and nothing calls a bot endpoint', async ({ page }) => {
    const urls = watchRequests(page);
    await page.goto('/login');
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
    expect(await page.locator('body').innerText()).not.toMatch(BOT_WORDS);

    await loginUi(page, USERS.demoHead);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Lakshmi');
    const screens = ['/', '/trips', '/bookings/new', '/approvals', '/masters', '/masters?tab=users', '/reports', '/reports/activity', '/policies', '/profile/messages'];
    for (const path of screens) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
      expect(await page.locator('body').innerText(), path).not.toMatch(BOT_WORDS);
    }
    await openTrip(page);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(await page.locator('body').innerText(), 'trip page').not.toMatch(BOT_WORDS);

    // Drawers and dialogs: invite a user, add a lane carrier.
    await page.goto('/masters?tab=users');
    await page.getByRole('button', { name: '+ Add user' }).click();
    expect(await page.getByRole('dialog').innerText()).not.toMatch(BOT_WORDS);

    expect(urls.filter((u) => BOT_REQUEST.test(u))).toEqual([]);
  });

  test('the desk sidebar no longer has the WhatsApp panel; navigation is unchanged', async ({ page }) => {
    await loginUi(page, USERS.shipperHead);
    const nav = page.getByRole('navigation', { name: 'Main', exact: true });
    await expect(nav.getByRole('link')).toHaveText(NAV);
    await expect(nav).not.toContainText(/whatsapp/i);
    await expect(page.getByRole('link', { name: 'My messages' })).toBeVisible();
  });

  test('My messages sets email updates: language and quiet hours, no "Send to" channel', async ({ page }) => {
    await loginUi(page, USERS.shipperExec);
    await page.getByRole('link', { name: 'My messages' }).click();
    await expect(page.getByRole('heading', { name: 'My messages', level: 1 })).toBeVisible();
    await expect(page.getByText('Which updates DigitRell emails you, and when.', { exact: false })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Message language' })).toBeVisible();
    await expect(page.getByRole('combobox', { name: /Quiet hours/ })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Send to' })).toHaveCount(0);
  });

  test('inviting a user: no "Gets messages on" choice, and email is required', async ({ page }) => {
    await loginUi(page, USERS.shipperHead, '/masters?tab=users');
    await page.getByRole('button', { name: '+ Add user' }).click();
    const drawer = page.getByRole('dialog');
    await expect(drawer.getByRole('combobox', { name: 'Gets messages on' })).toHaveCount(0);
    await expect(drawer.getByRole('combobox', { name: 'Message language' })).toBeVisible();
    await drawer.getByRole('textbox', { name: /^Name/ }).fill('Rekha Varma');
    await drawer.getByRole('textbox', { name: /^Mobile/ }).fill(`94${String(Date.now()).slice(-8)}`);
    await drawer.getByRole('radio', { name: /Booking executive/ }).check();
    await drawer.getByRole('button', { name: 'Create invite' }).click();
    await expect(drawer.getByText('Enter their email.')).toBeVisible();
    await expect(drawer.getByRole('textbox', { name: /^Name/ })).toHaveValue('Rekha Varma');
  });

  test('Policies list three agents (no intake) and the activity log has no Channel column', async ({ page }) => {
    await loginUi(page, USERS.shipperHead, '/policies');
    for (const agent of ['Tender', 'Bid evaluation', 'Billing']) await expect(page.getByText(agent, { exact: true })).toBeVisible();
    await expect(page.getByText('Intake', { exact: true })).toHaveCount(0);

    await page.goto('/reports/activity');
    await expect(page.getByRole('columnheader')).toHaveText(['Time', 'Who', 'What', 'Record', 'Reason']);
  });
});

test.describe('WhatsApp bot removed (addresses)', () => {
  test.use({ allowedConsole: /status of 404/ }); // the browser logs the page's own 404 status
  test('old bot addresses show the not-found page', async ({ page }) => {
    await loginUi(page, USERS.shipperHead);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    for (const path of ['/whatsapp', '/bot', '/settings/whatsapp']) {
      const res = await page.goto(path);
      expect(res?.status(), path).toBe(404);
      await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
    }
  });
});
