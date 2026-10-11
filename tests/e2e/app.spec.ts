import { expect, test, type Browser, type Page } from '@playwright/test';

// End-to-end walk-through against a running app + Supabase stack.
// Expects the database freshly reset and the admin bootstrapped as kartik / ADMIN_PASSWORD / 111.
const ADMIN = { user: 'kartik', password: process.env.E2E_ADMIN_PASSWORD ?? 'Admin-local-2026', pin: '111' };
const PEOPLE = {
  Shruti: { user: 'shruti', password: 'Shruti-temp-2026', pin: '222' },
  Dev: { user: 'dev', password: 'Dev-temp-20261', pin: '444' },
  Zinia: { user: 'zinia', password: 'Zinia-temp-2026', pin: '555' },
};
const SHOTS = process.env.E2E_SHOTS ?? 'test-results/screens';

test.describe.configure({ mode: 'serial' });

async function signIn(page: Page, who: { user: string; password: string; pin: string }) {
  await page.goto('/login');
  await page.getByLabel('Username').fill(who.user);
  await page.getByLabel('Password').fill(who.password);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForURL('**/verify');
  await page.getByLabel('PIN').fill(who.pin);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => u.pathname === '/');
  await expect(page.getByRole('heading', { name: /^Hello, / })).toBeVisible();
}

async function as(browser: Browser, who: { user: string; password: string; pin: string }, mobile = false) {
  const ctx = await browser.newContext(mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : {});
  const page = await ctx.newPage();
  await signIn(page, who);
  return page;
}

function isoIn(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

let taskUrl = '';
let backlogUrl = '';

test('signed-out visitors are sent to login; bad password is rejected generically', async ({ page }) => {
  await page.goto('/tasks');
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel('Username').fill('kartik');
  await page.getByLabel('Password').fill('wrong-password-1');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.locator('form [role=alert]')).toHaveText('Username or password is incorrect.');
  await page.screenshot({ path: `${SHOTS}/01-login.png` });
});

test('admin signs in with password + PIN and creates logins from the Team page', async ({ browser }) => {
  const page = await as(browser, ADMIN);
  await expect(page.getByRole('heading', { name: 'Hello, Kartik' })).toBeVisible();
  for (const [name, p] of Object.entries(PEOPLE)) {
    await page.goto('/team');
    await page.getByRole('link', { name, exact: true }).click();
    await page.getByLabel('Username').fill(p.user);
    await page.getByLabel('Temporary password').fill(p.password);
    await page.getByLabel('3-digit PIN').fill(p.pin);
    await page.getByRole('button', { name: 'Create login' }).click();
    await expect(page.getByText(`Username: ${p.user}`)).toBeVisible();
  }
  await page.goto('/team');
  await page.screenshot({ path: `${SHOTS}/02-team.png`, fullPage: true });
});

test('admin assigns a task to Shruti and can track it', async ({ browser }) => {
  const page = await as(browser, ADMIN);
  await page.goto('/tasks/new');
  await page.getByLabel('Task', { exact: true }).fill('Update Myntra listing photos');
  await page.getByLabel('Details').fill('Replace the 12 kurta listings with new shoot photos');
  await page.getByLabel('Owner').selectOption({ label: 'Shruti' });
  await page.getByLabel('Priority').selectOption('High');
  await page.getByLabel('Due Date').fill(isoIn(2));
  await page.getByRole('button', { name: 'Create task' }).click();
  await expect(page.getByText('Task created and assigned to Shruti.')).toBeVisible();
  taskUrl = new URL(page.url()).pathname;
  await expect(page.getByText('Due soon').filter({ visible: true }).first()).toBeVisible();
  await page.goto('/');
  await expect(page.getByText('Update Myntra listing photos').filter({ visible: true }).first()).toBeVisible(); // under "Tasks I assigned to others"
});

test('Shruti sees and updates her task; a blocker needs a note', async ({ browser }) => {
  const page = await as(browser, PEOPLE.Shruti);
  await expect(page.getByText('Update Myntra listing photos').filter({ visible: true }).first()).toBeVisible();
  await page.goto(taskUrl);
  await page.getByLabel('Status').selectOption('Blocked');
  await page.getByLabel('% Complete').fill('30');
  await page.getByLabel('Progress Note / Blocker').fill('');
  await page.getByRole('button', { name: 'Save progress' }).click();
  await expect(page.locator('form [role=alert]')).toContainText('Say what is blocking you');
  await page.getByLabel('Progress Note / Blocker').fill('Waiting for photos from the studio');
  await page.getByRole('button', { name: 'Save progress' }).click();
  await expect(page.getByText('Progress saved.')).toBeVisible();
  await expect(page.getByText('Edit task or reassign')).toHaveCount(0); // owner cannot edit core fields
  await page.reload();
  await page.screenshot({ path: `${SHOTS}/03-task-detail.png`, fullPage: true });
});

test('Zinia cannot open Shruti\'s task by URL and cannot see the manager dashboard', async ({ browser }) => {
  const page = await as(browser, PEOPLE.Zinia);
  await page.goto(taskUrl);
  await expect(page.getByRole('heading', { name: 'Not found' })).toBeVisible();
  await page.goto('/manager');
  await expect(page).toHaveURL(/error=managers-only/);
  await expect(page.getByRole('link', { name: 'Dashboard', exact: true })).toHaveCount(0);
});

