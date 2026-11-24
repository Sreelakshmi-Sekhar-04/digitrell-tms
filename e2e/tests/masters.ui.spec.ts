import type { Page } from '@playwright/test';
import { USERS, expect, loginUi, test, uniq } from './helpers';

async function openMasters(page: Page, user = USERS.shipperHead, tab?: string) {
  await loginUi(page, user, tab ? `/masters?tab=${tab}` : '/masters');
  await expect(page.getByRole('heading', { name: 'Carriers and lanes', level: 1 })).toBeVisible();
}
const drawer = (page: Page) => page.getByRole('dialog');
const field = (page: Page, name: string) => drawer(page).getByRole('textbox', { name, exact: true });

test.describe('Lanes and carriers (logistics head)', () => {
  test('lists seeded lanes with carriers, budget, rule and status', async ({ page }) => {
    await openMasters(page);
    const row = page.getByRole('row', { name: /Chennai → Bengaluru/ });
    await expect(row).toContainText('32ft MXL');
    await expect(row).toContainText('Kaveri Roadlines, NorthStar Logistics, Deccan Freight Carriers, Sai Ganesh Transport');
    await expect(row).toContainText('₹46,000');
    await expect(row).toContainText('Ask me');
    await expect(row).toContainText('Active');
  });

  test('empty lane form shows every missing field and stays open', async ({ page }) => {
    await openMasters(page);
    await page.getByRole('button', { name: '+ Add lane' }).click();
    await drawer(page).getByRole('button', { name: 'Save lane' }).click();
    await expect(drawer(page).getByText('Enter the pickup city.')).toBeVisible();
    await expect(drawer(page).getByText('Enter the drop city.')).toBeVisible();
    await expect(drawer(page).getByText('Choose truck type.')).toBeVisible();
    await expect(drawer(page)).toBeVisible();
  });

  test('add a lane with automatic award, a new carrier and a budget', async ({ page }) => {
    await openMasters(page);
    await page.getByRole('button', { name: '+ Add lane' }).click();
    await field(page, 'Pickup city').fill('Coimbatore');
    await field(page, 'Drop city').fill('Kochi');
    await drawer(page).getByText('19ft', { exact: true }).click();
    await drawer(page).getByText('Lowest within budget, automatic').click();
    await drawer(page).getByRole('button', { name: 'Save lane' }).click();
    // Business rule: automatic award needs a budget and a carrier. Typed values stay.
    await expect(drawer(page).getByText('Set a budget: automatic award only picks quotes within it.')).toBeVisible();
    await expect(drawer(page).getByText('Approve at least one carrier before turning on automatic award.')).toBeVisible();
    await expect(field(page, 'Pickup city')).toHaveValue('Coimbatore');

    await field(page, 'Budget per trip (₹)').fill('21500');
    await expect(field(page, 'Budget per trip (₹)')).toHaveValue('21,500');
    const carrierName = `Velan Transports ${uniq()}`;
    await drawer(page).getByRole('button', { name: '+ Add a carrier not on the list' }).click();
    await field(page, 'Carrier company name').fill(carrierName);
    await field(page, "Owner's mobile").fill('12345');
    await drawer(page).getByRole('button', { name: 'Add carrier' }).click();
    await expect(drawer(page).getByText('Enter a 10-digit Indian mobile number, e.g. 98765 43210.')).toBeVisible();
    await field(page, "Owner's mobile").fill(`98${String(Date.now()).slice(-8)}`);
    await drawer(page).getByRole('button', { name: 'Add carrier' }).click();
    await expect(drawer(page).getByRole('checkbox', { name: new RegExp(carrierName) })).toBeChecked();

    await drawer(page).getByRole('button', { name: 'Save lane' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Lane added.' })).toBeVisible();
    await expect(drawer(page)).toBeHidden();
    const row = page.getByRole('row', { name: /Coimbatore → Kochi/ });
    await expect(row).toContainText('₹21,500');
    await expect(row).toContainText('Lowest within budget, automatic');
    await expect(row).toContainText(carrierName);
  });

  test('duplicate lane is refused on the drop-city field', async ({ page }) => {
    await openMasters(page);
    await page.getByRole('button', { name: '+ Add lane' }).click();
    await field(page, 'Pickup city').fill('chennai');
    await field(page, 'Drop city').fill('bengaluru');
    await drawer(page).getByText('32ft MXL', { exact: true }).click();
    await drawer(page).getByRole('button', { name: 'Save lane' }).click();
    await expect(drawer(page).getByText('This lane already exists. Edit it instead.')).toBeVisible();
  });

  test('edit a lane and see the change in the table', async ({ page }) => {
    await openMasters(page);
    await page.getByRole('button', { name: 'Edit Chennai to Bengaluru' }).click();
    await expect(field(page, 'Budget per trip (₹)')).toHaveValue('46,000');
    await field(page, 'Budget per trip (₹)').fill('47000');
    await drawer(page).getByRole('checkbox', { name: /Sai Ganesh Transport/ }).uncheck();
    await drawer(page).getByRole('button', { name: 'Save changes' }).click();
    const row = page.getByRole('row', { name: /Chennai → Bengaluru/ });
    await expect(row).toContainText('₹47,000');
    await expect(row).not.toContainText('Sai Ganesh');
  });

  test('closing with unsaved changes asks once; Keep editing keeps the input', async ({ page }) => {
    await openMasters(page);
    await page.getByRole('button', { name: '+ Add lane' }).click();
    await field(page, 'Pickup city').fill('Madurai');
    await page.keyboard.press('Escape');
    await expect(drawer(page).getByText('Discard your changes?')).toBeVisible();
    await drawer(page).getByRole('button', { name: 'Keep editing' }).click();
    await expect(field(page, 'Pickup city')).toHaveValue('Madurai');
    await drawer(page).getByRole('button', { name: 'Close' }).click();
    await drawer(page).getByRole('button', { name: 'Discard' }).click();
    await expect(drawer(page)).toBeHidden();
  });
});

test.describe('Addresses', () => {
  test('add with a bad phone, fix it, then a duplicate name keeps the input', async ({ page }) => {
    await openMasters(page, USERS.shipperHead, 'addresses');
    await expect(page.getByRole('tab', { name: 'Addresses' })).toHaveAttribute('aria-selected', 'true');
    const name = `Oragadam Yard ${uniq()}`;
    await page.getByRole('button', { name: '+ Add address' }).click();
    await field(page, 'Short name').fill(name);
    await field(page, 'City').fill('Chennai');
    await field(page, 'Street address').fill('SIPCOT Oragadam');
    await drawer(page).getByText('Pickup and drop', { exact: true }).click();
    await field(page, 'Contact mobile').fill('555');
    await drawer(page).getByRole('button', { name: 'Save address' }).click();
    await expect(drawer(page).getByText('Enter a 10-digit Indian mobile number, e.g. 98765 43210.')).toBeVisible();
    await field(page, 'Contact mobile').fill('98765 43210');
    await drawer(page).getByRole('button', { name: 'Save address' }).click();
    await expect(page.getByRole('status').filter({ hasText: `${name} added.` })).toBeVisible();
    await expect(page.getByRole('row', { name: new RegExp(name) })).toContainText('+91 98765 43210');

    await page.getByRole('button', { name: '+ Add address' }).click();
    await field(page, 'Short name').fill('Hosur Plant');
    await field(page, 'City').fill('Bengaluru');
    await field(page, 'Street address').fill('Somewhere');
    await drawer(page).getByText('Drop', { exact: true }).click();
    await drawer(page).getByRole('button', { name: 'Save address' }).click();
    await expect(drawer(page).getByText('This name is already used. Pick another or edit the existing one.')).toBeVisible();
    await expect(field(page, 'Street address')).toHaveValue('Somewhere');
  });

  test('deactivate hides an address until "Show deactivated" is ticked', async ({ page }) => {
    await openMasters(page, USERS.shipperHead, 'addresses');
    await page.getByRole('button', { name: 'Edit Chakan Warehouse' }).click();
    await drawer(page).getByRole('button', { name: 'Deactivate' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Chakan Warehouse deactivated.' })).toBeVisible();
    await expect(page.getByRole('row', { name: /Chakan Warehouse/ })).toHaveCount(0);
    await page.getByLabel('Show deactivated').check();
    await expect(page.getByRole('row', { name: /Chakan Warehouse/ })).toContainText('Deactivated');
    await page.getByRole('button', { name: 'Edit Chakan Warehouse' }).click();
    await drawer(page).getByRole('button', { name: 'Reactivate' }).click();
    await expect(page.getByRole('row', { name: /Chakan Warehouse/ })).toContainText('Active');
  });
});

test.describe('Users and invites', () => {
  test('invite a colleague, they accept the link and land signed in', async ({ page, browser }) => {
    await openMasters(page, USERS.shipperHead, 'users');
    await page.getByRole('button', { name: '+ Add user' }).click();
    const email = `rahul.${uniq()}@sunrisefoods.test`;
    await field(page, 'Name').fill('Rahul Menon');
    await field(page, 'Mobile').fill(`93${String(Date.now()).slice(-8)}`);
    await field(page, 'Email').fill(email);
    await expect(drawer(page).getByRole('textbox', { name: /Can approve up to/ })).toHaveCount(0);
    await drawer(page).getByRole('radio', { name: /Approver/ }).check();
    const limit = drawer(page).getByRole('textbox', { name: 'Can approve up to (₹ per decision)' });
    await expect(limit).toBeVisible();
    await expect(drawer(page).getByText('Above this, it goes to you (₹2,00,000).')).toBeVisible();
    await limit.fill('300000');
    await drawer(page).getByRole('button', { name: 'Create invite' }).click();
    await expect(drawer(page).getByText('You can grant up to your own limit, ₹2,00,000.')).toBeVisible();
    await limit.fill('75000');
    await expect(drawer(page).getByText(/as approver \(up to ₹75,000\)/)).toBeVisible();
    await drawer(page).getByRole('button', { name: 'Create invite' }).click();

    await expect(drawer(page).getByRole('heading', { name: 'Invite ready' })).toBeVisible();
    const link = await drawer(page).getByRole('textbox', { name: 'Invite link' }).inputValue();
    expect(link).toMatch(/\/invite\/[0-9a-f]{64}$/);
    await drawer(page).getByRole('button', { name: 'Done' }).click();
    await expect(page.getByRole('row', { name: /Rahul Menon/ })).toContainText('Invited');

    const ctx = await browser.newContext();
    const rahul = await ctx.newPage();
    await rahul.goto(link);
    await expect(rahul.getByRole('heading', { name: 'Join Sunrise Foods Pvt Ltd' })).toBeVisible();
    await rahul.getByRole('textbox', { name: 'New password' }).fill('Kochi2026');
    await rahul.getByRole('textbox', { name: 'Type it again' }).fill('Kochi2027');
    await rahul.getByRole('button', { name: 'Set password and continue' }).click();
    await expect(rahul.getByText("The two passwords don't match.")).toBeVisible();
    await rahul.getByRole('textbox', { name: 'Type it again' }).fill('Kochi2026');
    await rahul.getByRole('button', { name: 'Set password and continue' }).click();
    await expect(rahul.getByTestId('user-name')).toHaveText('Rahul Menon');
    await rahul.goto(link);
    await expect(rahul.getByRole('heading', { name: "This link doesn't work any more" })).toBeVisible();
    await ctx.close();

    await page.reload();
    await expect(page.getByRole('row', { name: /Rahul Menon/ })).toContainText('Active');
  });

  test('your own row cannot be deactivated', async ({ page }) => {
    await openMasters(page, USERS.shipperHead, 'users');
    await page.getByRole('button', { name: 'Edit Anita Rao' }).click();
    await expect(drawer(page).getByRole('button', { name: 'Deactivate' })).toHaveCount(0);
    await expect(drawer(page).getByRole('radio', { name: /Booking executive/ })).toBeDisabled();
  });
});

test.describe('Booking executive view', () => {
  test('lanes and users are read-only; addresses can be added', async ({ page }) => {
    await openMasters(page, USERS.shipperExec);
    await expect(page.getByText('Lanes and users are managed by your logistics head.')).toBeVisible();
    await expect(page.getByRole('button', { name: /^\+ Add/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Edit / })).toHaveCount(0);
    await page.getByRole('tab', { name: 'Users and roles' }).click();
    await expect(page.getByRole('row', { name: /Anita Rao/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Edit / })).toHaveCount(0);
    await page.getByRole('tab', { name: 'Addresses' }).click();
    await expect(page.getByRole('button', { name: '+ Add address' })).toBeVisible();
  });

  test('policies are visible but cannot be changed', async ({ page }) => {
    await loginUi(page, USERS.shipperExec, '/policies');
    await expect(page.getByText('Only the logistics head can change these.')).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Payments need approval above (₹)' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Save changes' })).toHaveCount(0);
  });
});

test.describe('Policies (logistics head)', () => {
  test('change limits and autonomy, save, and it persists; award stays "ask first"', async ({ page }) => {
    await loginUi(page, USERS.shipperHead, '/policies');
    const save = page.getByRole('button', { name: 'Save changes' });
    await expect(save).toBeDisabled();
    await expect(page.getByRole('radiogroup', { name: 'Bid evaluation autonomy' }).getByRole('radio', { name: 'Act within limits' })).toBeDisabled();

    await page.getByRole('textbox', { name: 'Payments need approval above (₹)' }).fill('80000');
    await page.getByRole('radiogroup', { name: 'Billing autonomy' }).getByRole('radio', { name: 'Act within limits' }).click();
    await page.getByText('Hard copy required').click();
    await expect(page.getByText('You have unsaved changes.')).toBeVisible();
    await save.click();
    await expect(page.getByRole('status').filter({ hasText: 'Policies saved.' })).toBeVisible();

    await page.reload();
    await expect(page.getByRole('textbox', { name: 'Payments need approval above (₹)' })).toHaveValue('80,000');
    await expect(page.getByRole('radiogroup', { name: 'Billing autonomy' }).getByRole('radio', { name: 'Act within limits' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('radio', { name: /Hard copy required/ })).toBeChecked();
  });

  test('invalid values show field errors; Discard restores saved values', async ({ page }) => {
    await loginUi(page, USERS.shipperHead, '/policies');
    const hours = page.getByRole('textbox', { name: 'Quote window (hours)' });
    const before = await hours.inputValue();
    await hours.fill('99');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Enter the quote window in hours between 1 and 48.')).toBeVisible();
    await page.getByRole('button', { name: 'Discard' }).click();
    await expect(hours).toHaveValue(before);
  });
});
