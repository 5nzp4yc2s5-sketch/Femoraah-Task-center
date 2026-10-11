# Permission matrix

Enforced in PostgreSQL (RLS policies, column grants, guard triggers and SECURITY DEFINER functions), not in the UI. Every policy goes through `private.me()`, which returns nothing unless the account is **active** and the current Supabase session **passed the PIN step**. The public (anon) key alone can read nothing.

Roles: **admin** (Kartik), **manager** (none yet; admin can promote anyone), **member** (everyone else). Default decision: Kartik is the only manager. Shruti (Team Lead) gets no manager rights unless promoted. Dev reports to Sanket, so Sanket can view Dev's tasks and routines (supervisor visibility) but cannot edit them unless he created/assigned them.

| Action | Member | Task creator / current assigner | Task owner | Collaborator | Supervisor of owner | Manager | Admin |
|---|---|---|---|---|---|---|---|
| View a task | only if one of the roles to the right | ✓ | ✓ | ✓ | ✓ (view only) | ✓ all | ✓ all |
| Create a task and assign it to any active member | ✓ | | | | | ✓ | ✓ |
| Update Status / % Complete / Progress Note | | ✓ | ✓ | ✓ | | ✓ | ✓ |
| Edit title, details, priority, dates; reassign | | ✓ | ✗ | ✗ | ✗ | ✓ | ✓ |
| Add / remove collaborators | | ✓ | | | | ✓ | ✓ |
| Archive a task (no hard delete) | | creator only | | | | ✓ | ✓ |
| View task history | with the task | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Submit to Pending Backlog / view backlog | ✓ | | | | | ✓ | ✓ |
| Edit an open backlog item | requester only | | | | | ✓ | ✓ |
| Approve / override / reject backlog | ✗ | | | | | ✓ | ✓ |
| View routines | own (+ reports' if supervisor) | | | | ✓ | ✓ all | ✓ all |
| Tick off a routine | own | | | | ✗ | ✓ | ✓ |
| Create / edit routines, remove a completion | ✗ | | | | | ✓ | ✓ |
| Team directory + live counts (no task details) | ✓ (active people) | | | | | ✓ (incl. inactive) | ✓ + usernames |
| Manager Dashboard, Data Review, audit log | ✗ | | | | | ✓ | ✓ |
| Add/edit members, roles, logins, PINs, deactivate | ✗ | | | | | ✗ | ✓ |

Guarantees enforced by the database:
- `created_by` / `assigned_by` / `requested_by` are always set to the signed-in member (spoofed values are rejected by column grants).
- Members cannot change `access_role`, `is_active` or login links; the last active admin cannot be removed.
- Approval fields on backlog rows only change through `approve_backlog_item` / `reject_backlog_item`.
- Owners must be active members; % Complete is 0-100; statuses, priorities and frequencies are enums; Done forces 100%.
- Approval is atomic (row lock + one transaction) and idempotent; `tasks.backlog_item_id` is unique.
- Routine completions are unique per (routine, cycle) and per (routine, day); history is append-only for members.
- PIN hashes, verified sessions and login attempts have RLS on and no policies: unreadable through the API.
