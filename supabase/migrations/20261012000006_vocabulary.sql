-- Vocabulary from the Complete Missing Features spec (Parts 5 and 6).
-- Renaming an enum value keeps every stored row, default, check constraint and policy that uses it,
-- so existing tasks and backlog items carry over unchanged ("Not Started" rows become "To Do", etc.).
-- New values are added here on their own because Postgres cannot use a new enum value in the
-- same transaction that adds it.

alter type public.task_status rename value 'Not Started' to 'To Do';
alter type public.task_status rename value 'In Progress' to 'Active';

alter type public.task_priority add value if not exists 'Critical' before 'High';

alter type public.backlog_status rename value 'Open' to 'Pending';
alter type public.backlog_status rename value 'Assigned' to 'Converted to Task';
alter type public.backlog_status rename value 'Rejected' to 'Dismissed';
alter type public.backlog_status add value if not exists 'Approved' after 'Pending';

-- Team calendar and attendance vocabularies.
create type public.leave_type as enum ('Annual Leave', 'Sick Leave', 'Casual Leave', 'Holiday Swap', 'Other');
create type public.flag_review_status as enum ('Open', 'Reviewed', 'Resolved');
create type public.correction_status as enum ('Pending', 'Approved', 'Rejected');
