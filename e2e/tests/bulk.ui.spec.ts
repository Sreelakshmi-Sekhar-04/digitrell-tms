import fs from 'fs';
import type { Download, Page } from '@playwright/test';
import { USERS, asUser, expect, loginUi, test, uniq } from './helpers';
import { ownLane, tomorrow } from './trips.helpers';
import { HEAD, csvFile, mobile, xlsxFile, readXlsx } from './bulk.helpers';

const drawer = (page: Page) => page.getByRole('dialog');
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

async function openMasters(page: Page, user: { email: string; password: string }, tab: string) {
  await loginUi(page, user, `/masters?tab=${tab}`);
  await expect(page.getByRole('heading', { name: 'Master data', level: 1 })).toBeVisible();
}
async function openBulk(page: Page, title: string | RegExp) {
  await page.getByRole('button', { name: 'Bulk upload', exact: true }).click();
  await expect(drawer(page).getByRole('heading', { name: title })).toBeVisible();
}
/** Chooses a file in the open drawer (the input is visually hidden, so it is set directly). */
async function choose(page: Page, name: string, buffer: Buffer) {
  await drawer(page).locator('#bulk-file').setInputFiles({ name, mimeType: name.endsWith('.csv') ? 'text/csv' : XLSX, buffer });
}
const chip = (page: Page, text: string) => drawer(page).getByText(text, { exact: true });
const readDownload = async (d: Download) => fs.readFileSync((await d.path())!);

test.describe('Bulk upload: templates', () => {
  test('carriers drawer downloads the Excel and CSV templates', async ({ page }) => {
    await openMasters(page, USERS.shipperHead, 'carriers');
    await openBulk(page, 'Bulk upload carriers');
    await expect(drawer(page).getByText('Download template:')).toBeVisible();

    const [xl] = await Promise.all([page.waitForEvent('download'), drawer(page).getByRole('button', { name: 'Excel', exact: true }).click()]);
    expect(xl.suggestedFilename()).toMatch(/template\.xlsx$/);
    const { sheets } = await readXlsx(await readDownload(xl));
    expect(sheets.Carriers[0]).toEqual(HEAD.carriers);
    expect(Object.keys(sheets)).toContain('Instructions');

    const [csv] = await Promise.all([page.waitForEvent('download'), drawer(page).getByRole('button', { name: 'CSV', exact: true }).click()]);
    expect(csv.suggestedFilename()).toMatch(/template\.csv$/);
    expect((await readDownload(csv)).toString('utf8').replace(/^﻿/, '').trim()).toBe(HEAD.carriers.join(','));
  });

  test('lanes template has a drop-down and a Lists sheet', async ({ page }) => {
    await openMasters(page, USERS.shipperHead, 'lanes');
    await openBulk(page, 'Bulk upload lanes');
    const [xl] = await Promise.all([page.waitForEvent('download'), drawer(page).getByRole('button', { name: 'Excel', exact: true }).click()]);
    const { wb, sheets } = await readXlsx(await readDownload(xl));
    expect(wb.getWorksheet('Lanes')!.getCell('C2').dataValidation?.type).toBe('list');
    expect(sheets.Lists.flat()).toContain('Kaveri Roadlines');
  });
});

