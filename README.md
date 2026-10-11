# OpsPulse Workspace

A private team task command center that replaces the OpsPulse Google Sheet: Task Board, Pending Backlog with owner suggestions and manager approval, Routine Tasks, Team, individual dashboards and a manager Dashboard.

**Stack:** Next.js 16 (App Router, server actions) · React 19 · TypeScript · Tailwind CSS 4 · Supabase Postgres + Auth · Row Level Security · Vercel (or Cloudflare Workers).

## Docs
- [docs/SOURCE_ANALYSIS.md](docs/SOURCE_ANALYSIS.md): what the spreadsheet contained, bad rows, and what is new
- [docs/PERMISSIONS.md](docs/PERMISSIONS.md): who can do what, and how it is enforced
- [docs/DEPLOY.md](docs/DEPLOY.md): Supabase, admin login, GitHub, Vercel, adding the team, production checks
- [docs/TEST_RESULTS.md](docs/TEST_RESULTS.md): what was tested and the results

## How it is put together
- `supabase/migrations/`: schema, functions/triggers, RLS + grants, seed data from the spreadsheet. `docs/all-migrations.sql` is the same thing in one file for the SQL editor.
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
- **Open task** = any task not Done and not archived; this is what counts toward Max Open Tasks and Has Capacity?.
- **Flag precedence:** Done (green) > Overdue (red) > Blocked (grey) > Due soon ≤3 days (amber) > Stale, no update 3+ days (amber) > On track.
- **Last Update** is set automatically whenever a meaningful field changes.
- **"Today"** for due dates and routines uses the workspace time zone (`app_settings.timezone`, default Asia/Kolkata). Timestamps display in each viewer's local time zone.
- **Due next 7 days** = due today through today + 7.
- **Owner suggestion:** score = 0.7 × skill match + 0.3 × spare capacity, where skill match is the share of the comma-separated Skills Needed found in the person's Expertise (word-stem match), and load = (open + overdue + ½ blocked) ÷ Max Open Tasks. People at capacity are excluded; if nobody matches, the fallback owner (Kartik, "anything not covered above") is preferred. Every candidate's numbers are shown on the backlog item.
- **Routine cycle:** Next Due = Last Done + Every N Days. Ticking again before Next Due is refused as the same cycle.

## Known limitations
- **The 3-digit PIN is the only secret (owner's choice, 11-Oct-2026).** It has 1,000 values, so five wrong PINs in a row lock the account until an admin resets the PIN; a stranger who knows a username has a 1 in 200 chance before the lock. Usernames are first names, so treat them as known. The PIN hash would be trivially reversible offline if the database leaked.
- One IP is throttled after 20 failed sign-ins in 15 minutes. Anyone who knows a username can lock that person out by entering wrong PINs; the admin unlocks them from the Team page.
- Deactivation removes data access immediately and bans the auth user; an already-issued access token expires within an hour but can read nothing in the meantime.
- Other people's changes appear on the next refresh (pages refresh every 60 s and when the tab regains focus), not instantly.
- No notifications, no leave/holiday calendar, no file attachments. The spreadsheet's holiday rows are kept in Data Review.
- Supabase Free has no automatic backups and pauses after 7 idle days. Vercel Hobby forbids commercial use (see DEPLOY.md).
