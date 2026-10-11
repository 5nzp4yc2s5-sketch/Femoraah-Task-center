# Test results (local Supabase stack + production build, 11-Oct-2026)

Environment: Supabase CLI 2.120 local stack (Postgres 17, GoTrue, PostgREST), Next.js 16.4 `next build && next start`, Chromium via Playwright. Not yet run against a hosted deployment.

## Database / API security — `npm run test` → `tests/db/security.test.ts`: **44 / 44 passed**
These call the real Data API with the public key and real user sessions, i.e. exactly what an attacker editing requests could do.

| Requirement | Covered by |
|---|---|
| 1 Members see their authorized tasks | owner sees own tasks; supervisor sees report's tasks |
| 2 No reading others' private tasks | stranger gets 0 rows by id from tasks, task_board, task_updates, task_assignments |
| 3 Creators track tasks they assigned | creator sees assigned task but not assignee's other tasks; still sees it after reassignment |
| 4 Recommendations use expertise + workload | skill match picks Sanket/Zinia/Shruti; at-capacity person skipped; lighter workload wins a tie; fallback owner when nothing matches |
| 5 Only managers approve | member approve RPC rejected; forging approval/suggestion columns rejected |
| 6 Approval creates exactly one task | 3 concurrent approvals → 1 task, same id returned |
| 7 Routine dates | Next Due = Last Done + N; second tick in same cycle refused; overdue cycle recorded; history kept |
| 8 Dashboard counts update | open/overdue/blocked/due-7 change after edits; per-person counts |
| 9 Flags | Done > Overdue > Blocked > Due soon > Stale > On track; Done never overdue; days left |
| 10 Direct API can't bypass RLS | anon reads nothing; password-without-PIN reads nothing; PIN table unreadable; service functions denied |
| 11 No self-promotion | role/insert/PIN-reset/user_id edits by member all rejected; last admin protected |
| 12 Rate limiting | 5 wrong PINs (at sign-in or at the 12-hour re-check) → locked even with the right PIN, until the admin resets it; a correct PIN resets the count; per-IP gate |
| 13 Deactivation | open session loses access immediately; PIN re-verify refused |
| PIN-only sign-in | right PIN returns the login email, wrong PIN / unknown user / deactivated member do not; server-minted session still needs `verify_pin`; one-time token cannot be replayed; service and admin-only PIN functions denied to members |
| Integrity | % must be 0-100, Done forces 100%, inactive owner rejected, Monthly interval constraint |

## Browser end-to-end — `scripts/e2e-local.sh` → `tests/e2e/app.spec.ts`: **12 / 12 passed**
Signed-out redirect; generic wrong-PIN / unknown-user error; admin username+PIN sign-in; admin creates 3 logins in the Team UI; task assignment and creator tracking; owner progress update with required blocker note and no core-edit controls; URL-guessing another's task shows Not found; member blocked from manager dashboard; backlog suggestion; manager override approval and Assigned record; routine tick-off once per cycle; manager dashboard counts; **mobile 390 px** layout with no horizontal scroll; PIN lockout in the UI and admin unlock from the Team page; deactivation cuts off an open session.

## Not yet verified
- 15 "production deployment works with real persistence": blocked on Kartik's Supabase/Vercel accounts (see DEPLOY.md §7 checklist).
- Supabase Auth's own per-IP sign-in limit (hosted default) was not exercised locally.
