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
  await admin.getByLabel('Date', { exact: true }).fill(isoIn(10));
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
  await expect(admin.getByText(/White text on buttons, headers and links: 1\.\d:1/)).toBeVisible();
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