test.describe('Bulk upload: masters screens', () => {
  test('carriers: Excel upload, preview, import, summary, then the same file again is skipped', async ({ page }) => {
    const name = `UI Bulk Xl ${uniq()}`;
    await openMasters(page, USERS.shipperHead, 'carriers');
    await openBulk(page, 'Bulk upload carriers');
    await choose(page, 'carriers.xlsx', await xlsxFile(HEAD.carriers, [[name, mobile(), 'R Kumar', mobile(), 'ops@bulk.test', 'Chennai']]));
    await expect(chip(page, 'Ready to add: 1')).toBeVisible();
    await expect(chip(page, 'Ready to update: 0')).toBeVisible();
    await expect(chip(page, 'Already exist, skipped: 0')).toBeVisible();
    await expect(chip(page, 'Need fixing: 0')).toBeVisible();
    await expect(drawer(page).getByRole('table', { name: 'Rows in your file' })).toContainText(name);
    await drawer(page).getByRole('button', { name: 'Import 1 row', exact: true }).click();
    await expect(chip(page, 'Added: 1')).toBeVisible();
    await expect(chip(page, 'Not imported: 0')).toBeVisible();
    await drawer(page).getByRole('button', { name: 'Done', exact: true }).click();
    await expect(drawer(page)).toBeHidden();
    await expect(page.getByRole('row', { name: new RegExp(name) })).toBeVisible();

    // Repeat: everything already exists, nothing to import.
    await openBulk(page, 'Bulk upload carriers');
    await choose(page, 'carriers.xlsx', await xlsxFile(HEAD.carriers, [[name, mobile()]]));
    await expect(chip(page, 'Already exist, skipped: 1')).toBeVisible();
    await expect(chip(page, 'Ready to add: 0')).toBeVisible();
    await expect(drawer(page).getByRole('button', { name: 'Import 0 rows' })).toBeDisabled();
  });

  test('carriers: CSV with problems shows row and column, filter, problems report, imports only valid rows', async ({ page }) => {
    const t = uniq();
    const good = `UI Bulk Csv ${t}`;
    await openMasters(page, USERS.shipperHead, 'carriers');
    await openBulk(page, 'Bulk upload carriers');
    await choose(page, 'carriers.csv', csvFile(HEAD.carriers, [
      [good, mobile()],
      [`UI Bad Mob ${t}`, '12345'],
      ['', mobile()],
      [`UI Bad Gst ${t}`, mobile(), '', '', '', '', '', 'NOTAGSTIN'],
      ['Kaveri Roadlines', mobile()],
    ]));
    await expect(chip(page, 'Ready to add: 1')).toBeVisible();
    await expect(chip(page, 'Need fixing: 3')).toBeVisible();
    await expect(chip(page, 'Already exist, skipped: 1')).toBeVisible();
    const table = drawer(page).getByRole('table', { name: 'Rows in your file' });
    await expect(table.getByRole('row')).toHaveCount(6); // header + 5
    await expect(table).toContainText("Owner's mobile: Enter a 10-digit Indian mobile number");
    await expect(table).toContainText('Carrier name: Enter the carrier company name.');
    await expect(table).toContainText('GSTIN: Enter a 15-character GSTIN');

    await drawer(page).getByRole('checkbox', { name: 'Only rows that need fixing' }).check();
    await expect(table.getByRole('row')).toHaveCount(4); // header + 3
    await expect(table).not.toContainText(good);

    const [report] = await Promise.all([page.waitForEvent('download'), drawer(page).getByRole('button', { name: 'Download problems' }).click()]);
    const { sheets } = await readXlsx(await readDownload(report));
    const sheet = sheets.Carriers;
    expect(sheet[0]).toContain('Problems');
    expect(sheet).toHaveLength(4);
    expect(sheet.map((r) => r.at(-1)).join('|')).toContain('Owner');

    await drawer(page).getByRole('button', { name: 'Import 1 row', exact: true }).click();
    await expect(chip(page, 'Added: 1')).toBeVisible();
    await expect(chip(page, 'Skipped (already existed): 1')).toBeVisible();
    await expect(chip(page, 'Not imported: 3')).toBeVisible();
    await expect(drawer(page).getByRole('heading', { name: 'Rows not imported' })).toBeVisible();
    const [rep2] = await Promise.all([page.waitForEvent('download'), drawer(page).getByRole('button', { name: 'Download rows not imported' }).click()]);
    expect((await readXlsx(await readDownload(rep2))).sheets.Carriers).toHaveLength(4);
    await drawer(page).getByRole('button', { name: 'Upload another file' }).click();
    await expect(drawer(page).getByText('Download template:')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('row', { name: new RegExp(good) })).toBeVisible();
  });

  test('a file missing mandatory columns shows one clear error and can be replaced', async ({ page }) => {
    await openMasters(page, USERS.shipperHead, 'carriers');
    await openBulk(page, 'Bulk upload carriers');
    await choose(page, 'wrong.csv', csvFile(['Carrier name', 'City'], [['X', 'Y']]));
    await expect(drawer(page).getByRole('alert')).toContainText("Owner's mobile");
    await expect(drawer(page).getByText('Download template:')).toBeVisible();
    // The picker is still there: a good file recovers.
    await choose(page, 'ok.csv', csvFile(HEAD.carriers, [[`UI Recover ${uniq()}`, mobile()]]));
    await expect(chip(page, 'Ready to add: 1')).toBeVisible();
    await expect(drawer(page).getByRole('alert')).toHaveCount(0);
    // Choosing a corrected file replaces the preview.
    await choose(page, 'again.csv', csvFile(HEAD.carriers, [[`UI Recover2 ${uniq()}`, mobile()], [`UI Recover3 ${uniq()}`, mobile()]]));
    await expect(chip(page, 'Ready to add: 2')).toBeVisible();
    await expect(drawer(page).getByRole('button', { name: 'Import 2 rows' })).toBeEnabled();
  });

  test('rate cards: CSV upload creates a rate, a second file updates it', async ({ page, request }) => {
    const head = await asUser(request, USERS.shipperHead);
    const name = `UI Rate Carrier ${uniq()}`;
    expect((await head.upload('/carriers/bulk/import', csvFile(HEAD.carriers, [[name, mobile()]]))).status()).toBe(200);
    await openMasters(page, USERS.shipperHead, 'rate-cards');
    await openBulk(page, 'Bulk upload rate cards');
    await choose(page, 'rates.csv', csvFile(HEAD.rateCards, [[name, 'Chennai', 'Madurai', '17ft', 21000], [`Nobody ${uniq()}`, 'Chennai', 'Madurai', '17ft', 21000]]));
    await expect(chip(page, 'Ready to add: 1')).toBeVisible();
    await expect(chip(page, 'Need fixing: 1')).toBeVisible();
    await expect(drawer(page)).toContainText('not in your carrier list');
    await drawer(page).getByRole('button', { name: 'Import 1 row', exact: true }).click();
    await expect(chip(page, 'Added: 1')).toBeVisible();
    await drawer(page).getByRole('button', { name: 'Done', exact: true }).click();
    const row = page.getByRole('row', { name: new RegExp(name) });
    await expect(row).toContainText('₹21,000');

    await openBulk(page, 'Bulk upload rate cards');
    await choose(page, 'rates2.xlsx', await xlsxFile(HEAD.rateCards, [[name, 'Chennai', 'Madurai', '17ft', 23500]]));
    await expect(chip(page, 'Ready to update: 1')).toBeVisible();
    await drawer(page).getByRole('button', { name: 'Import 1 row', exact: true }).click();
    await expect(chip(page, 'Updated: 1')).toBeVisible();
    await drawer(page).getByRole('button', { name: 'Done', exact: true }).click();
    await expect(page.getByRole('row', { name: new RegExp(name) })).toContainText('₹23,500');
  });

  test('lanes: upload creates a lane; a second upload adds a carrier to it', async ({ page, request }) => {
    const head = await asUser(request, USERS.shipperHead);
    const t = uniq();
    const [a, b] = [`UI Lane A ${t}`, `UI Lane B ${t}`];
    await head.upload('/carriers/bulk/import', csvFile(HEAD.carriers, [[a, mobile()], [b, mobile()]]));
    const origin = `Tiruppur${t.replace(/\d/g, 'x')}`;
    await openMasters(page, USERS.shipperHead, 'lanes');
    await openBulk(page, 'Bulk upload lanes');
    await choose(page, 'lanes.csv', csvFile(HEAD.lanes, [[origin, 'Salem', '19ft', 'Ask me', a]]));
    await expect(chip(page, 'Ready to add: 1')).toBeVisible();
    await drawer(page).getByRole('button', { name: 'Import 1 row', exact: true }).click();
    await expect(chip(page, 'Added: 1')).toBeVisible();
    await drawer(page).getByRole('button', { name: 'Done', exact: true }).click();
    const row = page.getByRole('row', { name: new RegExp(`${origin} → Salem`, 'i') });
    await expect(row).toContainText(a);
    await expect(row).not.toContainText(b);

    await openBulk(page, 'Bulk upload lanes');
    await choose(page, 'lanes2.csv', csvFile(HEAD.lanes, [[origin, 'Salem', '19ft', '', `${a}; ${b}`]]));
    await expect(chip(page, 'Ready to update: 1')).toBeVisible();
    await drawer(page).getByRole('button', { name: 'Import 1 row', exact: true }).click();
    await expect(chip(page, 'Updated: 1')).toBeVisible();
    await drawer(page).getByRole('button', { name: 'Done', exact: true }).click();
    await expect(page.getByRole('row', { name: new RegExp(`${origin} → Salem`, 'i') })).toContainText(b);
  });

  test('addresses: executive uploads a mix; singular wording, report, then manual add still works', async ({ page }) => {
    const t = uniq();
    const ok = `UI Addr ${t}`;
    await openMasters(page, USERS.shipperExec, 'addresses');
    await openBulk(page, 'Bulk upload addresses');
    await choose(page, 'addresses.xlsx', await xlsxFile(HEAD.addresses, [
      [ok, 'Salem', 'Plot 1 Estate', 'Pickup and drop', 'S Rao', mobile(), '9-6'],
      [`UI Addr Bad ${t}`, 'Salem', 'Plot 2', 'Sideways'],
      ['Ambattur DC', 'Chennai', 'Anywhere', 'Pickup'],
    ]));
    await expect(chip(page, 'Ready to add: 1')).toBeVisible();
    await expect(chip(page, 'Need fixing: 1')).toBeVisible();
    await expect(chip(page, 'Already exist, skipped: 1')).toBeVisible();
    await expect(drawer(page)).toContainText('Type:');
    await drawer(page).getByRole('button', { name: 'Import 1 row', exact: true }).click();
    await expect(chip(page, 'Added: 1')).toBeVisible();
    await expect(chip(page, 'Not imported: 1')).toBeVisible();
    await drawer(page).getByRole('button', { name: 'Done', exact: true }).click();
    await expect(page.getByRole('row', { name: new RegExp(ok) })).toBeVisible();

    // Manual creation is unchanged.
    const manual = `UI Manual ${t}`;
    await page.getByRole('button', { name: '+ Add address' }).click();
    const f = (l: string) => drawer(page).getByLabel(new RegExp(`^${l}( \\*| \\(optional\\))?$`));
    await f('Short name').fill(manual);
    await f('City').fill('Chennai');
    await f('Street address').fill('SIPCOT Oragadam');
    await drawer(page).getByText('Pickup and drop', { exact: true }).click();
    await drawer(page).getByRole('button', { name: 'Save address' }).click();
    await expect(page.getByRole('status').filter({ hasText: `${manual} added.` })).toBeVisible();
    await expect(page.getByRole('row', { name: new RegExp(manual) })).toBeVisible();
  });
});

