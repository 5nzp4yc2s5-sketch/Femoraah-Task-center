# Test results (local Supabase stack + production build, 12-Oct-2026)

Environment: Supabase CLI local stack (Postgres 17, GoTrue, PostgREST) with migrations 001-008 applied from scratch, Next.js 16 `next build && next start`, Chromium via Playwright. The DB tests call the real Data API with the public key and real user sessions, i.e. exactly what someone editing requests in the browser could do.

`npm run lint` (TypeScript, no emit): clean. `next build`: succeeds.

## Database / API — `npm run test:db`: **77 / 77 passed**

### Security and permissions — `tests/db/security.test.ts` (44)
| Area | Covered by |
|---|---|
| No access without PIN | anon reads nothing; a password session without the PIN step reads nothing; PIN table unreadable; service functions denied |
| PIN sign-in | right PIN returns the login email; wrong PIN / unknown / deactivated do not; minted session still needs `verify_pin`; sign-out clears verification |
| Lockout | 5 wrong PINs lock the account until the admin resets it; a correct PIN resets the count; per-identifier gate |
| Task visibility | owner, delegator and collaborators see a task; strangers get 0 rows even by id; **no supervisor visibility** (Sanket cannot see Dev's tasks) |
| Task edits | assignee updates progress only; delegator edits core fields; `created_by` is forced; Delegated by must be an active member; reassignment history |
| Backlog | suggestion by expertise, then workload, then fallback; members cannot approve or forge approval fields; concurrent approval makes exactly one task; decided rows frozen |
| Routines | own routines only; once per cycle; overdue recorded; 1/7/30-day intervals; only managers create |
| Roles | no self-promotion; last admin protected; promoted manager can approve, demoted cannot; deactivation cuts off open sessions; audit log manager-only |

### New features — `tests/db/features.test.ts` (20)
TSK-### ids, Critical priority, To Do / Active / Blocked / Done; Blocked needs a reason, records when, clears on resume; 100% ⇔ Done; assignee can flag and set blocker but not change Delegated by; history records status, progress, owner, due date, blocker, flag and delegator changes; Last Update moves only on meaningful updates; leave rules (own future leave for members, anyone for managers); holidays managed by managers only; calendar hides leave type from other members; capacity status Available / At Capacity / Overloaded / On Leave; routine backup covers only while the owner is on leave; leave backup used when the routine has none; RTN ids and OK / Due Today / Overdue / Not Logged; people on leave are not suggested and the explanation says so; approving someone on leave needs an explicit override; Approved → Convert to Task creates exactly one task; Dismissed cannot be approved and Converted cannot be dismissed; dashboard filters recalculate KPIs from real rows; routine completion rate and capacity utilization; members cannot open the manager dashboard.

### Attendance — `tests/db/attendance.test.ts` (13: the 12 acceptance tests + repeated lateness)
| # | Test | Result |
|---|---|---|
| 1 | 09:55 for a 10:00 start → On Time | passed |
| 2 | 10:07 with 10-min grace → Within Grace Period | passed |
| 3 | 10:15 → Late, 15 min, Late Login flag | passed |
| 4 | Logs out at 19:00 → Logged Out | passed |
| 5 | 17:30 → Left Early, 90 min, Early Logout flag | passed |
| 6 | 20:00 → Overtime 60 min | passed |
| 7 | Browser closed → Incomplete Session after expiry, no logout invented | passed |
| 8 | Employee cannot read or change another's sessions, flags, schedules; no direct writes to timestamps | passed |
| 9 | Admin reviews/resolves a flag; employee can explain but not resolve | passed |
| 10 | Schedule change applies from its start date; past days unchanged | passed |
| 11 | Correction request → admin approves → corrected times used, originals kept, audit row written | passed |
| 12 | No login, approved leave, holiday, weekly off and today's rows computed in the database; signing out before the scheduled end of today raises no Early Logout flag until the end has passed | passed |
| + | Three late logins in 30 days → Repeated Late Login flag | passed |

## Browser end-to-end — `scripts/e2e-local.sh` → `tests/e2e/app.spec.ts`: **14 / 14 passed**
1. Signed-out redirect; generic error for wrong PIN or unknown user.
2. Admin signs in with username + PIN and creates logins on the Team page.
3. Admin delegates a Critical, flagged task to Shruti (Delegated by / Assigned to) and tracks it.
4. Shruti blocks the task with a reason in the form, then unblocks and re-blocks from the Task Board status menu (reason dialog).
5. Zinia cannot open Shruti's task by URL and cannot open the manager dashboard.
6. Shruti adds backlog work and sees a rule-based suggestion with its explanation.
7. Manager overrides the suggestion, Approve only, then Convert to task; the row stays as Converted to Task.
8. Dev ticks off a routine once per cycle.
9. Team Calendar: leave with a backup, overlapping leave refused, holiday added, leave type hidden from others, Zinia covers Dev's routine while he is away and the history says "covering for Dev".
10. Attendance: sign-in recorded; members see only their own (export of another person's CSV → 403); CSV header matches the spec; correction request → admin approves → Corrected marker; admin sets a schedule; sign-out recorded.
11. Manager dashboard KPI cards reflect the changes and link to filtered lists.
12. Mobile (390 px) layout with no horizontal scroll.
13. Five wrong PINs lock the account until the admin resets the PIN.
14. Deactivating a member cuts off their open session.

Screens were also reviewed by eye at 1440 px and 390 px for every page (dashboard, Task Board, task detail, backlog, routines, calendar, attendance admin and self view, schedules, team, manager dashboard, help).

## Not covered by automated tests
- Live site: checked after deploy through the Vercel deployment status and Supabase request/auth logs (this container cannot open *.vercel.app directly).
- Supabase Auth's own hosted per-IP sign-in limit.
- There is no background job: sessions left open are marked Incomplete whenever someone signs in or an attendance page loads (verified in the DB tests by calling the same function).
