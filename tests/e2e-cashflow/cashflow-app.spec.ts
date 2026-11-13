import { expect, test, type Browser, type Page } from '@playwright/test';

// The separate Cash Flow app: the same code started with APP_MODE=cashflow. Expects the database as
// tests/e2e leaves it: kartik / 111 is the Super Admin, Zinia (zinia / 555) no longer has Finance access.
type Person = { user: string; pin: string };
const ADMIN: Person = { user: 'kartik', pin: '111' };
const ZINIA: Person = { user: 'zinia', pin: '555' };
const SHOTS = process.env.E2E_SHOTS ?? 'test-results/screens';
const FINANCE_ONLY = 'This app is for the Super Admin and people with Finance access.';

test.describe.configure({ mode: 'serial' });

async function signIn(browser: Browser, who: Person): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto('/login');
  await page.getByLabel('Username').fill(who.user);
  await page.getByLabel('PIN').fill(who.pin);
  await page.getByRole('button', { name: 'Sign in' }).click();
  return page;
}

test('only Cash Flow, only for the Super Admin and people with Finance access', async ({ browser }) => {
  // Someone without Finance access cannot sign in here at all
  const refused = await signIn(browser, ZINIA);
  await expect(refused.getByText(FINANCE_ONLY)).toBeVisible();
  await expect(refused).toHaveURL(/\/login$/);
  await refused.goto('/finance');
  await expect(refused).toHaveURL(/\/login$/);

  // The Super Admin lands on Cash Flow; the menu has only Cash Flow and Team
  const admin = await signIn(browser, ADMIN);
  await admin.waitForURL((u) => u.pathname === '/finance');
  await expect(admin.getByRole('heading', { name: 'Cash Flow' })).toBeVisible();
  await expect(admin).toHaveTitle(/Cash Flow/);
  const menu = admin.locator('aside nav').getByRole('link');
  await expect(menu).toHaveText(['Cash Flow', 'Team']);
  await expect(admin.locator('aside').getByText('Cash Flow', { exact: true }).first()).toBeVisible();
  await admin.waitForLoadState('networkidle');
  await admin.screenshot({ path: `${SHOTS}/50-cashflow-app.png`, fullPage: true });

  // The task manager's pages are not part of this app
  for (const path of ['/tasks', '/attendance', '/credentials', '/sheets', '/help', '/manager']) {
    await admin.goto(path);
    await expect(admin).toHaveURL(/\/finance$/);
  }
  await admin.goto('/finance/gmail');
  await expect(admin.getByRole('heading', { name: 'Bank emails' })).toBeVisible();

  // The Super Admin gives Zinia Finance access on the Team page; now she gets in, without Team
  await admin.goto('/team');
  await admin.getByRole('link', { name: 'Zinia', exact: true }).click();
  await admin.getByLabel('Zinia can open Cash Flow').check();
  await admin.getByRole('button', { name: 'Save Finance access' }).click();
  await expect(admin.getByText('Finance access given. They can now open Cash Flow.')).toBeVisible();
  const zinia = await signIn(browser, ZINIA);
  await zinia.waitForURL((u) => u.pathname === '/finance');
  await expect(zinia.locator('aside nav').getByRole('link')).toHaveText(['Cash Flow']);

  // Taking it away again closes the app to her
  await admin.getByLabel('Zinia can open Cash Flow').uncheck();
  await admin.getByRole('button', { name: 'Save Finance access' }).click();
  await expect(admin.getByText('Finance access removed.')).toBeVisible();
  await zinia.goto('/finance');
  await expect(zinia.getByText(FINANCE_ONLY)).toBeVisible();
});