test.describe('Bulk upload: permissions in the UI', () => {
  test('executive sees Bulk upload only on addresses; head has none on users', async ({ page }) => {
    await openMasters(page, USERS.shipperExec, 'carriers');
    await expect(page.getByRole('button', { name: 'Bulk upload' })).toHaveCount(0);
    for (const tab of ['Rate cards', 'Lanes']) {
      await page.getByRole('tab', { name: tab }).click();
      await expect(page.getByRole('button', { name: 'Bulk upload' })).toHaveCount(0);
    }
    await page.getByRole('tab', { name: 'Addresses' }).click();
    await expect(page.getByRole('button', { name: 'Bulk upload' })).toBeVisible();
  });

  test('head has no bulk upload on Users and roles', async ({ page }) => {
    await openMasters(page, USERS.shipperHead, 'users');
    await expect(page.getByRole('button', { name: '+ Add user' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Bulk upload' })).toHaveCount(0);
  });
});

test.describe('Bulk upload: bookings', () => {
  test('upload bookings from New booking, import, and find them in Trips', async ({ page, request }) => {
    const head = await asUser(request, USERS.shipperHead);
    const own = await ownLane(head, 2);
    const addr = (await (await head.get('/addresses')).json()).addresses as { id: string; name: string }[];
    const pick = addr.find((a) => a.id === own.booking.pickupAddressId)!.name;
    const drop = addr.find((a) => a.id === own.booking.dropAddressId)!.name;
    const t = uniq();

    await loginUi(page, USERS.shipperHead, '/bookings/new');
    await expect(page.getByRole('heading', { name: 'New booking', level: 1 })).toBeVisible();
    await openBulk(page, 'Bulk upload bookings');
    const [tpl] = await Promise.all([page.waitForEvent('download'), drawer(page).getByRole('button', { name: 'Excel', exact: true }).click()]);
    expect((await readXlsx(await readDownload(tpl))).sheets.Bookings[0]).toEqual(HEAD.bookings);

    await choose(page, 'bookings.csv', csvFile(HEAD.bookings, [
      [`UI-PO-${t}-1`, pick, drop, tomorrow(), '17ft', 'Rice bags', 7, 20000],
      [`UI-PO-${t}-2`, pick, drop, tomorrow(), '17ft', 'Rice bags', 8, 20000],
      [`UI-PO-${t}-3`, `Nowhere ${t}`, drop, tomorrow(), '17ft', 'Rice bags', 7, 20000],
      [`UI-PO-${t}-4`, pick, drop, tomorrow(), '17ft', 'Rice bags', 700, 20000],
    ]));
    await expect(chip(page, 'Ready to add: 2')).toBeVisible();
    await expect(chip(page, 'Need fixing: 2')).toBeVisible();
    await expect(drawer(page)).toContainText('Pickup address: No saved address called');
    await drawer(page).getByRole('button', { name: 'Import 2 rows', exact: true }).click();
    await expect(chip(page, 'Added: 2')).toBeVisible();
    await expect(chip(page, 'Not imported: 2')).toBeVisible();
    await drawer(page).getByRole('link', { name: 'Go to Trips' }).click();
    await expect(page).toHaveURL(/\/trips/);
    await page.getByRole('textbox', { name: 'Search trips' }).fill(`UI-PO-${t}`);
    await expect(page.getByRole('row', { name: /Rice bags/ })).toHaveCount(2);
    // Tidy up so no approvals stay waiting for other specs.
    const mine = (await (await head.get(`/trips?q=${encodeURIComponent(`UI-PO-${t}`)}`)).json()).trips as { id: string }[];
    for (const tr of mine) expect((await head.post(`/trips/${tr.id}/cancel`, { reason: 'ORDER_CANCELLED' })).status()).toBe(200);
  });
});
