# Permission matrix

Enforced in PostgreSQL (RLS policies, column grants, guard triggers and SECURITY DEFINER functions), not in the UI. Every policy goes through `private.me()`, which returns nothing unless the account is **active** and the current Supabase session **passed the PIN step**. The public (anon) key alone can read nothing.

Roles: **admin** (Kartik), **manager** (anyone the admin promotes), **member** (everyone else). There is no supervisor visibility: nobody sees a teammate's tasks or routines because they supervise them (the old "Dev reports to Sanket" rule was removed on 12-Oct-2026).

| Action | Member | Entered the task / Delegated by | Assigned to | Collaborator | Manager | Admin |
|---|---|---|---|---|---|---|
| View a task | only if one of the roles to the right | ✓ | ✓ | ✓ | ✓ all | ✓ all |
| Create a task, assign it to any active member and name who delegated it | ✓ | | | | ✓ | ✓ |
| Update Status / % Complete / Progress Note / blocker reason / important flag | | ✓ | ✓ | ✓ | ✓ | ✓ |
| Edit title, description, priority, dates; reassign; change Delegated by | | ✓ | ✗ | ✗ | ✓ | ✓ |
| Add / remove collaborators | | ✓ | | | ✓ | ✓ |
| Archive a task (no hard delete) | | the person who entered it | | | ✓ | ✓ |
| View task history | with the task | ✓ | ✓ | ✓ | ✓ | ✓ |
| Submit to Pending Backlog / view backlog | ✓ | | | | ✓ | ✓ |
| Edit a pending backlog item | requester only | | | | ✓ | ✓ |
| Approve, convert to task, override the suggestion, assign someone on leave, dismiss | ✗ | | | | ✓ | ✓ |
| View routines | own, ones they back up, ones they cover today | | | | ✓ all | ✓ all |
| Tick off a routine | own; the backup while the assignee is on leave | | | | ✓ | ✓ |
| Create / edit routines, set backups, remove a completion | ✗ | | | | ✓ | ✓ |
| Team directory + live counts and capacity (no task details) | ✓ (active people) | | | | ✓ (incl. inactive) | ✓ + usernames |
| Team Calendar: see holidays and who is away | ✓ | | | | ✓ | ✓ |
| See leave type and note | own, or as the named backup | | | | ✓ | ✓ |
| Add / edit / delete leave | own, not starting in the past, until it starts | | | | ✓ anyone's | ✓ |
| Add / edit / delete company holidays | ✗ | | | | ✓ future dates | ✓ incl. past |
| See attendance (sessions, statuses, flags, schedules) | own only | | | | own only | ✓ everyone |
| Change own login/logout times | ✗ (request a correction) | | | | ✗ | via approved corrections only |
| Explain an attendance flag | own flags | | | | own flags | own flags |
| Review / resolve flags, decide corrections, set schedules, export everyone's CSV | ✗ | | | | ✗ | ✓ |
| Manager Dashboard, Data Review, audit log | ✗ | | | | ✓ | ✓ |
| Add/edit members, roles, logins, PINs, deactivate | ✗ | | | | ✗ | ✓ |

Guarantees enforced by the database:
- `created_by` and `requested_by` are always the signed-in member. `assigned_by` (Delegated by) defaults to the signed-in member and must be an active member.
- Members cannot change `access_role`, `is_active` or login links; the last active admin cannot be removed.
- Approval fields on backlog rows only change through `approve_backlog_item` / `convert_backlog_item` / `reject_backlog_item`.
- Assignees must be active members; % Complete is 0-100; statuses, priorities and frequencies are enums; Done forces 100%; Blocked requires a reason.
- Approval and conversion are atomic (row lock + one transaction) and idempotent; `tasks.backlog_item_id` is unique.
- Routine completions are unique per (routine, cycle) and per (routine, day); history is append-only for members.
- Attendance timestamps come from the database clock (`now()`) inside the sign-in and sign-out functions. There are no insert/update/delete grants on attendance tables for anyone; changes happen only through the functions above, and approved corrections keep the original values.
- Only sign-in and sign-out times are recorded. No keystrokes, screenshots, webcam or device activity.
- PIN hashes, verified sessions and login attempts have RLS on and no policies: unreadable through the API.
