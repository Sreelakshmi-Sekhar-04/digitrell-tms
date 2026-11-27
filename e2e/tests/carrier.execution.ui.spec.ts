import { USERS, asUser, expect, loginUi, test, uniq } from './helpers';
import { awardedTrip, refs, shipperHead } from './trips.helpers';
import type { APIRequestContext } from '@playwright/test';

const day = (n: number) => {
  const d = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const validDocs = { rcExpiry: day(900), insuranceExpiry: day(300), permitExpiry: day(300), fitnessExpiry: day(300), pucExpiry: day(100) };
const truckNo = () => `TN${String(10 + Math.floor(Math.random() * 89))}ZX${String(1000 + Math.floor(Math.random() * 8999))}`;
const mobile = () => `+9195${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
const licence = () => `TN09${String(Math.floor(Math.random() * 1e11)).padStart(11, '0')}`;

async function fleet(request: APIRequestContext, truckOver: Record<string, unknown> = {}) {
  const vijay = await asUser(request, USERS.carrier);
  const t = (await (await vijay.post('/carrier/trucks', { number: truckNo(), truckType: '20ft SXL', ownership: 'OWN', capacityKg: 9000, ...validDocs, ...truckOver })).json()).truck;
  const d = (await (await vijay.post('/carrier/drivers', { name: `Ui Driver ${uniq()}`, phone: mobile(), licenceNumber: licence(), licenceClass: 'HGMV', licenceExpiry: day(700) })).json()).driver;
  return { truck: t as { id: string; number: string }, driver: d as { id: string; name: string } };
}
async function wonLoad(request: APIRequestContext) {
  const anita = await shipperHead(request);
  return awardedTrip(request, anita, await refs(anita), { pune: true });
}

test.describe('Carrier execution screens', () => {
  test('assign a truck and driver; the panel then waits for the shipper; after the shipper issues the LR it is a read-only card with View / print', async ({ page, request }) => {
    const trip = await wonLoad(request);
    const { truck, driver } = await fleet(request);
    await loginUi(page, USERS.carrierTraffic, `/carrier/loads/${trip.id}`);
    await expect(page.getByRole('heading', { name: 'You won this load · ₹38,500' })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('list', { name: 'Load progress' }).locator('[aria-current="step"]')).toBeVisible();

    await expect(page.getByRole('button', { name: 'Assign truck and driver' })).toBeDisabled(); // nothing chosen yet
    await page.getByLabel(/^Truck/).selectOption(truck.id);
    await page.getByLabel(/^Driver( \*)?$/).selectOption(driver.id);
    await page.getByRole('button', { name: 'Assign truck and driver' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Truck and driver assigned.' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Truck assigned', exact: true })).toBeVisible();
    await expect(page.getByText(driver.name).first()).toBeVisible();
    await expect(page.getByText('Waiting for the shipper to issue the LR').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Change truck or driver' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Generate LR' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Void and reissue/ })).toHaveCount(0);

    const anita = await shipperHead(request);
    const issued = await anita.post(`/trips/${trip.id}/lr`, { ewayBill: '331012345678' });
    expect(issued.status(), await issued.text()).toBe(200);
    const lrNo = (await issued.json()).lrNumber as string;

    await page.reload();
    const lrHeading = page.getByRole('heading', { name: `LR ${lrNo}` });
    await expect(lrHeading).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText('e-way bill 331012345678').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Generate LR' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Void and reissue/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Change truck or driver' })).toHaveCount(0);

    const popup = page.waitForEvent('popup');
    await page.getByRole('button', { name: 'View / print LR' }).first().click();
    const lrPage = await popup;
    await expect(lrPage.locator('body')).toContainText(lrNo, { timeout: 30_000 });
  });

  test('a compliance block: traffic manager is told to ask the owner; the owner overrides with a reason', async ({ page, browser, request }) => {
    const trip = await wonLoad(request);
    const { truck, driver } = await fleet(request, { pucExpiry: day(-4) });

    await loginUi(page, USERS.carrierTraffic, `/carrier/loads/${trip.id}`);
    await expect(page.getByRole('heading', { name: 'You won this load · ₹38,500' })).toBeVisible({ timeout: 60_000 });
    await page.getByLabel(/^Truck/).selectOption(truck.id);
    await page.getByLabel(/^Driver( \*)?$/).selectOption(driver.id);
    const block = page.getByRole('alert').filter({ hasText: /PUC expired/i });
    if (!(await block.isVisible())) await page.getByRole('button', { name: 'Assign truck and driver' }).click();
    await expect(block).toBeVisible();
    await expect(block).toContainText('Ask the owner to assign this truck and driver with an override');
    await expect(page.getByRole('button', { name: /^Assign/ })).toBeDisabled();

    const owner = await (await browser.newContext()).newPage();
    await loginUi(owner, USERS.carrier, `/carrier/loads/${trip.id}`);
    await expect(owner.getByRole('heading', { name: 'You won this load · ₹38,500' })).toBeVisible({ timeout: 60_000 });
    await owner.getByLabel(/^Truck/).selectOption(truck.id);
    await owner.getByLabel(/^Driver( \*)?$/).selectOption(driver.id);
    const ownerBlock = owner.getByRole('alert').filter({ hasText: /PUC expired/i });
    if (!(await ownerBlock.isVisible())) await owner.getByRole('button', { name: /^Assign/ }).click();
    await expect(ownerBlock).toBeVisible();
    const submit = owner.getByRole('button', { name: 'Assign with owner override' });
    await expect(submit).toBeDisabled(); // a reason is required
    await owner.getByLabel(/^Owner override/).fill('PUC renewal is booked for tomorrow');
    await submit.click();
    await expect(owner.getByRole('heading', { name: 'Truck assigned' })).toBeVisible();
    await owner.context().close();
  });

  test('change the truck or driver while waiting for the LR', async ({ page, request }) => {
    const trip = await wonLoad(request);
    const a = await fleet(request);
    const b = await fleet(request);
    const vijay = await asUser(request, USERS.carrier);
    await vijay.post(`/carrier/loads/${trip.id}/assign`, { truckId: a.truck.id, driverId: a.driver.id });

    await loginUi(page, USERS.carrier, `/carrier/loads/${trip.id}`);
    await expect(page.getByRole('heading', { name: 'Truck assigned', exact: true })).toBeVisible({ timeout: 60_000 });
    await page.getByRole('button', { name: 'Change truck or driver' }).click();
    await page.getByLabel(/^Truck/).selectOption(b.truck.id);
    await page.getByLabel(/^Driver( \*)?$/).selectOption(b.driver.id);
    await page.getByRole('button', { name: 'Change truck and driver' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Truck and driver changed.' })).toBeVisible();
    await expect(page.getByText(b.driver.name).first()).toBeVisible();
    await expect(page.getByText('Waiting for the shipper to issue the LR').first()).toBeVisible();
  });

  test('accounts sees the load but has no assign form', async ({ page, request }) => {
    const trip = await wonLoad(request);
    await loginUi(page, USERS.carrierAccounts, `/carrier/loads/${trip.id}`);
    await expect(page.getByRole('heading', { name: 'You won this load · ₹38,500' })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('button', { name: /^Assign/ })).toHaveCount(0);
  });
});
