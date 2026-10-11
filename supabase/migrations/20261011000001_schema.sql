-- OpsPulse Workspace: core schema
-- Tables mirror the Google Sheets tabs (Team, Task Board, Pending Backlog, Routine Tasks)
-- plus the history, security and audit tables a multi-user web app needs.

create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- Controlled vocabularies --------------------------------------------------
create type public.access_role as enum ('admin', 'manager', 'member');
-- "Done" comes from the source Task Board; the others are the agreed status set.
create type public.task_status as enum ('Not Started', 'In Progress', 'Blocked', 'Done');
-- "High" and "Medium" appear in the source; "Low" completes the scale.
create type public.task_priority as enum ('High', 'Medium', 'Low');
create type public.backlog_status as enum ('Open', 'Assigned', 'Rejected');
create type public.approval_state as enum ('Pending', 'Yes', 'No');
-- Daily / Weekly / Monthly appear in the source; Custom covers "Every N Days".
create type public.routine_frequency as enum ('Daily', 'Weekly', 'Monthly', 'Custom');
create type public.issue_status as enum ('Open', 'Resolved', 'Dismissed');

-- Workspace settings (single row) -----------------------------------------
create table public.app_settings (
  id boolean primary key default true check (id),
  timezone text not null default 'Asia/Kolkata',
  stale_after_days int not null default 3 check (stale_after_days between 1 and 30),
  due_soon_days int not null default 3 check (due_soon_days between 0 and 30),
  updated_at timestamptz not null default now()
);
insert into public.app_settings default values;

-- Team ---------------------------------------------------------------------
create table public.members (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users (id) on delete set null,
  username text unique check (username ~ '^[a-z0-9._-]{3,32}$'),
  name text not null check (length(btrim(name)) between 1 and 80),
  role_title text not null default '' check (length(role_title) <= 120),
  expertise text not null default '' check (length(expertise) <= 1000),
  email text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  max_open_tasks int not null default 10 check (max_open_tasks between 1 and 200),
  access_role public.access_role not null default 'member',
  reports_to uuid references public.members (id) on delete set null,
  accepts_unmatched boolean not null default false,
  is_active boolean not null default true,
  deactivated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (reports_to is null or reports_to <> id)
);
create unique index members_active_name_uq on public.members (lower(name)) where is_active;
comment on column public.members.accepts_unmatched is
  'Backlog fallback owner when nobody''s expertise matches (seeded from "anything not covered above").';

-- 3-digit PIN second step. Never readable through the API.
create table public.member_pins (
  member_id uuid primary key references public.members (id) on delete cascade,
  pin_hash text not null,
  failed_attempts int not null default 0,
  locked_until timestamptz,
  pin_set_at timestamptz not null default now()
);

-- Supabase sessions that have passed the PIN step.
create table public.verified_sessions (
  session_id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  member_id uuid not null references public.members (id) on delete cascade,
  verified_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index on public.verified_sessions (user_id);

-- Password-step attempts recorded by the server for per-account / per-IP lockout.
create table public.login_attempts (
  id bigint generated always as identity primary key,
  identifier text not null,
  ip text,
  success boolean not null,
  created_at timestamptz not null default now()
);
create index on public.login_attempts (identifier, created_at desc);
create index on public.login_attempts (ip, created_at desc);

-- Pending Backlog ----------------------------------------------------------
create table public.backlog_items (
  id uuid primary key default gen_random_uuid(),
  backlog_no bigint generated always as identity unique,
  title text not null check (length(btrim(title)) between 1 and 200),
  details text not null default '' check (length(details) <= 5000),
  skills_needed text not null check (length(btrim(skills_needed)) between 1 and 500),
  priority public.task_priority not null default 'Medium',
  due_date date not null,
  requested_by uuid not null references public.members (id),
  date_added date not null default current_date,
  suggested_owner_id uuid references public.members (id),
  suggestion_reason text,
  suggestion_score numeric(5, 3),
  suggestion_candidates jsonb not null default '[]'::jsonb,
  suggested_at timestamptz,
  approval public.approval_state not null default 'Pending',
  status public.backlog_status not null default 'Open',
  decided_by uuid references public.members (id),
  decided_at timestamptz,
  final_owner_id uuid references public.members (id),
  overrode_suggestion boolean,
  decision_note text check (decision_note is null or length(decision_note) <= 1000),
  task_id uuid unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'Assigned' or (approval = 'Yes' and final_owner_id is not null and task_id is not null)),
  check (status <> 'Rejected' or approval = 'No')
);

