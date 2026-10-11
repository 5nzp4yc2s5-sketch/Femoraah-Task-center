-- OpsPulse Workspace: missing features from the "Complete Missing Features" spec.
--   * Team calendar: company holidays and leave (with a backup person), used for availability.
--   * No supervisor visibility: "reports to" no longer grants access (there is no delegation chain).
--   * Tasks: TSK-### ids, Critical priority, To Do / Active / Blocked / Done, a required blocker
--     reason with the time it became blocked, an "important" flag, an explicit Delegated By, and a
--     change history for due dates, blockers, priority, title and delegator.
--   * Routines: RTN-### ids, an optional backup person who covers while the owner is on leave,
--     Monthly = every 30 days, statuses OK / Due Today / Overdue / Not Logged.
--   * Backlog: BCK-### ids, Pending / Approved / Converted to Task / Dismissed, leave-aware suggestions.
--   * Workload: capacity status (Available / At Capacity / Overloaded / On Leave) and dashboard filters.

-- ===========================================================================
-- Team calendar
-- ===========================================================================
create table public.holidays (
  id uuid primary key default gen_random_uuid(),
  holiday_date date not null unique,
  name text not null check (length(btrim(name)) between 1 and 120),
  note text not null default '' check (length(note) <= 500),
  created_by uuid references public.members (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.leaves (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members (id) on delete cascade,
  leave_type public.leave_type not null default 'Annual Leave',
  start_date date not null,
  end_date date not null,
  backup_member_id uuid references public.members (id) on delete set null,
  -- Holiday Swap: the public holiday this person worked, which becomes a normal working day for them.
  swap_for_date date,
  note text not null default '' check (length(note) <= 500),
  created_by uuid references public.members (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date and end_date - start_date <= 366),
  check (backup_member_id is null or backup_member_id <> member_id),
  check (swap_for_date is null or leave_type = 'Holiday Swap')
);
create index leaves_member_dates on public.leaves (member_id, start_date, end_date);

create or replace function private.is_on_leave(p_member uuid, p_date date)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.leaves l where l.member_id = p_member and p_date between l.start_date and l.end_date)
$$;

create or replace function private.leave_until(p_member uuid, p_date date)
returns date language sql stable security definer set search_path = '' as $$
  select max(l.end_date) from public.leaves l where l.member_id = p_member and p_date between l.start_date and l.end_date
$$;

-- A company holiday applies to everyone except a person who swapped it (worked it and took another day).
create or replace function private.holiday_for(p_member uuid, p_date date)
returns text language sql stable security definer set search_path = '' as $$
  select h.name from public.holidays h
  where h.holiday_date = p_date
    and not exists (select 1 from public.leaves l where l.member_id = p_member and l.swap_for_date = p_date)
$$;

create or replace function private.leaves_guard()
returns trigger language plpgsql set search_path = '' as $$
declare v_me uuid := private.me();
begin
  if private.is_api_caller() then
    if v_me is null then raise exception 'Not signed in' using errcode = '42501'; end if;
    if tg_op in ('UPDATE', 'DELETE') and not private.is_manager() then
      if old.member_id <> v_me then
        raise exception 'Only a manager can change someone else''s leave' using errcode = '42501';
      end if;
      if old.start_date < private.today() then
        raise exception 'Leave that has already started can only be changed by a manager' using errcode = '42501';
      end if;
    end if;
    if tg_op = 'DELETE' then return old; end if;
    if not private.is_manager() then
      if new.member_id <> v_me then
        raise exception 'You can only add leave for yourself' using errcode = '42501';
      end if;
      if new.start_date < private.today() then
        raise exception 'Past leave can only be recorded by a manager' using errcode = '42501';
      end if;
    end if;
    new.created_by := case when tg_op = 'INSERT' then v_me else old.created_by end;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  perform private.assert_active_member(new.member_id, 'Employee');
  if new.backup_member_id is not null then
    perform private.assert_active_member(new.backup_member_id, 'Backup');
  end if;
  if exists (select 1 from public.leaves l
             where l.member_id = new.member_id and l.id <> new.id
               and l.start_date <= new.end_date and l.end_date >= new.start_date) then
    raise exception 'This leave overlaps another leave for the same person' using errcode = '23P01';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger leaves_guard before insert or update or delete on public.leaves
  for each row execute function private.leaves_guard();

create or replace function private.calendar_after()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'leaves' then
    perform private.audit('leave', coalesce(new.id, old.id), lower(tg_op), jsonb_build_object(
      'member', coalesce(new.member_id, old.member_id), 'type', coalesce(new.leave_type, old.leave_type),
      'from', coalesce(new.start_date, old.start_date), 'to', coalesce(new.end_date, old.end_date),
      'backup', coalesce(new.backup_member_id, old.backup_member_id)));
  else
    perform private.audit('holiday', coalesce(new.id, old.id), lower(tg_op), jsonb_build_object(
      'date', coalesce(new.holiday_date, old.holiday_date), 'name', coalesce(new.name, old.name)));
  end if;
  return null;
end $$;
create trigger leaves_after after insert or update or delete on public.leaves
  for each row execute function private.calendar_after();

create or replace function private.holidays_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if private.is_api_caller() then
    if not private.is_manager() then
      raise exception 'Only a manager can change company holidays' using errcode = '42501';
    end if;
    -- Past holidays shape attendance history, so only an admin may change them.
    if not private.is_admin() and (
         (tg_op <> 'INSERT' and old.holiday_date < private.today())
      or (tg_op <> 'DELETE' and new.holiday_date < private.today())) then
      raise exception 'Only an admin can change holidays in the past' using errcode = '42501';
    end if;
    if tg_op = 'INSERT' then new.created_by := private.me(); end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  new.name := btrim(new.name);
  new.updated_at := now();
  return new;
end $$;
create trigger holidays_guard before insert or update or delete on public.holidays
  for each row execute function private.holidays_guard();
create trigger holidays_after after insert or update or delete on public.holidays
  for each row execute function private.calendar_after();

-- Everyone sees who is away and when (that is the point of a team calendar). The leave type and
-- note are only shown to managers, the person and their backup.
create or replace function public.team_calendar(p_from date, p_to date)
returns table (kind text, id uuid, member_id uuid, member_name text, start_date date, end_date date,
               label text, backup_member_id uuid, backup_name text, note text, can_edit boolean)
language plpgsql stable security definer set search_path = '' as $$
declare v_me uuid := private.me(); v_mgr boolean := private.is_manager();
begin
  if v_me is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  if p_to < p_from or p_to - p_from > 400 then raise exception 'Choose a shorter date range' using errcode = '22023'; end if;
  return query
  select 'holiday'::text, h.id, null::uuid, null::text, h.holiday_date, h.holiday_date, h.name, null::uuid, null::text, h.note,
         v_mgr and (h.holiday_date >= private.today() or private.is_admin())
  from public.holidays h where h.holiday_date between p_from and p_to
  union all
  select 'leave'::text, l.id, l.member_id, m.name, l.start_date, l.end_date,
         case when v_mgr or v_me in (l.member_id, l.backup_member_id) then l.leave_type::text else 'Leave' end,
         l.backup_member_id, b.name,
         case when v_mgr or v_me in (l.member_id, l.backup_member_id) then l.note else '' end,
         v_mgr or (l.member_id = v_me and l.start_date >= private.today())
  from public.leaves l
  join public.members m on m.id = l.member_id
  left join public.members b on b.id = l.backup_member_id
  where l.start_date <= p_to and l.end_date >= p_from
  order by 5, 1, 4;
end $$;

-- ===========================================================================
-- No supervisor visibility ("we don't have delegation")
-- ===========================================================================
create or replace function private.can_view_task(p_task uuid, p_owner uuid, p_created_by uuid, p_assigned_by uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.me() is not null and (
    private.is_manager()
    or private.me() in (p_owner, p_created_by, p_assigned_by)
    or exists (select 1 from public.task_collaborators c where c.task_id = p_task and c.member_id = private.me())
  )
$$;

create or replace function private.can_view_routine(p_owner uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.me() is not null and (private.is_manager() or private.me() = p_owner)
$$;

update public.members set reports_to = null where reports_to is not null;
update public.members set role_title = 'Packing' where name = 'Dev' and role_title = 'Packing (reports to Sanket)';
update public.members set expertise = 'Packing' where name = 'Dev' and expertise = 'Packing, plus tasks assigned by Sanket';
update public.members set expertise = replace(expertise, ' Assigns Dev''s work.', '')
 where name = 'Sanket' and expertise like '% Assigns Dev''s work.';
revoke insert (reports_to), update (reports_to) on public.members from authenticated;

-- ===========================================================================
-- Tasks
-- ===========================================================================
alter table public.tasks
  add column blocker_reason text not null default '' check (length(blocker_reason) <= 1000),
  add column blocked_at timestamptz,
  add column is_flagged boolean not null default false;

-- Any task already Blocked keeps its progress note as the blocker reason.
update public.tasks
   set blocker_reason = coalesce(nullif(btrim(progress_note), ''), 'Reason not recorded (blocked before blocker reasons were required)'),
       blocked_at = last_update_at
 where status = 'Blocked';

alter table public.tasks add constraint tasks_blocker_required
  check (status <> 'Blocked' or length(btrim(blocker_reason)) > 0);

-- Field-level history for changes that task_updates (status / % / note) and
-- task_assignments (owner) do not already record.
create table public.task_changes (
  id bigint generated always as identity primary key,
  task_id uuid not null references public.tasks (id) on delete cascade,
  changed_by uuid references public.members (id) on delete set null,
  field text not null,
  old_value text,
  new_value text,
  created_at timestamptz not null default now()
);
create index task_changes_task on public.task_changes (task_id, created_at desc);

create or replace function private.tasks_before()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_me uuid := private.me();
  v_meaningful boolean;
begin
  new.blocker_reason := btrim(coalesce(new.blocker_reason, ''));
  if tg_op = 'INSERT' then
    if private.is_api_caller() then
      if v_me is null then raise exception 'Not signed in' using errcode = '42501'; end if;
      new.created_by := v_me;
      new.assigned_by := coalesce(new.assigned_by, v_me);
      new.backlog_item_id := null;
      new.archived_at := null;
      new.archived_by := null;
    end if;
    perform private.assert_active_member(new.owner_id, 'Assigned to');
    perform private.assert_active_member(new.assigned_by, 'Delegated by');
    if new.status = 'Done' or new.percent_complete = 100 then
      new.status := 'Done'; new.percent_complete := 100; new.completed_at := now();
    end if;
    if new.status = 'Blocked' then
      if new.blocker_reason = '' then raise exception 'A blocked task needs a blocker reason' using errcode = '23514'; end if;
      new.blocked_at := now();
    else
      new.blocker_reason := ''; new.blocked_at := null;
    end if;
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
        raise exception 'You can only update status, %% complete, the progress note, the blocker and the flag on this task' using errcode = '42501';
      end if;
    end if;
    if new.archived_at is distinct from old.archived_at and not private.is_manager()
       and not (v_me = old.created_by) then
      raise exception 'Only the task creator or a manager can archive a task' using errcode = '42501';
    end if;
    new.archived_by := case when new.archived_at is not null and old.archived_at is null then v_me
                            when new.archived_at is null then null else old.archived_by end;
    new.completed_at := old.completed_at;
    new.last_update_at := old.last_update_at;
    new.blocked_at := old.blocked_at;
  end if;

  if new.owner_id is distinct from old.owner_id then
    perform private.assert_active_member(new.owner_id, 'Assigned to');
  end if;
  if new.assigned_by is distinct from old.assigned_by then
    perform private.assert_active_member(new.assigned_by, 'Delegated by');
  end if;

  -- Status and % complete stay consistent: Done is 100%, 100% is Done, reopening drops to 90%.
  if new.status = 'Done' and old.status <> 'Done' then
    new.percent_complete := 100;
    new.completed_at := now();
  elsif new.status <> 'Done' and old.status = 'Done' then
    new.completed_at := null;
    if new.percent_complete = 100 then new.percent_complete := 90; end if;
  elsif new.status <> 'Done' and new.percent_complete = 100 then
    new.status := 'Done';
    new.completed_at := now();
  elsif new.status = 'Done' then
    new.percent_complete := 100;
  end if;

  if new.status = 'Blocked' then
    if new.blocker_reason = '' then raise exception 'A blocked task needs a blocker reason' using errcode = '23514'; end if;
    if old.status <> 'Blocked' or new.blocked_at is null then new.blocked_at := now(); end if;
  else
    new.blocker_reason := '';
    new.blocked_at := null;
  end if;

  v_meaningful := new.title is distinct from old.title or new.details is distinct from old.details
    or new.owner_id is distinct from old.owner_id or new.assigned_by is distinct from old.assigned_by
    or new.priority is distinct from old.priority
    or new.status is distinct from old.status or new.start_date is distinct from old.start_date
    or new.due_date is distinct from old.due_date or new.percent_complete is distinct from old.percent_complete
    or new.progress_note is distinct from old.progress_note or new.blocker_reason is distinct from old.blocker_reason;
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
    if new.blocker_reason <> '' then
      insert into public.task_changes (task_id, changed_by, field, old_value, new_value)
      values (new.id, v_actor, 'blocker', null, new.blocker_reason);
    end if;
    if new.is_flagged then
      insert into public.task_changes (task_id, changed_by, field, old_value, new_value)
      values (new.id, v_actor, 'flagged', 'false', 'true');
    end if;
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
  insert into public.task_changes (task_id, changed_by, field, old_value, new_value)
  select new.id, v_actor, v.f, v.o, v.n
  from (values
    ('due_date', old.due_date::text, new.due_date::text),
    ('start_date', old.start_date::text, new.start_date::text),
    ('priority', old.priority::text, new.priority::text),
    ('title', old.title, new.title),
    ('delegated_by', (select m.name from public.members m where m.id = old.assigned_by),
                     (select m.name from public.members m where m.id = new.assigned_by)),
    ('blocker', nullif(old.blocker_reason, ''), nullif(new.blocker_reason, '')),
    ('flagged', old.is_flagged::text, new.is_flagged::text),
    ('details', left(old.details, 300), left(new.details, 300))
  ) as v(f, o, n)
  where v.o is distinct from v.n and not (v.f = 'delegated_by' and old.assigned_by is not distinct from new.assigned_by);
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

-- Flags, in this precedence:
--   Done > Overdue > Blocked > Due soon (3 days) > Stale (no update 3+ days) > Due in 7 days > On track.
create or replace function public.task_flag(p_status public.task_status, p_due date, p_last_update timestamptz)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when p_status = 'Done' then 'Done'
    when p_due is not null and p_due < private.today() then 'Overdue'
    when p_status = 'Blocked' then 'Blocked'
    when p_due is not null and p_due <= private.today() + (select due_soon_days from public.app_settings limit 1) then 'Due soon'
    when private.today() - private.local_date(p_last_update) >= (select stale_after_days from public.app_settings limit 1) then 'Stale'
    when p_due is not null and p_due <= private.today() + 7 then 'Due in 7 days'
    else 'On track'
  end
$$;

create or replace view public.task_board with (security_invoker = true) as
select
  t.id, t.task_no, 'TSK-' || lpad(t.task_no::text, 3, '0') as task_code,
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
     >= (select stale_after_days from public.app_settings limit 1)) as is_stale,
  t.blocker_reason, t.blocked_at, t.is_flagged, t.updated_at,
  (private.today() - private.local_date(t.last_update_at)) as days_since_update
from public.tasks t
left join public.members o on o.id = t.owner_id
left join public.members a on a.id = t.assigned_by
left join public.members c on c.id = t.created_by;

-- One activity feed over the three history tables (row access follows the task).
create or replace view public.task_activity with (security_invoker = true) as
select x.task_id, t.task_no, 'TSK-' || lpad(t.task_no::text, 3, '0') as task_code, t.title,
       t.owner_id, t.assigned_by, t.created_by, x.at, x.actor_id, act.name as actor_name, x.kind, x.summary
from (
  select u.task_id, u.created_at as at, u.author_id as actor_id, 'progress'::text as kind,
         u.status::text || ' · ' || u.percent_complete || '%'
           || case when u.note <> '' then ' · “' || u.note || '”' else '' end as summary
  from public.task_updates u
  union all
  select g.task_id, g.created_at, g.changed_by, 'assignment',
         case when g.from_owner_id is null
              then coalesce(g.reason, 'Assigned') || ' → assigned to ' || coalesce(n2.name, 'a former member')
              else 'Reassigned from ' || coalesce(n1.name, 'a former member') || ' to ' || coalesce(n2.name, 'a former member') end
  from public.task_assignments g
  left join public.members n1 on n1.id = g.from_owner_id
  left join public.members n2 on n2.id = g.to_owner_id
  union all
  select c.task_id, c.created_at, c.changed_by, c.field,
         case c.field
           when 'due_date' then 'Due date ' || coalesce(to_char(c.old_value::date, 'DD-Mon-YY'), 'none') || ' → ' || coalesce(to_char(c.new_value::date, 'DD-Mon-YY'), 'none')
           when 'start_date' then 'Start date ' || coalesce(to_char(c.old_value::date, 'DD-Mon-YY'), 'none') || ' → ' || coalesce(to_char(c.new_value::date, 'DD-Mon-YY'), 'none')
           when 'priority' then 'Priority ' || c.old_value || ' → ' || c.new_value
           when 'title' then 'Renamed from “' || c.old_value || '”'
           when 'delegated_by' then 'Delegated by ' || coalesce(c.old_value, 'nobody') || ' → ' || coalesce(c.new_value, 'nobody')
           when 'blocker' then case when c.new_value is null then 'Blocker cleared' || coalesce(' (was “' || c.old_value || '”)', '')
                                    when c.old_value is null then 'Blocked: “' || c.new_value || '”'
                                    else 'Blocker updated: “' || c.new_value || '”' end
           when 'flagged' then case when c.new_value = 'true' then 'Flagged as important' else 'Important flag removed' end
           when 'details' then 'Description edited'
           else c.field || ' changed'
         end
  from public.task_changes c
) x
join public.tasks t on t.id = x.task_id
left join public.members act on act.id = x.actor_id;

-- ===========================================================================
-- Routines
-- ===========================================================================
alter table public.routines
  add column routine_no int generated always as identity,
  add column backup_member_id uuid references public.members (id) on delete set null;
alter table public.routines add constraint routines_backup_not_owner
  check (backup_member_id is null or backup_member_id <> owner_id);
create unique index routines_no_uq on public.routines (routine_no);

alter table public.routine_completions
  add column covering_for uuid references public.members (id) on delete set null;

create or replace function private.routines_before()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' and private.is_api_caller() then new.created_by := private.me(); end if;
  if tg_op = 'UPDATE' and new.created_by is distinct from old.created_by then new.created_by := old.created_by; end if;
  perform private.assert_active_member(new.owner_id, 'Owner');
  if new.backup_member_id is not null and (tg_op = 'INSERT' or new.backup_member_id is distinct from old.backup_member_id) then
    perform private.assert_active_member(new.backup_member_id, 'Backup');
  end if;
  if new.frequency = 'Daily' then new.every_n_days := 1;
  elsif new.frequency = 'Weekly' then new.every_n_days := 7;
  elsif new.frequency = 'Monthly' then new.every_n_days := 30;
  end if;
  new.updated_at := now();
  return new;
end $$;

-- Who covers a routine today: only while the owner is on leave. The routine's own backup comes
-- first, then the backup named on the leave. Ownership never changes.
create or replace function private.routine_cover(p_owner uuid, p_backup uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select c.id from (
    select coalesce(p_backup, l.backup_member_id) as id
    from public.leaves l
    where l.member_id = p_owner and private.today() between l.start_date and l.end_date
    order by l.created_at limit 1
  ) x join public.members c on c.id = x.id and c.is_active
$$;

create or replace function private.can_view_routine_row(p_owner uuid, p_backup uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(private.me() is not null and (
    private.is_manager()
    or private.me() = p_owner
    or private.me() = p_backup
    or private.me() = private.routine_cover(p_owner, p_backup)
  ), false)
$$;

create or replace view public.routine_board with (security_invoker = true) as
with last as (
  select rc.routine_id, max(rc.completed_on) as last_done, count(*) as times_done,
         (array_agg(rc.created_at order by rc.completed_on desc, rc.created_at desc))[1] as last_completed_at,
         bool_or(rc.completed_on = private.today()) as done_today
  from public.routine_completions rc group by rc.routine_id
)
select
  r.id, r.title, r.owner_id, m.name as owner_name, r.frequency, r.every_n_days, r.notes, r.is_active,
  l.last_done, coalesce(l.times_done, 0) as times_done,
  (l.last_done + r.every_n_days) as next_due,
  case
    when not r.is_active then 'Paused'
    when l.last_done is null then 'Not Logged'
    when l.last_done + r.every_n_days < private.today() then 'Overdue'
    when l.last_done + r.every_n_days = private.today() then 'Due Today'
    else 'OK'
  end as status,
  r.routine_no, 'RTN-' || lpad(r.routine_no::text, 3, '0') as routine_code,
  r.backup_member_id, bk.name as backup_name,
  private.is_on_leave(r.owner_id, private.today()) as owner_on_leave,
  cv.cover_id as covered_by_id, cm.name as covered_by_name,
  l.last_completed_at, coalesce(l.done_today, false) as done_today
from public.routines r
left join public.members m on m.id = r.owner_id
left join public.members bk on bk.id = r.backup_member_id
left join last l on l.routine_id = r.id
left join lateral (select private.routine_cover(r.owner_id, r.backup_member_id) as cover_id) cv on true
left join public.members cm on cm.id = cv.cover_id;

create or replace function public.complete_routine(p_routine uuid, p_done_on date default null, p_note text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.routines;
  v_me uuid := private.me();
  v_done date := coalesce(p_done_on, private.today());
  v_last date;
  v_cycle date;
  v_cover uuid;
begin
  if v_me is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  select * into r from public.routines where id = p_routine for update;
  if r.id is null or not private.can_view_routine_row(r.owner_id, r.backup_member_id) then
    raise exception 'Routine not found' using errcode = 'P0002';
  end if;
  v_cover := private.routine_cover(r.owner_id, r.backup_member_id);
  if not (r.owner_id = v_me or private.is_manager() or coalesce(v_cover = v_me, false)) then
    raise exception 'Only the owner, the person covering, or a manager can tick off this routine' using errcode = '42501';
  end if;
  if not r.is_active then raise exception 'This routine is paused' using errcode = '23514'; end if;
  if v_done > private.today() or v_done < private.today() - 30 then
    raise exception 'Done date must be today or within the last 30 days' using errcode = '22023';
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

  insert into public.routine_completions (routine_id, cycle_due, completed_on, completed_by, note, covering_for)
  values (r.id, v_cycle, v_done, v_me, coalesce(p_note, ''),
          case when v_me <> r.owner_id and coalesce(v_cover = v_me, false) then r.owner_id end)
  on conflict do nothing;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'already_done', 'last_done', v_last);
  end if;
  return jsonb_build_object('ok', true, 'last_done', v_done, 'next_due', v_done + r.every_n_days, 'completed_at', now());
end $$;

-- ===========================================================================
-- Backlog
-- ===========================================================================
alter table public.backlog_items
  add column converted_by uuid references public.members (id) on delete set null,
  add column converted_at timestamptz,
  add column override_leave boolean not null default false;
update public.backlog_items set converted_by = decided_by, converted_at = decided_at where status = 'Converted to Task';
alter table public.backlog_items add constraint backlog_approved_shape
  check (status <> 'Approved' or (approval = 'Yes' and final_owner_id is not null and task_id is null));

create or replace function private.backlog_before()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if private.is_api_caller() then
      if private.me() is null then raise exception 'Not signed in' using errcode = '42501'; end if;
      new.requested_by := private.me();
      new.approval := 'Pending';
      new.status := 'Pending';
      new.decided_by := null; new.decided_at := null; new.final_owner_id := null;
      new.overrode_suggestion := null; new.decision_note := null; new.task_id := null;
      new.suggested_owner_id := null; new.suggestion_reason := null; new.suggestion_score := null;
      new.suggestion_candidates := '[]'::jsonb; new.suggested_at := null;
      new.converted_by := null; new.converted_at := null; new.override_leave := false;
    end if;
    new.date_added := private.today();
    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;

  if private.is_api_caller() then
    if old.status <> 'Pending' then
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
       or new.converted_by is distinct from old.converted_by or new.converted_at is distinct from old.converted_at
       or new.override_leave is distinct from old.override_leave
       or new.requested_by is distinct from old.requested_by or new.date_added is distinct from old.date_added then
      raise exception 'Approval and suggestion fields can only change through the approval workflow' using errcode = '42501';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

-- Recommendation (rule-based, no AI):
--   skill   = average over the comma-separated "Skills Needed" phrases of the share of each
--             phrase's keywords found in the person's Expertise and Role (prefix match on word stems).
--   load    = (open + overdue + 0.5 * blocked) / max open tasks
--   score   = 0.7 * skill + 0.3 * max(0, 1 - load)
-- Eligible: active, not on leave today, and below capacity. People on leave are listed but never
-- suggested; a manager can still choose them by overriding.
create or replace function private.compute_suggestion(p_item uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  b public.backlog_items;
  v_phrases text[];
  v_best jsonb;
  v_candidates jsonb;
  v_any_skill boolean;
  v_reason text;
  v_alts text;
  v_blocked_best jsonb;
  v_away text;
begin
  select * into b from public.backlog_items where id = p_item;
  if b.id is null or b.status <> 'Pending' then return; end if;

  select coalesce(array_agg(btrim(p)), '{}') into v_phrases
  from regexp_split_to_table(b.skills_needed, '\s*(,|;|/|\n|\s&\s|\sand\s)\s*') p
  where btrim(p) <> '' and cardinality(private.keywords(p)) > 0;

  with people as (
    select m.id, m.name, m.max_open_tasks, m.accepts_unmatched, private.keywords(m.expertise || ' ' || m.role_title) as words,
           w.open_tasks, w.overdue, w.blocked, private.is_on_leave(m.id, private.today()) as on_leave
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
           s.open_tasks < s.max_open_tasks as has_capacity,
           s.open_tasks < s.max_open_tasks and not s.on_leave as eligible
    from scored s
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'member_id', r.id, 'name', r.name, 'score', r.score, 'skill', round(r.skill, 3),
      'matched', to_jsonb(r.matched), 'open', r.open_tasks, 'overdue', r.overdue, 'blocked', r.blocked,
      'max', r.max_open_tasks, 'has_capacity', r.has_capacity, 'on_leave', r.on_leave,
      'eligible', r.eligible, 'fallback', r.accepts_unmatched)
      order by r.eligible desc, (r.skill > 0) desc, r.score desc, r.overdue, r.open_tasks, r.name), '[]'::jsonb),
    bool_or(r.skill > 0 and r.eligible),
    string_agg(case when r.on_leave then r.name end, ', ' order by r.name)
  into v_candidates, v_any_skill, v_away
  from ranked r;

  if not coalesce(v_any_skill, false) then
    -- Nobody available matches: prefer fallback owners, then the lightest workload.
    select coalesce(jsonb_agg(c order by (c->>'eligible')::boolean desc, (c->>'fallback')::boolean desc,
                                         (c->>'open')::int, c->>'name'), '[]'::jsonb)
      into v_candidates from jsonb_array_elements(v_candidates) c;
  end if;

  v_best := v_candidates -> 0;
  select c into v_blocked_best from jsonb_array_elements(v_candidates) c
   where not (c->>'eligible')::boolean and (c->>'skill')::numeric > coalesce((v_best->>'skill')::numeric, 0)
   order by (c->>'skill')::numeric desc limit 1;

  if v_best is null or not (v_best->>'eligible')::boolean then
    v_reason := 'Nobody is available with spare capacity right now. Manager to choose an owner.';
    v_best := null;
  elsif v_any_skill then
    v_reason := format('%s: matches %s of %s skill(s)%s; %s of %s open-task slots used; %s; %s. Score %s.',
      v_best->>'name',
      jsonb_array_length(v_best->'matched'), coalesce(array_length(v_phrases, 1), 0),
      case when jsonb_array_length(v_best->'matched') > 0
           then ' (' || (select string_agg(x, ', ') from jsonb_array_elements_text(v_best->'matched') x) || ')' else '' end,
      v_best->>'open', v_best->>'max',
      case when (v_best->>'overdue')::int = 0 then 'no overdue tasks' else (v_best->>'overdue') || ' overdue' end,
      case when (v_best->>'blocked')::int = 0 then 'nothing blocked' else (v_best->>'blocked') || ' blocked' end,
      v_best->>'score');
  else
    v_reason := format('No available person''s skills match "%s". %s%s has the most room: %s of %s open-task slots used, %s overdue.',
      b.skills_needed, v_best->>'name',
      case when (v_best->>'fallback')::boolean then ' (handles anything not covered by others)' else '' end,
      v_best->>'open', v_best->>'max', v_best->>'overdue');
  end if;

  if v_best is not null then
    select string_agg(format('%s (score %s)', c->>'name', c->>'score'), ', ')
      into v_alts
      from (select c from jsonb_array_elements(v_candidates) c
             where (c->>'eligible')::boolean and c->>'member_id' <> v_best->>'member_id' limit 2) s;
    if v_alts is not null then v_reason := v_reason || ' Alternatives: ' || v_alts || '.'; end if;
  end if;
  if v_blocked_best is not null then
    v_reason := v_reason || format(' %s matches more skills but is %s.',
      v_blocked_best->>'name',
      case when (v_blocked_best->>'on_leave')::boolean then 'on leave today'
           else format('at capacity (%s/%s)', v_blocked_best->>'open', v_blocked_best->>'max') end);
  end if;
  if v_away is not null then
    v_reason := v_reason || ' On leave today, not suggested: ' || v_away || '.';
  end if;

  update public.backlog_items set
    suggested_owner_id = (v_best->>'member_id')::uuid,
    suggestion_score = (v_best->>'score')::numeric,
    suggestion_reason = v_reason,
    suggestion_candidates = (select coalesce(jsonb_agg(c), '[]'::jsonb) from (select c from jsonb_array_elements(v_candidates) c limit 6) s),
    suggested_at = now()
  where id = p_item;
end $$;

create or replace function private.backlog_after()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform private.audit('backlog', new.id, 'submitted', jsonb_build_object('title', new.title));
    perform private.compute_suggestion(new.id);
  elsif new.status = 'Pending' and (new.skills_needed is distinct from old.skills_needed) then
    perform private.compute_suggestion(new.id);
  end if;
  return null;
end $$;

-- Creates exactly one task for an approved item (status To Do, delegated by the approver).
create or replace function private.convert_backlog(p_item uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  b public.backlog_items;
  v_task uuid;
begin
  select * into b from public.backlog_items where id = p_item for update;
  if b.task_id is not null then return b.task_id; end if;
  if b.status <> 'Approved' then raise exception 'Approve this backlog item first' using errcode = '23514'; end if;
  perform private.assert_active_member(b.final_owner_id, 'Assigned to');

  insert into public.tasks (title, details, owner_id, assigned_by, created_by, priority, status, start_date, due_date, backlog_item_id, progress_note)
  values (b.title,
          b.details || case when b.details = '' then '' else E'\n\n' end || 'Skills needed: ' || b.skills_needed,
          b.final_owner_id, coalesce(b.decided_by, private.me()), b.requested_by, b.priority, 'To Do',
          least(private.today(), b.due_date), b.due_date, b.id, '')
  returning id into v_task;

  update public.backlog_items set status = 'Converted to Task', task_id = v_task,
    converted_by = private.me(), converted_at = now()
  where id = p_item;
  perform private.audit('backlog', p_item, 'converted', jsonb_build_object('task_id', v_task, 'owner', b.final_owner_id));
  return v_task;
end $$;

drop function if exists public.approve_backlog_item(uuid, uuid, text);
-- Approve the owner (and by default convert to a task in the same transaction).
-- Repeating the call returns the task created the first time.
create function public.approve_backlog_item(p_item uuid, p_owner uuid default null, p_note text default null,
                                            p_convert boolean default true, p_override_leave boolean default false)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  b public.backlog_items;
  v_owner uuid;
  v_me uuid := private.me();
  v_on_leave boolean;
begin
  if not private.is_manager() then
    raise exception 'Only a manager can approve backlog assignments' using errcode = '42501';
  end if;
  select * into b from public.backlog_items where id = p_item for update;
  if b.id is null then raise exception 'Backlog item not found' using errcode = 'P0002'; end if;
  if b.status = 'Converted to Task' then return b.task_id; end if;
  if b.status = 'Dismissed' then raise exception 'This backlog item was dismissed' using errcode = '23514'; end if;
  if b.status = 'Approved' then
    if p_convert then return private.convert_backlog(p_item); end if;
    return null;
  end if;

  v_owner := coalesce(p_owner, b.suggested_owner_id);
  if v_owner is null then raise exception 'Choose an owner before approving' using errcode = '23502'; end if;
  perform private.assert_active_member(v_owner, 'Owner');
  v_on_leave := private.is_on_leave(v_owner, private.today());
  if v_on_leave and not p_override_leave then
    raise exception '% is on leave today. Tick "Assign anyway" to override.', (select name from public.members where id = v_owner)
      using errcode = '23514';
  end if;

  update public.backlog_items set
    approval = 'Yes', status = 'Approved', decided_by = v_me, decided_at = now(),
    final_owner_id = v_owner, overrode_suggestion = (b.suggested_owner_id is distinct from v_owner),
    decision_note = nullif(btrim(coalesce(p_note, '')), ''), override_leave = v_on_leave
  where id = p_item;

  perform private.audit('backlog', p_item, 'approved', jsonb_build_object(
    'owner', v_owner, 'suggested', b.suggested_owner_id,
    'overrode', b.suggested_owner_id is distinct from v_owner, 'override_leave', v_on_leave, 'note', p_note));
  if p_convert then return private.convert_backlog(p_item); end if;
  return null;
end $$;

create or replace function public.convert_backlog_item(p_item uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare b public.backlog_items;
begin
  if not private.is_manager() then
    raise exception 'Only a manager can convert backlog items' using errcode = '42501';
  end if;
  select * into b from public.backlog_items where id = p_item;
  if b.id is null then raise exception 'Backlog item not found' using errcode = 'P0002'; end if;
  if b.status = 'Converted to Task' then return b.task_id; end if;
  return private.convert_backlog(p_item);
end $$;

create or replace function public.reject_backlog_item(p_item uuid, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare b public.backlog_items;
begin
  if not private.is_manager() then raise exception 'Only a manager can dismiss backlog items' using errcode = '42501'; end if;
  select * into b from public.backlog_items where id = p_item for update;
  if b.id is null then raise exception 'Backlog item not found' using errcode = 'P0002'; end if;
  if b.status = 'Dismissed' then return; end if;
  if b.status = 'Converted to Task' then raise exception 'Already converted to a task' using errcode = '23514'; end if;
  update public.backlog_items set approval = 'No', status = 'Dismissed', decided_by = private.me(), decided_at = now(),
    decision_note = nullif(btrim(coalesce(p_note, '')), '')
  where id = p_item;
  perform private.audit('backlog', p_item, 'dismissed', jsonb_build_object('note', p_note));
end $$;

drop view if exists public.backlog_board;
create view public.backlog_board with (security_invoker = true) as
select
  b.*, 'BCK-' || (100 + b.backlog_no)::text as backlog_code,
  rq.name as requested_by_name, so.name as suggested_owner_name,
  fo.name as final_owner_name, d.name as decided_by_name, cv.name as converted_by_name
from public.backlog_items b
left join public.members rq on rq.id = b.requested_by
left join public.members so on so.id = b.suggested_owner_id
left join public.members fo on fo.id = b.final_owner_id
left join public.members d on d.id = b.decided_by
left join public.members cv on cv.id = b.converted_by;

-- ===========================================================================
-- Workload, capacity and dashboards
-- ===========================================================================
create or replace function private.capacity_status(p_open int, p_max int, p_on_leave boolean)
returns text language sql immutable set search_path = '' as $$
  select case when p_on_leave then 'On Leave'
              when p_open < p_max then 'Available'
              when p_open = p_max then 'At Capacity'
              else 'Overloaded' end
$$;

drop function if exists public.team_overview();
drop function if exists public.manager_dashboard();
drop function if exists private.member_workload();

-- Workload: a task counts while it is not Done and not archived.
create function private.member_workload()
returns table (member_id uuid, open_tasks int, overdue int, blocked int, due_today int, due_next_7 int, stale int,
               routine_overdue int, routine_not_logged int, routine_due_today int, routine_ok int, routines_active int,
               on_leave boolean)
language sql stable security definer set search_path = '' as $$
  with rt as (
    select r.owner_id,
      count(*) filter (where l.last_done + r.every_n_days < private.today()) as overdue,
      count(*) filter (where l.last_done is null) as not_logged,
      count(*) filter (where l.last_done + r.every_n_days = private.today()) as due_today,
      count(*) filter (where l.last_done + r.every_n_days > private.today()) as ok,
      count(*) as active
    from public.routines r
    left join (select routine_id, max(completed_on) as last_done from public.routine_completions group by routine_id) l on l.routine_id = r.id
    where r.is_active
    group by r.owner_id
  )
  select m.id,
    count(t.id) filter (where t.status <> 'Done')::int,
    count(t.id) filter (where t.status <> 'Done' and t.due_date < private.today())::int,
    count(t.id) filter (where t.status = 'Blocked')::int,
    count(t.id) filter (where t.status <> 'Done' and t.due_date = private.today())::int,
    count(t.id) filter (where t.status <> 'Done' and t.due_date between private.today() and private.today() + 7)::int,
    count(t.id) filter (where t.status <> 'Done' and private.today() - private.local_date(t.last_update_at) >= (select stale_after_days from public.app_settings limit 1))::int,
    coalesce(max(rt.overdue), 0)::int, coalesce(max(rt.not_logged), 0)::int, coalesce(max(rt.due_today), 0)::int,
    coalesce(max(rt.ok), 0)::int, coalesce(max(rt.active), 0)::int,
    private.is_on_leave(m.id, private.today())
  from public.members m
  left join public.tasks t on t.owner_id = m.id and t.archived_at is null
  left join rt on rt.owner_id = m.id
  group by m.id
$$;

-- Team directory counts (no task details). Visible to every signed-in member, like the Team tab.
create function public.team_overview()
returns table (member_id uuid, name text, role_title text, expertise text, email text, max_open_tasks int,
               access_role public.access_role, is_active boolean, has_login boolean, username text,
               open_tasks int, overdue int, blocked int, has_capacity boolean,
               routine_overdue int, on_leave boolean, leave_until date, capacity_status text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if private.me() is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  return query
  select m.id, m.name, m.role_title, m.expertise, m.email, m.max_open_tasks, m.access_role, m.is_active,
         m.user_id is not null, case when private.is_admin() then m.username end,
         w.open_tasks, w.overdue, w.blocked, w.open_tasks < m.max_open_tasks,
         w.routine_overdue, w.on_leave, case when w.on_leave then private.leave_until(m.id, private.today()) end,
         private.capacity_status(w.open_tasks, m.max_open_tasks, w.on_leave)
  from public.members m join private.member_workload() w on w.member_id = m.id
  where m.is_active or private.is_manager()
  order by m.is_active desc, m.created_at;
end $$;

-- Manager KPIs with optional filters. Task figures honour employee, status, priority and a due-date
-- range; routine figures honour employee and frequency. Every number is a count of real rows.
create function public.manager_dashboard(p_member uuid default null, p_status text default null, p_priority text default null,
                                         p_from date default null, p_to date default null, p_frequency text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := private.today();
  v_stale int := (select stale_after_days from public.app_settings limit 1);
  v_tasks jsonb;
  v_routines jsonb;
  v_people jsonb;
  v_capacity jsonb;
begin
  if not private.is_manager() then raise exception 'Managers only' using errcode = '42501'; end if;

  with t as (
    select * from public.tasks
    where archived_at is null
      and (p_member is null or owner_id = p_member)
      and (p_status is null or status::text = p_status)
      and (p_priority is null or priority::text = p_priority)
      and (p_from is null or due_date >= p_from)
      and (p_to is null or due_date <= p_to)
  )
  select jsonb_build_object(
    'open', count(*) filter (where status <> 'Done'),
    'overdue', count(*) filter (where status <> 'Done' and due_date < v_today),
    'blocked', count(*) filter (where status = 'Blocked'),
    'due_today', count(*) filter (where status <> 'Done' and due_date = v_today),
    'due_next_7', count(*) filter (where status <> 'Done' and due_date between v_today and v_today + 7),
    'stale', count(*) filter (where status <> 'Done' and v_today - private.local_date(last_update_at) >= v_stale),
    'done_last_7', count(*) filter (where status = 'Done' and completed_at >= now() - interval '7 days'),
    'critical_open', count(*) filter (where status <> 'Done' and priority = 'Critical'),
    'flagged_open', count(*) filter (where status <> 'Done' and is_flagged)
  ) into v_tasks from t;

  with r as (
    select rb.* from public.routine_board rb
    where rb.is_active
      and (p_member is null or rb.owner_id = p_member)
      and (p_frequency is null or rb.frequency::text = p_frequency)
  )
  select jsonb_build_object(
    'active', count(*),
    'ok', count(*) filter (where status = 'OK'),
    'due_today', count(*) filter (where status = 'Due Today'),
    'overdue', count(*) filter (where status = 'Overdue'),
    'not_logged', count(*) filter (where status = 'Not Logged'),
    'done_today', count(*) filter (where done_today),
    'completion_rate', case when count(*) = 0 then null else round(100.0 * count(*) filter (where status = 'OK') / count(*)) end
  ) into v_routines from r;

  select jsonb_build_object(
      'open', coalesce(sum(w.open_tasks), 0),
      'max', coalesce(sum(m.max_open_tasks), 0),
      'utilization', case when coalesce(sum(m.max_open_tasks), 0) = 0 then null
                          else round(100.0 * sum(w.open_tasks) / sum(m.max_open_tasks)) end,
      'on_leave', count(*) filter (where w.on_leave),
      'overloaded', count(*) filter (where not w.on_leave and w.open_tasks > m.max_open_tasks),
      'at_capacity', count(*) filter (where not w.on_leave and w.open_tasks = m.max_open_tasks)),
    coalesce(jsonb_agg(jsonb_build_object(
        'member_id', m.id, 'name', m.name, 'role_title', m.role_title,
        'open', w.open_tasks, 'overdue', w.overdue, 'blocked', w.blocked, 'due_today', w.due_today,
        'due_next_7', w.due_next_7, 'stale', w.stale, 'routine_overdue', w.routine_overdue,
        'routine_not_logged', w.routine_not_logged,
        'max_open_tasks', m.max_open_tasks, 'has_capacity', w.open_tasks < m.max_open_tasks,
        'on_leave', w.on_leave, 'leave_until', case when w.on_leave then private.leave_until(m.id, v_today) end,
        'capacity_status', private.capacity_status(w.open_tasks, m.max_open_tasks, w.on_leave)
      ) order by m.created_at), '[]'::jsonb)
  into v_capacity, v_people
  from public.members m join private.member_workload() w on w.member_id = m.id
  where m.is_active and (p_member is null or m.id = p_member);

  return v_tasks || jsonb_build_object(
    'today', v_today,
    'unassigned_backlog', (select count(*) from public.backlog_items b
                            where b.status in ('Pending', 'Approved')
                              and (p_priority is null or b.priority::text = p_priority)
                              and (p_from is null or b.due_date >= p_from)
                              and (p_to is null or b.due_date <= p_to)),
    'routine_overdue', v_routines->'overdue',
    'routine_not_logged', v_routines->'not_logged',
    'routines', v_routines,
    'capacity', v_capacity,
    'open_data_issues', (select count(*) from public.data_issues where status = 'Open'),
    'people', v_people);
end $$;

create or replace function public.my_summary()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_me uuid := private.me(); v jsonb;
begin
  if v_me is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  select jsonb_build_object('today', private.today(), 'open', w.open_tasks, 'overdue', w.overdue, 'blocked', w.blocked,
    'due_today', w.due_today, 'due_next_7', w.due_next_7, 'stale', w.stale, 'routine_overdue', w.routine_overdue,
    'routine_not_logged', w.routine_not_logged, 'routine_due_today', w.routine_due_today, 'routine_ok', w.routine_ok,
    'routines_active', w.routines_active, 'max_open_tasks', m.max_open_tasks,
    'has_capacity', w.open_tasks < m.max_open_tasks, 'on_leave', w.on_leave,
    'capacity_status', private.capacity_status(w.open_tasks, m.max_open_tasks, w.on_leave),
    'covering', (select count(*) from public.routines r
                  where r.is_active and r.owner_id <> v_me and private.routine_cover(r.owner_id, r.backup_member_id) = v_me))
  into v from private.member_workload() w join public.members m on m.id = w.member_id where w.member_id = v_me;
  return v;
end $$;

-- ===========================================================================
-- Row level security and grants
-- ===========================================================================
alter table public.holidays enable row level security;
alter table public.leaves enable row level security;
alter table public.task_changes enable row level security;

grant select on public.holidays to authenticated;
grant insert (holiday_date, name, note), update (holiday_date, name, note), delete on public.holidays to authenticated;
create policy holidays_read on public.holidays for select to authenticated using (private.me() is not null);
create policy holidays_insert on public.holidays for insert to authenticated with check (private.is_manager());
create policy holidays_update on public.holidays for update to authenticated using (private.is_manager()) with check (private.is_manager());
create policy holidays_delete on public.holidays for delete to authenticated using (private.is_manager());

grant select, delete on public.leaves to authenticated;
grant insert (member_id, leave_type, start_date, end_date, backup_member_id, swap_for_date, note),
      update (member_id, leave_type, start_date, end_date, backup_member_id, swap_for_date, note)
  on public.leaves to authenticated;
create policy leaves_read on public.leaves for select to authenticated
  using (private.is_manager() or private.me() in (member_id, backup_member_id));
create policy leaves_insert on public.leaves for insert to authenticated
  with check (private.is_manager() or member_id = private.me());
create policy leaves_update on public.leaves for update to authenticated
  using (private.is_manager() or member_id = private.me()) with check (private.is_manager() or member_id = private.me());
create policy leaves_delete on public.leaves for delete to authenticated
  using (private.is_manager() or member_id = private.me());

grant select on public.task_changes to authenticated;
create policy task_changes_read on public.task_changes for select to authenticated
  using (exists (select 1 from public.tasks t where t.id = task_id));

grant insert (assigned_by, blocker_reason, is_flagged), update (assigned_by, blocker_reason, is_flagged)
  on public.tasks to authenticated;
drop policy tasks_insert on public.tasks;
create policy tasks_insert on public.tasks for insert to authenticated
  with check (private.me() is not null and created_by = private.me());

grant insert (backup_member_id), update (backup_member_id) on public.routines to authenticated;
drop policy routines_read on public.routines;
create policy routines_read on public.routines for select to authenticated
  using (private.can_view_routine_row(owner_id, backup_member_id));

grant select on public.task_activity, public.backlog_board to authenticated;

revoke execute on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated;

revoke execute on function
  public.team_calendar(date, date),
  public.team_overview(),
  public.manager_dashboard(uuid, text, text, date, date, text),
  public.approve_backlog_item(uuid, uuid, text, boolean, boolean),
  public.convert_backlog_item(uuid)
from public, anon;
grant execute on function
  public.team_calendar(date, date),
  public.team_overview(),
  public.manager_dashboard(uuid, text, text, date, date, text),
  public.my_summary(),
  public.approve_backlog_item(uuid, uuid, text, boolean, boolean),
  public.convert_backlog_item(uuid),
  public.reject_backlog_item(uuid, text),
  public.complete_routine(uuid, date, text),
  public.task_flag(public.task_status, date, timestamptz)
to authenticated;

-- ===========================================================================
-- Calendar entries that the spreadsheet kept as "routine" rows (see Data Review).
-- ===========================================================================
insert into public.holidays (holiday_date, name, note)
select date '2026-10-30', 'Diwali Public Holiday', 'From the Routine Tasks sheet: company observed public holiday (eligible for swap).'
where exists (select 1 from public.data_issues where source_file = 'Routine Tasks' and source_row = 42)
on conflict (holiday_date) do nothing;

insert into public.leaves (member_id, leave_type, start_date, end_date, backup_member_id, note)
select m.id, 'Annual Leave', date '2026-10-11', date '2026-10-11', b.id, 'From the Routine Tasks sheet ("Backup/Delegate: ' || b.name || '").'
from (values ('Dev', 'Zinia', 41), ('Zinia', 'Sanket', 44)) v(who, backup, src)
join public.members m on m.name = v.who and m.is_active
join public.members b on b.name = v.backup and b.is_active
where exists (select 1 from public.data_issues d where d.source_file = 'Routine Tasks' and d.source_row = v.src)
  and not exists (select 1 from public.leaves l where l.member_id = m.id and date '2026-10-11' between l.start_date and l.end_date);

insert into public.leaves (member_id, leave_type, start_date, end_date, note)
select m.id, 'Holiday Swap', date '2026-10-20', date '2026-10-20',
       'From the Routine Tasks sheet: "Original: 2026-10-25 → Swapped to: 2026-10-20. Worked on public holiday." The original date does not match the Diwali row (30-Oct-26); confirm it in Data Review.'
from public.members m
where m.name = 'Shruti' and m.is_active
  and exists (select 1 from public.data_issues d where d.source_file = 'Routine Tasks' and d.source_row = 43)
  and not exists (select 1 from public.leaves l where l.member_id = m.id and date '2026-10-20' between l.start_date and l.end_date);

update public.data_issues
   set status = 'Resolved', resolved_at = now(),
       resolution_note = 'Imported into the Team Calendar when holidays and leave were added.'
 where source_file = 'Routine Tasks' and source_row in (41, 42, 44) and status = 'Open';
update public.data_issues
   set suggested_action = 'Imported to the Team Calendar as a Holiday Swap on 20-Oct-26. Confirm the original holiday date (the note says 2026-10-25, the Diwali row says 30-Oct-26).'
 where source_file = 'Routine Tasks' and source_row = 43 and status = 'Open';
-- OpsPulse Workspace: login/logout attendance tracking.
--
-- What is recorded: the database time of each successful PIN sign-in (start of a work session)
-- and of each sign-out (end of it). Nothing else about the device or activity is collected.
--
-- Policy (also shown on the Attendance page):
--   * A work session starts when someone enters their PIN and has no session already open.
--     Signing in on a second device while a session is open does not start another one.
--   * It ends when they sign out (on any device). A second sign-out changes nothing.
--   * A session that is never signed out becomes an "Incomplete Session" once the sign-in
--     expires (session_expiry_hours, 12 by default, the same limit as the PIN re-check) or the
--     work day ends in the person's time zone. No logout time is invented for it; hours for it
--     are only counted after an admin approves a correction.
--   * Each day is judged against the schedule that applied on that date. Schedule changes can
--     only start today or later, so past days never change.
--   * Flags are prompts for an admin to review, not findings of misconduct.

alter table public.app_settings
  add column overtime_after_minutes int not null default 30 check (overtime_after_minutes between 0 and 240),
  add column session_expiry_hours int not null default 12 check (session_expiry_hours between 1 and 24),
  add column repeat_flag_count int not null default 3 check (repeat_flag_count between 2 and 20),
  add column repeat_flag_window_days int not null default 30 check (repeat_flag_window_days between 7 and 90);

-- Schedules: one row per change, effective from a date. History is never rewritten.
create table public.work_schedules (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members (id) on delete cascade,
  effective_from date not null,
  start_time time not null,
  end_time time not null,
  working_days smallint[] not null default '{1,2,3,4,5,6}',
  break_minutes int not null default 60 check (break_minutes between 0 and 240),
  grace_minutes int not null default 10 check (grace_minutes between 0 and 120),
  timezone text not null default 'Asia/Kolkata',
  note text not null default '' check (length(note) <= 500),
  created_by uuid references public.members (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (member_id, effective_from),
  check (end_time > start_time),
  check (cardinality(working_days) between 1 and 7 and working_days <@ '{1,2,3,4,5,6,7}'::smallint[])
);

-- One row per person per work date, holding the schedule that applied when the day was first recorded.
create table public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members (id) on delete cascade,
  work_date date not null,
  schedule_id uuid references public.work_schedules (id) on delete set null,
  scheduled_start timestamptz,
  scheduled_end timestamptz,
  grace_minutes int not null default 0,
  break_minutes int not null default 0,
  is_working_day boolean not null default true,
  timezone text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (member_id, work_date)
);

-- Work sessions (several per day are allowed). Original timestamps are never edited;
-- an approved correction is stored next to them.
create table public.attendance_sessions (
  id uuid primary key default gen_random_uuid(),
  record_id uuid not null references public.attendance_records (id) on delete cascade,
  member_id uuid not null references public.members (id) on delete cascade,
  work_date date not null,
  source text not null default 'app' check (source in ('app', 'correction')),
  login_at timestamptz not null,
  logout_at timestamptz,
  logout_source text check (logout_source in ('sign_out', 'admin')),
  auth_session_id uuid,
  incomplete_at timestamptz,
  corrected_login_at timestamptz,
  corrected_logout_at timestamptz,
  correction_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (logout_at is null or logout_at >= login_at),
  check (corrected_logout_at is null or corrected_logout_at > coalesce(corrected_login_at, login_at))
);
-- At most one open session per person: this is what makes a repeated sign-in or sign-out harmless.
create unique index attendance_one_open_session on public.attendance_sessions (member_id)
  where logout_at is null and incomplete_at is null and corrected_logout_at is null;
create index attendance_sessions_day on public.attendance_sessions (member_id, work_date);

create table public.attendance_flags (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members (id) on delete cascade,
  work_date date not null,
  flag_type text not null check (flag_type in ('Late Login', 'Early Logout', 'No Login', 'Incomplete Session',
                                               'Repeated Late Login', 'Repeated Early Logout')),
  expected_at timestamptz,
  actual_at timestamptz,
  minutes int,
  reason text not null default '',
  employee_explanation text not null default '' check (length(employee_explanation) <= 1000),
  status public.flag_review_status not null default 'Open',
  review_note text not null default '' check (length(review_note) <= 1000),
  reviewed_by uuid references public.members (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (member_id, work_date, flag_type)
);

create table public.attendance_corrections (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members (id) on delete cascade,
  work_date date not null,
  requested_login_at timestamptz,
  requested_logout_at timestamptz,
  reason text not null check (length(btrim(reason)) between 3 and 1000),
  status public.correction_status not null default 'Pending',
  original_login_at timestamptz,
  original_logout_at timestamptz,
  session_id uuid references public.attendance_sessions (id) on delete set null,
  decided_by uuid references public.members (id) on delete set null,
  decided_at timestamptz,
  decision_note text not null default '' check (length(decision_note) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (requested_login_at is not null or requested_logout_at is not null),
  check (requested_logout_at is null or requested_login_at is null or requested_logout_at > requested_login_at)
);
create unique index attendance_one_pending_correction on public.attendance_corrections (member_id, work_date)
  where status = 'Pending';
alter table public.attendance_sessions add constraint attendance_sessions_correction_fk
  foreign key (correction_id) references public.attendance_corrections (id) on delete set null;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function private.schedule_for(p_member uuid, p_date date)
returns public.work_schedules language sql stable security definer set search_path = '' as $$
  select s.* from public.work_schedules s
  where s.member_id = p_member and s.effective_from <= p_date
  order by s.effective_from desc limit 1
$$;

create or replace function private.member_timezone(p_member uuid)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select s.timezone from public.work_schedules s
      where s.member_id = p_member and s.effective_from <= (now() at time zone s.timezone)::date
      order by s.effective_from desc limit 1),
    (select timezone from public.app_settings limit 1),
    'UTC')
$$;

create or replace function private.attendance_record_for(p_member uuid, p_date date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  s public.work_schedules;
begin
  select r.id into v_id from public.attendance_records r where r.member_id = p_member and r.work_date = p_date;
  if v_id is not null then return v_id; end if;
  s := private.schedule_for(p_member, p_date);
  insert into public.attendance_records (member_id, work_date, schedule_id, scheduled_start, scheduled_end,
                                         grace_minutes, break_minutes, is_working_day, timezone)
  values (p_member, p_date, s.id,
          case when s.id is not null then (p_date + s.start_time) at time zone s.timezone end,
          case when s.id is not null then (p_date + s.end_time) at time zone s.timezone end,
          coalesce(s.grace_minutes, 0), coalesce(s.break_minutes, 0),
          coalesce(extract(isodow from p_date)::smallint = any (s.working_days), false),
          coalesce(s.timezone, private.member_timezone(p_member)))
  on conflict (member_id, work_date) do nothing
  returning id into v_id;
  if v_id is null then
    select r.id into v_id from public.attendance_records r where r.member_id = p_member and r.work_date = p_date;
  end if;
  return v_id;
end $$;

-- Marks sessions that were never signed out as incomplete (see the policy above).
create or replace function private.attendance_expire(p_member uuid default null)
returns void language sql security definer set search_path = '' as $$
  update public.attendance_sessions s set incomplete_at = now(), updated_at = now()
  from public.attendance_records r
  where r.id = s.record_id
    and (p_member is null or s.member_id = p_member)
    and s.logout_at is null and s.incomplete_at is null and s.corrected_logout_at is null
    and (s.login_at < now() - make_interval(hours => (select session_expiry_hours from public.app_settings limit 1))
         or s.work_date < (now() at time zone r.timezone)::date)
$$;

-- One computed attendance row per person per day: schedule, holiday/leave, sessions and statuses.
create or replace function private.attendance_rows(p_from date, p_to date, p_member uuid default null)
returns table (
  member_id uuid, member_name text, work_date date, day_type text, holiday_name text, leave_type text,
  scheduled_start timestamptz, scheduled_end timestamptz, grace_minutes int, break_minutes int, tz text,
  first_login timestamptz, last_logout timestamptz, session_count int, open_session boolean, incomplete_sessions int,
  worked_minutes int, minutes_late int, minutes_early int, minutes_overtime int,
  login_status text, logout_status text, corrected boolean, record_id uuid)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  m record;
  d date;
  s public.work_schedules;
  rec public.attendance_records;
  lv public.leaves;
  agg record;
  v_working boolean;
  v_today date;
  v_worked numeric;
  v_overtime int := (select a.overtime_after_minutes from public.app_settings a limit 1);
  v_expiry interval := make_interval(hours => (select a.session_expiry_hours from public.app_settings a limit 1));
begin
  for m in
    select mm.id, mm.name from public.members mm
    where (p_member is null or mm.id = p_member)
      and (mm.is_active or exists (select 1 from public.attendance_records ar
                                   where ar.member_id = mm.id and ar.work_date between p_from and p_to))
    order by mm.created_at
  loop
    for d in select g::date from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') g loop
      rec := null;
      select ar.* into rec from public.attendance_records ar where ar.member_id = m.id and ar.work_date = d;
      s := private.schedule_for(m.id, d);
      if rec.id is null and s.id is null then continue; end if;

      tz := coalesce(rec.timezone, s.timezone, 'UTC');
      v_today := (now() at time zone tz)::date;
      if d > v_today then continue; end if;

      member_id := m.id; member_name := m.name; work_date := d; record_id := rec.id;
      if rec.id is not null then
        scheduled_start := rec.scheduled_start; scheduled_end := rec.scheduled_end;
        grace_minutes := rec.grace_minutes; break_minutes := rec.break_minutes; v_working := rec.is_working_day;
      else
        scheduled_start := (d + s.start_time) at time zone s.timezone;
        scheduled_end := (d + s.end_time) at time zone s.timezone;
        grace_minutes := s.grace_minutes; break_minutes := s.break_minutes;
        v_working := extract(isodow from d)::smallint = any (s.working_days);
      end if;

      holiday_name := private.holiday_for(m.id, d);
      lv := null;
      select l.* into lv from public.leaves l where l.member_id = m.id and d between l.start_date and l.end_date
       order by l.created_at limit 1;
      leave_type := lv.leave_type::text;
      day_type := case when lv.id is not null then 'On Leave'
                       when holiday_name is not null then 'Holiday'
                       when scheduled_start is null then 'No Schedule'
                       when not v_working then 'Weekly Off'
                       else 'Working Day' end;

      select min(coalesce(x.corrected_login_at, x.login_at)) as first_login,
             max(coalesce(x.corrected_logout_at, x.logout_at)) as last_logout,
             count(*)::int as n,
             coalesce(bool_or(x.is_open), false) as any_open,
             (count(*) filter (where coalesce(x.corrected_logout_at, x.logout_at) is null and not x.is_open))::int as n_incomplete,
             coalesce(bool_or(x.source = 'correction' or x.corrected_login_at is not null or x.corrected_logout_at is not null), false) as any_corrected
        into agg
        from (select ss.*,
                     (coalesce(ss.corrected_logout_at, ss.logout_at) is null and ss.incomplete_at is null
                      and ss.login_at >= now() - v_expiry and ss.work_date >= v_today) as is_open
                from public.attendance_sessions ss
               where ss.member_id = m.id and ss.work_date = d) x;

      -- Hours: merge overlapping sessions; an open session counts up to now.
      select coalesce(sum(extract(epoch from (g3.e - g3.b))), 0) / 60 into v_worked
        from (select min(g2.a) as b, max(g2.z) as e
                from (select g1.a, g1.z, sum(g1.newgrp) over (order by g1.a, g1.z) as grp
                        from (select iv.a, iv.z,
                                     case when iv.a <= max(iv.z) over (order by iv.a, iv.z rows between unbounded preceding and 1 preceding)
                                          then 0 else 1 end as newgrp
                                from (select coalesce(ss.corrected_login_at, ss.login_at) as a,
                                             coalesce(ss.corrected_logout_at, ss.logout_at,
                                                      case when ss.incomplete_at is null and ss.login_at >= now() - v_expiry
                                                                and ss.work_date >= v_today then now() end) as z
                                        from public.attendance_sessions ss
                                       where ss.member_id = m.id and ss.work_date = d) iv
                               where iv.z is not null) g1) g2
               group by g2.grp) g3;

      first_login := agg.first_login; last_logout := agg.last_logout;
      session_count := coalesce(agg.n, 0); open_session := agg.any_open;
      incomplete_sessions := coalesce(agg.n_incomplete, 0); corrected := agg.any_corrected;
      worked_minutes := floor(v_worked)::int;
      minutes_late := null; minutes_early := null; minutes_overtime := null;

      if first_login is null then
        login_status := case when day_type = 'Working Day' then 'Not Logged In' else day_type end;
      elsif day_type <> 'Working Day' then
        login_status := day_type;
      else
        minutes_late := greatest(0, floor(extract(epoch from (first_login - scheduled_start)) / 60))::int;
        login_status := case when minutes_late = 0 then 'On Time'
                             when minutes_late <= grace_minutes then 'Within Grace Period'
                             else 'Late' end;
      end if;

      if open_session then
        logout_status := 'Currently Working';
      elsif last_logout is not null then
        if day_type <> 'Working Day' then
          logout_status := 'Logged Out';
        elsif floor(extract(epoch from (scheduled_end - last_logout)) / 60) >= 1 then
          minutes_early := floor(extract(epoch from (scheduled_end - last_logout)) / 60)::int;
          logout_status := 'Left Early';
        else
          minutes_overtime := greatest(0, floor(extract(epoch from (last_logout - scheduled_end)) / 60))::int;
          logout_status := case when minutes_overtime >= greatest(v_overtime, 1) then 'Overtime' else 'Logged Out' end;
        end if;
      elsif incomplete_sessions > 0 then
        logout_status := 'Incomplete Session';
      else
        logout_status := null;
      end if;
      return next;
    end loop;
  end loop;
end $$;

-- Creates review flags for a date range (idempotent; a reviewed flag is never reopened or overwritten).
create or replace function private.attendance_sync_flags(p_from date, p_to date, p_member uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  r record;
  v_count int := (select a.repeat_flag_count from public.app_settings a limit 1);
  v_window int := (select a.repeat_flag_window_days from public.app_settings a limit 1);
  v_expiry int := (select a.session_expiry_hours from public.app_settings a limit 1);
begin
  for r in select * from private.attendance_rows(p_from, p_to, p_member) loop
    if r.login_status = 'Late' then
      insert into public.attendance_flags (member_id, work_date, flag_type, expected_at, actual_at, minutes, reason)
      values (r.member_id, r.work_date, 'Late Login', r.scheduled_start, r.first_login, r.minutes_late,
              format('Signed in %s min after the scheduled start of %s (grace period %s min).',
                     r.minutes_late, to_char(r.scheduled_start at time zone r.tz, 'HH24:MI'), r.grace_minutes))
      on conflict (member_id, work_date, flag_type) do nothing;
    end if;
    if r.logout_status = 'Left Early' then
      insert into public.attendance_flags (member_id, work_date, flag_type, expected_at, actual_at, minutes, reason)
      values (r.member_id, r.work_date, 'Early Logout', r.scheduled_end, r.last_logout, r.minutes_early,
              format('Signed out %s min before the scheduled end of %s.',
                     r.minutes_early, to_char(r.scheduled_end at time zone r.tz, 'HH24:MI')))
      on conflict (member_id, work_date, flag_type) do nothing;
    end if;
    if r.day_type = 'Working Day' and r.first_login is null
       and (r.work_date < (now() at time zone r.tz)::date or now() > r.scheduled_end) then
      insert into public.attendance_flags (member_id, work_date, flag_type, expected_at, reason)
      values (r.member_id, r.work_date, 'No Login', r.scheduled_start,
              'No sign-in was recorded on a scheduled working day. This may be unrecorded leave or a technical issue.')
      on conflict (member_id, work_date, flag_type) do nothing;
    end if;
    if r.incomplete_sessions > 0 then
      insert into public.attendance_flags (member_id, work_date, flag_type, expected_at, actual_at, reason)
      values (r.member_id, r.work_date, 'Incomplete Session', r.scheduled_end, null,
              format('A session was not signed out before it expired (%s-hour limit or end of day), so the logout time is unknown.', v_expiry))
      on conflict (member_id, work_date, flag_type) do nothing;
    end if;
  end loop;

  insert into public.attendance_flags (member_id, work_date, flag_type, minutes, reason)
  select f.member_id, f.work_date, 'Repeated ' || f.flag_type, f.cnt,
         format('%s %s flags in the %s days up to this date.', f.cnt, lower(f.flag_type), v_window)
  from (select f0.member_id, f0.work_date, f0.flag_type,
               (select count(*) from public.attendance_flags g
                 where g.member_id = f0.member_id and g.flag_type = f0.flag_type
                   and g.work_date between f0.work_date - (v_window - 1) and f0.work_date)::int as cnt
          from public.attendance_flags f0
         where f0.flag_type in ('Late Login', 'Early Logout')
           and f0.work_date between p_from and p_to
           and (p_member is null or f0.member_id = p_member)) f
  where f.cnt >= v_count
  on conflict (member_id, work_date, flag_type) do nothing;
end $$;

-- Called from verify_pin after a successful PIN entry.
create or replace function private.attendance_login(p_member uuid, p_auth_session uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_date date;
  v_record uuid;
begin
  perform private.attendance_expire(p_member);
  select s.id into v_id from public.attendance_sessions s
   where s.member_id = p_member and s.logout_at is null and s.incomplete_at is null and s.corrected_logout_at is null;
  if v_id is not null then return v_id; end if;
  v_date := (now() at time zone private.member_timezone(p_member))::date;
  v_record := private.attendance_record_for(p_member, v_date);
  insert into public.attendance_sessions (record_id, member_id, work_date, login_at, auth_session_id)
  values (v_record, p_member, v_date, now(), p_auth_session)
  on conflict do nothing
  returning id into v_id;
  perform private.attendance_sync_flags(v_date, v_date, p_member);
  return v_id;
end $$;

-- Called from end_session when someone signs out. Repeating it changes nothing.
create or replace function private.attendance_logout(p_member uuid, p_source text default 'sign_out')
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_date date;
begin
  perform private.attendance_expire(p_member);
  update public.attendance_sessions s set logout_at = now(), logout_source = p_source, updated_at = now()
   where s.id = (select o.id from public.attendance_sessions o
                  where o.member_id = p_member and o.logout_at is null and o.incomplete_at is null
                    and o.corrected_logout_at is null
                  order by o.login_at desc limit 1 for update)
     and s.logout_at is null
  returning s.id, s.work_date into v_id, v_date;
  if v_id is not null then perform private.attendance_sync_flags(v_date, v_date, p_member); end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Hooks into the existing sign-in and sign-out (attendance can never block signing in or out)
-- ---------------------------------------------------------------------------
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
    begin
      perform private.attendance_login(v_member, v_session);
    exception when others then
      raise warning 'attendance login not recorded: %', sqlerrm;
    end;
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

create or replace function public.end_session()
returns void language plpgsql security definer set search_path = '' as $$
declare v_member uuid := private.me();
begin
  if v_member is not null then
    begin
      perform private.attendance_logout(v_member, 'sign_out');
    exception when others then
      raise warning 'attendance logout not recorded: %', sqlerrm;
    end;
  end if;
  delete from public.verified_sessions where session_id = private.jwt_session_id() and user_id = auth.uid();
end $$;

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------
create or replace function public.attendance_report(p_from date, p_to date, p_member uuid default null)
returns table (
  member_id uuid, member_name text, work_date date, day_type text, holiday_name text, leave_type text,
  scheduled_start timestamptz, scheduled_end timestamptz, grace_minutes int, break_minutes int, tz text,
  first_login timestamptz, last_logout timestamptz, session_count int, open_session boolean, incomplete_sessions int,
  worked_minutes int, minutes_late int, minutes_early int, minutes_overtime int,
  login_status text, logout_status text, corrected boolean, record_id uuid,
  open_flags int, pending_correction boolean)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare v_me uuid := private.me();
begin
  if v_me is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 92 then
    raise exception 'Choose a date range of up to 93 days' using errcode = '22023';
  end if;
  if not private.is_admin() then
    if p_member is not null and p_member <> v_me then
      raise exception 'You can only view your own attendance' using errcode = '42501';
    end if;
    p_member := v_me;
  end if;
  return query
  select r.*,
         (select count(*) from public.attendance_flags f
           where f.member_id = r.member_id and f.work_date = r.work_date and f.status = 'Open')::int,
         exists (select 1 from public.attendance_corrections c
                  where c.member_id = r.member_id and c.work_date = r.work_date and c.status = 'Pending')
  from private.attendance_rows(p_from, p_to, p_member) r
  order by r.work_date desc, r.member_name;
end $$;

-- Expires stale sessions and creates flags for the range (admin: everyone; others: themselves).
create or replace function public.attendance_refresh(p_from date, p_to date)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.me();
  v_who uuid;
begin
  if v_me is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 92 then
    raise exception 'Choose a date range of up to 93 days' using errcode = '22023';
  end if;
  v_who := case when private.is_admin() then null else v_me end;
  perform private.attendance_expire(v_who);
  perform private.attendance_sync_flags(p_from, p_to, v_who);
end $$;

create or replace function public.review_attendance_flag(p_flag uuid, p_status public.flag_review_status, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin() then raise exception 'Only an admin can review attendance flags' using errcode = '42501'; end if;
  update public.attendance_flags
     set status = p_status, review_note = left(btrim(coalesce(p_note, '')), 1000),
         reviewed_by = case when p_status = 'Open' then null else private.me() end,
         reviewed_at = case when p_status = 'Open' then null else now() end,
         updated_at = now()
   where id = p_flag;
  if not found then raise exception 'Flag not found' using errcode = 'P0002'; end if;
  perform private.audit('attendance_flag', p_flag, lower(p_status::text), jsonb_build_object('note', p_note));
end $$;

create or replace function public.explain_attendance_flag(p_flag uuid, p_explanation text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if private.me() is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  update public.attendance_flags set employee_explanation = left(btrim(coalesce(p_explanation, '')), 1000), updated_at = now()
   where id = p_flag and member_id = private.me();
  if not found then raise exception 'Flag not found' using errcode = 'P0002'; end if;
  perform private.audit('attendance_flag', p_flag, 'explained', '{}'::jsonb);
end $$;

-- Times are local to the person's schedule time zone on that date.
create or replace function public.request_attendance_correction(p_date date, p_login time, p_logout time, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.me();
  v_tz text;
  v_today date;
  v_login timestamptz;
  v_logout timestamptz;
  v_id uuid;
begin
  if v_me is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  if p_login is null and p_logout is null then
    raise exception 'Enter the correct login time, logout time, or both' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Explain why the record needs correcting' using errcode = '22023';
  end if;
  v_tz := coalesce((select r.timezone from public.attendance_records r where r.member_id = v_me and r.work_date = p_date),
                   (private.schedule_for(v_me, p_date)).timezone, private.member_timezone(v_me));
  v_today := (now() at time zone v_tz)::date;
  if p_date is null or p_date > v_today or p_date < v_today - 60 then
    raise exception 'Corrections can be requested for today or the last 60 days' using errcode = '22023';
  end if;
  v_login := case when p_login is not null then (p_date + p_login) at time zone v_tz end;
  v_logout := case when p_logout is not null then (p_date + p_logout) at time zone v_tz end;
  if v_login is not null and v_logout is not null and v_logout <= v_login then
    raise exception 'The logout time must be after the login time' using errcode = '22023';
  end if;
  if coalesce(v_login, v_logout) > now() or v_logout > now() then
    raise exception 'Times cannot be in the future' using errcode = '22023';
  end if;
  insert into public.attendance_corrections (member_id, work_date, requested_login_at, requested_logout_at, reason)
  values (v_me, p_date, v_login, v_logout, btrim(p_reason))
  returning id into v_id;
  perform private.audit('attendance_correction', v_id, 'requested', jsonb_build_object(
    'date', p_date, 'login', v_login, 'logout', v_logout));
  return v_id;
end $$;

-- Approving stores the corrected times next to the original ones (which are kept), and resolves
-- that day's open flags with a note. Rejecting changes nothing but the request.
create or replace function public.decide_attendance_correction(p_id uuid, p_approve boolean, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  c public.attendance_corrections;
  v_me uuid := private.me();
  v_rec uuid;
  v_first public.attendance_sessions;
  v_last public.attendance_sessions;
  v_session uuid;
begin
  if not private.is_admin() then raise exception 'Only an admin can decide attendance corrections' using errcode = '42501'; end if;
  select * into c from public.attendance_corrections where id = p_id for update;
  if c.id is null then raise exception 'Request not found' using errcode = 'P0002'; end if;
  if c.status <> 'Pending' then raise exception 'This request has already been decided' using errcode = '23514'; end if;

  if not p_approve then
    update public.attendance_corrections set status = 'Rejected', decided_by = v_me, decided_at = now(),
      decision_note = left(btrim(coalesce(p_note, '')), 1000), updated_at = now()
    where id = p_id;
    perform private.audit('attendance_correction', p_id, 'rejected', jsonb_build_object('note', p_note));
    return;
  end if;

  v_rec := private.attendance_record_for(c.member_id, c.work_date);
  select * into v_first from public.attendance_sessions s where s.record_id = v_rec
   order by coalesce(s.corrected_login_at, s.login_at) limit 1;
  select * into v_last from public.attendance_sessions s where s.record_id = v_rec
   order by coalesce(s.corrected_login_at, s.login_at) desc limit 1;

  if v_first.id is null then
    if c.requested_login_at is null then
      raise exception 'There is no sign-in that day, so the correction needs a login time' using errcode = '22023';
    end if;
    insert into public.attendance_sessions (record_id, member_id, work_date, source, login_at, logout_at, logout_source, correction_id)
    values (v_rec, c.member_id, c.work_date, 'correction', c.requested_login_at, c.requested_logout_at,
            case when c.requested_logout_at is not null then 'admin' end, c.id)
    returning id into v_session;
  else
    if c.requested_logout_at is not null
       and c.requested_logout_at <= coalesce(case when v_first.id = v_last.id then c.requested_login_at end,
                                             v_last.corrected_login_at, v_last.login_at) then
      raise exception 'The corrected logout time is before that session''s login' using errcode = '22023';
    end if;
    if c.requested_login_at is not null then
      update public.attendance_sessions set corrected_login_at = c.requested_login_at, correction_id = c.id, updated_at = now()
       where id = v_first.id;
    end if;
    if c.requested_logout_at is not null then
      update public.attendance_sessions set corrected_logout_at = c.requested_logout_at, correction_id = c.id, updated_at = now()
       where id = v_last.id;
    end if;
    v_session := case when c.requested_logout_at is not null then v_last.id else v_first.id end;
  end if;

  update public.attendance_corrections set status = 'Approved', decided_by = v_me, decided_at = now(),
    decision_note = left(btrim(coalesce(p_note, '')), 1000), session_id = v_session,
    original_login_at = coalesce(v_first.corrected_login_at, v_first.login_at),
    original_logout_at = coalesce(v_last.corrected_logout_at, v_last.logout_at),
    updated_at = now()
  where id = p_id;

  update public.attendance_flags
     set status = 'Resolved', reviewed_by = v_me, reviewed_at = now(), updated_at = now(),
         review_note = 'Attendance correction approved' || coalesce(': ' || nullif(btrim(p_note), ''), '.')
   where member_id = c.member_id and work_date = c.work_date and status = 'Open';

  perform private.audit('attendance_correction', p_id, 'approved', jsonb_build_object(
    'member', c.member_id, 'date', c.work_date,
    'original_login', coalesce(v_first.corrected_login_at, v_first.login_at),
    'original_logout', coalesce(v_last.corrected_logout_at, v_last.logout_at),
    'login', c.requested_login_at, 'logout', c.requested_logout_at, 'note', p_note));
end $$;

-- A schedule change starts today or later; earlier days keep the schedule they had.
create or replace function public.admin_set_schedule(p_member uuid, p_effective_from date, p_start time, p_end time,
                                                     p_days int[], p_break int, p_grace int, p_timezone text,
                                                     p_note text default '')
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not private.is_admin() then raise exception 'Only an admin can change work schedules' using errcode = '42501'; end if;
  perform private.assert_active_member(p_member, 'Employee');
  if p_timezone is null or not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = p_timezone) then
    raise exception 'Unknown time zone' using errcode = '22023';
  end if;
  if p_effective_from is null or p_effective_from < (now() at time zone p_timezone)::date then
    raise exception 'A schedule change can start today or later; past days keep the schedule they had' using errcode = '22023';
  end if;
  if p_start is null or p_end is null or p_end <= p_start then
    raise exception 'The end time must be after the start time' using errcode = '22023';
  end if;
  insert into public.work_schedules (member_id, effective_from, start_time, end_time, working_days,
                                     break_minutes, grace_minutes, timezone, note, created_by)
  values (p_member, p_effective_from, p_start, p_end, p_days::smallint[], p_break, p_grace, p_timezone,
          left(btrim(coalesce(p_note, '')), 500), private.me())
  on conflict (member_id, effective_from) do update set
    start_time = excluded.start_time, end_time = excluded.end_time, working_days = excluded.working_days,
    break_minutes = excluded.break_minutes, grace_minutes = excluded.grace_minutes, timezone = excluded.timezone,
    note = excluded.note, created_by = excluded.created_by, updated_at = now()
  returning id into v_id;
  perform private.audit('schedule', v_id, 'set', jsonb_build_object(
    'member', p_member, 'from', p_effective_from, 'start', p_start, 'end', p_end, 'days', p_days,
    'break', p_break, 'grace', p_grace, 'timezone', p_timezone));
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Default schedules (an admin should replace these with each person's real shift)
-- ---------------------------------------------------------------------------
create or replace function private.default_schedule(p_member uuid)
returns void language sql security definer set search_path = '' as $$
  insert into public.work_schedules (member_id, effective_from, start_time, end_time, working_days,
                                     break_minutes, grace_minutes, timezone, note)
  values (p_member, private.today(), '10:00', '19:00', '{1,2,3,4,5,6}', 60, 10,
          coalesce((select timezone from public.app_settings limit 1), 'Asia/Kolkata'),
          'Default schedule. Change it on Attendance > Schedules to match this person''s real shift.')
  on conflict (member_id, effective_from) do nothing
$$;

create or replace function private.members_schedule()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.work_schedules s where s.member_id = new.id) then
    perform private.default_schedule(new.id);
  end if;
  return null;
end $$;
create trigger members_schedule after insert on public.members
  for each row execute function private.members_schedule();

select private.default_schedule(m.id) from public.members m
where m.is_active and not exists (select 1 from public.work_schedules s where s.member_id = m.id);

-- ---------------------------------------------------------------------------
-- Row level security: a person sees their own records, an admin sees everyone's.
-- Nothing is writable through the API; every change goes through the functions above.
-- ---------------------------------------------------------------------------
alter table public.work_schedules enable row level security;
alter table public.attendance_records enable row level security;
alter table public.attendance_sessions enable row level security;
alter table public.attendance_flags enable row level security;
alter table public.attendance_corrections enable row level security;

grant select on public.work_schedules, public.attendance_records, public.attendance_sessions,
                public.attendance_flags, public.attendance_corrections to authenticated;
create policy schedules_read on public.work_schedules for select to authenticated
  using (private.is_admin() or member_id = private.me());
create policy att_records_read on public.attendance_records for select to authenticated
  using (private.is_admin() or member_id = private.me());
create policy att_sessions_read on public.attendance_sessions for select to authenticated
  using (private.is_admin() or member_id = private.me());
create policy att_flags_read on public.attendance_flags for select to authenticated
  using (private.is_admin() or member_id = private.me());
create policy att_corrections_read on public.attendance_corrections for select to authenticated
  using (private.is_admin() or member_id = private.me());

grant update (overtime_after_minutes, session_expiry_hours, repeat_flag_count, repeat_flag_window_days)
  on public.app_settings to authenticated;

revoke execute on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated;

revoke execute on function
  public.attendance_report(date, date, uuid),
  public.attendance_refresh(date, date),
  public.review_attendance_flag(uuid, public.flag_review_status, text),
  public.explain_attendance_flag(uuid, text),
  public.request_attendance_correction(date, time, time, text),
  public.decide_attendance_correction(uuid, boolean, text),
  public.admin_set_schedule(uuid, date, time, time, int[], int, int, text, text)
from public, anon;
grant execute on function
  public.attendance_report(date, date, uuid),
  public.attendance_refresh(date, date),
  public.review_attendance_flag(uuid, public.flag_review_status, text),
  public.explain_attendance_flag(uuid, text),
  public.request_attendance_correction(date, time, time, text),
  public.decide_attendance_correction(uuid, boolean, text),
  public.admin_set_schedule(uuid, date, time, time, int[], int, int, text, text),
  public.verify_pin(text),
  public.end_session()
to authenticated;