test('Shruti adds unassigned work to the backlog and gets a suggested owner', async ({ browser }) => {
  const page = await as(browser, PEOPLE.Shruti);
  await page.goto('/backlog/new');
  await page.getByLabel('Task', { exact: true }).fill('Pack and dispatch the festive bulk order');
  await page.getByLabel('Skills Needed').fill('packing, dispatch');
  await page.getByLabel('Priority').selectOption('High');
  await page.getByLabel('Due Date').fill(isoIn(4));
  await page.getByRole('button', { name: 'Submit to backlog' }).click();
  await expect(page.getByRole('heading', { name: /Suggested Owner: Sanket/ })).toBeVisible();
  await expect(page.getByText('Waiting for a manager to approve an owner.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve and assign' })).toHaveCount(0);
  backlogUrl = new URL(page.url()).pathname;
});

test('manager approves with an override; the backlog row is kept as Assigned', async ({ browser }) => {
  const page = await as(browser, ADMIN);
  await page.goto(backlogUrl);
  await page.screenshot({ path: `${SHOTS}/04-backlog-approval.png`, fullPage: true });
  await page.getByLabel('Assign to').selectOption({ label: 'Dev' });
  await page.getByLabel('Decision note').fill('Sanket is on dispatch this week');
  await page.getByRole('button', { name: 'Approve and assign' }).click();
  await page.waitForURL(/\/tasks\/[0-9a-f-]+\?created=1/);
  await expect(page.getByText('Task created and assigned to Dev.')).toBeVisible();
  await page.goto(backlogUrl);
  await expect(page.getByText(/overrode suggestion: Sanket/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve and assign' })).toHaveCount(0);
  await page.goto('/backlog?show=all');
  await expect(page.getByRole('cell', { name: 'Assigned' }).first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/05-backlog.png`, fullPage: true });
});

test('Dev ticks off a routine once per cycle', async ({ browser }) => {
  const page = await as(browser, PEOPLE.Dev);
  await page.goto('/routines');
  const row = page.getByRole('row', { name: /Pack orders/ });
  await row.getByRole('button', { name: 'Mark done' }).click();
  await expect(row.getByText(/Logged\. Next due/)).toBeVisible();
  await page.reload();
  await expect(page.getByRole('row', { name: /Pack orders/ }).getByText('Done this cycle ✓')).toBeVisible();
  await expect(page.getByRole('row', { name: /Update hold sheet/ })).toHaveCount(0); // Sanket's routine, not Dev's
});

test('manager dashboard reflects the changes', async ({ browser }) => {
  const page = await as(browser, ADMIN);
  await page.goto('/manager');
  const card = (label: string) => page.locator('.card', { hasText: label }).first();
  await expect(card('Open tasks')).toContainText('2');
  await expect(card('Blocked')).toContainText('1');
  await expect(card('Unassigned backlog')).toContainText('0');
  await page.getByRole('link', { name: 'Shruti' }).click();
  await expect(page.getByText('Shruti: open and recent tasks')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/06-manager-dashboard.png`, fullPage: true });
  await page.goto('/tasks?done=1');
  await expect(page.getByRole('heading', { name: 'Task Board' })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/07-task-board.png`, fullPage: true });
});

test('mobile layout works', async ({ browser }) => {
  const page = await as(browser, PEOPLE.Shruti, true);
  await page.screenshot({ path: `${SHOTS}/08-mobile-dashboard.png`, fullPage: true });
  await page.getByRole('button', { name: 'Open menu' }).click();
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Task Board' }).click();
  await expect(page.getByRole('heading', { name: 'Task Board' })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow).toBe(false);
  await page.screenshot({ path: `${SHOTS}/09-mobile-board.png`, fullPage: true });
});

test('five wrong PINs lock the account', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Username').fill(PEOPLE.Zinia.user);
  await page.getByLabel('Password').fill(PEOPLE.Zinia.password);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForURL('**/verify');
  for (let i = 0; i < 5; i++) {
    await page.getByLabel('PIN').fill('999');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.locator('form [role=alert]')).toBeVisible();
  }
  await expect(page.locator('form [role=alert]')).toContainText('Too many wrong PINs');
  await page.getByLabel('PIN').fill(PEOPLE.Zinia.pin);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('form [role=alert]')).toContainText('Too many wrong PINs');
});

test('deactivating a member cuts off their open session', async ({ browser }) => {
  const dev = await as(browser, PEOPLE.Dev);
  const admin = await as(browser, ADMIN);
  await admin.goto('/team');
  await admin.getByRole('link', { name: 'Dev', exact: true }).click();
  await admin.getByRole('button', { name: 'Deactivate member' }).click();
  await admin.getByRole('dialog').getByRole('button', { name: 'Deactivate' }).click();
  await expect(admin.getByRole('button', { name: 'Reactivate member' })).toBeVisible();
  await dev.goto('/tasks');
  await expect(dev).toHaveURL(/\/login\?error=inactive/);
  await admin.getByRole('button', { name: 'Reactivate member' }).click();
  await admin.getByRole('dialog').getByRole('button', { name: 'Reactivate' }).click();
  await expect(admin.getByRole('button', { name: 'Deactivate member' })).toBeVisible();
});
