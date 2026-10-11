# OpsPulse Workspace

A private team task command center that replaces the OpsPulse Google Sheet: Task Board, Pending Backlog with rule-based assignee suggestions and manager approval, Routine Tasks with backups, Team with capacity, Team Calendar (holidays and leave), Attendance (sign-in and sign-out times), individual dashboards and a manager Dashboard.

**Stack:** Next.js 16 (App Router, server actions) · React 19 · TypeScript · Tailwind CSS 4 · Supabase Postgres + Auth · Row Level Security · Vercel (or Cloudflare Workers).

## Docs
- [docs/SOURCE_ANALYSIS.md](docs/SOURCE_ANALYSIS.md): what the spreadsheet contained, bad rows, and what is new
- [docs/PERMISSIONS.md](docs/PERMISSIONS.md): who can do what, and how it is enforced
- [docs/DEPLOY.md](docs/DEPLOY.md): Supabase, admin login, GitHub, Vercel, adding the team, production checks
- [docs/TEST_RESULTS.md](docs/TEST_RESULTS.md): what was tested and the results

## How it is put together
- `supabase/migrations/`: schema, functions/triggers, RLS + grants, seed data from the spreadsheet, then 006 (status names), 007 (delegation, blockers, history, routine backups, backlog approval, calendar, capacity) and 008 (attendance). `docs/all-migrations.sql` (001-006) and `docs/all-migrations-part2.sql` (007-008) are the same thing for the SQL editor; run them as two separate queries, because new enum values must be committed before they are used.
- `src/proxy.ts`: refreshes the Supabase session cookie and sends signed-out visitors to /login.
- `src/app/(app)/…`: pages. Every read and write uses the signed-in user's session, so RLS applies. The service key is used only server-side for login lockout bookkeeping, username lookup, and creating/disabling auth users after the caller is confirmed as admin.
- Sign-in: username + 3-digit PIN. The server checks the PIN in Postgres (`service_pin_login`), then starts a Supabase Auth session with a one-time magic-link token (no email is sent) and marks it verified (`verify_pin`). Auth users keep a random 32-byte password nobody knows. A session that has not passed the PIN step reads nothing, because every policy goes through `private.me()`. Devices stay signed in and re-check the PIN every 12 hours.

## Local development
```bash
npm install
npx supabase start                 # needs Docker
cp .env.example .env.local         # fill with the values `npx supabase status` prints
npx supabase db reset              # applies migrations + seed team/routines
npm run bootstrap-admin            # creates Kartik's login
npm run dev
```
Tests: `npm test` (database security, needs `.env.test.local` with TEST_SUPABASE_URL / TEST_SUPABASE_ANON_KEY / TEST_SUPABASE_SERVICE_KEY), `npm run build && npm start` then `./scripts/e2e-local.sh` (browser).

## Rules worth knowing
- **Task statuses:** To Do, Active, Blocked, Done. Priorities: Critical, High, Medium, Low. IDs: TSK-001 (tasks), BCK-101 (backlog), RTN-001 (routines).
- **Assigned to / Delegated by:** every task has the person doing it and the person who handed it over. Delegated by defaults to whoever enters the task and can name any active member; the person who actually entered it is kept separately. Nobody sees a teammate's work just because they supervise them.
- **Open task** = any task not Done and not archived; this is what counts toward Max Open Tasks and capacity.
- **Capacity status:** On Leave if on approved leave today; otherwise Available (open < max), At Capacity (open = max) or Overloaded (open > max). Default max is 10 (15 for the founder).
- **Blocked** needs a blocker reason; the time it became blocked is recorded and shown, and leaving Blocked clears both. Done means 100%; 100% marks a task Done; reopening a Done task drops it to 90%.
- **Flag precedence:** Done (green) > Overdue (red) > Blocked (orange) > Due soon ≤3 days (amber) > Stale, no update 3+ days (amber) > Due in 7 days (yellow) > On track. A separate star marks tasks someone flagged as important.
- **Last Update** is set automatically whenever a meaningful field changes. Every change to status, %, notes, assignee, delegator, dates, priority, title, blocker and flag is kept in the task's history.
- **"Today"** for due dates, routines, leave and attendance uses the workspace time zone (`app_settings.timezone`, default Asia/Kolkata). Timestamps display in each viewer's local time zone.
- **Due next 7 days** = due today through today + 7.
- **Assignee suggestion (rule-based, no AI):** score = 0.7 × skill match + 0.3 × spare capacity, where skill match is the share of the comma-separated Skills Needed found in the person's skills (word-stem match), and load = (open + overdue + ½ blocked) ÷ Max Open Tasks. People at capacity or on leave today are not suggested (a manager can still assign them with "Assign anyway"); if nobody matches, the fallback person (Kartik, "anything not covered above") is preferred. The explanation, two alternatives and every candidate's numbers are shown on the backlog item.
- **Backlog flow:** Pending → Approved → Converted to Task (or Dismissed). "Approve and create task" does both steps; converting twice never creates two tasks.
- **Routine cycle:** Daily 1 day, Weekly 7, Monthly 30, Custom N. Next Due = Last Done + interval. Statuses: OK, Due Today, Overdue, Not Logged. While the assignee is on leave, the routine's backup (or the backup named on the leave) can tick it off; the history records "covering for". Ownership never changes.
- **Attendance:** signing in (the PIN step) records a login at database time; signing out records the logout. One open session at a time; a second sign-out never changes the recorded logout. A session left open for 12 hours or past the end of the day becomes an Incomplete Session; no logout time is invented. Statuses and flags compare against each person's schedule (default 10:00-19:00 Mon-Sat, 10-minute grace, until the admin changes it). Schedule changes apply from today onward; past days keep their schedule. Only the admin sees everyone's attendance; everyone else sees only their own. Corrections are requests the admin approves; the original times are kept.

## Known limitations
- **The 3-digit PIN is the only secret (owner's choice, 11-Oct-2026).** It has 1,000 values, so five wrong PINs in a row lock the account until an admin resets the PIN; a stranger who knows a username has a 1 in 200 chance before the lock. Usernames are first names, so treat them as known. The PIN hash would be trivially reversible offline if the database leaked.
- One IP is throttled after 20 failed sign-ins in 15 minutes. Anyone who knows a username can lock that person out by entering wrong PINs; the admin unlocks them from the Team page.
- Deactivation removes data access immediately and bans the auth user; an already-issued access token expires within an hour but can read nothing in the meantime.
- Other people's changes appear on the next refresh (pages refresh every 60 s and when the tab regains focus), not instantly.
- No notifications or file attachments. The spreadsheet's holiday rows were imported to the Team Calendar; one swap date conflicts with the Diwali date and is listed in Data Review.
- Attendance only knows about sign-in and sign-out in this app. Someone who stays signed in on a device from yesterday is not "logged in" today until they sign in again, and closing the browser without signing out leaves an Incomplete Session.
- Supabase Free has no automatic backups and pauses after 7 idle days. Vercel Hobby forbids commercial use (see DEPLOY.md).
