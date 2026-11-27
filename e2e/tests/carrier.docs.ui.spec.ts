import type { APIRequestContext, Page } from '@playwright/test';
import { USERS, asUser, expect, loginUi, test } from './helpers';

const day = (n: number) => {
  const d = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const truckNo = () => `KA${String(10 + Math.floor(Math.random() * 89))}DU${String(1000 + Math.floor(Math.random() * 8999))}`;
const prettyNo = (n: string) => `${n.slice(0, 2)} ${n.slice(2, 4)} ${n.slice(4, 6)} ${n.slice(6)}`;
const png = { name: 'paper.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') };
const pdf = { name: 'paper.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.1\n%%EOF\n') };

async function openFleet(page: Page) {
  await loginUi(page, USERS.carrierTraffic, '/carrier/fleet');
  await expect(page.getByRole('heading', { level: 1, name: 'Fleet and rates' })).toBeVisible({ timeout: 60_000 });
}
const row = (page: Page, n: string) => page.getByRole('table', { name: 'Trucks' }).getByRole('row').filter({ hasText: prettyNo(n) });

async function savedTruck(request: APIRequestContext) {
  const divya = await asUser(request, USERS.carrierTraffic);
  const n = truckNo();
  const res = await divya.post('/carrier/trucks', { number: n, truckType: '20ft SXL', ownership: 'OWN', rcExpiry: day(900), insuranceExpiry: day(300), permitExpiry: day(300), fitnessExpiry: day(300), pucExpiry: day(100) });
  expect(res.status()).toBe(201);
  return n;
}

const named = (name: string, f = png) => ({ ...f, name });

