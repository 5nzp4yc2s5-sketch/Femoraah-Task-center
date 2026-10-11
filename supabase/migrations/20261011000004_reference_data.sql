-- OpsPulse Workspace: initial data taken from the Google Sheets export (11-Oct-26).
-- Team.html -> members; Routine Tasks.html -> routines; rows that were not valid
-- records go to data_issues for the manager to review instead of being imported.

insert into public.members (name, role_title, expertise, max_open_tasks, access_role, accepts_unmatched) values
  ('Zinia',  'Customer Support', 'Customer queries, hold status, NDR management, order confirmation calls', 10, 'member', false),
  ('Shruti', 'Listings & Team Lead', 'Listing on all platforms, handling the team, exchanges, query follow-ups, ad hoc work', 10, 'member', false),
  ('Sanket', 'Warehouse Lead', 'Warehouse management, monthly inventory count, packing count, label processing, daily hold sheet, dispatch, Myntra ticket raising. Assigns Dev''s work.', 10, 'member', false),
  ('Dev',    'Packing (reports to Sanket)', 'Packing, plus tasks assigned by Sanket', 10, 'member', false),
  ('Kartik', 'Founder', 'Approvals, escalations, anything not covered above', 15, 'admin', true);

update public.members set reports_to = (select id from public.members where name = 'Sanket') where name = 'Dev';

insert into public.routines (title, owner_id, frequency, every_n_days, notes)
select r.title, m.id, r.frequency::public.routine_frequency, r.n, ''
from (values
  ('Reply to customer queries', 'Zinia', 'Daily', 1),
  ('Follow up on open customer queries', 'Shruti', 'Daily', 1),
  ('Process exchanges', 'Shruti', 'Daily', 1),
  ('Check listings are live and correct on all platforms', 'Shruti', 'Weekly', 7),
  ('Team check-in: review Task Board with the team', 'Shruti', 'Weekly', 7),
  ('Update hold sheet', 'Sanket', 'Daily', 1),
  ('Label processing', 'Sanket', 'Daily', 1),
  ('Dispatch parcels', 'Sanket', 'Daily', 1),
  ('Packing count', 'Sanket', 'Daily', 1),
  ('Raise Myntra tickets for open issues', 'Sanket', 'Daily', 1),
  ('Monthly inventory count', 'Sanket', 'Monthly', 30),
  ('Assign Dev''s tasks for the day', 'Sanket', 'Daily', 1),
  ('Pack orders', 'Dev', 'Daily', 1),
  ('Order Count', 'Sanket', 'Daily', 1),
  ('Reporting to Kartik for Packing re-order', 'Sanket', 'Weekly', 7)
) as r(title, owner, frequency, n)
join public.members m on m.name = r.owner;

-- The export's only completion: "Reply to customer queries", Last Done 11-Oct-26.
insert into public.routine_completions (routine_id, cycle_due, completed_on, completed_by, note)
select r.id, date '2026-10-11', date '2026-10-11', r.owner_id, 'Imported from spreadsheet'
from public.routines r where r.title = 'Reply to customer queries';

