import { expect, test, type Browser, type Page } from '@playwright/test';

// End-to-end walk-through against a running app + Supabase stack.
// Expects the database freshly reset and the admin bootstrapped as kartik / PIN 111.
type Person = { user: string; pin: string };
const ADMIN: Person = { user: 'kartik', pin: '111' };
const PEOPLE: Record<string, Person> = {
  Shruti: { user: 'shruti', pin: '222' },
  Dev: { user: 'dev', pin: '444' },
  Zinia: { user: 'zinia', pin: '555' },
};
const SHOTS = process.env.E2E_SHOTS ?? 'test-results/screens';

test.describe.configure({ mode: 'serial' });

async function signIn(page: Page, who: Person) {
  await page.goto('/login');
  await page.getByLabel('Username').fill(who.user);
  await page.getByLabel('PIN').fill(who.pin);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => u.pathname === '/');
  await expect(page.getByRole('heading', { name: /^Hello, / })).toBeVisible();
}

async function as(browser: Browser, who: Person, mobile = false) {
  const ctx = await browser.newContext(mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : {});
  const page = await ctx.newPage();
  await signIn(page, who);
  return page;
}

// Dates in the workspace time zone (the app's "today"), not the test machine's.
function isoIn(days: number) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function memberIdFromTeam(page: Page, name: string) {
  await page.goto('/team');
  const href = await page.getByRole('link', { name, exact: true }).first().getAttribute('href');
  return href!.split('/').pop()!;
}

let taskUrl = '';
let backlogUrl = '';

test('signed-out visitors are sent to login; a wrong PIN or unknown user is rejected generically', async ({ page }) => {
  await page.goto('/tasks');
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel('Username').fill('kartik');
  await page.getByLabel('PIN').fill('999');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('form [role=alert]')).toHaveText('Username or PIN is incorrect.');
  await page.getByLabel('Username').fill('nobody');
  await page.getByLabel('PIN').fill('111');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('form [role=alert]')).toHaveText('Username or PIN is incorrect.');
  await page.screenshot({ path: `${SHOTS}/01-login.png` });
});

test('admin signs in with username + PIN and creates logins from the Team page', async ({ browser }) => {
  const page = await as(browser, ADMIN);
  await expect(page.getByRole('heading', { name: 'Hello, Kartik' })).toBeVisible();
  for (const [name, p] of Object.entries(PEOPLE)) {
    await page.goto('/team');
    await page.getByRole('link', { name, exact: true }).click();
    await page.getByLabel('Username').fill(p.user);
    await page.getByLabel('3-digit PIN').fill(p.pin);
    await page.getByRole('button', { name: 'Create login' }).click();
    await expect(page.getByText(`Username: ${p.user}`)).toBeVisible();
  }
  await page.goto('/team');
  await page.screenshot({ path: `${SHOTS}/02-team.png`, fullPage: true });
});

test('admin delegates a task to Shruti and can track it', async ({ browser }) => {
  const page = await as(browser, ADMIN);
  await page.goto('/tasks/new');
  await expect(page.getByLabel('Owner')).toHaveCount(0);
  await expect(page.getByLabel('Delegated by')).toHaveValue(/.+/); // defaults to the person entering it
  await page.getByLabel('Task', { exact: true }).fill('Update Myntra listing photos');
  await page.getByLabel('Description').fill('Replace the 12 kurta listings with new shoot photos');
  await page.getByLabel('Assigned to').selectOption({ label: 'Shruti' });
  await page.getByLabel('Priority').selectOption('Critical');
  await page.getByLabel('Due Date').fill(isoIn(2));
  await page.getByLabel('Flag as important').check();
  await page.getByRole('button', { name: 'Create task' }).click();
  await expect(page.getByText('Task created and assigned to Shruti.')).toBeVisible();
  taskUrl = new URL(page.url()).pathname;
  await expect(page.getByText('Due soon').filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText(/^TSK-\d{3}$/)).toBeVisible();
  await page.goto('/tasks?scope=assigned');
  await expect(page.getByText('Update Myntra listing photos').filter({ visible: true }).first()).toBeVisible();
});

