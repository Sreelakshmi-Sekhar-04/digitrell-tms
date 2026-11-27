import { USERS, expect, loginUi, test, uniq } from './helpers';
import type { Page } from '@playwright/test';

const day = (n: number) => {
  const d = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const truckNo = () => `KA${String(10 + Math.floor(Math.random() * 89))}UI${String(1000 + Math.floor(Math.random() * 8999))}`;
const mobileDigits = () => `97${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;

async function openFleet(page: Page, user: { email: string; password: string }, tab?: string) {
  await loginUi(page, user, `/carrier/fleet${tab ? `?tab=${tab}` : ''}`);
  // Generous first wait: in dev mode the page may compile on its first visit.
  await expect(page.getByRole('heading', { level: 1, name: 'Fleet and rates' })).toBeVisible({ timeout: 60_000 });
}

test.describe('Fleet and rates: trucks', () => {
  test('shows the seeded trucks with status from documents, problems first', async ({ page }) => {
    await openFleet(page, USERS.carrierTraffic);
    const table = page.getByRole('table', { name: 'Trucks' });
    await expect(table.getByRole('row').nth(1)).toContainText('TN 11 CC 9087');
    await expect(table.getByRole('row').nth(1)).toContainText('Blocked');
    await expect(table.getByRole('row').nth(1)).toContainText('Permit expired');
    await expect(table.getByRole('row').filter({ hasText: 'TN 09 BX 4471' })).toContainText('Expiring');
    await expect(table.getByRole('columnheader', { name: 'Capacity' })).toBeVisible();
    await expect(table.getByRole('columnheader', { name: 'Ownership' })).toHaveCount(0);
    await expect(table.getByRole('row').filter({ hasText: 'TN 10 AZ 2210' })).toContainText(/d+(.d+)? t/);
    await expect(table).not.toContainText('Usual driver');
    await expect(page.getByTestId('truck-summary')).toContainText('blocked by documents');
    await expect(page.getByRole('tab', { name: 'Trucks' })).toHaveAttribute('aria-selected', 'true');
  });

  test('traffic manager adds a truck: errors first, live document states, then saved', async ({ page }) => {
    await openFleet(page, USERS.carrierTraffic);
    await page.getByRole('button', { name: '+ Add truck' }).click();
    const drawer = page.getByRole('dialog', { name: 'Add truck' });
    await drawer.getByRole('button', { name: 'Save truck' }).click();
    await expect(drawer.getByText('Enter the truck number.')).toBeVisible();
    await expect(drawer.getByText('Enter the RC expiry date.')).toBeVisible();

    const n = truckNo();
    await drawer.getByRole('textbox', { name: 'Truck number' }).fill(n.toLowerCase());
    await drawer.getByText('32ft MXL', { exact: true }).click();
    await drawer.getByLabel('RC valid to').fill(day(900));
    await drawer.getByLabel('Insurance valid to').fill(day(5));
    await expect(drawer.getByText('Expiring soon')).toBeVisible();
    await drawer.getByLabel('Permit valid to').fill(day(300));
    await drawer.getByLabel('Fitness valid to').fill(day(300));
    await drawer.getByLabel('PUC valid to').fill(day(200));
    await expect(drawer.getByText('Ownership')).toHaveCount(0);
    await expect(drawer.getByText('Usual driver')).toHaveCount(0);
    await expect(drawer.getByText(/Vahan|ULIP/)).toHaveCount(0);
    await drawer.getByLabel('Capacity (tonnes)').fill('0.2');
    await drawer.getByRole('button', { name: 'Save truck' }).click();
    await expect(drawer.getByText('Enter the capacity in tonnes, between 0.5 and 60.')).toBeVisible();
    await drawer.getByLabel('Capacity (tonnes)').fill('18');
    await drawer.getByRole('button', { name: 'Save truck' }).click();

    await expect(drawer).toBeHidden();
    const pretty = `${n.slice(0, 2)} ${n.slice(2, 4)} ${n.slice(4, 6)} ${n.slice(6)}`;
    const row = page.getByRole('table', { name: 'Trucks' }).getByRole('row').filter({ hasText: pretty });
    await expect(row).toContainText('Expiring');
    await expect(row).toContainText('18 t');
  });

  test('editing a truck to fix an expired date clears the block, and unsaved changes ask before closing', async ({ page }) => {
    await openFleet(page, USERS.carrierTraffic);
    await page.getByRole('button', { name: 'Edit TN 11 CC 9087' }).click();
    const drawer = page.getByRole('dialog', { name: 'Edit TN 11 CC 9087' });
    await drawer.getByLabel('Permit valid to').fill(day(365));
    await drawer.getByRole('button', { name: 'Cancel' }).click();
    await expect(drawer.getByText('Discard your changes?')).toBeVisible();
    await drawer.getByRole('button', { name: 'Keep editing' }).click();
    await drawer.getByRole('button', { name: 'Save changes' }).click();
    await expect(drawer).toBeHidden();
    await expect(page.getByRole('table', { name: 'Trucks' }).getByRole('row').filter({ hasText: 'TN 11 CC 9087' })).toContainText('Ready');
  });

  test('accounts can view trucks but has no add or edit buttons', async ({ page }) => {
    await openFleet(page, USERS.carrierAccounts);
    await expect(page.getByText('Only the traffic manager can change it.')).toBeVisible();
    await expect(page.getByRole('button', { name: '+ Add truck' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Edit / })).toHaveCount(0);
    await expect(page.getByRole('table', { name: 'Trucks' })).toContainText('TN 09 BX 4471');
  });
});

test.describe('Fleet and rates: drivers', () => {
  test('lists drivers with licence and UPI state; blocked licence explained', async ({ page }) => {
    await openFleet(page, USERS.carrierTraffic, 'drivers');
    const table = page.getByRole('table', { name: 'Drivers' });
    await expect(table.getByRole('row').filter({ hasText: 'Ramesh K' })).toContainText('Verified');
    await expect(table.getByRole('row').filter({ hasText: 'Murugan V' })).toContainText('Not verified');
    await expect(table.getByRole('row').filter({ hasText: 'Selvam P' })).toContainText('Licence expired');
    await expect(table).not.toContainText('Harish B');
  });

  test('add a driver, then change the UPI: a second person approves it', async ({ page, browser }) => {
    const name = `Driver ${uniq()}`;
    await openFleet(page, USERS.carrierTraffic, 'drivers');
    await page.getByRole('button', { name: '+ Add driver' }).click();
    const drawer = page.getByRole('dialog', { name: 'Add driver' });
    await drawer.getByRole('textbox', { name: 'Name' }).fill(name);
    await drawer.getByRole('textbox', { name: 'Mobile (WhatsApp)' }).fill(mobileDigits());
    await drawer.getByRole('textbox', { name: 'Licence number' }).fill(`TN09${String(Math.floor(Math.random() * 1e11)).padStart(11, '0')}`);
    await drawer.getByText('HGMV', { exact: true }).click();
    await drawer.getByLabel('Licence valid to').fill(day(800));
    await drawer.getByRole('textbox', { name: 'UPI ID for advances' }).fill('first@okaxis');
    await drawer.getByRole('button', { name: 'Save driver' }).click();
    await expect(drawer).toBeHidden();

    await page.getByRole('button', { name: `Open ${name}` }).click();
    const edit = page.getByRole('dialog', { name });
    await edit.getByRole('textbox', { name: 'UPI ID for advances' }).fill('second@okhdfc');
    await expect(edit.getByText('Changing a UPI ID needs a second person to approve it.')).toBeVisible();
    await edit.getByRole('button', { name: 'Save and ask for approval' }).click();
    await expect(edit).toBeHidden();
    const row = page.getByRole('table', { name: 'Drivers' }).getByRole('row').filter({ hasText: name });
    await expect(row).toContainText('Change waiting');
    await page.getByRole('button', { name: `Open ${name}` }).click();
    await expect(page.getByText('You asked for this change, so someone else must approve it.')).toBeVisible();

    // The owner approves in their own session.
    const ownerPage = await (await browser.newContext()).newPage();
    await openFleet(ownerPage, USERS.carrier, 'drivers');
    await ownerPage.getByRole('button', { name: `Open ${name}` }).click();
    await ownerPage.getByRole('button', { name: 'Approve change' }).click();
    const ownerRow = ownerPage.getByRole('table', { name: 'Drivers' }).getByRole('row').filter({ hasText: name });
    await expect(ownerRow).toContainText('second@okhdfc');
    await expect(ownerRow).toContainText('Not verified');
    await expect(ownerRow).not.toContainText('Change waiting');

    // Verify the new ID with the ₹1 test reference.
    await ownerPage.getByRole('button', { name: `Open ${name}` }).click();
    await ownerPage.getByRole('button', { name: 'Mark verified' }).click();
    await expect(ownerPage.getByText('Enter the UPI reference of the ₹1 test payment.')).toBeVisible();
    await ownerPage.getByRole('textbox', { name: 'UPI reference of the ₹1 payment' }).fill('432198765012');
    await ownerPage.getByRole('button', { name: 'Mark verified' }).click();
    await expect(ownerRow).toContainText('Verified');
    await ownerPage.context().close();
  });
});

test.describe('Fleet and rates: rate cards, users and profile', () => {
  test('rate cards show band, margin and status; owner adds one with a live band preview', async ({ page }) => {
    await openFleet(page, USERS.carrier, 'rates');
    const table = page.getByRole('table', { name: 'Own price list' });
    const cb = table.getByRole('row').filter({ hasText: 'Chennai → Bengaluru' });
    await expect(cb).toContainText('Sunrise Foods Pvt Ltd');
    await expect(cb).toContainText('₹42,500');
    await expect(cb).toContainText('±5%');
    await expect(cb).toContainText('10.6%');
    await expect(table.getByRole('row').filter({ hasText: 'Chennai → Madurai' })).toContainText('Expired');

    await page.getByRole('button', { name: '+ Add rate' }).click();
    const drawer = page.getByRole('dialog', { name: 'Add rate' });
    const city = `Trichy${uniq()}`;
    await drawer.getByRole('textbox', { name: 'From city' }).fill('Chennai');
    await drawer.getByRole('textbox', { name: 'To city' }).fill(city);
    await drawer.getByText('20ft SXL', { exact: true }).click();
    await drawer.getByRole('textbox', { name: 'Rate per trip (₹)' }).fill('30000');
    await expect(drawer.getByRole('textbox', { name: 'Rate per trip (₹)' })).toHaveValue('30,000');
    await expect(drawer.getByText('Quotes from ₹28,500 to ₹31,500 go without you.')).toBeVisible();
    await drawer.getByRole('textbox', { name: 'Trip cost (₹)' }).fill('27000');
    await expect(drawer.getByText('Margin at this rate: 10%.', { exact: false })).toBeVisible();
    await drawer.getByRole('button', { name: 'Save rate' }).click();
    await expect(drawer).toBeHidden();
    await expect(table.getByRole('row').filter({ hasText: `Chennai → ${city}` })).toContainText('Any shipper');
  });

  test('traffic manager sees rate cards read-only', async ({ page }) => {
    await openFleet(page, USERS.carrierTraffic, 'rates');
    await expect(page.getByText('Only the owner can change it.')).toBeVisible();
    await expect(page.getByRole('button', { name: '+ Add rate' })).toHaveCount(0);
  });

  test('owner invites a colleague with two roles and gets a link', async ({ page }) => {
    await openFleet(page, USERS.carrier, 'users');
    await expect(page.getByRole('table', { name: 'Users and roles' }).getByRole('row').filter({ hasText: 'Vijay Kumar' })).toContainText('Owner, Traffic manager');
    await page.getByRole('button', { name: '+ Add user' }).click();
    const drawer = page.getByRole('dialog', { name: 'Invite a colleague' });
    await drawer.getByRole('button', { name: 'Create invite' }).click();
    await expect(drawer.getByText('Choose at least one role: owner, traffic manager or accounts.')).toBeVisible();
    await drawer.getByRole('textbox', { name: 'Name' }).fill(`Clerk ${uniq()}`);
    await drawer.getByRole('textbox', { name: 'Mobile' }).fill(mobileDigits());
    await drawer.getByRole('checkbox', { name: /Traffic manager/ }).check();
    await drawer.getByRole('checkbox', { name: /Accounts/ }).check();
    await drawer.getByRole('button', { name: 'Create invite' }).click();
    const ready = page.getByRole('dialog', { name: 'Invite ready' });
    await expect(ready.getByRole('textbox', { name: 'Invite link' })).toHaveValue(/\/invite\/[0-9a-f]{64}$/);
  });

  test('company profile shows tax and bank, and no LR series', async ({ page }) => {
    await openFleet(page, USERS.carrier, 'profile');
    await expect(page.getByRole('textbox', { name: 'GSTIN' })).toHaveValue('33AAKFK1234M1Z8');
    await expect(page.getByRole('textbox', { name: 'LR prefix' })).toHaveCount(0);
    await expect(page.getByText(/Next LR/)).toHaveCount(0);
    await page.getByRole('textbox', { name: /^PAN/ }).fill('ZZZZZ9999Z');
    await page.getByRole('button', { name: 'Save profile' }).click();
    await expect(page.getByText('This PAN does not match the GSTIN (characters 3 to 12).')).toBeVisible();
    await page.getByRole('button', { name: 'Undo changes' }).click();
    await expect(page.getByRole('textbox', { name: /^PAN/ })).toHaveValue('AAKFK1234M');
  });
});

test.describe('Carrier policies', () => {
  test('owner changes the margin floor and an agent level; saved and logged', async ({ page }) => {
    await loginUi(page, USERS.carrier, '/carrier/policies');
    await expect(page.getByRole('heading', { level: 1, name: 'Policies' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Margin floor (%)' })).toHaveValue('8');
    await expect(page.getByRole('radiogroup', { name: 'Quote autonomy' }).getByRole('radio', { name: 'Ask first' })).toHaveAttribute('aria-checked', 'true');
    await page.getByRole('textbox', { name: 'Margin floor (%)' }).fill('9');
    await page.getByRole('radiogroup', { name: 'Billing autonomy' }).getByRole('radio', { name: 'Ask first' }).click();
    await expect(page.getByText('You have unsaved changes.')).toBeVisible();
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Policies saved.')).toBeVisible();
    await page.reload();
    await expect(page.getByRole('textbox', { name: 'Margin floor (%)' })).toHaveValue('9');
    // restore
    await page.getByRole('textbox', { name: 'Margin floor (%)' }).fill('8');
    await page.getByRole('radiogroup', { name: 'Billing autonomy' }).getByRole('radio', { name: 'Suggest only' }).click();
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Policies saved.')).toBeVisible();
  });

  test('an invalid value shows next to its field', async ({ page }) => {
    await loginUi(page, USERS.carrier, '/carrier/policies');
    await page.getByRole('textbox', { name: 'Rate band around rate card (± %)' }).fill('40');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Enter the rate band (%) between 0 and 25.')).toBeVisible();
  });

  test('traffic manager sees policies read-only', async ({ page }) => {
    await loginUi(page, USERS.carrierTraffic, '/carrier/policies');
    await expect(page.getByText('Only the owner can change these.')).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Margin floor (%)' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Save changes' })).toHaveCount(0);
  });
});
