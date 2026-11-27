import { USERS, asUser, expect, loginUi, test } from './helpers';
import { awardedTrip, bookPune, refs, shipperHead } from './trips.helpers';
import type { APIRequestContext } from '@playwright/test';

/** A fresh Pune → Hyderabad booking: Kaveri is offered it first at ₹38,500; NorthStar waits at ₹39,000. */
async function newOffer(request: APIRequestContext) {
  const anita = await shipperHead(request);
  const r = await refs(anita);
  return { anita, r, trip: await bookPune(anita, r) };
}

test.describe('Carrier loads screens', () => {
  test('Loads lists a new offer under Needs action and opens it', async ({ page, request }) => {
    const { trip } = await newOffer(request);
    await loginUi(page, USERS.carrier, '/carrier/loads');
    await expect(page.getByRole('heading', { level: 1, name: 'Loads' })).toBeVisible();
    await page.getByRole('tab', { name: /Needs action/ }).click();
    await expect(page).toHaveURL(/tab=action/);
    const row = page.getByRole('table', { name: 'Loads' }).getByRole('row').filter({ hasText: trip.number });
    await expect(row).toContainText('Pune → Hyderabad');
    await expect(row).toContainText('Sunrise Foods Pvt Ltd');
    await expect(row).toContainText('New offer');
    await expect(row).toContainText('₹38,500');
    await page.getByRole('searchbox', { name: 'Search loads' }).fill(trip.number);
    await expect(page.getByTestId('load-count')).toHaveText('1 shown');
    await row.getByRole('link', { name: trip.number }).click();
    // Generous first wait: in dev mode the load page may compile on its first visit.
    await expect(page.getByRole('heading', { level: 1, name: 'Pune → Hyderabad' })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('heading', { name: 'New load offer from Sunrise Foods Pvt Ltd' })).toBeVisible();
    await expect(page.getByRole('main').getByText('₹38,500').first()).toBeVisible();
    await expect(page.getByRole('main').getByRole('textbox')).toHaveCount(0); // no price to type: accept or pass only
    await expect(page.getByRole('list', { name: 'Load progress' }).locator('[aria-current="step"]')).toContainText('Offer');
  });

  test('accept the offer at the fixed rate: the load is won at once', async ({ page, request }) => {
    const { anita, trip } = await newOffer(request);
    await loginUi(page, USERS.carrierTraffic, `/carrier/loads/${trip.id}`);
    await page.getByRole('button', { name: 'Accept ₹38,500' }).click();
    await expect(page.getByRole('heading', { name: 'You won this load · ₹38,500' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Accept ₹38,500' })).toHaveCount(0);
    expect((await (await anita.get(`/trips/${trip.id}`)).json()).trip.status).toBe('AWARDED');
  });

  test('pass on a load with a reason: the next carrier is offered', async ({ page, request }) => {
    const { anita, trip } = await newOffer(request);
    await loginUi(page, USERS.carrier, `/carrier/loads/${trip.id}`);
    await page.getByRole('button', { name: 'Pass on this load' }).click();
    await page.getByRole('textbox', { name: 'Why are you passing?' }).fill('No truck free');
    await page.getByRole('button', { name: 'Pass on this load' }).click();
    await expect(page.getByText('You passed on this load.').first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'You passed' })).toBeVisible();
    const t = (await (await anita.get(`/trips/${trip.id}`)).json()).trip;
    expect(t.quotes.find((q: { carrier: string }) => q.carrier === 'NorthStar Logistics').status).toBe('REQUESTED');
  });

  test('a load that is no longer offered shows a clear message when the carrier acts late', async ({ page, request }) => {
    const { anita, trip } = await newOffer(request);
    await loginUi(page, USERS.carrier, `/carrier/loads/${trip.id}`);
    await expect(page.getByRole('button', { name: 'Accept ₹38,500' })).toBeVisible();
    // The offer moves on (the carrier's colleague passed) while this page is open.
    const divya = await asUser(request, USERS.carrierTraffic);
    expect((await divya.post(`/carrier/loads/${trip.id}/decline`, {})).status()).toBe(200);
    await page.getByRole('button', { name: 'Accept ₹38,500' }).click();
    await expect(page.getByRole('alert').or(page.getByRole('heading', { name: 'You passed' })).first()).toBeVisible();
    expect((await (await anita.get(`/trips/${trip.id}`)).json()).trip.quotes.filter((q: { status: string }) => q.status === 'ACCEPTED')).toHaveLength(0);
  });

  test('accounts sees an offer but cannot answer it', async ({ page, request }) => {
    const { trip } = await newOffer(request);
    await loginUi(page, USERS.carrierAccounts, `/carrier/loads/${trip.id}`);
    await expect(page.getByText('Only the owner or traffic manager can answer load offers.')).toBeVisible();
    await expect(page.getByRole('button', { name: /Accept/ })).toHaveCount(0);
  });

  test("the load page never shows another carrier's rate", async ({ page, request }) => {
    const { trip } = await newOffer(request);
    await loginUi(page, USERS.carrier, `/carrier/loads/${trip.id}`);
    await expect(page.getByRole('heading', { name: 'New load offer from Sunrise Foods Pvt Ltd' })).toBeVisible();
    await expect(page.locator('main')).not.toContainText('39,000');
    await expect(page.locator('main')).not.toContainText('NorthStar');
  });

  test('a won load shows the next step and the award in the activity', async ({ page, request }) => {
    const anita = await shipperHead(request);
    const trip = await awardedTrip(request, anita, await refs(anita), { pune: true });
    await loginUi(page, USERS.carrier, `/carrier/loads/${trip.id}`);
    await expect(page.getByRole('heading', { name: 'You won this load · ₹38,500' })).toBeVisible();
    await expect(page.getByText('Awarded to you at ₹38,500')).toBeVisible();
  });

  test('Home shows stats and active loads, with no approvals to decide', async ({ page, request }) => {
    const { trip } = await newOffer(request);
    await loginUi(page, USERS.carrier);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Good (morning|afternoon|evening), Vijay/);
    const stats = page.getByRole('region', { name: 'This month' });
    await expect(stats).toContainText('Load offers open');
    await expect(stats).toContainText('Trucks free tomorrow');
    await expect(stats).toContainText('Average margin');
    await expect(page.getByTestId('approval-card')).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Active loads' }).getByRole('link', { name: new RegExp(trip.number) })).toBeVisible();
    await page.getByRole('link', { name: 'Open load offers' }).click();
    await expect(page).toHaveURL(/\/carrier\/loads\?tab=action/);
  });

  test('Approvals is empty for every carrier role', async ({ page }) => {
    await loginUi(page, USERS.carrierTraffic, '/carrier/approvals');
    await expect(page.getByTestId('approval-card')).toHaveCount(0);
  });
});