test.describe('Fleet and rates: truck papers', () => {
  test('a new truck: files are named by guess, held until Save, then uploaded; the table counts them', async ({ page }) => {
    await openFleet(page);
    await page.getByRole('button', { name: '+ Add truck' }).click();
    const drawer = page.getByRole('dialog', { name: 'Add truck' });
    await expect(drawer.getByText('Enter the expiry dates and upload a photo or PDF of each paper.')).toBeVisible();
    const n = truckNo();
    await drawer.getByRole('textbox', { name: 'Truck number' }).fill(n);
    await drawer.getByText('32ft MXL', { exact: true }).click();
    for (const [label, date] of [['RC', 900], ['Insurance', 300], ['Permit', 300], ['Fitness', 300], ['PUC', 200]] as const) await drawer.getByLabel(`${label} valid to`).fill(day(date));

    await drawer.getByTestId('papers-input').setInputFiles([named('rc-front.png'), named('puc-cert.pdf', pdf)]);
    await expect(drawer.getByLabel('Which paper is rc-front.png?')).toHaveValue('rcExpiry'); // guessed from the name
    await expect(drawer.getByLabel('Which paper is puc-cert.pdf?')).toHaveValue('pucExpiry');
    await expect(drawer.getByRole('button', { name: /^Upload \d+ file/ })).toHaveCount(0); // a new truck uploads after Save
    await drawer.getByRole('button', { name: 'Save truck' }).click();
    await expect(drawer).toBeHidden();
    await expect(row(page, n)).toContainText('2 of 5 papers uploaded', { timeout: 30_000 });
  });

  test('unchosen and duplicate papers are flagged and block Save', async ({ page }) => {
    await openFleet(page);
    await page.getByRole('button', { name: '+ Add truck' }).click();
    const drawer = page.getByRole('dialog', { name: 'Add truck' });
    await drawer.getByRole('textbox', { name: 'Truck number' }).fill(truckNo());
    await drawer.getByText('32ft MXL', { exact: true }).click();
    for (const [label, date] of [['RC', 900], ['Insurance', 300], ['Permit', 300], ['Fitness', 300], ['PUC', 200]] as const) await drawer.getByLabel(`${label} valid to`).fill(day(date));

    await drawer.getByTestId('papers-input').setInputFiles([named('scan-1.png'), named('rc-copy.png')]);
    await expect(drawer.getByLabel('Which paper is scan-1.png?')).toHaveValue('');
    await drawer.getByRole('button', { name: 'Save truck' }).click();
    await expect(drawer.getByText('Choose which paper each file is.')).toBeVisible();
    await expect(drawer).toBeVisible(); // not saved

    await drawer.getByLabel('Which paper is scan-1.png?').selectOption('rcExpiry'); // RC twice
    await expect(drawer.getByText('More than one file is marked as RC. Each paper can have one file.')).toBeVisible();
    await drawer.getByRole('button', { name: 'Save truck' }).click();
    await expect(drawer).toBeVisible();
    await drawer.getByLabel('Which paper is scan-1.png?').selectOption('ALL'); // all five, which also collides with RC
    await expect(drawer.getByText(/More than one file is marked as RC/)).toBeVisible();
  });

  test('an existing truck: "Upload N files" sends them now; View and Remove sit under the date; the count follows', async ({ page, request }) => {
    const n = await savedTruck(request);
    await openFleet(page);
    await expect(row(page, n)).toContainText('0 of 5 papers uploaded');
    await page.getByRole('button', { name: `Edit ${prettyNo(n)}` }).click();
    const drawer = page.getByRole('dialog', { name: `Edit ${prettyNo(n)}` });
    await expect(drawer.getByText('No file').first()).toBeVisible();

    await drawer.getByTestId('papers-input').setInputFiles([named('insurance-policy.png'), named('permit.pdf', pdf)]);
    await expect(drawer.getByText('(not uploaded yet)')).toHaveCount(2); // picked, not sent until the button is pressed
    await drawer.getByRole('button', { name: 'Upload 2 files' }).click();
    await expect(drawer.getByText('(not uploaded yet)')).toHaveCount(0);
    await expect(drawer.getByText('insurance-policy.png')).toBeVisible();
    await expect(drawer.getByText('permit.pdf')).toBeVisible();
    await expect(drawer.getByRole('button', { name: 'View' })).toHaveCount(2);
    await expect(row(page, n)).toContainText('2 of 5 papers uploaded');

    await drawer.getByRole('button', { name: 'Remove' }).first().click();
    await expect(row(page, n)).toContainText('1 of 5 papers uploaded');
  });

  test('"All papers in one file" stores the same file against all five', async ({ page, request }) => {
    const n = await savedTruck(request);
    await openFleet(page);
    await page.getByRole('button', { name: `Edit ${prettyNo(n)}` }).click();
    const drawer = page.getByRole('dialog', { name: `Edit ${prettyNo(n)}` });
    await drawer.getByTestId('papers-input').setInputFiles(named('bundle.pdf', pdf));
    await drawer.getByLabel('Which paper is bundle.pdf?').selectOption('ALL');
    await drawer.getByRole('button', { name: 'Upload 1 file' }).click();
    await expect(row(page, n)).toContainText('5 of 5 papers uploaded', { timeout: 30_000 });
  });

  test('a wrong type or a file over 5 MB is refused on the spot', async ({ page, request }) => {
    const n = await savedTruck(request);
    await openFleet(page);
    await page.getByRole('button', { name: `Edit ${prettyNo(n)}` }).click();
    const drawer = page.getByRole('dialog', { name: `Edit ${prettyNo(n)}` });
    await drawer.getByTestId('papers-input').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hi') });
    await expect(drawer.getByText('notes.txt: Upload a JPG, PNG, WebP or PDF file.')).toBeVisible();
    await drawer.getByTestId('papers-input').setInputFiles({ name: 'big.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(5 * 1024 * 1024 + 1024, 0x20) });
    await expect(drawer.getByText('big.pdf: That file is over 5 MB. Upload a smaller photo or PDF.')).toBeVisible();
    await expect(drawer.getByRole('button', { name: /^Upload \d+ file/ })).toHaveCount(0);
  });
});
