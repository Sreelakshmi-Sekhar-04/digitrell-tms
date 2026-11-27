import type { Page } from '@playwright/test';
import { USERS, asUser, expect, loginUi, test } from './helpers';

const field = (page: Page, label: string) =>
  page.getByLabel(new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( \\*| \\(optional\\))?$`));

test.describe('Demo data on screen', () => {
  test('Home shows the decisions waiting, this month and the active trips', async ({ page, request }) => {
    const lakshmi = await asUser(request, USERS.demoHead);
    const dash = await (await lakshmi.get('/insights/dashboard')).json();
    await loginUi(page, USERS.demoHead);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Lakshmi');
    await expect(page.getByRole('heading', { name: 'Needs your decision' })).toBeVisible();
    await expect(page.getByText('Nothing waiting for you')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Set up in five steps' })).toHaveCount(0);
    const active = page.getByRole('table', { name: 'Active trips' });
    await expect(active.getByRole('row')).not.toHaveCount(1);
    for (const t of dash.activeTrips.slice(0, 3)) await expect(active.getByText(t.number)).toBeVisible();
  });

  test('Trips: tab counts match the data, and search finds a demo trip by its PO reference', async ({ page, request }) => {
    const lakshmi = await asUser(request, USERS.demoHead);
    // The list opens on "Booked in: last 30 days"; compare with the same filter.
    const { counts } = await (await lakshmi.get('/trips?days=30')).json();
    await loginUi(page, USERS.demoHead, '/trips');
    const tabs = page.getByRole('tablist', { name: 'Trip status' });
    await expect(tabs.getByRole('tab', { name: /^All/ })).toContainText(String(counts.all));
    await expect(tabs.getByRole('tab', { name: /^Closed/ })).toContainText(String(counts.closed));
    await tabs.getByRole('tab', { name: /^In transit/ }).click();
    const table = page.getByRole('table', { name: 'Trips' });
    await expect(table.getByRole('row')).toHaveCount(counts.transit + 1);

    await page.goto('/trips?q=PO-VAF-10471&days=all');
    await expect(table.getByRole('row')).toHaveCount(2);
    await expect(table.getByRole('row').nth(1)).toContainText('Thirumala Roadways');
    await expect(table.getByRole('row').nth(1)).toContainText('Closed');
  });

  test('Approvals lists the payments and exception fix waiting (no award approvals)', async ({ page, request }) => {
    const lakshmi = await asUser(request, USERS.demoHead);
    const { approvals } = await (await lakshmi.get('/approvals')).json();
    const payments = approvals.filter((a: { kind: string }) => a.kind === 'PAYMENT').length;
    await loginUi(page, USERS.demoHead, '/approvals');
    const table = page.getByRole('table', { name: 'Approvals' });
    await expect(table.getByRole('row')).toHaveCount(approvals.length + 1);
    await expect(table.getByRole('row', { name: /Carrier award/ })).toHaveCount(0);
    await expect(table.getByRole('row', { name: /Payment/ })).toHaveCount(payments);
    await expect(table.getByRole('row', { name: /Exception fix/ })).toHaveCount(1);
  });

  test('Reports: 90 days of lanes and a carrier scorecard', async ({ page }) => {
    await loginUi(page, USERS.demoHead, '/reports');
    await page.getByLabel('Period').selectOption('90d');
    await expect(page.getByText('Last 90 days · all lanes')).toBeVisible();
    for (const lane of ['Chennai → Bengaluru', 'Chennai → Hyderabad', 'Mumbai → Pune', 'Bengaluru → Coimbatore']) {
      await expect(page.getByText(lane).first()).toBeVisible();
    }
    const card = page.getByRole('table', { name: 'Carrier scorecard' });
    for (const c of ['Thirumala Roadways', 'Godavari Freight Lines', 'Nilgiri Logistics', 'Shivam Transport Co', 'Konkan Cargo Movers']) {
      await expect(card.getByRole('row', { name: new RegExp(c) })).toBeVisible();
    }
  });

  test('a closed trip shows its full history: claim, deduction and payment', async ({ page, request }) => {
    const lakshmi = await asUser(request, USERS.demoHead);
    const [trip] = (await (await lakshmi.get('/trips?q=PO-VAF-10471')).json()).trips;
    await loginUi(page, USERS.demoHead, `/trips/${trip.id}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Bengaluru → Coimbatore');
    const body = page.locator('main');
    await expect(body).toContainText(trip.number);
    await expect(body.getByText(/CL-\d+/).first()).toBeVisible();
    await expect(body.getByText('Booked on the web').first()).toBeVisible();
    await expect(body.getByText('Trip closed').first()).toBeVisible();
  });

  test('accounts approves a waiting demo invoice and records the payment; the trip closes', async ({ page, request }) => {
    const suresh = await asUser(request, USERS.demoAccounts);
    const [summary] = (await (await suresh.get('/trips?q=PO-VAF-10725')).json()).trips;
    const { trip } = await (await suresh.get(`/trips/${summary.id}`)).json();
    expect(trip.invoice.status).toBe('RECEIVED');

    await loginUi(page, USERS.demoAccounts, '/approvals');
    const row = page.getByRole('row', { name: new RegExp(trip.invoice.number.replace(/\//g, '\\/')) });
    await row.getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByRole('status').filter({ hasText: `Invoice ${trip.invoice.number} approved.` })).toBeVisible();

    await page.goto(`/trips/${trip.id}`);
    await field(page, 'UPI reference').fill('UPI 600213457788');
    await page.getByRole('button', { name: `Record payment ₹${trip.invoice.total.toLocaleString('en-IN')}` }).click();
    await expect(page.getByText(/by UPI, reference UPI 600213457788\. Trip closed\./)).toBeVisible();
  });
});

test.describe('Demo data on a phone', () => {
  test('Home and Trips fit the screen with demo data', async ({ page }) => {
    test.skip(test.info().project.name !== 'ui', 'runs in the desktop project at phone width');
    await page.setViewportSize({ width: 390, height: 844 });
    await loginUi(page, USERS.demoHead);
    for (const path of ['/', '/trips', '/approvals']) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
  });
});