insert into public.data_issues (source_file, source_row, raw, issue, suggested_action) values
  ('Routine Tasks', 3,
   '{"Routine Task":"Sanket","Owner":"Warehouse Dispatch Supervisor","Frequency":"Order dispatch, label generation, Myntra ticket escalation, packing counts & inventory audits","Every N Days":"#N/A","Last Done":"11-Jan-00","Next Due":"#N/A","Status":"#N/A"}',
   'Malformed row: a team-member record (name, role, skills) pasted into the routine table, producing #N/A formulas and a 1900 date.',
   'Not imported as a routine. Sanket''s routines are already listed separately. Decide whether his role should read "Warehouse Dispatch Supervisor" (Team tab says "Warehouse Lead") and whether "label generation" / "inventory audits" belong in his expertise.'),
  ('Routine Tasks', 4,
   '{"Routine Task":"Sanket","Owner":"Warehouse Dispatch Supervisor","Frequency":"Order dispatch, label generation, Myntra ticket escalation, packing counts & inventory audits","Every N Days":"#N/A","Last Done":"11-Jan-00","Next Due":"#N/A","Status":"#N/A"}',
   'Exact duplicate of row 3.', 'Not imported. Dismiss once row 3 is handled.'),
  ('Routine Tasks', 41,
   '{"Routine Task":"[Holiday] Holiday / Annual Leave","Owner":"Dev","Frequency":"Daily","Last Done":"11-Oct-26","Notes":"Backup/Delegate: Zinia"}',
   'Leave entry, not a recurring task. The app has no leave calendar yet.',
   'Not imported. Dev on leave 11-Oct-26 with Zinia as backup; reassign Dev''s open tasks if needed.'),
  ('Routine Tasks', 42,
   '{"Routine Task":"[Public Holiday] Diwali Public Holiday","Owner":"ALL","Frequency":"Daily","Last Done":"30-Oct-26","Notes":"Company observed public holiday (eligible for swap)"}',
   'Public-holiday entry with owner "ALL", not a recurring task.', 'Not imported. Diwali holiday 30-Oct-26.'),
  ('Routine Tasks', 43,
   '{"Routine Task":"[Holiday Swap] Swapped Diwali Public Holiday","Owner":"Shruti","Frequency":"Daily","Last Done":"20-Oct-26","Notes":"Original: 2026-10-25 → Swapped to: 2026-10-20. Worked on public holiday; swapped leave taken on alternate shift date."}',
   'Holiday-swap entry, not a recurring task. Note says original date 2026-10-25 while the Diwali row says 30-Oct-26.',
   'Not imported. Confirm the correct original holiday date.'),
  ('Routine Tasks', 44,
   '{"Routine Task":"[Holiday] Holiday / Annual Leave","Owner":"Zinia","Frequency":"Daily","Last Done":"11-Oct-26","Notes":"Backup/Delegate: Sanket"}',
   'Leave entry, not a recurring task.', 'Not imported. Zinia on leave 11-Oct-26 with Sanket as backup.'),
  ('Routine Tasks', 45,
   '{"Routine Task":"test","Owner":"Sanket","Frequency":"Daily","Notes":"test12 | [Delegated by Shruti] | [Priority: Medium]"}',
   'Test delegation row placed in the routine table.', 'Not imported. Delegated one-off work belongs on the Task Board.'),
  ('Routine Tasks', 46,
   '{"Routine Task":"test","Owner":"Dev","Frequency":"Daily","Notes":"[Delegated by Shruti to Dev]"}',
   'Test delegation row placed in the routine table.', 'Not imported.'),
  ('Task Board', 2,
   '{"Task":"test","Owner":"Shruti","Assigned By":"kc","Priority":"High","Status":"Done","% Complete":"10000%","Last Update":"11-Oct-26","Flag":"Done"}',
   'Test row. % Complete was entered as 100 in a percent-formatted cell, so it showed 10000%. "kc" is not a team member. No Task ID or dates.',
   'Not imported. In the app % Complete is stored 0-100 and Assigned By is always the signed-in person.'),
  ('Task Board', 3,
   '{"Task":"test","Owner":"Kartik","Assigned By":"kc","Priority":"High","Status":"Done","% Complete":"10000%","Last Update":"11-Oct-26","Flag":"Done"}',
   'Same test row as above, owned by Kartik.', 'Not imported.'),
  ('Team', null,
   '{"Email":""}',
   'Email is blank for all five team members.',
   'Add each person''s email (optional) on the Team page. Logins use a username, so email is not required to sign in.'),
  ('OpsPulse Workspace Daily Check-Off Dashboard', null,
   '{"content":"empty export"}',
   'This export contains only a stylesheet link and no table, so its layout could not be reproduced.',
   'Re-export the tab if it held anything beyond what Dashboard and Routine Tasks show.');
