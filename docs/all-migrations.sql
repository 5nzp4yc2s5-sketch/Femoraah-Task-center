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
-- OpsPulse Workspace: identity helpers, invariants (triggers) and workflow RPCs.
--
-- Convention: helpers in schema "private" are SECURITY DEFINER with an empty search_path.
-- Guard triggers are SECURITY INVOKER and only restrict callers whose current_user is
-- 'authenticated' (i.e. requests coming through the Data API). Workflow functions below
-- run as the owner, so their own writes pass the guards after doing their own checks.

-- Identity ------------------------------------------------------------------
create or replace function private.today()
returns date language sql stable security definer set search_path = '' as $$
  select (now() at time zone coalesce((select timezone from public.app_settings limit 1), 'UTC'))::date
$$;

create or replace function private.local_date(ts timestamptz)
returns date language sql stable security definer set search_path = '' as $$
  select (ts at time zone coalesce((select timezone from public.app_settings limit 1), 'UTC'))::date
$$;

create or replace function private.jwt_session_id()
returns uuid language plpgsql stable set search_path = '' as $$
declare v text := auth.jwt() ->> 'session_id';
begin
  if v is null or v = '' then return null; end if;
  return v::uuid;
exception when others then return null;
end $$;

-- Member row for the signed-in user, regardless of PIN state (used only by the login flow).
create or replace function private.member_for_user()
returns uuid language sql stable security definer set search_path = '' as $$
  select m.id from public.members m where m.user_id = auth.uid() and m.is_active
$$;

create or replace function private.session_verified()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.verified_sessions v
    where v.session_id = private.jwt_session_id()
      and v.user_id = auth.uid()
      and v.expires_at > now()
  )
$$;

-- The caller's member id, only when the account is active AND this session passed the PIN step.
-- Every RLS policy goes through this, so a password alone (or a deactivated account) sees nothing.
create or replace function private.me()
returns uuid language sql stable security definer set search_path = '' as $$
  select case when private.session_verified() then private.member_for_user() end
$$;

create or replace function private.my_role()
returns public.access_role language sql stable security definer set search_path = '' as $$
  select m.access_role from public.members m where m.id = private.me()
$$;

create or replace function private.is_manager()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(private.my_role() in ('manager', 'admin'), false)
$$;

create or replace function private.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(private.my_role() = 'admin', false)
$$;

create or replace function private.is_api_caller()
returns boolean language sql stable set search_path = '' as $$
  select current_user in ('authenticated', 'anon')
$$;