-- Task Board ---------------------------------------------------------------
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  task_no bigint generated always as identity unique,
  title text not null check (length(btrim(title)) between 1 and 200),
  details text not null default '' check (length(details) <= 5000),
  owner_id uuid not null references public.members (id),
  assigned_by uuid not null references public.members (id),
  created_by uuid not null references public.members (id),
  priority public.task_priority not null default 'Medium',
  status public.task_status not null default 'Not Started',
  start_date date,
  due_date date,
  percent_complete smallint not null default 0 check (percent_complete between 0 and 100),
  progress_note text not null default '' check (length(progress_note) <= 1000),
  last_update_at timestamptz not null default now(),
  completed_at timestamptz,
  backlog_item_id uuid unique references public.backlog_items (id),
  archived_at timestamptz,
  archived_by uuid references public.members (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (due_date is null or start_date is null or due_date >= start_date),
  check (status <> 'Done' or percent_complete = 100)
);
create index on public.tasks (owner_id) where archived_at is null;
create index on public.tasks (created_by);
create index on public.tasks (assigned_by);
create index on public.tasks (due_date) where archived_at is null;

alter table public.backlog_items
  add constraint backlog_items_task_fk foreign key (task_id) references public.tasks (id);

create table public.task_collaborators (
  task_id uuid not null references public.tasks (id) on delete cascade,
  member_id uuid not null references public.members (id),
  added_by uuid references public.members (id),
  added_at timestamptz not null default now(),
  primary key (task_id, member_id)
);
create index on public.task_collaborators (member_id);

create table public.task_assignments (
  id bigint generated always as identity primary key,
  task_id uuid not null references public.tasks (id) on delete cascade,
  from_owner_id uuid references public.members (id),
  to_owner_id uuid not null references public.members (id),
  changed_by uuid references public.members (id),
  reason text,
  created_at timestamptz not null default now()
);
create index on public.task_assignments (task_id, created_at);

create table public.task_updates (
  id bigint generated always as identity primary key,
  task_id uuid not null references public.tasks (id) on delete cascade,
  author_id uuid references public.members (id),
  status public.task_status not null,
  percent_complete smallint not null,
  note text not null default '',
  created_at timestamptz not null default now()
);
create index on public.task_updates (task_id, created_at desc);

-- Routine Tasks ------------------------------------------------------------
create table public.routines (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(btrim(title)) between 1 and 200),
  owner_id uuid not null references public.members (id),
  frequency public.routine_frequency not null,
  every_n_days int not null check (every_n_days between 1 and 366),
  notes text not null default '' check (length(notes) <= 1000),
  is_active boolean not null default true,
  created_by uuid references public.members (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (frequency = 'Daily' and every_n_days = 1)
    or (frequency = 'Weekly' and every_n_days = 7)
    or (frequency = 'Monthly' and every_n_days between 28 and 31)
    or frequency = 'Custom'
  )
);
create index on public.routines (owner_id);

-- One row per completed cycle; never overwritten.
create table public.routine_completions (
  id uuid primary key default gen_random_uuid(),
  routine_id uuid not null references public.routines (id) on delete cascade,
  cycle_due date not null,
  completed_on date not null,
  completed_by uuid not null references public.members (id),
  note text not null default '' check (length(note) <= 500),
  created_at timestamptz not null default now(),
  unique (routine_id, cycle_due),
  unique (routine_id, completed_on)
);

-- Audit + data review ------------------------------------------------------
create table public.audit_events (
  id bigint generated always as identity primary key,
  actor_member_id uuid references public.members (id),
  actor_user_id uuid,
  entity text not null,
  entity_id uuid,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index on public.audit_events (entity, entity_id, created_at desc);
create index on public.audit_events (created_at desc);

-- Rows from the spreadsheet export that could not be imported as-is.
create table public.data_issues (
  id uuid primary key default gen_random_uuid(),
  source_file text not null,
  source_row int,
  raw jsonb not null,
  issue text not null,
  suggested_action text not null default '',
  status public.issue_status not null default 'Open',
  resolution_note text,
  resolved_by uuid references public.members (id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
