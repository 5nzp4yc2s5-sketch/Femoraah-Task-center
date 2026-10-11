# Deploying OpsPulse Workspace (free tier)

Total cost: ₹0 on Supabase Free + Vercel Hobby (or Cloudflare Workers Free). About 20 minutes.
You never paste secrets into chat or commit them to GitHub; they go only into the hosting dashboards.

## Read first: free-tier terms (checked 11-Oct-2026)

- **Vercel Hobby is for non-commercial personal use only.** Vercel's fair-use guidelines say commercial use, which includes a deployment that benefits anyone paid to work on it, needs Pro (US$20/month). An internal tool for a trading business is very likely commercial under that wording. Options: accept the risk on Hobby, pay for Pro, or host on **Cloudflare Workers Free**, which allows commercial use (setup in section 5; that path has **not** been test-deployed yet).
- **Supabase Free**: 500 MB database, 2 free projects, and the project **pauses after 7 days with no activity** (daily team use keeps it awake; a paused project is restored from the dashboard). **No automatic backups on Free**: export regularly (section 6).

## 1. Supabase project

1. Sign in at supabase.com → **New project**. Name `opspulse`, region **Mumbai (ap-south-1)**, generate a strong database password and keep it in your password manager.
2. **SQL Editor → New query**: paste the whole of `docs/all-migrations.sql` and **Run**. (Or, with the Supabase CLI: `npx supabase link --project-ref <ref>` then `npx supabase db push`.) This creates the tables, RLS policies and the seed team/routines from your spreadsheet.
3. **Authentication → Sign In / Providers**:
   - Turn **off** "Allow new users to sign up". (No public signup; only the admin creates logins.)
   - Email provider: turn **off** "Confirm email" is fine (logins are created pre-confirmed).
   - Password requirements: minimum length **10**, "letters and digits".
   - Turn **off** anonymous sign-ins (default off).
4. **Project Settings → API**: note the **Project URL**, the **anon / publishable** key and the **service_role / secret** key. The secret key is a password: only ever paste it into the hosting provider's environment settings.

## 2. Create your admin login (Kartik)

Either option works.

**Option A, no tools needed (dashboard):**
1. **Authentication → Users → Add user → Create new user**: email `kartik@users.opspulse.invalid`, a strong password (10+ chars, letters and digits), tick **Auto Confirm User**.
2. **SQL Editor**, run (pick your own PIN instead of 000):
   ```sql
   select public.service_bootstrap_admin(
     (select id from public.members where name = 'Kartik'),
     (select id from auth.users where email = 'kartik@users.opspulse.invalid'),
     'kartik', '000');
   ```
3. After your first sign-in, change the PIN from **Account** (the SQL history keeps what you typed).

**Option B, from a terminal** (Node 20+): `NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run bootstrap-admin` and answer the prompts.

Both refuse to run once an admin login exists.

## 3. GitHub

Create an **empty private** repository (e.g. `opspulse-workspace`) and push this folder:
```bash
git remote add origin https://github.com/<you>/opspulse-workspace.git
git push -u origin main
```
`.env*` files are git-ignored; only `.env.example` (placeholders) is committed.

## 4. Vercel

1. vercel.com → **Add New → Project** → import the GitHub repo. Framework: Next.js (auto-detected). No build settings to change.
2. **Environment Variables** (Production and Preview):
   - `NEXT_PUBLIC_SUPABASE_URL` = Project URL
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = anon / publishable key
   - `SUPABASE_SERVICE_ROLE_KEY` = service_role / secret key (mark **Sensitive**)
3. **Deploy**. You get `https://<project>.vercel.app` with HTTPS.
4. Back in Supabase → **Authentication → URL Configuration**: set Site URL to that address.

## 5. Alternative: Cloudflare Workers (free, commercial use allowed) — not yet test-deployed

Uses the OpenNext adapter: `npm i -D @opennextjs/cloudflare wrangler`, add a `wrangler.jsonc` and `open-next.config.ts` per https://opennext.js.org/cloudflare, set the same three variables as Worker secrets (`npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY`), then `npx opennextjs-cloudflare build && npx opennextjs-cloudflare deploy`.

## 6. Add the team

Sign in as Kartik → **Team** → click a name → **Login**: choose a username (e.g. `zinia`), a temporary password and a 3-digit PIN → **Create login**. Tell each person their username, password and PIN **in person**, then ask them to change the password and PIN from **Account**. The five people from the spreadsheet are already in the Team table with their roles, expertise and capacities; **Add member** creates new people. Promote someone to manager on their Team page if they should approve backlog items.

Backups on Free: **Database → Backups** is not included, so run `npx supabase db dump --data-only -f backup.sql` (or Table Editor → Export CSV) weekly.

## 7. Verify production (5 minutes)

1. Open the URL signed out → you land on the sign-in page.
2. Sign in as Kartik (password, then PIN) → Dashboard shows 5 people and "12 records need review".
3. Create a login for one teammate; in a private window sign in as them and confirm they see only their own tasks and routines.
4. Create a task for them as Kartik; confirm it appears for them, and that "Tasks I assigned to others" shows it for you.
5. Have them add a backlog item; approve it as Kartik; confirm exactly one task appears.
6. Enter a wrong PIN five times in a private window → the account locks for 15 minutes.