-- Task permissions ----------------------------------------------------------
-- Viewers: managers, owner, creator, current assigner, collaborators, and the owner's supervisor.
create or replace function private.can_view_task(p_task uuid, p_owner uuid, p_created_by uuid, p_assigned_by uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.me() is not null and (
    private.is_manager()
    or private.me() in (p_owner, p_created_by, p_assigned_by)
    or exists (select 1 from public.task_collaborators c where c.task_id = p_task and c.member_id = private.me())
    or exists (select 1 from public.members o where o.id = p_owner and o.reports_to = private.me())
  )
$$;

-- Full editors (title, details, owner, priority, dates, archive): managers, creator, current assigner.
create or replace function private.can_edit_task(p_created_by uuid, p_assigned_by uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.me() is not null and (private.is_manager() or private.me() in (p_created_by, p_assigned_by))
$$;

-- Progress editors (status, % complete, progress note): full editors, owner, collaborators.
create or replace function private.can_update_progress(p_task uuid, p_owner uuid, p_created_by uuid, p_assigned_by uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.can_edit_task(p_created_by, p_assigned_by)
    or private.me() = p_owner
    or exists (select 1 from public.task_collaborators c where c.task_id = p_task and c.member_id = private.me())
$$;

create or replace function private.can_view_routine(p_owner uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.me() is not null and (
    private.is_manager()
    or private.me() = p_owner
    or exists (select 1 from public.members o where o.id = p_owner and o.reports_to = private.me())
  )
$$;

-- Audit ---------------------------------------------------------------------
create or replace function private.audit(p_entity text, p_entity_id uuid, p_action text, p_details jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.audit_events (actor_member_id, actor_user_id, entity, entity_id, action, details)
  values (private.member_for_user(), auth.uid(), p_entity, p_entity_id, p_action, coalesce(p_details, '{}'::jsonb))
$$;

-- Flags ---------------------------------------------------------------------
-- One flag per task, in this precedence:
--   Done (green) > Overdue (red) > Blocked (grey) > Due soon (amber) > Stale (amber) > On track.
-- A finished task is never overdue; an overdue task stays red even when blocked (Status still says Blocked).
create or replace function public.task_flag(p_status public.task_status, p_due date, p_last_update timestamptz)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when p_status = 'Done' then 'Done'
    when p_due is not null and p_due < private.today() then 'Overdue'
    when p_status = 'Blocked' then 'Blocked'
    when p_due is not null and p_due <= private.today() + (select due_soon_days from public.app_settings limit 1) then 'Due soon'
    when private.today() - private.local_date(p_last_update) >= (select stale_after_days from public.app_settings limit 1) then 'Stale'
    else 'On track'
  end
$$;

-- Generic updated_at --------------------------------------------------------
create or replace function private.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;

-- Members guard -------------------------------------------------------------
create or replace function private.members_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if private.is_api_caller() and not private.is_admin() then
    raise exception 'Only an admin can change the team directory' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    if private.is_api_caller() and new.user_id is distinct from old.user_id then
      raise exception 'Login links are managed by the provisioning flow' using errcode = '42501';
    end if;
    if new.is_active and not old.is_active then new.deactivated_at := null; end if;
    if not new.is_active and old.is_active then new.deactivated_at := now(); end if;
    -- Never leave the workspace without an active admin.
    if old.access_role = 'admin' and old.is_active
       and (new.access_role <> 'admin' or not new.is_active)
       and not exists (select 1 from public.members m where m.access_role = 'admin' and m.is_active and m.id <> old.id) then
      raise exception 'At least one active admin is required' using errcode = '23514';
    end if;
  elsif tg_op = 'INSERT' and private.is_api_caller() then
    new.user_id := null;
  end if;
  new.username := lower(new.username);
  new.updated_at := now();
  return new;
end $$;

create or replace function private.members_after()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform private.audit('member', new.id, 'created', jsonb_build_object('name', new.name, 'role', new.access_role));
  else
    if new.access_role is distinct from old.access_role then
      perform private.audit('member', new.id, 'role_changed', jsonb_build_object('from', old.access_role, 'to', new.access_role));
    end if;
    if new.is_active is distinct from old.is_active then
      perform private.audit('member', new.id, case when new.is_active then 'reactivated' else 'deactivated' end, '{}'::jsonb);
    end if;
    -- Deactivation or unlinking revokes every PIN-verified session at once.
    if (not new.is_active and old.is_active) or (old.user_id is not null and new.user_id is distinct from old.user_id) then
      delete from public.verified_sessions where member_id = new.id;
    end if;
  end if;
  return null;
end $$;

create trigger members_guard before insert or update on public.members
  for each row execute function private.members_guard();
create trigger members_after after insert or update on public.members
  for each row execute function private.members_after();

-- Tasks invariants ----------------------------------------------------------
create or replace function private.assert_active_member(p_member uuid, p_label text)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.members m where m.id = p_member and m.is_active) then
    raise exception '% must be an active team member', p_label using errcode = '23514';
  end if;
end $$;

create or replace function private.tasks_before()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_me uuid := private.me();
  v_meaningful boolean;
begin
  if tg_op = 'INSERT' then
    if private.is_api_caller() then
      if v_me is null then raise exception 'Not signed in' using errcode = '42501'; end if;
      new.created_by := v_me;
      new.assigned_by := v_me;
      new.backlog_item_id := null;
      new.archived_at := null;
      new.archived_by := null;
    end if;
    perform private.assert_active_member(new.owner_id, 'Owner');
    if new.status = 'Done' then new.percent_complete := 100; new.completed_at := now(); end if;
    new.last_update_at := now();
    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;

  -- UPDATE
  if new.id <> old.id or new.task_no <> old.task_no or new.created_by <> old.created_by
     or new.backlog_item_id is distinct from old.backlog_item_id or new.created_at <> old.created_at then
    raise exception 'Task identity fields cannot be changed' using errcode = '42501';
  end if;

  if private.is_api_caller() then
    if not private.can_edit_task(old.created_by, old.assigned_by) then
      if new.title is distinct from old.title or new.details is distinct from old.details
         or new.owner_id is distinct from old.owner_id or new.assigned_by is distinct from old.assigned_by
         or new.priority is distinct from old.priority or new.start_date is distinct from old.start_date
         or new.due_date is distinct from old.due_date or new.archived_at is distinct from old.archived_at then
        raise exception 'You can only update status, %% complete and the progress note on this task' using errcode = '42501';
      end if;
    end if;
    if new.archived_at is distinct from old.archived_at and not private.is_manager()
       and not (v_me = old.created_by) then
      raise exception 'Only the task creator or a manager can archive a task' using errcode = '42501';
    end if;
    new.assigned_by := case when new.owner_id is distinct from old.owner_id then v_me else old.assigned_by end;
    new.archived_by := case when new.archived_at is not null and old.archived_at is null then v_me
                            when new.archived_at is null then null else old.archived_by end;
    new.completed_at := old.completed_at;
    new.last_update_at := old.last_update_at;
  end if;

  if new.owner_id is distinct from old.owner_id then
    perform private.assert_active_member(new.owner_id, 'Owner');
  end if;

  if new.status = 'Done' and old.status <> 'Done' then
    new.percent_complete := 100;
    new.completed_at := now();
  elsif new.status <> 'Done' and old.status = 'Done' then
    new.completed_at := null;
    if new.percent_complete = 100 then new.percent_complete := 90; end if;
  end if;

  v_meaningful := new.title is distinct from old.title or new.details is distinct from old.details
    or new.owner_id is distinct from old.owner_id or new.priority is distinct from old.priority
    or new.status is distinct from old.status or new.start_date is distinct from old.start_date
    or new.due_date is distinct from old.due_date or new.percent_complete is distinct from old.percent_complete
    or new.progress_note is distinct from old.progress_note;
  if v_meaningful then new.last_update_at := now(); end if;
  new.updated_at := now();
  return new;
end $$;

create or replace function private.tasks_after()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := coalesce(private.member_for_user(), new.assigned_by);
begin
  if tg_op = 'INSERT' then
    insert into public.task_assignments (task_id, from_owner_id, to_owner_id, changed_by, reason)
    values (new.id, null, new.owner_id, new.assigned_by,
            case when new.backlog_item_id is not null then 'Approved from backlog' else 'Created' end);
    insert into public.task_updates (task_id, author_id, status, percent_complete, note)
    values (new.id, v_actor, new.status, new.percent_complete, new.progress_note);
    perform private.audit('task', new.id, 'created', jsonb_build_object('owner', new.owner_id, 'title', new.title));
    return null;
  end if;

  if new.owner_id is distinct from old.owner_id then
    insert into public.task_assignments (task_id, from_owner_id, to_owner_id, changed_by, reason)
    values (new.id, old.owner_id, new.owner_id, v_actor, 'Reassigned');
    perform private.audit('task', new.id, 'reassigned', jsonb_build_object('from', old.owner_id, 'to', new.owner_id));
  end if;
  if new.status is distinct from old.status or new.percent_complete is distinct from old.percent_complete
     or new.progress_note is distinct from old.progress_note then
    insert into public.task_updates (task_id, author_id, status, percent_complete, note)
    values (new.id, v_actor, new.status, new.percent_complete, new.progress_note);
  end if;
  if new.archived_at is distinct from old.archived_at then
    perform private.audit('task', new.id, case when new.archived_at is null then 'restored' else 'archived' end, '{}'::jsonb);
  end if;
  if new.title is distinct from old.title or new.due_date is distinct from old.due_date
     or new.priority is distinct from old.priority or new.details is distinct from old.details then
    perform private.audit('task', new.id, 'edited', jsonb_build_object(
      'title', jsonb_build_array(old.title, new.title),
      'due_date', jsonb_build_array(old.due_date, new.due_date),
      'priority', jsonb_build_array(old.priority, new.priority)));
  end if;
  return null;
end $$;

create trigger tasks_before before insert or update on public.tasks
  for each row execute function private.tasks_before();
create trigger tasks_after after insert or update on public.tasks
  for each row execute function private.tasks_after();

-- Collaborators can only be people, and changes are audited.
create or replace function private.collaborators_before()
returns trigger language plpgsql set search_path = '' as $$
begin
  if private.is_api_caller() then new.added_by := private.me(); end if;
  perform private.assert_active_member(new.member_id, 'Collaborator');
  return new;
end $$;
create trigger collaborators_before before insert on public.task_collaborators
  for each row execute function private.collaborators_before();

-- Backlog invariants --------------------------------------------------------
create or replace function private.backlog_before()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if private.is_api_caller() then
      if private.me() is null then raise exception 'Not signed in' using errcode = '42501'; end if;
      new.requested_by := private.me();
      new.approval := 'Pending';
      new.status := 'Open';
      new.decided_by := null; new.decided_at := null; new.final_owner_id := null;
      new.overrode_suggestion := null; new.decision_note := null; new.task_id := null;
      new.suggested_owner_id := null; new.suggestion_reason := null; new.suggestion_score := null;
      new.suggestion_candidates := '[]'::jsonb; new.suggested_at := null;
    end if;
    new.date_added := private.today();
    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;

  if private.is_api_caller() then
    if old.status <> 'Open' then
      raise exception 'This backlog item has already been decided' using errcode = '42501';
    end if;
    if new.approval is distinct from old.approval or new.status is distinct from old.status
       or new.decided_by is distinct from old.decided_by or new.decided_at is distinct from old.decided_at
       or new.final_owner_id is distinct from old.final_owner_id or new.task_id is distinct from old.task_id
       or new.overrode_suggestion is distinct from old.overrode_suggestion
       or new.decision_note is distinct from old.decision_note
       or new.suggested_owner_id is distinct from old.suggested_owner_id
       or new.suggestion_reason is distinct from old.suggestion_reason
       or new.suggestion_score is distinct from old.suggestion_score
       or new.suggestion_candidates is distinct from old.suggestion_candidates
       or new.requested_by is distinct from old.requested_by or new.date_added is distinct from old.date_added then
      raise exception 'Approval and suggestion fields can only change through the approval workflow' using errcode = '42501';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger backlog_before before insert or update on public.backlog_items
  for each row execute function private.backlog_before();

-- Routines ------------------------------------------------------------------
create or replace function private.routines_before()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' and private.is_api_caller() then new.created_by := private.me(); end if;
  if tg_op = 'UPDATE' and new.created_by is distinct from old.created_by then new.created_by := old.created_by; end if;
  perform private.assert_active_member(new.owner_id, 'Owner');
  if new.frequency = 'Daily' then new.every_n_days := 1;
  elsif new.frequency = 'Weekly' then new.every_n_days := 7;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger routines_before before insert or update on public.routines
  for each row execute function private.routines_before();

create or replace function private.routines_after()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.audit('routine', coalesce(new.id, old.id), lower(tg_op), jsonb_build_object('title', coalesce(new.title, old.title)));
  return null;
end $$;
create trigger routines_after after insert or update or delete on public.routines
  for each row execute function private.routines_after();

-- Read models ---------------------------------------------------------------
create or replace view public.task_board with (security_invoker = true) as
select
  t.id, t.task_no, 'T-' || lpad(t.task_no::text, 4, '0') as task_code,
  t.title, t.details,
  t.owner_id, o.name as owner_name,
  t.assigned_by, a.name as assigned_by_name,
  t.created_by, c.name as created_by_name,
  t.priority, t.status, t.start_date, t.due_date, t.percent_complete,
  t.last_update_at, t.progress_note, t.completed_at, t.backlog_item_id,
  t.archived_at, t.created_at,
  case when t.due_date is null or t.status = 'Done' then null else t.due_date - private.today() end as days_left,
  public.task_flag(t.status, t.due_date, t.last_update_at) as flag,
  (t.status <> 'Done' and private.today() - private.local_date(t.last_update_at)
     >= (select stale_after_days from public.app_settings limit 1)) as is_stale
from public.tasks t
left join public.members o on o.id = t.owner_id
left join public.members a on a.id = t.assigned_by
left join public.members c on c.id = t.created_by;

create or replace view public.routine_board with (security_invoker = true) as
with last as (
  select rc.routine_id, max(rc.completed_on) as last_done, count(*) as times_done
  from public.routine_completions rc group by rc.routine_id
)
select
  r.id, r.title, r.owner_id, m.name as owner_name, r.frequency, r.every_n_days, r.notes, r.is_active,
  l.last_done, coalesce(l.times_done, 0) as times_done,
  (l.last_done + r.every_n_days) as next_due,
  case
    when not r.is_active then 'Paused'
    when l.last_done is null then 'Not logged yet'
    when l.last_done + r.every_n_days < private.today() then 'Overdue'
    when l.last_done + r.every_n_days = private.today() then 'Due today'
    else 'OK'
  end as status
from public.routines r
left join public.members m on m.id = r.owner_id
left join last l on l.routine_id = r.id;

create or replace view public.backlog_board with (security_invoker = true) as
select
  b.*, 'B-' || lpad(b.backlog_no::text, 4, '0') as backlog_code,
  rq.name as requested_by_name, so.name as suggested_owner_name,
  fo.name as final_owner_name, d.name as decided_by_name
from public.backlog_items b
left join public.members rq on rq.id = b.requested_by
left join public.members so on so.id = b.suggested_owner_id
left join public.members fo on fo.id = b.final_owner_id
left join public.members d on d.id = b.decided_by;

-- Session / PIN RPCs --------------------------------------------------------
create or replace function public.session_status()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare m public.members;
begin
  if auth.uid() is null then return jsonb_build_object('signed_in', false); end if;
  select * into m from public.members where user_id = auth.uid();
  if m.id is null then
    return jsonb_build_object('signed_in', true, 'linked', false);
  end if;
  return jsonb_build_object(
    'signed_in', true, 'linked', true, 'active', m.is_active,
    'member_id', m.id, 'name', m.name, 'access_role', m.access_role,
    'has_pin', exists (select 1 from public.member_pins p where p.member_id = m.id),
    'verified', m.is_active and private.session_verified(),
    'timezone', (select timezone from public.app_settings limit 1)
  );
end $$;

create or replace function public.verify_pin(p_pin text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_member uuid := private.member_for_user();
  v_session uuid := private.jwt_session_id();
  v_pin public.member_pins;
  c_max_attempts constant int := 5;
  c_lock constant interval := interval '15 minutes';
  c_session_ttl constant interval := interval '12 hours';
begin
  if auth.uid() is null or v_session is null or v_member is null then
    return jsonb_build_object('ok', false, 'error', 'not_allowed');
  end if;
  select * into v_pin from public.member_pins where member_id = v_member for update;
  if v_pin.member_id is null then
    return jsonb_build_object('ok', false, 'error', 'no_pin');
  end if;
  if v_pin.locked_until is not null and v_pin.locked_until > now() then
    return jsonb_build_object('ok', false, 'error', 'locked', 'locked_until', v_pin.locked_until);
  end if;
  if p_pin is not null and p_pin ~ '^[0-9]{3}$' and extensions.crypt(p_pin, v_pin.pin_hash) = v_pin.pin_hash then
    update public.member_pins set failed_attempts = 0, locked_until = null where member_id = v_member;
    insert into public.verified_sessions (session_id, user_id, member_id, verified_at, expires_at)
    values (v_session, auth.uid(), v_member, now(), now() + c_session_ttl)
    on conflict (session_id) do update set verified_at = now(), expires_at = excluded.expires_at
      where public.verified_sessions.user_id = auth.uid();
    perform private.audit('member', v_member, 'pin_verified', '{}'::jsonb);
    return jsonb_build_object('ok', true);
  end if;

  if v_pin.failed_attempts + 1 >= c_max_attempts then
    update public.member_pins set failed_attempts = 0, locked_until = now() + c_lock where member_id = v_member;
    perform private.audit('member', v_member, 'pin_locked', '{}'::jsonb);
    return jsonb_build_object('ok', false, 'error', 'locked', 'locked_until', now() + c_lock);
  end if;
  update public.member_pins set failed_attempts = failed_attempts + 1 where member_id = v_member;
  perform private.audit('member', v_member, 'pin_failed', '{}'::jsonb);
  return jsonb_build_object('ok', false, 'error', 'wrong_pin', 'remaining', c_max_attempts - v_pin.failed_attempts - 1);
end $$;

create or replace function public.end_session()
returns void language sql security definer set search_path = '' as $$
  delete from public.verified_sessions where session_id = private.jwt_session_id() and user_id = auth.uid()
$$;

create or replace function private.hash_pin(p_pin text)
returns text language plpgsql security definer set search_path = '' as $$
begin
  if p_pin is null or p_pin !~ '^[0-9]{3}$' then
    raise exception 'PIN must be exactly 3 digits' using errcode = '22023';
  end if;
  return extensions.crypt(p_pin, extensions.gen_salt('bf', 10));
end $$;

create or replace function public.change_my_pin(p_current text, p_new text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_member uuid := private.me(); v_hash text;
begin
  if v_member is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  select pin_hash into v_hash from public.member_pins where member_id = v_member;
  if v_hash is null or extensions.crypt(coalesce(p_current, ''), v_hash) <> v_hash then
    return jsonb_build_object('ok', false, 'error', 'wrong_pin');
  end if;
  update public.member_pins set pin_hash = private.hash_pin(p_new), pin_set_at = now(), failed_attempts = 0, locked_until = null
  where member_id = v_member;
  perform private.audit('member', v_member, 'pin_changed', '{}'::jsonb);
  return jsonb_build_object('ok', true);
end $$;

-- Admin provisioning ----------------------------------------------------------
create or replace function public.admin_set_pin(p_member uuid, p_pin text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  insert into public.member_pins (member_id, pin_hash) values (p_member, private.hash_pin(p_pin))
  on conflict (member_id) do update set pin_hash = excluded.pin_hash, pin_set_at = now(), failed_attempts = 0, locked_until = null;
  perform private.audit('member', p_member, 'pin_reset', '{}'::jsonb);
end $$;

create or replace function public.admin_link_login(p_member uuid, p_user uuid, p_username text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  if exists (select 1 from public.members where id = p_member and user_id is not null) then
    raise exception 'This member already has a login' using errcode = '23505';
  end if;
  update public.members set user_id = p_user, username = lower(p_username) where id = p_member;
  if not found then raise exception 'Member not found' using errcode = 'P0002'; end if;
  perform private.audit('member', p_member, 'login_created', jsonb_build_object('username', lower(p_username)));
end $$;

create or replace function public.admin_unlink_login(p_member uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_user uuid;
begin
  if not private.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  if p_member = private.me() then raise exception 'You cannot remove your own login' using errcode = '42501'; end if;
  select user_id into v_user from public.members where id = p_member;
  update public.members set user_id = null where id = p_member;
  delete from public.member_pins where member_id = p_member;
  perform private.audit('member', p_member, 'login_removed', '{}'::jsonb);
  return v_user;
end $$;

-- Service-role-only variants for the one-time bootstrap script (no signed-in admin exists yet).
create or replace function public.service_bootstrap_admin(p_member uuid, p_user uuid, p_username text, p_pin text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.members where access_role = 'admin' and user_id is not null and is_active) then
    raise exception 'An admin login already exists; add people from the Team page instead' using errcode = '42501';
  end if;
  update public.members set user_id = p_user, username = lower(p_username), access_role = 'admin', is_active = true
  where id = p_member;
  if not found then raise exception 'Member not found' using errcode = 'P0002'; end if;
  insert into public.member_pins (member_id, pin_hash) values (p_member, private.hash_pin(p_pin))
  on conflict (member_id) do update set pin_hash = excluded.pin_hash, pin_set_at = now(), failed_attempts = 0, locked_until = null;
  insert into public.audit_events (actor_member_id, entity, entity_id, action, details)
  values (p_member, 'member', p_member, 'bootstrap_admin', jsonb_build_object('username', lower(p_username)));
end $$;

-- Password-step lockout bookkeeping, called by the server with the service role.
create or replace function public.service_login_gate(p_identifier text, p_ip text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id_fail int; v_ip_fail int;
begin
  select count(*) into v_id_fail from public.login_attempts
   where identifier = lower(p_identifier) and not success and created_at > now() - interval '15 minutes'
     and created_at > coalesce((select max(created_at) from public.login_attempts
                                where identifier = lower(p_identifier) and success), '-infinity');
  select count(*) into v_ip_fail from public.login_attempts
   where ip = p_ip and not success and created_at > now() - interval '15 minutes';
  return jsonb_build_object('allowed', v_id_fail < 5 and v_ip_fail < 20, 'identifier_failures', v_id_fail, 'ip_failures', v_ip_fail);
end $$;

create or replace function public.service_record_login(p_identifier text, p_ip text, p_success boolean)
returns void language sql security definer set search_path = '' as $$
  insert into public.login_attempts (identifier, ip, success) values (lower(p_identifier), p_ip, p_success);
  delete from public.login_attempts where created_at < now() - interval '30 days';
$$;

create or replace function public.service_resolve_login(p_identifier text)
returns text language sql stable security definer set search_path = '' as $$
  select u.email::text from public.members m join auth.users u on u.id = m.user_id
  where m.is_active and (m.username = lower(p_identifier) or lower(u.email) = lower(p_identifier))
  limit 1
$$;

-- Workload + dashboards -------------------------------------------------------
-- Workload definition: a task counts toward capacity while it is not Done and not archived.
create or replace function private.member_workload()
returns table (member_id uuid, open_tasks int, overdue int, blocked int, due_next_7 int, stale int, routine_overdue int, routine_not_logged int)
language sql stable security definer set search_path = '' as $$
  select m.id,
    count(t.id) filter (where t.status <> 'Done')::int,
    count(t.id) filter (where t.status <> 'Done' and t.due_date < private.today())::int,
    count(t.id) filter (where t.status = 'Blocked')::int,
    count(t.id) filter (where t.status <> 'Done' and t.due_date between private.today() and private.today() + 7)::int,
    count(t.id) filter (where t.status <> 'Done' and private.today() - private.local_date(t.last_update_at) >= (select stale_after_days from public.app_settings limit 1))::int,
    (select count(*) from public.routines r
       where r.owner_id = m.id and r.is_active
         and (select max(rc.completed_on) from public.routine_completions rc where rc.routine_id = r.id) + r.every_n_days < private.today())::int,
    (select count(*) from public.routines r
       where r.owner_id = m.id and r.is_active
         and not exists (select 1 from public.routine_completions rc where rc.routine_id = r.id))::int
  from public.members m
  left join public.tasks t on t.owner_id = m.id and t.archived_at is null
  group by m.id
$$;

-- Team directory counts (no task details). Visible to every signed-in member, like the Team tab.
create or replace function public.team_overview()
returns table (member_id uuid, name text, role_title text, expertise text, email text, max_open_tasks int,
               access_role public.access_role, reports_to uuid, is_active boolean, has_login boolean, username text,
               open_tasks int, overdue int, blocked int, has_capacity boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if private.me() is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  return query
  select m.id, m.name, m.role_title, m.expertise, m.email, m.max_open_tasks, m.access_role, m.reports_to, m.is_active,
         m.user_id is not null, case when private.is_admin() then m.username end,
         w.open_tasks, w.overdue, w.blocked, w.open_tasks < m.max_open_tasks
  from public.members m join private.member_workload() w on w.member_id = m.id
  where m.is_active or private.is_manager()
  order by m.is_active desc, m.created_at;
end $$;

create or replace function public.manager_dashboard()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  if not private.is_manager() then raise exception 'Managers only' using errcode = '42501'; end if;
  select jsonb_build_object(
    'today', private.today(),
    'open', coalesce(sum(w.open_tasks), 0),
    'overdue', coalesce(sum(w.overdue), 0),
    'blocked', coalesce(sum(w.blocked), 0),
    'due_next_7', coalesce(sum(w.due_next_7), 0),
    'stale', coalesce(sum(w.stale), 0),
    'unassigned_backlog', (select count(*) from public.backlog_items where status = 'Open'),
    'routine_overdue', coalesce(sum(w.routine_overdue), 0),
    'routine_not_logged', coalesce(sum(w.routine_not_logged), 0),
    'open_data_issues', (select count(*) from public.data_issues where status = 'Open'),
    'people', coalesce(jsonb_agg(jsonb_build_object(
        'member_id', m.id, 'name', m.name, 'role_title', m.role_title,
        'open', w.open_tasks, 'overdue', w.overdue, 'blocked', w.blocked,
        'due_next_7', w.due_next_7, 'stale', w.stale, 'routine_overdue', w.routine_overdue,
        'max_open_tasks', m.max_open_tasks, 'has_capacity', w.open_tasks < m.max_open_tasks
      ) order by m.created_at), '[]'::jsonb)
  ) into v
  from public.members m join private.member_workload() w on w.member_id = m.id
  where m.is_active;
  -- tasks of deactivated members still count in the totals
  return v || jsonb_build_object(
    'open', (select count(*) from public.tasks where archived_at is null and status <> 'Done'),
    'overdue', (select count(*) from public.tasks where archived_at is null and status <> 'Done' and due_date < private.today()),
    'blocked', (select count(*) from public.tasks where archived_at is null and status = 'Blocked'),
    'due_next_7', (select count(*) from public.tasks where archived_at is null and status <> 'Done' and due_date between private.today() and private.today() + 7),
    'stale', (select count(*) from public.tasks where archived_at is null and status <> 'Done'
                and private.today() - private.local_date(last_update_at) >= (select stale_after_days from public.app_settings limit 1))
  );
end $$;

create or replace function public.my_summary()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_me uuid := private.me(); v jsonb;
begin
  if v_me is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  select jsonb_build_object('today', private.today(), 'open', w.open_tasks, 'overdue', w.overdue, 'blocked', w.blocked,
    'due_next_7', w.due_next_7, 'stale', w.stale, 'routine_overdue', w.routine_overdue,
    'routine_not_logged', w.routine_not_logged, 'max_open_tasks', m.max_open_tasks,
    'has_capacity', w.open_tasks < m.max_open_tasks)
  into v from private.member_workload() w join public.members m on m.id = w.member_id where w.member_id = v_me;
  return v;
end $$;

-- Backlog recommendation ------------------------------------------------------
-- Deterministic and explainable:
--   skill   = average over the comma-separated "Skills Needed" phrases of the share of each
--             phrase's keywords found in the person's Expertise (prefix match on word stems).
--   load    = (open + overdue + 0.5 * blocked) / max open tasks
--   score   = 0.7 * skill + 0.3 * max(0, 1 - load)
-- Only active members with spare capacity (open < max) are eligible. If nobody's expertise
-- matches at all, members flagged as fallback owners ("anything not covered above") come first.
create or replace function private.keywords(p_text text)
returns text[] language sql immutable set search_path = '' as $$
  select coalesce(array_agg(distinct w), '{}')
  from regexp_split_to_table(lower(coalesce(p_text, '')), '[^a-z0-9]+') as w
  where length(w) >= 3
    and w not in ('and', 'the', 'for', 'with', 'from', 'all', 'any', 'anything', 'not', 'covered', 'above',
                  'plus', 'task', 'tasks', 'work', 'assigned', 'reports', 'other', 'etc', 'into', 'via',
                  'management', 'handling', 'daily', 'weekly', 'monthly', 'ad', 'hoc')
$$;

create or replace function private.word_match(p_kw text, p_words text[])
returns boolean language sql immutable set search_path = '' as $$
  select exists (
    select 1 from unnest(p_words) e
    where case
      when length(p_kw) <= 3 or length(e) <= 3 then e = p_kw
      else left(e, least(5, length(p_kw), length(e))) = left(p_kw, least(5, length(p_kw), length(e)))
    end
  )
$$;

create or replace function private.compute_suggestion(p_item uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  b public.backlog_items;
  v_phrases text[];
  v_best jsonb;
  v_runner jsonb;
  v_candidates jsonb;
  v_any_skill boolean;
  v_reason text;
  v_blocked_best jsonb;
begin
  select * into b from public.backlog_items where id = p_item;
  if b.id is null or b.status <> 'Open' then return; end if;

  select coalesce(array_agg(btrim(p)), '{}') into v_phrases
  from regexp_split_to_table(b.skills_needed, '\s*(,|;|/|\n|\s&\s|\sand\s)\s*') p
  where btrim(p) <> '' and cardinality(private.keywords(p)) > 0;

  with people as (
    select m.id, m.name, m.max_open_tasks, m.accepts_unmatched, private.keywords(m.expertise || ' ' || m.role_title) as words,
           w.open_tasks, w.overdue, w.blocked
    from public.members m join private.member_workload() w on w.member_id = m.id
    where m.is_active
  ),
  phrase_scores as (
    select p.id, ph.phrase,
      (select count(*) from unnest(private.keywords(ph.phrase)) k where private.word_match(k, p.words))::numeric
        / cardinality(private.keywords(ph.phrase)) as share
    from people p cross join unnest(v_phrases) as ph(phrase)
  ),
  scored as (
    select p.*,
      coalesce((select avg(s.share) from phrase_scores s where s.id = p.id), 0) as skill,
      coalesce((select array_agg(s.phrase order by s.phrase) from phrase_scores s where s.id = p.id and s.share > 0), '{}') as matched,
      (p.open_tasks + p.overdue + 0.5 * p.blocked)::numeric / p.max_open_tasks as load
    from people p
  ),
  ranked as (
    select s.*, round(0.7 * s.skill + 0.3 * greatest(0, 1 - s.load), 3) as score,
           s.open_tasks < s.max_open_tasks as has_capacity
    from scored s
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'member_id', r.id, 'name', r.name, 'score', r.score, 'skill', round(r.skill, 3),
      'matched', to_jsonb(r.matched), 'open', r.open_tasks, 'overdue', r.overdue, 'blocked', r.blocked,
      'max', r.max_open_tasks, 'has_capacity', r.has_capacity, 'fallback', r.accepts_unmatched)
      order by r.has_capacity desc, (r.skill > 0) desc, r.score desc, r.overdue, r.open_tasks, r.name), '[]'::jsonb),
    bool_or(r.skill > 0 and r.has_capacity)
  into v_candidates, v_any_skill
  from ranked r;

  if not coalesce(v_any_skill, false) then
    -- Nobody with capacity matches: prefer fallback owners, then lightest workload.
    select coalesce(jsonb_agg(c order by (c->>'has_capacity')::boolean desc, (c->>'fallback')::boolean desc,
                                         (c->>'open')::int, c->>'name'), '[]'::jsonb)
      into v_candidates from jsonb_array_elements(v_candidates) c;
  end if;

  v_best := v_candidates -> 0;
  v_runner := v_candidates -> 1;
  select c into v_blocked_best from jsonb_array_elements(v_candidates) c
   where not (c->>'has_capacity')::boolean and (c->>'skill')::numeric > coalesce((v_best->>'skill')::numeric, 0)
   order by (c->>'skill')::numeric desc limit 1;

  if v_best is null or not (v_best->>'has_capacity')::boolean then
    v_reason := 'Nobody active has spare capacity right now. Manager to choose an owner.';
    v_best := null;
  elsif v_any_skill then
    v_reason := format('%s matches %s of %s skill(s)%s. Workload %s/%s open, %s overdue, %s blocked. Score %s.',
      v_best->>'name',
      jsonb_array_length(v_best->'matched'), coalesce(array_length(v_phrases, 1), 0),
      case when jsonb_array_length(v_best->'matched') > 0
           then ' (' || (select string_agg(x, ', ') from jsonb_array_elements_text(v_best->'matched') x) || ')' else '' end,
      v_best->>'open', v_best->>'max', v_best->>'overdue', v_best->>'blocked', v_best->>'score');
  else
    v_reason := format('No one''s expertise matches "%s". %s%s has the most room: %s/%s open, %s overdue.',
      b.skills_needed, v_best->>'name',
      case when (v_best->>'fallback')::boolean then ' (handles anything not covered by others)' else '' end,
      v_best->>'open', v_best->>'max', v_best->>'overdue');
  end if;
  if v_best is not null and v_runner is not null and (v_runner->>'has_capacity')::boolean then
    v_reason := v_reason || format(' Next best: %s (score %s).', v_runner->>'name', v_runner->>'score');
  end if;
  if v_blocked_best is not null then
    v_reason := v_reason || format(' %s matches more skills but is at capacity (%s/%s).',
      v_blocked_best->>'name', v_blocked_best->>'open', v_blocked_best->>'max');
  end if;

  update public.backlog_items set
    suggested_owner_id = (v_best->>'member_id')::uuid,
    suggestion_score = (v_best->>'score')::numeric,
    suggestion_reason = v_reason,
    suggestion_candidates = (select coalesce(jsonb_agg(c), '[]'::jsonb) from (select c from jsonb_array_elements(v_candidates) c limit 5) s),
    suggested_at = now()
  where id = p_item;
end $$;

create or replace function private.backlog_after()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform private.audit('backlog', new.id, 'submitted', jsonb_build_object('title', new.title));
    perform private.compute_suggestion(new.id);
  elsif new.status = 'Open' and (new.skills_needed is distinct from old.skills_needed) then
    perform private.compute_suggestion(new.id);
  end if;
  return null;
end $$;
create trigger backlog_after after insert or update of skills_needed on public.backlog_items
  for each row execute function private.backlog_after();

create or replace function public.refresh_backlog_suggestion(p_item uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if private.me() is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  perform private.compute_suggestion(p_item);
end $$;

-- Approve = create exactly one task + mark the backlog row Assigned, in one transaction.
-- Re-submitting an approval returns the task created the first time.
create or replace function public.approve_backlog_item(p_item uuid, p_owner uuid default null, p_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  b public.backlog_items;
  v_owner uuid;
  v_task uuid;
  v_me uuid := private.me();
begin
  if not private.is_manager() then
    raise exception 'Only a manager can approve backlog assignments' using errcode = '42501';
  end if;
  select * into b from public.backlog_items where id = p_item for update;
  if b.id is null then raise exception 'Backlog item not found' using errcode = 'P0002'; end if;
  if b.status = 'Assigned' then return b.task_id; end if;
  if b.status = 'Rejected' then raise exception 'This backlog item was rejected' using errcode = '23514'; end if;

  v_owner := coalesce(p_owner, b.suggested_owner_id);
  if v_owner is null then raise exception 'Choose an owner before approving' using errcode = '23502'; end if;
  perform private.assert_active_member(v_owner, 'Owner');

  insert into public.tasks (title, details, owner_id, assigned_by, created_by, priority, status, start_date, due_date, backlog_item_id, progress_note)
  values (b.title,
          b.details || case when b.details = '' then '' else E'\n\n' end || 'Skills needed: ' || b.skills_needed,
          v_owner, v_me, b.requested_by, b.priority, 'Not Started', least(private.today(), b.due_date), b.due_date, b.id, '')
  returning id into v_task;

  update public.backlog_items set
    approval = 'Yes', status = 'Assigned', decided_by = v_me, decided_at = now(),
    final_owner_id = v_owner, overrode_suggestion = (b.suggested_owner_id is distinct from v_owner),
    decision_note = nullif(btrim(coalesce(p_note, '')), ''), task_id = v_task
  where id = p_item;

  perform private.audit('backlog', p_item, 'approved', jsonb_build_object(
    'task_id', v_task, 'owner', v_owner, 'suggested', b.suggested_owner_id,
    'overrode', b.suggested_owner_id is distinct from v_owner, 'note', p_note));
  return v_task;
end $$;

create or replace function public.reject_backlog_item(p_item uuid, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare b public.backlog_items;
begin
  if not private.is_manager() then raise exception 'Only a manager can reject backlog items' using errcode = '42501'; end if;
  select * into b from public.backlog_items where id = p_item for update;
  if b.id is null then raise exception 'Backlog item not found' using errcode = 'P0002'; end if;
  if b.status = 'Rejected' then return; end if;
  if b.status = 'Assigned' then raise exception 'Already assigned' using errcode = '23514'; end if;
  update public.backlog_items set approval = 'No', status = 'Rejected', decided_by = private.me(), decided_at = now(),
    decision_note = nullif(btrim(coalesce(p_note, '')), '')
  where id = p_item;
  perform private.audit('backlog', p_item, 'rejected', jsonb_build_object('note', p_note));
end $$;

-- Routine completion ------------------------------------------------------------
-- A routine is done for the current cycle when last_done + N > done date. Completing again
-- inside the same cycle is refused; the unique (routine_id, cycle_due) constraint backs this up.
create or replace function public.complete_routine(p_routine uuid, p_done_on date default null, p_note text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.routines;
  v_me uuid := private.me();
  v_done date := coalesce(p_done_on, private.today());
  v_last date;
  v_cycle date;
begin
  if v_me is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  select * into r from public.routines where id = p_routine for update;
  if r.id is null or not private.can_view_routine(r.owner_id) then
    raise exception 'Routine not found' using errcode = 'P0002';
  end if;
  if not (r.owner_id = v_me or private.is_manager()) then
    raise exception 'Only the owner or a manager can tick off this routine' using errcode = '42501';
  end if;
  if not r.is_active then raise exception 'This routine is paused' using errcode = '23514'; end if;
  if v_done > private.today() + 1 or v_done < private.today() - 30 then
    raise exception 'Done date must be within the last 30 days' using errcode = '22023';
  end if;

  select max(completed_on) into v_last from public.routine_completions where routine_id = r.id;
  if v_last is null then
    v_cycle := v_done;
  else
    if v_done < v_last + r.every_n_days then
      return jsonb_build_object('ok', false, 'error', 'already_done', 'last_done', v_last, 'next_due', v_last + r.every_n_days);
    end if;
    v_cycle := v_last + r.every_n_days;
  end if;

  insert into public.routine_completions (routine_id, cycle_due, completed_on, completed_by, note)
  values (r.id, v_cycle, v_done, v_me, coalesce(p_note, ''))
  on conflict do nothing;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'already_done', 'last_done', v_last);
  end if;
  return jsonb_build_object('ok', true, 'last_done', v_done, 'next_due', v_done + r.every_n_days);
end $$;

create or replace function public.resolve_data_issue(p_issue uuid, p_status public.issue_status, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_manager() then raise exception 'Managers only' using errcode = '42501'; end if;
  update public.data_issues set status = p_status, resolution_note = nullif(btrim(coalesce(p_note, '')), ''),
    resolved_by = case when p_status = 'Open' then null else private.me() end,
    resolved_at = case when p_status = 'Open' then null else now() end
  where id = p_issue;
  perform private.audit('data_issue', p_issue, lower(p_status::text), jsonb_build_object('note', p_note));
end $$;

-- Routine completion history is audited (including manager corrections).
create or replace function private.completions_after()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform private.audit('routine', new.routine_id, 'completed', jsonb_build_object('completed_on', new.completed_on, 'cycle_due', new.cycle_due));
  else
    perform private.audit('routine', old.routine_id, 'completion_removed', jsonb_build_object('completed_on', old.completed_on, 'by', old.completed_by));
  end if;
  return null;
end $$;
create trigger completions_after after insert or delete on public.routine_completions
  for each row execute function private.completions_after();
-- OpsPulse Workspace: Row Level Security and grants.
-- Every policy is evaluated through private.me(), which is NULL unless the account is active
-- and the current session passed the PIN step. anon gets nothing.

alter table public.app_settings enable row level security;
alter table public.members enable row level security;
alter table public.member_pins enable row level security;
alter table public.verified_sessions enable row level security;
alter table public.login_attempts enable row level security;
alter table public.backlog_items enable row level security;
alter table public.tasks enable row level security;
alter table public.task_collaborators enable row level security;
alter table public.task_assignments enable row level security;
alter table public.task_updates enable row level security;
alter table public.routines enable row level security;
alter table public.routine_completions enable row level security;
alter table public.audit_events enable row level security;
alter table public.data_issues enable row level security;

-- Start from zero privileges, then grant exactly what the app uses.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

-- Helpers used inside policies/triggers must be executable by the API role.
grant execute on all functions in schema private to authenticated;

-- app_settings ------------------------------------------------------------
grant select on public.app_settings to authenticated;
grant update (timezone, stale_after_days, due_soon_days) on public.app_settings to authenticated;
create policy settings_read on public.app_settings for select to authenticated using (private.me() is not null);
create policy settings_admin on public.app_settings for update to authenticated
  using (private.is_admin()) with check (private.is_admin());

-- members (Team directory: no credentials live here) -----------------------
grant select on public.members to authenticated;
grant insert (name, role_title, expertise, email, max_open_tasks, access_role, reports_to, accepts_unmatched, is_active)
  on public.members to authenticated;
grant update (name, role_title, expertise, email, max_open_tasks, access_role, reports_to, accepts_unmatched, is_active)
  on public.members to authenticated;
create policy members_read on public.members for select to authenticated
  using (private.me() is not null and (is_active or private.is_manager()));
create policy members_admin_insert on public.members for insert to authenticated with check (private.is_admin());
create policy members_admin_update on public.members for update to authenticated
  using (private.is_admin()) with check (private.is_admin());

-- member_pins / verified_sessions / login_attempts: no API access at all (functions only).

-- tasks -------------------------------------------------------------------
grant select on public.tasks to authenticated;
grant insert (title, details, owner_id, priority, status, start_date, due_date, percent_complete, progress_note)
  on public.tasks to authenticated;
grant update (title, details, owner_id, priority, status, start_date, due_date, percent_complete, progress_note, archived_at)
  on public.tasks to authenticated;
create policy tasks_read on public.tasks for select to authenticated
  using (private.can_view_task(id, owner_id, created_by, assigned_by));
create policy tasks_insert on public.tasks for insert to authenticated
  with check (private.me() is not null and created_by = private.me() and assigned_by = private.me());
create policy tasks_update on public.tasks for update to authenticated
  using (private.can_update_progress(id, owner_id, created_by, assigned_by))
  with check (private.can_view_task(id, owner_id, created_by, assigned_by));

-- task_collaborators --------------------------------------------------------
grant select, delete on public.task_collaborators to authenticated;
grant insert (task_id, member_id) on public.task_collaborators to authenticated;
create policy collab_read on public.task_collaborators for select to authenticated
  using (exists (select 1 from public.tasks t where t.id = task_id));
create policy collab_insert on public.task_collaborators for insert to authenticated
  with check (exists (select 1 from public.tasks t where t.id = task_id and private.can_edit_task(t.created_by, t.assigned_by)));
create policy collab_delete on public.task_collaborators for delete to authenticated
  using (exists (select 1 from public.tasks t where t.id = task_id and private.can_edit_task(t.created_by, t.assigned_by)));

-- history tables: readable with the task, written only by triggers -----------
grant select on public.task_assignments, public.task_updates to authenticated;
create policy assignments_read on public.task_assignments for select to authenticated
  using (exists (select 1 from public.tasks t where t.id = task_id));
create policy updates_read on public.task_updates for select to authenticated
  using (exists (select 1 from public.tasks t where t.id = task_id));

-- backlog_items (shared backlog) -----------------------------------------
grant select on public.backlog_items to authenticated;
grant insert (title, details, skills_needed, priority, due_date) on public.backlog_items to authenticated;
grant update (title, details, skills_needed, priority, due_date) on public.backlog_items to authenticated;
create policy backlog_read on public.backlog_items for select to authenticated using (private.me() is not null);
create policy backlog_insert on public.backlog_items for insert to authenticated
  with check (private.me() is not null and requested_by = private.me());
create policy backlog_update on public.backlog_items for update to authenticated
  using (status = 'Open' and (requested_by = private.me() or private.is_manager()))
  with check (status = 'Open' and (requested_by = private.me() or private.is_manager()));

-- routines ------------------------------------------------------------------
grant select on public.routines to authenticated;
grant insert (title, owner_id, frequency, every_n_days, notes, is_active) on public.routines to authenticated;
grant update (title, owner_id, frequency, every_n_days, notes, is_active) on public.routines to authenticated;
create policy routines_read on public.routines for select to authenticated using (private.can_view_routine(owner_id));
create policy routines_insert on public.routines for insert to authenticated with check (private.is_manager());
create policy routines_update on public.routines for update to authenticated
  using (private.is_manager()) with check (private.is_manager());

grant select, delete on public.routine_completions to authenticated;
create policy completions_read on public.routine_completions for select to authenticated
  using (exists (select 1 from public.routines r where r.id = routine_id));
create policy completions_delete on public.routine_completions for delete to authenticated
  using (private.is_manager());

-- audit + data review ------------------------------------------------------
grant select on public.audit_events, public.data_issues to authenticated;
create policy audit_read on public.audit_events for select to authenticated using (private.is_manager());
create policy issues_read on public.data_issues for select to authenticated using (private.is_manager());

-- read models ---------------------------------------------------------------
grant select on public.task_board, public.routine_board, public.backlog_board to authenticated;

-- RPCs callable by signed-in users (each checks permissions itself) ----------
grant execute on function
  public.task_flag(public.task_status, date, timestamptz),
  public.session_status(),
  public.verify_pin(text),
  public.end_session(),
  public.change_my_pin(text, text),
  public.admin_set_pin(uuid, text),
  public.admin_link_login(uuid, uuid, text),
  public.admin_unlink_login(uuid),
  public.team_overview(),
  public.manager_dashboard(),
  public.my_summary(),
  public.refresh_backlog_suggestion(uuid),
  public.approve_backlog_item(uuid, uuid, text),
  public.reject_backlog_item(uuid, text),
  public.complete_routine(uuid, date, text),
  public.resolve_data_issue(uuid, public.issue_status, text)
to authenticated;

-- Server-only (service role) functions.
grant execute on function
  public.service_bootstrap_admin(uuid, uuid, text, text),
  public.service_login_gate(text, text),
  public.service_record_login(text, text, boolean),
  public.service_resolve_login(text)
to service_role;
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
-- PIN-only sign-in: username + 3-digit PIN, no password.
-- Supabase Auth still issues the session (the server mints it with a one-time magic-link token after the
-- PIN checks out), so RLS, verified_sessions and deactivation work exactly as before.
-- Because the PIN is now the only secret, five wrong PINs lock the account until an admin resets the PIN.

-- Sign-in check, called by the server with the service role before any session exists.
create or replace function public.service_pin_login(p_identifier text, p_pin text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_member uuid;
  v_email text;
  v_pin public.member_pins;
  c_max_attempts constant int := 5;
begin
  select m.id, u.email::text into v_member, v_email
  from public.members m join auth.users u on u.id = m.user_id
  where m.is_active and (m.username = lower(p_identifier) or lower(u.email) = lower(p_identifier))
  limit 1;
  if v_member is not null then
    select * into v_pin from public.member_pins where member_id = v_member for update;
  end if;
  if v_pin.member_id is null then
    -- Same bcrypt cost as a real check, so an unknown username can't be told apart by timing.
    perform extensions.crypt(coalesce(p_pin, ''), extensions.gen_salt('bf', 10));
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;
  if v_pin.locked_until is not null and v_pin.locked_until > now() then
    return jsonb_build_object('ok', false, 'error', 'locked');
  end if;
  if p_pin ~ '^[0-9]{3}$' and extensions.crypt(p_pin, v_pin.pin_hash) = v_pin.pin_hash then
    update public.member_pins set failed_attempts = 0, locked_until = null where member_id = v_member;
    return jsonb_build_object('ok', true, 'email', v_email);
  end if;

  if v_pin.failed_attempts + 1 >= c_max_attempts then
    update public.member_pins set failed_attempts = 0, locked_until = 'infinity' where member_id = v_member;
    insert into public.audit_events (entity, entity_id, action) values ('member', v_member, 'pin_locked');
    return jsonb_build_object('ok', false, 'error', 'locked');
  end if;
  update public.member_pins set failed_attempts = failed_attempts + 1 where member_id = v_member;
  insert into public.audit_events (entity, entity_id, action) values ('member', v_member, 'pin_failed');
  return jsonb_build_object('ok', false, 'error', 'invalid');
end $$;

-- The 12-hour PIN re-check now uses the same lock: five wrong PINs lock until an admin resets the PIN.
create or replace function public.verify_pin(p_pin text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_member uuid := private.member_for_user();
  v_session uuid := private.jwt_session_id();
  v_pin public.member_pins;
  c_max_attempts constant int := 5;
  c_session_ttl constant interval := interval '12 hours';
begin
  if auth.uid() is null or v_session is null or v_member is null then
    return jsonb_build_object('ok', false, 'error', 'not_allowed');
  end if;
  select * into v_pin from public.member_pins where member_id = v_member for update;
  if v_pin.member_id is null then
    return jsonb_build_object('ok', false, 'error', 'no_pin');
  end if;
  if v_pin.locked_until is not null and v_pin.locked_until > now() then
    return jsonb_build_object('ok', false, 'error', 'locked');
  end if;
  if p_pin is not null and p_pin ~ '^[0-9]{3}$' and extensions.crypt(p_pin, v_pin.pin_hash) = v_pin.pin_hash then
    update public.member_pins set failed_attempts = 0, locked_until = null where member_id = v_member;
    insert into public.verified_sessions (session_id, user_id, member_id, verified_at, expires_at)
    values (v_session, auth.uid(), v_member, now(), now() + c_session_ttl)
    on conflict (session_id) do update set verified_at = now(), expires_at = excluded.expires_at
      where public.verified_sessions.user_id = auth.uid();
    perform private.audit('member', v_member, 'pin_verified', '{}'::jsonb);
    return jsonb_build_object('ok', true);
  end if;

  if v_pin.failed_attempts + 1 >= c_max_attempts then
    update public.member_pins set failed_attempts = 0, locked_until = 'infinity' where member_id = v_member;
    perform private.audit('member', v_member, 'pin_locked', '{}'::jsonb);
    return jsonb_build_object('ok', false, 'error', 'locked');
  end if;
  update public.member_pins set failed_attempts = failed_attempts + 1 where member_id = v_member;
  perform private.audit('member', v_member, 'pin_failed', '{}'::jsonb);
  return jsonb_build_object('ok', false, 'error', 'wrong_pin', 'remaining', c_max_attempts - v_pin.failed_attempts - 1);
end $$;

-- Lets the admin see on the Team page that someone is locked out (reset PIN clears it).
create or replace function public.admin_pin_locked(p_member uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  return exists (select 1 from public.member_pins where member_id = p_member and locked_until > now());
end $$;

revoke execute on function public.service_pin_login(text, text), public.admin_pin_locked(uuid) from public, anon, authenticated;
grant execute on function public.service_pin_login(text, text) to service_role;
grant execute on function public.admin_pin_locked(uuid) to authenticated;
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