test('Shruti blocks her task with a reason, then unblocks it from the board', async ({ browser }) => {
  const page = await as(browser, PEOPLE.Shruti);
  await expect(page.getByText('Update Myntra listing photos').filter({ visible: true }).first()).toBeVisible();
  await page.goto(taskUrl);
  await page.getByLabel('Status', { exact: true }).selectOption('Blocked');
  await page.getByLabel('% Complete').fill('30');
  await expect(page.getByRole('textbox', { name: 'Blocker reason (required)' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Blocker reason (required)' }).fill('Waiting for photos from the studio');
  await page.getByRole('button', { name: 'Save progress' }).click();
  await expect(page.getByText('Progress saved.')).toBeVisible();
  await expect(page.getByText(/Edit task, reassign/)).toHaveCount(0); // the assignee cannot edit core fields
  await page.reload();
  await expect(page.getByRole('note')).toContainText('Waiting for photos from the studio');
  await expect(page.getByText('Blocked: “Waiting for photos from the studio”')).toBeVisible(); // history
  await page.screenshot({ path: `${SHOTS}/03-task-detail.png`, fullPage: true });

  await page.goto('/tasks');
  const row = page.getByRole('row', { name: /Update Myntra listing photos/ });
  await expect(row).toContainText('Blocked: Waiting for photos from the studio');
  await row.getByLabel('Change status').selectOption('Active');
  await expect(row.getByRole('status')).toHaveText('Saved');
  await page.reload();
  await expect(page.getByRole('row', { name: /Update Myntra listing photos/ })).not.toContainText('Waiting for photos');
  await page.goto(taskUrl);
  await expect(page.getByText(/Blocker cleared/)).toBeVisible();
  // and back to Blocked from the board, which asks for the reason first
  await page.goto('/tasks');
  await page.getByRole('row', { name: /Update Myntra listing photos/ }).getByLabel('Change status').selectOption('Blocked');
  await page.getByRole('dialog').getByLabel('Blocker reason').fill('Studio closed until Monday');
  await page.getByRole('dialog').getByRole('button', { name: 'Mark Blocked' }).click();
  await expect(page.getByRole('row', { name: /Update Myntra listing photos/ }).getByRole('status')).toHaveText('Saved');
  await page.reload();
  await expect(page.getByRole('row', { name: /Update Myntra listing photos/ })).toContainText('Studio closed until Monday');
});

test('Zinia cannot open Shruti\'s task by URL and cannot see the manager dashboard', async ({ browser }) => {
  const page = await as(browser, PEOPLE.Zinia);
  await page.goto(taskUrl);
  await expect(page.getByRole('heading', { name: 'Not found' })).toBeVisible();
  await page.goto('/manager');
  await expect(page).toHaveURL(/error=managers-only/);
  await expect(page.getByRole('link', { name: 'Dashboard', exact: true })).toHaveCount(0);
});

test('Shruti adds unassigned work to the backlog and gets a rule-based suggestion', async ({ browser }) => {
  const page = await as(browser, PEOPLE.Shruti);
  await page.goto('/backlog/new');
  await page.getByLabel('Task', { exact: true }).fill('Pack and dispatch the festive bulk order');
  await page.getByLabel('Skills Needed').fill('packing, dispatch');
  await page.getByLabel('Priority').selectOption('High');
  await page.getByLabel('Due Date').fill(isoIn(4));
  await page.getByRole('button', { name: 'Submit to backlog' }).click();
  await expect(page.getByRole('heading', { name: /Suggested assignee: Sanket/ })).toBeVisible();
  await expect(page.getByText(/Alternatives:/)).toBeVisible();
  await expect(page.getByText('Waiting for a manager to approve who takes it.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve and create task' })).toHaveCount(0);
  await expect(page.getByText(/^BCK-1\d\d$/).first()).toBeVisible();
  backlogUrl = new URL(page.url()).pathname;
});

test('manager approves with an override; the backlog row is kept as Converted to Task', async ({ browser }) => {
  const page = await as(browser, ADMIN);
  await page.goto(backlogUrl);
  await page.screenshot({ path: `${SHOTS}/04-backlog-approval.png`, fullPage: true });
  await page.getByLabel('Assign to').selectOption({ label: 'Dev' });
  await page.getByLabel('Decision note').fill('Sanket is on dispatch this week');
  await page.getByRole('button', { name: 'Approve only' }).click();
  await expect(page.getByRole('button', { name: 'Convert to task' })).toBeVisible();
  await page.getByRole('button', { name: 'Convert to task' }).click();
  await page.waitForURL(/\/tasks\/[0-9a-f-]+\?created=1/);
  await expect(page.getByText('Task created and assigned to Dev.')).toBeVisible();
  await expect(page.getByLabel('Change status')).toHaveValue('To Do');
  await page.goto(backlogUrl);
  await expect(page.getByText(/overrode suggestion: Sanket/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve and create task' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Convert to task' })).toHaveCount(0);
  await page.goto('/backlog?show=all');
  await expect(page.getByText('Converted to Task').filter({ visible: true }).first()).toBeVisible();
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

test('Team Calendar: admin records leave with a backup and a holiday; the backup covers the routine', async ({ browser }) => {
  const admin = await as(browser, ADMIN);
  // a routine for Dev with Zinia as backup
  await admin.goto('/routines/new');
  await admin.getByLabel('Routine Task').fill('Restock packing tape');
  await admin.getByLabel('Assigned to').selectOption({ label: 'Dev' });
  await admin.getByLabel('Backup (optional)').selectOption({ label: 'Zinia' });
  await admin.getByLabel('Frequency').selectOption('Weekly');
  await admin.getByRole('button', { name: 'Create routine' }).click();
  await expect(admin.getByText(/RTN-\d{3}/).filter({ visible: true }).first()).toBeVisible();

  await admin.goto('/calendar');
  await expect(admin.getByRole('heading', { name: 'Team Calendar' })).toBeVisible();
  await admin.getByLabel('Person').selectOption({ label: 'Dev' });
  await admin.getByLabel('Leave type').selectOption('Sick Leave');
  await admin.getByLabel('First day').fill(isoIn(0));
  await admin.getByLabel('Last day').fill(isoIn(1));
  await admin.getByLabel('Backup (optional)').selectOption({ label: 'Zinia' });
  await admin.getByRole('button', { name: 'Add leave' }).click();
  await expect(admin.getByText(/Leave added: Sick Leave/)).toBeVisible();
  // overlapping leave is refused
  await admin.getByLabel('Person').selectOption({ label: 'Dev' });
  await admin.getByLabel('Leave type').selectOption('Casual Leave');
  await admin.getByLabel('First day').fill(isoIn(1));
  await admin.getByLabel('Last day').fill(isoIn(1));
  await admin.getByRole('button', { name: 'Add leave' }).click();
  await expect(admin.getByText(/overlaps another leave/)).toBeVisible();
  // The reference data already has Diwali on 30-Oct-26, and a second holiday on one date is refused.
  await admin.getByLabel('Date', { exact: true }).fill(isoIn(10) === '2026-10-30' ? isoIn(11) : isoIn(10));
  await admin.getByLabel('Holiday', { exact: true }).fill('Founders Day');
  await admin.getByRole('button', { name: 'Add holiday' }).click();
  await expect(admin.getByText('Founders Day').first()).toBeVisible();
  await admin.screenshot({ path: `${SHOTS}/11-calendar.png`, fullPage: true });
  await admin.goto('/team');
  await expect(admin.getByText('On Leave').filter({ visible: true }).first()).toBeVisible();

  // Shruti sees that Dev is away but not why, and cannot add holidays
  const shruti = await as(browser, PEOPLE.Shruti);
  await shruti.goto('/calendar');
  await expect(shruti.getByText(/Dev/).filter({ visible: true }).first()).toBeVisible();
  await expect(shruti.getByText('Sick Leave').filter({ visible: true })).toHaveCount(0); // the type is private
  await expect(shruti.getByRole('button', { name: 'Add holiday' })).toHaveCount(0);

  // Zinia covers Dev's routine while he is away; ownership stays with Dev
  const zinia = await as(browser, PEOPLE.Zinia);
  await zinia.goto('/routines');
  const row = zinia.getByRole('row', { name: /Restock packing tape/ });
  await expect(row).toContainText('covering while Dev is on leave');
  await row.getByRole('button', { name: 'Mark done' }).click();
  await expect(row.getByText(/Logged\. Next due/)).toBeVisible();
  await admin.goto('/routines');
  await admin.getByRole('row', { name: /Restock packing tape/ }).getByRole('link', { name: /Restock packing tape/ }).click();
  await expect(admin.getByText(/covering for Dev/).filter({ visible: true }).first()).toBeVisible();
});

test('Attendance: sign-in is recorded, people see only their own, corrections need the admin', async ({ browser }) => {
  const admin = await as(browser, ADMIN);
  const devId = await memberIdFromTeam(admin, 'Dev');
  const shrutiId = await memberIdFromTeam(admin, 'Shruti');

  const shruti = await as(browser, PEOPLE.Shruti);
  await shruti.goto('/attendance');
  await expect(shruti.getByRole('heading', { name: 'My attendance' })).toBeVisible();
  await expect(shruti.getByText('Currently Working').first()).toBeVisible();
  await expect(shruti.getByText(/No keystrokes, screenshots, webcam/i).first()).toBeVisible();
  // someone else's attendance is refused, in the page and in the export
  const other = await shruti.request.get(`/attendance/export?member=${devId}`);
  expect(other.status()).toBe(403);
  const own = await shruti.request.get('/attendance/export');
  expect(own.status()).toBe(200);
  expect((await own.text()).split(/\r?\n/)[0]).toBe(
    'Employee,Date,Scheduled Start,Actual Login,Login Status,Minutes Late,Scheduled End,Actual Logout,Logout Status,Minutes Early,Overtime Minutes,Hours Worked,Sessions,Incomplete Sessions,Corrected,Open Flags,Break Minutes,Exempt,Team',
  );
  await expect(shruti.getByRole('link', { name: 'Schedules' })).toHaveCount(0);
  await shruti.goto('/attendance/schedules');
  await expect(shruti).toHaveURL(/error=admins-only/);

  // a correction request for yesterday
  await shruti.goto('/attendance');
  await shruti.getByLabel('Date', { exact: true }).fill(isoIn(-1));
  await shruti.getByLabel('Correct login time').fill('10:00');
  await shruti.getByLabel('Correct logout time').fill('19:00');
  await shruti.getByLabel('Reason').fill('Worked from the warehouse without the app');
  await shruti.getByRole('button', { name: 'Request correction' }).click();
  await expect(shruti.locator('[role=status]').first()).toBeVisible();
  await shruti.screenshot({ path: `${SHOTS}/12-my-attendance.png`, fullPage: true });

  // the admin sees everyone, approves the request, and changes a schedule from today
  await admin.goto('/attendance');
  await expect(admin.getByRole('heading', { name: 'Attendance', exact: true })).toBeVisible();
  for (const h of ['Employee', 'Scheduled Start', 'Actual Login', 'Login Status', 'Scheduled End', 'Actual Logout', 'Logout Status', 'Hours Worked']) {
    await expect(admin.getByRole('columnheader', { name: h, exact: true })).toBeVisible();
  }
  await expect(admin.locator('a > .card', { hasText: 'Currently working' })).not.toContainText(/^Currently working\s*0/);
  await expect(admin.getByText('Worked from the warehouse without the app')).toBeVisible();
  await admin.getByRole('button', { name: 'Approve' }).first().click();
  await admin.getByRole('dialog').getByRole('button', { name: /Approve/ }).click();
  await expect(admin.getByText('Correction requests (0 pending)')).toBeVisible({ timeout: 10_000 });
  await admin.screenshot({ path: `${SHOTS}/13-attendance-admin.png`, fullPage: true });
  const csv = await admin.request.get(`/attendance/export?from=${isoIn(-1)}&to=${isoIn(0)}`);
  expect(csv.status()).toBe(200);
  expect(csv.headers()['content-type']).toContain('text/csv');
  expect(await csv.text()).toContain('Shruti');

  await admin.goto(`/attendance?from=${isoIn(-1)}&member=${shrutiId}`);
  await expect(admin.getByText('Corrected').filter({ visible: true }).first()).toBeVisible();

  await admin.goto('/attendance/schedules');
  await expect(admin.getByText(/Days before that keep the schedule they had/)).toBeVisible();
  await admin.getByLabel('Employee').selectOption({ label: 'Dev' });
  await admin.getByLabel('Start time').fill('09:00');
  await admin.getByLabel('End time').fill('18:00');
  await admin.getByRole('button', { name: 'Save schedule' }).click();
  await expect(admin.getByText(/Schedule saved\. It applies from the chosen date/)).toBeVisible();
  await admin.screenshot({ path: `${SHOTS}/14-schedules.png`, fullPage: true });

  // signing out records the logout
  await shruti.getByRole('button', { name: 'Sign out' }).click();
  await shruti.waitForURL(/\/login/);
  await admin.goto(`/attendance?member=${shrutiId}`);
  await expect(admin.getByText(/Left Early|Logged Out|Overtime/).filter({ visible: true }).first()).toBeVisible();
});

test('manager dashboard reflects the changes', async ({ browser }) => {
  const page = await as(browser, ADMIN);
  await page.goto('/manager');
  const card = (label: string) => page.locator('a > .card', { hasText: label }).first();
  await expect(card('Open tasks')).toContainText('2');
  await expect(card('Blocked')).toContainText('1');
  await expect(card('Unassigned backlog')).toContainText('0');
  await expect(card('Routine completion rate')).toContainText('%');
  await expect(card('Capacity utilization')).toContainText('%');
  await page.screenshot({ path: `${SHOTS}/06-manager-dashboard.png`, fullPage: true });
  await card('Blocked').click();
  await expect(page.getByRole('row', { name: /Update Myntra listing photos/ })).toBeVisible();
  await page.goto('/manager');
  await page.getByLabel('Employee').selectOption({ label: 'Shruti' });
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByText('Shruti: open and recent tasks')).toBeVisible();
  await expect(card('Open tasks')).toContainText('1');
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

test('five wrong PINs lock the account until the admin resets the PIN', async ({ page, browser }) => {
  await page.goto('/login');
  for (let i = 0; i < 5; i++) {
    await page.getByLabel('Username').fill(PEOPLE.Zinia.user);
    await page.getByLabel('PIN').fill('999');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.locator('form [role=alert]')).toBeVisible();
  }
  await expect(page.locator('form [role=alert]')).toContainText('locked after too many wrong PINs');
  await page.getByLabel('Username').fill(PEOPLE.Zinia.user);
  await page.getByLabel('PIN').fill(PEOPLE.Zinia.pin);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('form [role=alert]')).toContainText('locked after too many wrong PINs');

  const admin = await as(browser, ADMIN);
  await admin.goto('/team');
  await admin.getByRole('link', { name: 'Zinia', exact: true }).click();
  await expect(admin.getByText('Locked after 5 wrong PINs')).toBeVisible();
  await admin.screenshot({ path: `${SHOTS}/10-locked-member.png`, fullPage: true });
  await admin.getByLabel('New PIN').fill(PEOPLE.Zinia.pin);
  await admin.getByRole('button', { name: 'Reset PIN' }).click();
  await expect(admin.getByText('PIN reset and lockout cleared.')).toBeVisible();
  await signIn(page, PEOPLE.Zinia);
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

test('Attendance phase 2: teams and default hours, breaks, the exception queue and exemptions', async ({ browser }) => {
  const admin = await as(browser, ADMIN);

  // Teams and default hours (weekly offs are the unticked days)
  await admin.goto('/settings');
  await expect(admin.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await admin.getByLabel('New team').fill('Warehouse');
  await admin.getByRole('button', { name: 'Add team' }).click();
  await expect(admin.getByText('Team added.')).toBeVisible();
  await admin.getByLabel('Start time').fill('09:30');
  await admin.getByRole('button', { name: 'Save default hours' }).click();
  await expect(admin.getByText(/Default hours saved/)).toBeVisible();
  await admin.locator('#mt-member').selectOption({ label: 'Zinia' });
  await admin.locator('#mt-team').selectOption({ label: 'Warehouse' });
  await admin.getByRole('button', { name: 'Save team' }).click();
  await expect(admin.getByText(/Team saved\. It applies from the chosen date/)).toBeVisible();
  // Zinia follows the defaults from today: Warehouse has none, so she gets the company's 09:30 start
  await admin.goto('/attendance/schedules');
  await admin.locator('#f-member').selectOption({ label: 'Zinia' });
  await admin.getByRole('button', { name: 'Follow defaults' }).click();
  await expect(admin.getByText(/this person follows the team or company default hours/)).toBeVisible();
  await admin.goto('/settings');
  const ziniaRow = admin.getByRole('row', { name: /Zinia/ });
  await expect(ziniaRow.getByText('Warehouse')).toBeVisible();
  await expect(ziniaRow.getByText('Company default')).toBeVisible();
  await expect(ziniaRow.getByText(/09:30–19:00/)).toBeVisible();
  await admin.screenshot({ path: `${SHOTS}/15-settings.png`, fullPage: true });

  // Breaks from My Dashboard
  const zinia = await as(browser, PEOPLE.Zinia);
  await zinia.getByRole('button', { name: 'Start break' }).click();
  await expect(zinia.getByRole('button', { name: 'End break' })).toBeVisible({ timeout: 10_000 });
  await expect(zinia.getByText(/On a break since/)).toBeVisible();
  await zinia.screenshot({ path: `${SHOTS}/16-break-running.png`, fullPage: true });
  await zinia.getByRole('button', { name: 'End break' }).click();
  await expect(zinia.getByRole('button', { name: 'Start break' })).toBeVisible({ timeout: 10_000 });
  await expect(zinia.getByText(/Breaks today: /)).toBeVisible();

  // Two late logins yesterday to decide (inserted directly: real ones depend on the time of day)
  const pg = (await import('pg')).default;
  const db = new pg.Client({ connectionString: process.env.TEST_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' });
  await db.connect();
  await db.query(
    `insert into public.attendance_flags (member_id, work_date, flag_type, minutes, reason)
     select id, private.today() - 1, 'Late Login', 25, 'Signed in 25 min after the scheduled start of 10:00 (grace period 10 min).'
     from public.members where name in ('Dev', 'Shruti')
     on conflict do nothing`,
  );
  await db.end();
  await admin.goto(`/attendance/exceptions?type=Late+Login&from=${isoIn(-1)}&to=${isoIn(-1)}`);
  await expect(admin.getByRole('heading', { name: 'Attendance exceptions' })).toBeVisible();
  await admin.getByLabel(/Select all open/).check();
  await admin.getByLabel('Note (optional, saved with the decision)').fill('Road closure confirmed');
  await admin.screenshot({ path: `${SHOTS}/17-exception-queue.png`, fullPage: true });
  await admin.getByRole('button', { name: /^Approve \d+$/ }).click();
  await expect(admin.getByText(/^2 exceptions approved\./)).toBeVisible({ timeout: 10_000 });
  await admin.goto(`/attendance/exceptions?type=Late+Login&status=Approved&from=${isoIn(-1)}&to=${isoIn(-1)}`);
  await expect(admin.getByText('Approved by Kartik').first()).toBeVisible();
  await admin.getByText(/History \(1\)/).first().click();
  await expect(admin.getByText(/Approved by Kartik · “Road closure confirmed”/).first()).toBeVisible();

  // Exemptions
  await admin.goto('/attendance/exemptions');
  await admin.getByLabel('Employee').selectOption({ label: 'Shruti' });
  await admin.getByLabel('Reason').fill('Field visits, flexible hours agreed');
  await admin.getByRole('button', { name: 'Add exemption' }).click();
  await expect(admin.getByText(/Permanent exemption added/)).toBeVisible();
  await admin.reload();
  await expect(admin.getByText('Field visits, flexible hours agreed')).toBeVisible();
  await admin.screenshot({ path: `${SHOTS}/18-exemptions.png`, fullPage: true });

  // The attendance sheet shows breaks; employees cannot open the admin pages
  await admin.goto('/attendance');
  await expect(admin.getByRole('columnheader', { name: 'Breaks', exact: true })).toBeVisible();
  await admin.screenshot({ path: `${SHOTS}/19-attendance-admin-breaks.png`, fullPage: true });
  for (const path of ['/settings', '/attendance/exceptions', '/attendance/exemptions']) {
    await zinia.goto(path);
    await expect(zinia).toHaveURL(/error=admins-only/);
  }
});

// The next date (at least `min` days ahead) that falls on an ISO weekday (1 = Monday … 7 = Sunday).
function nextIsoDay(isoDow: number, min = 1) {
  for (let i = min; i < min + 7; i++) {
    const d = isoIn(i);
    const dow = new Date(`${d}T00:00:00Z`).getUTCDay() || 7;
    if (dow === isoDow) return d;
  }
  throw new Error('unreachable');
}

test('Phase 3: company branding, logo, daily quotes and weekly-off swaps', async ({ browser }) => {
  const admin = await as(browser, ADMIN);

  // Branding: unreadable colours are refused, readable ones change the whole app
  await admin.goto('/settings/company');
  await expect(admin.getByRole('link', { name: 'Company & branding' })).toHaveAttribute('aria-current', 'page');
  await admin.getByLabel('Company name').fill('Femoraah');
  await admin.getByLabel('Tagline (optional)').fill('Ops command center');
  await admin.getByLabel('Primary colour', { exact: true }).fill('#fde68a');
  await expect(admin.getByText(/White text on buttons, and links on white: 1\.\d:1/)).toBeVisible();
  await admin.getByRole('button', { name: 'Save company settings' }).click();
  await expect(admin.getByText(/^Hard to read: white text on buttons/)).toBeVisible();
  await admin.getByLabel('Primary colour', { exact: true }).fill('#7c2d12');
  await admin.getByLabel('Secondary colour', { exact: true }).fill('#14532d');
  await admin.getByLabel('Accent colour', { exact: true }).fill('#b45309');
  await admin.getByRole('button', { name: 'Save company settings' }).click();
  await expect(admin.getByText(/Company settings saved/)).toBeVisible();
  await admin.getByLabel('Upload a logo').setInputFiles('tests/e2e/fixtures/logo.png');
  await admin.getByRole('button', { name: 'Save logo' }).click();
  await expect(admin.getByText('Logo saved.')).toBeVisible();
  await admin.reload();
  await expect(admin.locator('aside').getByText('Femoraah')).toBeVisible();
  await expect(admin.locator('aside img')).toBeVisible();
  const menuColour = await admin.locator('aside').evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(menuColour).toBe('rgb(20, 83, 45)');
  await expect(admin).toHaveTitle(/Femoraah/);
  await admin.screenshot({ path: `${SHOTS}/20-company-branding.png`, fullPage: true });

  // The sign-in page shows the brand before anyone signs in
  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto('/login');
  await expect(visitor.getByText('Femoraah', { exact: true })).toBeVisible();
  await expect(visitor.getByText('Ops command center')).toBeVisible();
  const logo = await visitor.request.get('/brand/logo');
  expect(logo.status()).toBe(200);
  expect(logo.headers()['content-type']).toBe('image/png');
  expect(logo.headers()['x-content-type-options']).toBe('nosniff');
  await visitor.screenshot({ path: `${SHOTS}/21-login-branded.png` });

  // Quotes: add, archive, restore, reorder; everyone sees the same quote today
  await admin.goto('/settings/quotes');
  await expect(admin.getByText('In rotation (20)')).toBeVisible();
  await admin.getByLabel('Quote', { exact: true }).fill('Ship small, ship daily.');
  await admin.getByLabel('Author (optional)').fill('OpsPulse team');
  await admin.getByRole('button', { name: 'Add quote' }).click();
  await expect(admin.getByText('Quote added at the end of the list.')).toBeVisible();
  await admin.reload();
  const added = admin.getByRole('listitem').filter({ hasText: 'Ship small, ship daily.' });
  await added.getByRole('button', { name: 'Archive' }).click();
  await expect(admin.getByText('Archived (1)')).toBeVisible();
  await admin.getByRole('listitem').filter({ hasText: 'Ship small, ship daily.' }).getByRole('button', { name: 'Restore' }).click();
  await expect(admin.getByText('In rotation (21)')).toBeVisible();
  const first = admin.getByRole('listitem').first();
  await expect(first).toContainText('Well done is better than well said.');
  await first.getByRole('button', { name: 'Move down' }).click();
  await expect(admin.getByRole('listitem').nth(1)).toContainText('Well done is better than well said.');

  const zinia = await as(browser, PEOPLE.Zinia);
  const dev = await as(browser, PEOPLE.Dev);
  const ziniaQuote = await zinia.locator('figure blockquote').textContent();
  expect(ziniaQuote?.length).toBeGreaterThan(5);
  await expect(dev.locator('figure blockquote')).toHaveText(ziniaQuote!);
  await admin.goto('/settings/quotes');
  await expect(admin.getByText("Today's quote")).toBeVisible();
  await admin.screenshot({ path: `${SHOTS}/22-quotes.png`, fullPage: true });
  await zinia.screenshot({ path: `${SHOTS}/23-dashboard-quote.png` });
  for (const path of ['/settings/company', '/settings/quotes']) {
    await zinia.goto(path);
    await expect(zinia).toHaveURL(/error=admins-only/);
  }

  // Weekly-off swap: Zinia works a Sunday (her weekly off) and takes the Wednesday after it off
  const sunday = nextIsoDay(7, 1);
  const wednesday = nextIsoDay(3, Math.round((Date.parse(sunday) - Date.parse(isoIn(0))) / 86_400_000) + 1);
  await zinia.goto('/calendar');
  await zinia.getByLabel('Leave type').selectOption('Holiday Swap');
  await zinia.getByLabel('First day').fill(wednesday);
  await zinia.getByLabel('Last day').fill(wednesday);
  await zinia.getByLabel('Day you will work instead').selectOption('weekly');
  // A Monday is a working day, so it cannot be swapped
  await zinia.getByLabel('Weekly off you will work').fill(nextIsoDay(1, 1));
  await zinia.getByRole('button', { name: 'Add leave' }).click();
  await expect(zinia.getByText(/is not a company holiday or a weekly off for this person/)).toBeVisible();
  await zinia.getByLabel('Weekly off you will work').fill(sunday);
  await zinia.getByRole('button', { name: 'Add leave' }).click();
  await expect(zinia.getByText(/Leave added: Holiday Swap/)).toBeVisible();
  await zinia.screenshot({ path: `${SHOTS}/24-weekly-off-swap.png`, fullPage: true });
});

test('Phase 4: Admin role with admin areas, and the Google Sheets workspace', async ({ browser }) => {
  const admin = await as(browser, ADMIN);
  const shruti = await as(browser, PEOPLE.Shruti);

  // Shruti becomes an Admin with no admin areas: no Settings, no attendance admin, cannot add sheets
  await admin.goto('/team');
  await admin.getByRole('link', { name: 'Shruti', exact: true }).click();
  await admin.getByLabel('Access level').selectOption('manager');
  await admin.getByRole('button', { name: 'Save profile' }).click();
  await expect(admin.getByText('Saved.')).toBeVisible();
  await expect(admin.getByRole('heading', { name: 'Admin areas' })).toBeVisible();
  await shruti.goto('/');
  await expect(shruti.locator('aside').getByText('Admin · Account')).toBeVisible();
  await expect(shruti.locator('aside').getByRole('link', { name: 'Settings' })).toHaveCount(0);
  await shruti.goto('/settings');
  await expect(shruti).toHaveURL(/error=admins-only/);
  await shruti.goto('/attendance/exceptions');
  await expect(shruti).toHaveURL(/error=admins-only/);
  await shruti.goto('/sheets');
  await expect(shruti.getByText('No sheets yet')).toBeVisible();
  // Anyone can add a sheet, but without the Sheets area she cannot choose who is responsible
  await shruti.goto('/sheets/new');
  await expect(shruti.getByLabel('Responsible person', { exact: true })).toHaveValue('You (Shruti)');

  // The Super Admin gives her the Google Sheets area only
  await admin.getByLabel(/^Google Sheets/).check();
  await admin.getByRole('button', { name: 'Save admin areas' }).click();
  await expect(admin.getByText('Admin areas saved.')).toBeVisible();
  await admin.screenshot({ path: `${SHOTS}/25-admin-areas.png`, fullPage: true });

  // Shruti adds a sheet; a link that is not a Google Sheet is refused
  await shruti.goto('/sheets');
  await shruti.getByRole('link', { name: 'Add a sheet' }).first().click();
  await expect(shruti).toHaveURL(/\/sheets\/new$/);
  await shruti.getByLabel('Sheet name').fill('Daily sales tracker');
  await shruti.getByLabel('Category').fill('Sales');
  await shruti.getByLabel('Google Sheets link').fill('https://docs.google.com/spreadsheets/d/short');
  await shruti.getByLabel('Purpose').fill('Orders and revenue by channel, updated every evening.');
  await shruti.getByLabel('Responsible person', { exact: true }).selectOption({ label: 'Zinia' });
  await shruti.getByRole('group', { name: 'Working on it' }).getByLabel('Dev').check();
  await shruti.getByRole('button', { name: 'Add sheet' }).click();
  await expect(shruti.getByText(/Paste the full Google Sheets link/)).toBeVisible();
  await shruti.getByLabel('Google Sheets link').fill('https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit#gid=0');
  await shruti.getByRole('button', { name: 'Add sheet' }).click();
  await expect(shruti.getByText('Added Daily sales tracker.')).toBeVisible();
  // The same link cannot be added twice
  await shruti.getByRole('link', { name: 'Add another sheet' }).click();
  await shruti.getByLabel('Sheet name').fill('Sales copy');
  await shruti.getByLabel('Google Sheets link').fill('https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit');
  await shruti.getByRole('button', { name: 'Add sheet' }).click();
  await expect(shruti.getByText('This sheet link is already in the workspace')).toBeVisible();

  // The Super Admin adds a sheet only the people on it can see
  await admin.goto('/sheets/new');
  await admin.getByLabel('Sheet name').fill('Payroll inputs');
  await admin.getByLabel('Category').fill('Finance');
  await admin.getByLabel('Google Sheets link').fill('https://docs.google.com/spreadsheets/d/1ZyXwVuTsRqPoNmLkJiHgFeDcBa9876543210/edit');
  await admin.getByLabel('Responsible person', { exact: true }).selectOption({ label: 'Shruti' });
  await admin.getByLabel(/^Only the responsible person/).check();
  await admin.getByRole('button', { name: 'Add sheet' }).click();
  await expect(admin.getByText('Added Payroll inputs.')).toBeVisible();
  await admin.reload();
  const table = admin.locator('table');
  await expect(table.getByRole('row')).toHaveCount(3);
  await expect(table.getByRole('row', { name: /Daily sales tracker/ })).toContainText('Zinia');
  await expect(table.getByRole('row', { name: /Daily sales tracker/ })).toContainText('Dev');
  const open = table.getByRole('row', { name: /Daily sales tracker/ }).getByRole('link', { name: /Open sheet/ });
  await expect(open).toHaveAttribute('target', '_blank');
  await expect(open).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(open).toHaveAttribute('href', 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit#gid=0');
  await admin.screenshot({ path: `${SHOTS}/26-sheets.png`, fullPage: true });

  // Search, filter and sort
  await admin.goto('/sheets?q=payroll');
  await expect(admin.locator('table').getByRole('row')).toHaveCount(2);
  await admin.goto('/sheets?category=Sales');
  await expect(admin.locator('table').getByRole('row', { name: /Daily sales tracker/ })).toBeVisible();
  await expect(admin.locator('table').getByRole('row', { name: /Payroll inputs/ })).toHaveCount(0);
  await admin.goto('/sheets?sort=owner');
  await expect(admin.locator('table tbody tr').first()).toContainText('Payroll inputs');

  // Zinia (an Employee) sees the shared sheet but not the restricted one, and can edit the one she is responsible for
  const zinia = await as(browser, PEOPLE.Zinia);
  await zinia.goto('/sheets');
  await expect(zinia.locator('table').getByRole('row', { name: /Daily sales tracker/ })).toBeVisible();
  await expect(zinia.getByText('Payroll inputs')).toHaveCount(0);
  await zinia.locator('table').getByRole('link', { name: 'Daily sales tracker' }).click();
  await expect(zinia.getByRole('heading', { name: 'Daily sales tracker' })).toBeVisible();
  await expect(zinia.getByLabel('Responsible person', { exact: true })).toHaveValue('Zinia');
  await expect(zinia.getByLabel('Responsible person', { exact: true })).not.toBeEditable();
  await zinia.getByLabel('Purpose').fill('Orders and revenue by channel. Zinia updates it by 7 pm.');
  await zinia.getByRole('button', { name: 'Save sheet' }).click();
  await expect(zinia.getByText('Saved.')).toBeVisible();
  await expect(zinia.getByRole('button', { name: 'Remove from workspace' })).toHaveCount(0);
  await zinia.screenshot({ path: `${SHOTS}/27-sheet-owner-edit.png`, fullPage: true });

  // Dev works on it but is not responsible: he can read it but not change it
  const dev = await as(browser, PEOPLE.Dev, true);
  await dev.goto('/sheets');
  await expect(dev.locator('main ul').getByText('Daily sales tracker', { exact: true })).toBeVisible();
  await expect(dev.getByRole('link', { name: 'Daily sales tracker' })).toHaveCount(0);
  await dev.screenshot({ path: `${SHOTS}/28-sheets-mobile.png`, fullPage: true });
  const sheetUrl = zinia.url();
  await dev.goto(sheetUrl);
  await expect(dev.getByText('Zinia updates it by 7 pm.')).toBeVisible();
  await expect(dev.getByRole('button', { name: 'Save sheet' })).toHaveCount(0);

  // Remove and restore keep the entry and its history
  await admin.goto('/sheets');
  await admin.locator('table').getByRole('link', { name: 'Payroll inputs' }).click();
  await admin.getByRole('button', { name: 'Remove from workspace' }).click();
  await admin.getByRole('dialog').getByRole('button', { name: 'Remove' }).click();
  await expect(admin.getByText(/Removed from the workspace on/)).toBeVisible();
  await admin.goto('/sheets?removed=1');
  await admin.locator('table').getByRole('link', { name: 'Payroll inputs' }).click();
  await admin.getByRole('button', { name: 'Restore sheet' }).click();
  await admin.getByRole('dialog').getByRole('button', { name: 'Restore' }).click();
  await expect(admin.getByRole('button', { name: 'Remove from workspace' })).toBeVisible();
  await expect(admin.getByText(/Restored by Kartik/)).toBeVisible();
  await expect(admin.getByText(/Removed from the workspace by Kartik/)).toBeVisible();
  await expect(admin.getByText(/Added by Kartik/)).toBeVisible();

  // An Employee adds a sheet too: she becomes responsible for it and chooses who can see it
  await zinia.goto('/sheets');
  await zinia.getByRole('link', { name: 'Add a sheet' }).first().click();
  await expect(zinia).toHaveURL(/\/sheets\/new$/);
  await expect(zinia.getByLabel('Responsible person', { exact: true })).toHaveValue('You (Zinia)');
  await expect(zinia.getByLabel('Responsible person', { exact: true })).not.toBeEditable();
  await zinia.getByLabel('Sheet name').fill('Returns log');
  await zinia.getByLabel('Google Sheets link').fill('https://docs.google.com/spreadsheets/d/1ReturnsLogReturnsLogReturnsLog12345/edit');
  await zinia.getByLabel(/^Only the responsible person/).check();
  await zinia.getByRole('button', { name: 'Add sheet' }).click();
  await expect(zinia.getByText('Added Returns log.')).toBeVisible();
  await zinia.screenshot({ path: `${SHOTS}/37-employee-adds-sheet.png`, fullPage: true });
  await dev.goto('/sheets');
  await expect(dev.getByText('Returns log')).toHaveCount(0);
  await admin.goto('/sheets');
  await expect(admin.locator('table').getByRole('row', { name: /Returns log/ })).toContainText('Zinia');
});

test('Phase 4b: shared logins with PIN-checked show and copy, access managers and history', async ({ browser }) => {
  test.setTimeout(180_000);
  const admin = await as(browser, ADMIN);
  const shruti = await as(browser, PEOPLE.Shruti);

  // Shruti is an Admin without the Credentials area: she cannot add logins and sees none
  await shruti.goto('/credentials');
  await expect(shruti.getByText('No logins shared with you')).toBeVisible();
  await shruti.goto('/credentials/new');
  await expect(shruti).toHaveURL(/error=admins-only/);

  // The Super Admin saves a login. The password never appears in the page.
  await admin.goto('/credentials');
  await admin.getByRole('link', { name: 'Add a login' }).first().click();
  await expect(admin).toHaveURL(/\/credentials\/new$/);
  await admin.getByLabel('Name', { exact: true }).fill('Amazon Seller Central');
  await admin.getByLabel('Category').fill('Marketplaces');
  await admin.getByLabel('Website').fill('https://sellercentral.amazon.in/');
  await admin.getByLabel('Username or email').fill('ops@femoraah.example');
  await admin.getByLabel('Password', { exact: true }).fill('S3cret-Pass!42');
  await admin.getByLabel(/^Notes/).fill('One-time codes go to the ops phone.');
  await admin.getByRole('button', { name: 'Save login' }).click();
  await expect(admin.getByText(/Login saved and encrypted/)).toBeVisible();
  await expect(admin.getByRole('heading', { name: 'Amazon Seller Central' })).toBeVisible();
  expect(await admin.content()).not.toContain('S3cret-Pass!42');
  const credUrl = admin.url().replace(/\?.*$/, '');

  // Shared with the Warehouse team (Zinia is in it) to use, and with Shruti as access manager
  await admin.getByLabel('Share with').selectOption({ label: 'Warehouse team' });
  await admin.getByRole('button', { name: 'Share', exact: true }).click();
  await expect(admin.getByText('Everyone in the team can show and copy')).toBeVisible();
  await admin.getByLabel('Share with').selectOption({ label: 'Shruti' });
  await admin.getByLabel('Access', { exact: true }).selectOption('manage');
  await admin.getByRole('button', { name: 'Share', exact: true }).click();
  await expect(admin.getByText('Access manager: can show, copy, change and share')).toBeVisible();
  await admin.goto('/credentials');
  await expect(admin.locator('table').getByRole('row', { name: /Amazon Seller Central/ })).toContainText('1 person, 1 team');
  await admin.screenshot({ path: `${SHOTS}/29-credentials.png`, fullPage: true });

  // Zinia can use it through her team: a wrong PIN is refused and counted, the right one shows it
  const zctx = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const zinia = await zctx.newPage();
  await signIn(zinia, PEOPLE.Zinia);
  await zinia.goto('/credentials');
  await expect(zinia.locator('table').getByRole('row', { name: /Amazon Seller Central/ })).toContainText('Can use');
  await zinia.locator('table').getByRole('link', { name: 'Amazon Seller Central' }).click();
  await expect(zinia.getByRole('heading', { name: 'Amazon Seller Central' })).toBeVisible();
  await expect(zinia.getByRole('heading', { name: 'Who can use it' })).toHaveCount(0);
  await expect(zinia.getByRole('heading', { name: 'History' })).toHaveCount(0);
  await expect(zinia.getByRole('button', { name: 'Save new password' })).toHaveCount(0);
  await zinia.getByRole('button', { name: 'Show password' }).click();
  const zdlg = zinia.getByRole('dialog');
  await zdlg.getByLabel('Your PIN').fill('999');
  await zdlg.getByRole('button', { name: 'Show', exact: true }).click();
  await expect(zdlg.getByRole('alert')).toContainText('Wrong PIN. 4 tries left');
  await zdlg.getByLabel('Your PIN').fill(PEOPLE.Zinia.pin);
  await zdlg.getByRole('button', { name: 'Show', exact: true }).click();
  await expect(zdlg.getByTestId('revealed-password')).toHaveText('S3cret-Pass!42');
  await expect(zdlg.getByText('One-time codes go to the ops phone.')).toBeVisible();
  await expect(zdlg.getByRole('button', { name: 'Edit notes' })).toHaveCount(0);
  await zinia.screenshot({ path: `${SHOTS}/30-credential-shown.png` });
  await zdlg.getByRole('button', { name: 'Hide' }).click();
  await expect(zinia.getByTestId('revealed-password')).toHaveCount(0);
  await zinia.getByRole('button', { name: 'Copy password' }).click();
  await zdlg.getByLabel('Your PIN').fill(PEOPLE.Zinia.pin);
  await zdlg.getByRole('button', { name: 'Copy', exact: true }).click();
  await expect(zinia.getByText('Password copied. The clipboard is cleared in 30 seconds.')).toBeVisible();
  expect(await zinia.evaluate(() => navigator.clipboard.readText())).toBe('S3cret-Pass!42');

  // Dev has no access, even with the link
  const dev = await as(browser, PEOPLE.Dev);
  await dev.goto('/credentials');
  await expect(dev.getByText('No logins shared with you')).toBeVisible();
  await dev.goto(credUrl);
  await expect(dev.getByRole('heading', { name: 'Not found' })).toBeVisible();

  // Shruti, as access manager, saves a new password and shares it with Dev, but cannot make managers
  await shruti.goto('/credentials');
  await expect(shruti.locator('table').getByRole('row', { name: /Amazon Seller Central/ })).toContainText('Access manager');
  await shruti.goto(credUrl);
  await expect(shruti.getByLabel('Access', { exact: true })).toHaveCount(0);
  await shruti.getByLabel('New password').fill('N3w-Pass!77');
  await shruti.locator('#change-pin').fill(PEOPLE.Shruti.pin);
  await shruti.getByRole('button', { name: 'Save new password' }).click();
  await expect(shruti.getByText(/Password saved\. This changes only the copy kept here/)).toBeVisible();
  await shruti.getByLabel('Share with').selectOption({ label: 'Dev' });
  await shruti.getByRole('button', { name: 'Share', exact: true }).click();
  await expect(shruti.getByText('Access saved.')).toBeVisible();
  await dev.goto(credUrl);
  await expect(dev.getByRole('heading', { name: 'Amazon Seller Central' })).toBeVisible();

  // Deactivating Dev removes his access for good; reactivating him does not bring it back
  await admin.goto('/team');
  await admin.getByRole('link', { name: 'Dev', exact: true }).click();
  await admin.getByRole('button', { name: 'Deactivate member' }).click();
  await admin.getByRole('dialog').getByRole('button', { name: 'Deactivate' }).click();
  await expect(admin.getByRole('button', { name: 'Reactivate member' })).toBeVisible();
  await admin.getByRole('button', { name: 'Reactivate member' }).click();
  await admin.getByRole('dialog').getByRole('button', { name: 'Reactivate' }).click();
  await expect(admin.getByRole('button', { name: 'Deactivate member' })).toBeVisible();
  const devAgain = await as(browser, PEOPLE.Dev);
  await devAgain.goto(credUrl);
  await expect(devAgain.getByRole('heading', { name: 'Not found' })).toBeVisible();

  // The Super Admin sees the new password, edits the notes, and reads the full history
  await admin.goto(credUrl);
  await expect(admin.getByText(/by Shruti/).first()).toBeVisible();
  await admin.getByRole('button', { name: 'Show password' }).click();
  const adlg = admin.getByRole('dialog');
  await adlg.getByLabel('Your PIN').fill(ADMIN.pin);
  await adlg.getByRole('button', { name: 'Show', exact: true }).click();
  await expect(adlg.getByTestId('revealed-password')).toHaveText('N3w-Pass!77');
  await adlg.getByRole('button', { name: 'Edit notes' }).click();
  await adlg.getByLabel('Notes').fill('One-time codes go to the ops phone. Ask Shruti.');
  await adlg.getByRole('button', { name: 'Save notes' }).click();
  await expect(adlg.getByText('Notes saved.')).toBeVisible();
  await expect(adlg.getByText('One-time codes go to the ops phone. Ask Shruti.')).toBeVisible();
  await adlg.getByRole('button', { name: 'Hide' }).click();
  await admin.reload();
  const history = admin.locator('section').filter({ has: admin.getByRole('heading', { name: 'History' }) });
  for (const line of [
    'Added by Kartik',
    'Shared with the Warehouse team (can use) by Kartik',
    'Shared with Shruti (access manager) by Kartik',
    'Refused: wrong PIN (tried to show) by Zinia',
    'Password shown by Zinia',
    'Password copied by Zinia',
    'Password changed by Shruti',
    'Shared with Dev (can use) by Shruti',
    'Access removed for Dev (account deactivated) by Kartik',
    'Password shown by Kartik',
    'Notes changed by Kartik',
  ]) await expect(history).toContainText(line);
  await admin.screenshot({ path: `${SHOTS}/31-credential-detail.png`, fullPage: true });

  // Removing it from use hides it from everyone but Credentials admins; restoring brings it back
  await admin.getByRole('button', { name: 'Remove from use' }).click();
  await admin.getByRole('dialog').getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(admin.getByText(/Removed from use on/)).toBeVisible();
  await zinia.goto('/credentials');
  await expect(zinia.getByText('No logins shared with you')).toBeVisible();
  await admin.getByRole('button', { name: 'Restore login' }).click();
  await admin.getByRole('dialog').getByRole('button', { name: 'Restore' }).click();
  await expect(admin.getByRole('button', { name: 'Remove from use' })).toBeVisible();

  const zphone = await as(browser, PEOPLE.Zinia, true);
  await zphone.goto('/credentials');
  await expect(zphone.locator('main ul').getByText('Amazon Seller Central', { exact: true })).toBeVisible();
  await zphone.screenshot({ path: `${SHOTS}/32-credentials-mobile.png`, fullPage: true });
});

test('Phase 5: attendance at a glance on the dashboards, with filters, trends and quick actions', async ({ browser }) => {
  const admin = await as(browser, ADMIN);
  await admin.goto('/manager');
  const overview = admin.locator('section[aria-labelledby="att-today"]');
  await expect(overview.getByRole('heading', { name: 'Attendance today' })).toBeVisible();
  const card = (label: string) => overview.locator('a > .card', { hasText: label }).first();
  await expect(card('Present')).toContainText('/');
  await expect(card('Open exceptions')).toBeVisible();

  // Who is in: everyone with hours today, filterable by state and team without a reload
  const board = overview.locator('.card', { has: admin.getByRole('group', { name: 'Show' }) });
  const everyone = await board.locator('ul > li').count();
  expect(everyone).toBeGreaterThan(0);
  await expect(board.getByRole('link', { name: /Kartik/ })).toBeVisible();
  await board.getByRole('button', { name: /^Working · / }).click();
  await expect(board.getByRole('button', { name: /^Working · / })).toHaveAttribute('aria-pressed', 'true');
  await expect(board.getByRole('link', { name: /Kartik/ })).toBeVisible();
  expect(await board.locator('ul > li').count()).toBeLessThanOrEqual(everyone);
  await board.getByRole('button', { name: /^Everyone · / }).click();
  await board.getByRole('group', { name: 'Team' }).getByRole('button', { name: 'Warehouse' }).click();
  await expect(board.getByRole('link', { name: /Zinia/ })).toBeVisible();
  await expect(board.getByRole('link', { name: /Kartik/ })).toHaveCount(0);
  await board.getByRole('group', { name: 'Team' }).getByRole('button', { name: 'All teams' }).click();

  // Two weeks of sign-ins: one described, clickable bar per day, today included
  const trend = overview.getByRole('figure', { name: /Sign-ins per day over the last 14 days/ });
  await expect(trend.getByRole('listitem').filter({ has: admin.locator('a') })).toHaveCount(14);
  const todayBar = trend.getByRole('link', { name: /Today, so far/ });
  await expect(todayBar).toHaveAttribute('href', /\/attendance\?from=\d{4}-\d{2}-\d{2}$/);
  await expect(todayBar).toHaveAttribute('aria-label', /\d+ on time, \d+ late, \d+ not signed in, \d+ on leave, \d+ worked a day off/);
  await expect(overview.getByRole('link', { name: 'Warehouse', exact: true })).toHaveAttribute('href', /\/attendance\?team=/);
  await expect(admin.getByRole('figure', { name: /Tasks added and done per day/ })).toBeVisible();
  await admin.screenshot({ path: `${SHOTS}/34-dashboard-attendance.png`, fullPage: true });

  // Quick action goes straight to the exceptions queue
  await overview.getByRole('navigation', { name: 'Quick actions' }).getByRole('link', { name: /Review exceptions/ }).click();
  await expect(admin.getByRole('heading', { name: 'Attendance exceptions' })).toBeVisible();

  // Shruti is an Admin without the Attendance area: the task dashboard only
  const shruti = await as(browser, PEOPLE.Shruti);
  await shruti.goto('/manager');
  await expect(shruti.getByRole('heading', { name: 'Tasks and routines' })).toBeVisible();
  await expect(shruti.getByRole('heading', { name: 'Attendance today' })).toHaveCount(0);

  // Zinia sees her own two weeks and this week's hours on her dashboard, on a phone
  const zinia = await as(browser, PEOPLE.Zinia, true);
  await expect(zinia.getByText('Last 14 days')).toBeVisible();
  await expect(zinia.getByText('This week')).toBeVisible();
  await expect(zinia.locator('ol a[aria-label]').filter({ hasText: /\d/ })).toHaveCount(14);
  await zinia.screenshot({ path: `${SHOTS}/35-my-dashboard-mobile.png`, fullPage: true });

  const phone = await as(browser, ADMIN, true);
  await phone.goto('/manager');
  await expect(phone.getByRole('heading', { name: 'Attendance today' })).toBeVisible();
  await phone.screenshot({ path: `${SHOTS}/36-dashboard-mobile.png`, fullPage: true });
});
