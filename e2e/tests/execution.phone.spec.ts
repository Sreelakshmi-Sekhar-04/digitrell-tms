import { USERS, asUser, expect, loginUi, test } from './helpers';
import { deliveredTrip, integration, refs, setPolicy } from './trips.helpers';

test.describe('Execution on a phone (390 × 844)', () => {
  test('POD review and invoice panels fit the screen', async ({ page, request }) => {
    const anita = await asUser(request, USERS.shipperHead);
    const r = await refs(anita);
    await setPolicy(anita);
    const damaged = await deliveredTrip(request, anita, r, 1);
    await integration.pod(request, damaged.number, { remarks: '1 ctn damaged' });
    await loginUi(page, USERS.shipperHead, `/trips/${damaged.id}`);
    await expect(page.getByRole('heading', { name: 'Delivered · POD needs a look' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

    const billed = await deliveredTrip(request, anita, r);
    await integration.pod(request, billed.number);
    await integration.invoice(request, billed.number, { number: 'INV-PH1', freight: 43800 });
    await page.goto(`/trips/${billed.id}`);
    await expect(page.getByRole('button', { name: 'Approve ₹43,800' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  });
});
