# Source analysis: OpsPulse Workspace Google Sheets export (11-Oct-26)

All eight files were readable. This records what the spreadsheet actually contained, so existing behaviour is kept separate from what the web app adds.

## What exists in the source

| Tab | Columns (exact) | Data |
|---|---|---|
| Dashboard | Open tasks, Overdue, Blocked, Due in next 7 days, No update in 3+ days, Unassigned backlog, Routine tasks overdue. Per person: Name, Open, Overdue, Blocked, Due next 7 days, Routine overdue, Has Capacity? | All zeros (formulas over empty sheets) |
| Task Board | Task ID, Task, Details, Owner, Assigned By, Priority, Status, Start Date, Due Date, % Complete, Last Update, Progress Note / Blocker, Days Left, Flag | 2 test rows |
| Pending Backlog | Backlog ID, Task, Details, Skills Needed, Priority, Due Date, Requested By, Date Added, Suggested Owner, Why (match + workload), Approved?, Status | Empty |
| Routine Tasks | Routine Task, Owner, Frequency, Every N Days, Last Done, Next Due, Status, Notes | 15 valid rows, 8 invalid rows |
| Team | Name, Role, Expertise / Skills, Email, Max Open Tasks, Open Tasks, Overdue, Blocked, Has Capacity? | 5 people, emails blank |
| How It Works | Instructions text | 22 lines |
| Daily Check-Off Dashboard | — | **Empty export** (only a stylesheet link). Nothing to reproduce. |
| sheet.css | Generic Google Sheets CSS | Sheet colours are inline in each export: header `#1f3a5f` white bold, borders `#d0d7e2`, Done rows `#d4edda`, Calibri 11pt |

Values seen in the source: Status `Done` (Task Board), `OK` / `Not logged yet` (Routines); Priority `High`, `Medium`; Frequency `Daily` (1), `Weekly` (7), `Monthly` (30); Approved? `Yes`; backlog Status `Assigned`; Flag `Done`.

Workflow from How It Works: employees spend ~2 minutes a day updating Status, % Complete, Progress Note and Last Update; Blocked needs a reason; Dev's tasks are added by Sanket; routines are ticked by entering a date in Last Done; unowned work goes to Pending Backlog; Claude filled Suggested Owner + Why from Expertise and the Team workload columns; the manager sets Approved = Yes; approved rows move to the Task Board and the backlog row becomes Assigned. Colours: red overdue, amber due in 3 days or no update 3+ days, grey blocked, green done.

## Malformed or missing data

| Where | Problem | How the app handles it |
|---|---|---|
| Task Board rows 2-3 | `test` rows, Assigned By `kc` (not a member), % Complete `10000%` (100 typed into a % cell), no ID/dates | Not imported; listed in Data Review. % is stored 0-100; Assigned By is always the signed-in person |
| Routine rows 3-4 | Sanket's team record pasted into routine columns, `#N/A` formulas, `11-Jan-00` date; role "Warehouse Dispatch Supervisor" differs from Team tab "Warehouse Lead" | Not imported; Data Review asks which role/skills are correct |
| Routine rows 41-44 | Holiday / leave / holiday-swap entries (owner `ALL` on one; swap note says 25-Oct while Diwali row says 30-Oct) | Not imported (no leave calendar exists in the source or the app); kept in Data Review |
| Routine rows 45-46 | `test` delegation rows | Not imported; Data Review |
| Team | Email blank for everyone | Logins use usernames, email optional |
| Daily Check-Off Dashboard | Empty file | Flagged; nothing invented |

## Added for the web app (not in the spreadsheet)

Logins with password + 3-digit PIN, roles and row-level permissions, task creator / collaborator / supervisor visibility, assignment and progress history, audit log, archive instead of delete, rejected backlog state, backlog override with decision note, routine completion history, "Due today" and "Paused" routine states, individual dashboards, "No update 3+ days" per person, Data Review page, `Not Started` / `In Progress` / `Blocked` statuses and `Low` priority (only `Done`, `High`, `Medium` appear in the data), deterministic owner recommendation in place of Claude.
