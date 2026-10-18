-- OpsPulse Workspace: attendance, phase 2.
--
-- Adds teams, company and team default hours (including weekly offs), attendance exemptions,
-- decisions on attendance exceptions (approve / reject / waive, one at a time or in bulk, with
-- history), and break tracking.
--
-- Safe for a live database: this migration only adds tables, columns with defaults, indexes and
-- functions, and replaces existing functions in place with the same signatures and return types.
-- No row is deleted or overwritten. The only change to an existing constraint is widening the list
-- of attendance flag types (two new types), done in one statement so the check is never absent.
--
-- Rules:
--   * Hours come from the most specific source: a person's own schedule, else their team's
--     default, else the company default. A person follows the defaults from a chosen date.
--   * Weekly offs are the days outside a schedule's working days (already shown as "Weekly Off").
--   * Every change starts today or later, and each day keeps the schedule recorded for it, so past
--     days never change.
--   * An exemption stops late / early / late-logout / long-break flags for its dates. Sign-in and
--     sign-out times are still recorded and shown; missed sign-ins and incomplete sessions are
--     still flagged.
--   * Worked time subtracts recorded breaks that fall inside signed-in time. Days without recorded
--     breaks are calculated exactly as before.

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------
alter table public.app_settings
  add column if not exists late_logout_flag_minutes int check (late_logout_flag_minutes between 15 and 600),
  add column if not exists long_break_grace_minutes int not null default 10 check (long_break_grace_minutes between 0 and 120);
comment on column public.app_settings.late_logout_flag_minutes is
  'Flag a sign-out this many minutes after the scheduled end as Late Logout. Null = off.';

-- ---------------------------------------------------------------------------
-- Teams and team history
-- ---------------------------------------------------------------------------
create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 60),
  note text not null default '' check (length(note) <= 500),
  is_active boolean not null default true,
  created_by uuid references public.members (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists teams_name_uq on public.teams (lower(btrim(name)));

-- One row per change: the person's team from a date (team_id null = no team from that date).
create table if not exists public.member_teams (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members (id) on delete cascade,
  team_id uuid references public.teams (id) on delete restrict,
  effective_from date not null,
  created_by uuid references public.members (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (member_id, effective_from)
);

-- ---------------------------------------------------------------------------
-- Default hours: company-wide (team_id null) or per team, each effective from a date
-- ---------------------------------------------------------------------------
create table if not exists public.schedule_defaults (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references public.teams (id) on delete restrict,
  effective_from date not null,
  start_time time not null,
  end_time time not null,
  working_days smallint[] not null,
  break_minutes int not null default 60 check (break_minutes between 0 and 240),
  grace_minutes int not null default 10 check (grace_minutes between 0 and 120),
  timezone text not null default 'Asia/Kolkata',
  note text not null default '' check (length(note) <= 500),
  created_by uuid references public.members (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (team_id, effective_from),
  check (end_time > start_time),
  check (cardinality(working_days) between 1 and 7 and working_days <@ '{1,2,3,4,5,6,7}'::smallint[])
);

-- A personal schedule row can instead say "follow the team / company default from this date".
-- Its own times are then only a fallback, used if no default exists for that date.
alter table public.work_schedules add column if not exists follows_default boolean not null default false;

-- ---------------------------------------------------------------------------
-- Exemptions
-- ---------------------------------------------------------------------------
create table if not exists public.attendance_exemptions (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members (id) on delete cascade,
  start_date date not null,
  end_date date,                       -- null = permanent
  note text not null default '' check (length(note) <= 500),
  created_by uuid references public.members (id) on delete set null,
  created_at timestamptz not null default now(),
  ended_from date,                     -- set when switched off early: first date it no longer applies
  ended_by uuid references public.members (id) on delete set null,
  ended_at timestamptz,
  end_note text not null default '' check (length(end_note) <= 500),
  updated_at timestamptz not null default now(),
  check (end_date is null or end_date >= start_date)
);
create index if not exists attendance_exemptions_member on public.attendance_exemptions (member_id, start_date);

-- ---------------------------------------------------------------------------
-- Exception decisions and their history
-- ---------------------------------------------------------------------------
alter table public.attendance_flags
  add column if not exists decision text check (decision in ('Approved', 'Rejected', 'Waived'));

-- Two new flag types. Drop-and-add in one statement: existing rows are re-checked against the
-- wider list, and there is no moment without the check.
alter table public.attendance_flags drop constraint if exists attendance_flags_flag_type_check, add constraint attendance_flags_flag_type_check check (flag_type in ('Late Login', 'Early Logout', 'No Login', 'Incomplete Session', 'Repeated Late Login', 'Repeated Early Logout', 'Late Logout', 'Long Break'));

create table if not exists public.attendance_flag_actions (
  id uuid primary key default gen_random_uuid(),
  flag_id uuid not null references public.attendance_flags (id) on delete cascade,
  action text not null check (action in ('Approved', 'Rejected', 'Waived', 'Reviewed', 'Resolved', 'Reopened')),
  note text not null default '' check (length(note) <= 1000),
  actor uuid references public.members (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists attendance_flag_actions_flag on public.attendance_flag_actions (flag_id, created_at);

-- ---------------------------------------------------------------------------
-- Breaks
-- ---------------------------------------------------------------------------
create table if not exists public.attendance_breaks (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members (id) on delete cascade,
  work_date date not null,
  record_id uuid references public.attendance_records (id) on delete cascade,
  session_id uuid references public.attendance_sessions (id) on delete set null,
  source text not null default 'app' check (source in ('app', 'manual')),
  start_at timestamptz not null,
  end_at timestamptz,
  note text not null default '' check (length(note) <= 500),
  entered_by uuid references public.members (id) on delete set null,
  closed_incomplete_at timestamptz,    -- the work session ended without a sign-out while on break
  voided_at timestamptz,               -- removed by an admin (kept for the record)
  voided_by uuid references public.members (id) on delete set null,
  void_note text not null default '' check (length(void_note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_at is null or end_at > start_at)
);
-- At most one running break per person.
create unique index if not exists attendance_one_open_break on public.attendance_breaks (member_id)
  where end_at is null and closed_incomplete_at is null and voided_at is null;
create index if not exists attendance_breaks_day on public.attendance_breaks (member_id, work_date);

-- ---------------------------------------------------------------------------
-- Schedule resolution
-- ---------------------------------------------------------------------------
create or replace function private.team_for(p_member uuid, p_date date)
returns uuid language sql stable security definer set search_path = '' as $$
  select mt.team_id from public.member_teams mt
  where mt.member_id = p_member and mt.effective_from <= p_date
  order by mt.effective_from desc limit 1
$$;

-- The team's default in force on the date, else the company default.
create or replace function private.default_for(p_team uuid, p_date date)
returns public.schedule_defaults language sql stable security definer set search_path = '' as $$
  select sd.* from public.schedule_defaults sd
  where sd.effective_from <= p_date and (sd.team_id is null or sd.team_id = p_team)
  order by (sd.team_id is null), sd.effective_from desc limit 1
$$;

-- The schedule in force for a person on a date, where it came from, and their team then.
-- source: 'Personal', 'Team' or 'Company' (null when the person has no schedule at all).
create or replace function private.schedule_pick(p_member uuid, p_date date,
                                                 out sched public.work_schedules, out source text, out team uuid)
language plpgsql stable security definer set search_path = '' as $$
declare
  dflt public.schedule_defaults;
begin
  select ws.* into sched from public.work_schedules ws
   where ws.member_id = p_member and ws.effective_from <= p_date
   order by ws.effective_from desc limit 1;
  team := private.team_for(p_member, p_date);
  if sched.id is null then
    sched := null;
    return;
  end if;
  source := 'Personal';
  if not sched.follows_default then return; end if;
  dflt := private.default_for(team, p_date);
  if dflt.id is null then return; end if;
  source := case when dflt.team_id is null then 'Company' else 'Team' end;
  sched.start_time := dflt.start_time;
  sched.end_time := dflt.end_time;
  sched.working_days := dflt.working_days;
  sched.break_minutes := dflt.break_minutes;
  sched.grace_minutes := dflt.grace_minutes;
  sched.timezone := dflt.timezone;
end $$;

-- Same signature as before; now applies the precedence above. The returned id is always the
-- person's own schedule row, so attendance_records.schedule_id keeps pointing at a real row.
create or replace function private.schedule_for(p_member uuid, p_date date)
returns public.work_schedules language sql stable security definer set search_path = '' as $$
  select (private.schedule_pick(p_member, p_date)).sched
$$;

create or replace function private.member_timezone(p_member uuid)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce((private.schedule_for(p_member, private.today())).timezone,
                  (select timezone from public.app_settings limit 1),
                  'UTC')
$$;

create or replace function private.is_exempt(p_member uuid, p_date date)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.attendance_exemptions e
     where e.member_id = p_member and e.start_date <= p_date
       and (e.end_date is null or p_date <= e.end_date)
       and (e.ended_from is null or p_date < e.ended_from))
$$;

-- ---------------------------------------------------------------------------
-- Session end: close a running break with the sign-out, or mark it incomplete with the session
-- ---------------------------------------------------------------------------
create or replace function private.attendance_expire(p_member uuid default null)
returns void language sql security definer set search_path = '' as $$
  update public.attendance_sessions s set incomplete_at = now(), updated_at = now()
  from public.attendance_records r
  where r.id = s.record_id
    and (p_member is null or s.member_id = p_member)
    and s.logout_at is null and s.incomplete_at is null and s.corrected_logout_at is null
    and (s.login_at < now() - make_interval(hours => (select session_expiry_hours from public.app_settings limit 1))
         or s.work_date < (now() at time zone r.timezone)::date);
  -- A break still running when nobody is signed in any more has no known end.
  update public.attendance_breaks b set closed_incomplete_at = now(), updated_at = now()
  where (p_member is null or b.member_id = p_member)
    and b.end_at is null and b.closed_incomplete_at is null and b.voided_at is null
    and not exists (select 1 from public.attendance_sessions o
                     where o.member_id = b.member_id and o.logout_at is null
                       and o.incomplete_at is null and o.corrected_logout_at is null);
$$;

create or replace function private.attendance_logout(p_member uuid, p_source text default 'sign_out')
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_date date;
begin
  perform private.attendance_expire(p_member);
  -- Signing out ends a running break at the same moment.
  update public.attendance_breaks b set end_at = greatest(now(), b.start_at + interval '1 millisecond'), updated_at = now()
   where b.member_id = p_member and b.end_at is null and b.closed_incomplete_at is null and b.voided_at is null;
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
-- One computed row per person per day, with team, schedule source, exemption and breaks.
-- private.attendance_rows (used by the existing report) now returns the first 24 columns of this.
-- ---------------------------------------------------------------------------
create or replace function private.attendance_days(p_from date, p_to date, p_member uuid default null)
returns table (
  member_id uuid, member_name text, work_date date, day_type text, holiday_name text, leave_type text,
  scheduled_start timestamptz, scheduled_end timestamptz, grace_minutes int, break_minutes int, tz text,
  first_login timestamptz, last_logout timestamptz, session_count int, open_session boolean, incomplete_sessions int,
  worked_minutes int, minutes_late int, minutes_early int, minutes_overtime int,
  login_status text, logout_status text, corrected boolean, record_id uuid,
  exempt boolean, break_taken_minutes int, break_count int, on_break boolean, break_started_at timestamptz,
  team_id uuid, team_name text, schedule_source text)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  m record;
  d date;
  pk record;
  s public.work_schedules;
  rec public.attendance_records;
  lv public.leaves;
  agg record;
  bk record;
  v_working boolean;
  v_today date;
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
      select * into pk from private.schedule_pick(m.id, d);
      s := pk.sched;
      if rec.id is null and s.id is null then continue; end if;

      tz := coalesce(rec.timezone, s.timezone, 'UTC');
      v_today := (now() at time zone tz)::date;
      if d > v_today then continue; end if;

      member_id := m.id; member_name := m.name; work_date := d; record_id := rec.id;
      team_id := pk.team;
      team_name := (select t.name from public.teams t where t.id = pk.team);
      schedule_source := pk.source;
      exempt := private.is_exempt(m.id, d);
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

      -- Signed-in time: merge overlapping sessions (an open session counts up to now). Breaks: a
      -- running break counts up to now while the person is still signed in. Worked time is the
      -- signed-in time minus the part of each break that falls inside it.
      with iv as (
        select coalesce(ss.corrected_login_at, ss.login_at) as a,
               coalesce(ss.corrected_logout_at, ss.logout_at,
                        case when ss.incomplete_at is null and ss.login_at >= now() - v_expiry
                                  and ss.work_date >= v_today then now() end) as z
          from public.attendance_sessions ss
         where ss.member_id = m.id and ss.work_date = d),
      g1 as (
        select iv.a, iv.z,
               case when iv.a <= max(iv.z) over (order by iv.a, iv.z rows between unbounded preceding and 1 preceding)
                    then 0 else 1 end as newgrp
          from iv where iv.z is not null),
      g2 as (select g1.a, g1.z, sum(g1.newgrp) over (order by g1.a, g1.z) as grp from g1),
      merged as (select min(g2.a) as sb, max(g2.z) as se from g2 group by g2.grp),
      brk as (
        select bb.start_at as ba,
               coalesce(bb.end_at, case when bb.closed_incomplete_at is null and agg.any_open then now() end) as bz,
               (bb.end_at is null and bb.closed_incomplete_at is null and agg.any_open) as running
          from public.attendance_breaks bb
         where bb.member_id = m.id and bb.work_date = d and bb.voided_at is null)
      select coalesce((select sum(extract(epoch from (mg.se - mg.sb))) from merged mg), 0) / 60 as signed_in,
             coalesce((select sum(extract(epoch from (least(mg.se, br.bz) - greatest(mg.sb, br.ba))))
                         from merged mg join brk br on br.bz is not null and br.ba < mg.se and br.bz > mg.sb), 0) / 60 as in_breaks,
             coalesce((select sum(extract(epoch from (br.bz - br.ba))) from brk br where br.bz is not null), 0) / 60 as taken,
             (select count(*) from brk)::int as n,
             (select max(br.ba) from brk br where br.running) as running_since
        into bk;

      -- While someone is still signed in, the day has no logout yet (an earlier break is not "the" logout).
      first_login := agg.first_login;
      last_logout := case when agg.any_open then null else agg.last_logout end;
      session_count := coalesce(agg.n, 0); open_session := agg.any_open;
      incomplete_sessions := coalesce(agg.n_incomplete, 0); corrected := agg.any_corrected;
      worked_minutes := greatest(0, floor(bk.signed_in - bk.in_breaks))::int;
      break_taken_minutes := floor(bk.taken)::int;
      break_count := bk.n;
      on_break := bk.running_since is not null;
      break_started_at := bk.running_since;
      minutes_late := null; minutes_early := null; minutes_overtime := null;

      if first_login is null then
        login_status := case when day_type = 'Working Day' then 'Not Logged In' else day_type end;
      elsif day_type <> 'Working Day' then
        login_status := day_type;
      elsif exempt then
        login_status := 'Exempt';
      else
        minutes_late := greatest(0, floor(extract(epoch from (first_login - scheduled_start)) / 60))::int;
        login_status := case when minutes_late = 0 then 'On Time'
                             when minutes_late <= grace_minutes then 'Within Grace Period'
                             else 'Late' end;
      end if;

      if open_session then
        logout_status := 'Currently Working';
      elsif last_logout is not null then
        if day_type <> 'Working Day' or exempt then
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

-- Same signature and columns as before.
create or replace function private.attendance_rows(p_from date, p_to date, p_member uuid default null)
returns table (
  member_id uuid, member_name text, work_date date, day_type text, holiday_name text, leave_type text,
  scheduled_start timestamptz, scheduled_end timestamptz, grace_minutes int, break_minutes int, tz text,
  first_login timestamptz, last_logout timestamptz, session_count int, open_session boolean, incomplete_sessions int,
  worked_minutes int, minutes_late int, minutes_early int, minutes_overtime int,
  login_status text, logout_status text, corrected boolean, record_id uuid)
language sql stable security definer set search_path = '' as $$
  select x.member_id, x.member_name, x.work_date, x.day_type, x.holiday_name, x.leave_type,
         x.scheduled_start, x.scheduled_end, x.grace_minutes, x.break_minutes, x.tz,
         x.first_login, x.last_logout, x.session_count, x.open_session, x.incomplete_sessions,
         x.worked_minutes, x.minutes_late, x.minutes_early, x.minutes_overtime,
         x.login_status, x.logout_status, x.corrected, x.record_id
  from private.attendance_days(p_from, p_to, p_member) x
$$;

-- Creates review flags for a date range (idempotent; a decided flag is never reopened or overwritten).
create or replace function private.attendance_sync_flags(p_from date, p_to date, p_member uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  r record;
  v_count int := (select a.repeat_flag_count from public.app_settings a limit 1);
  v_window int := (select a.repeat_flag_window_days from public.app_settings a limit 1);
  v_expiry int := (select a.session_expiry_hours from public.app_settings a limit 1);
  v_late_logout int := (select a.late_logout_flag_minutes from public.app_settings a limit 1);
  v_break_grace int := (select a.long_break_grace_minutes from public.app_settings a limit 1);
begin
  for r in select * from private.attendance_days(p_from, p_to, p_member) loop
    if r.login_status = 'Late' then
      insert into public.attendance_flags (member_id, work_date, flag_type, expected_at, actual_at, minutes, reason)
      values (r.member_id, r.work_date, 'Late Login', r.scheduled_start, r.first_login, r.minutes_late,
              format('Signed in %s min after the scheduled start of %s (grace period %s min).',
                     r.minutes_late, to_char(r.scheduled_start at time zone r.tz, 'HH24:MI'), r.grace_minutes))
      on conflict (member_id, work_date, flag_type) do nothing;
    end if;
    -- Early logout is only judged once the scheduled end has passed: signing out for lunch and
    -- coming back is not leaving early.
    if r.logout_status = 'Left Early'
       and (r.work_date < (now() at time zone r.tz)::date or now() >= r.scheduled_end) then
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
    -- Late logout: off unless a threshold is set in Settings.
    if v_late_logout is not null and r.day_type = 'Working Day' and r.minutes_overtime >= v_late_logout then
      insert into public.attendance_flags (member_id, work_date, flag_type, expected_at, actual_at, minutes, reason)
      values (r.member_id, r.work_date, 'Late Logout', r.scheduled_end, r.last_logout, r.minutes_overtime,
              format('Signed out %s min after the scheduled end of %s.',
                     r.minutes_overtime, to_char(r.scheduled_end at time zone r.tz, 'HH24:MI')))
      on conflict (member_id, work_date, flag_type) do nothing;
    end if;
    -- Long break: judged once the scheduled end has passed and no break is running.
    if r.day_type = 'Working Day' and not r.exempt and not r.on_break
       and r.break_taken_minutes > r.break_minutes + v_break_grace
       and (r.work_date < (now() at time zone r.tz)::date or now() >= r.scheduled_end) then
      insert into public.attendance_flags (member_id, work_date, flag_type, minutes, reason)
      values (r.member_id, r.work_date, 'Long Break', r.break_taken_minutes - r.break_minutes,
              format('Breaks totalled %s min against an allowance of %s min (plus %s min grace).',
                     r.break_taken_minutes, r.break_minutes, v_break_grace))
      on conflict (member_id, work_date, flag_type) do nothing;
    end if;
  end loop;

  -- Approved and waived flags do not count towards a repeated flag.
  insert into public.attendance_flags (member_id, work_date, flag_type, minutes, reason)
  select f.member_id, f.work_date, 'Repeated ' || f.flag_type, f.cnt,
         format('%s %s flags in the %s days up to this date.', f.cnt, lower(f.flag_type), v_window)
  from (select f0.member_id, f0.work_date, f0.flag_type,
               (select count(*) from public.attendance_flags g
                 where g.member_id = f0.member_id and g.flag_type = f0.flag_type
                   and coalesce(g.decision, '') not in ('Approved', 'Waived')
                   and g.work_date between f0.work_date - (v_window - 1) and f0.work_date)::int as cnt
          from public.attendance_flags f0
         where f0.flag_type in ('Late Login', 'Early Logout')
           and coalesce(f0.decision, '') not in ('Approved', 'Waived')
           and f0.work_date between p_from and p_to
           and (p_member is null or f0.member_id = p_member)) f
  where f.cnt >= v_count
  on conflict (member_id, work_date, flag_type) do nothing;
end $$;

-- ---------------------------------------------------------------------------
-- Flag history: every status or decision change is recorded, whichever function made it.
-- ---------------------------------------------------------------------------
create or replace function private.attendance_flags_history()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status is distinct from old.status or new.decision is distinct from old.decision then
    insert into public.attendance_flag_actions (flag_id, action, note, actor)
    values (new.id,
            case when new.status = 'Open' then 'Reopened'
                 when new.decision is not null then new.decision
                 else new.status::text end,
            new.review_note,
            coalesce(new.reviewed_by, private.member_for_user()));
  end if;
  return null;
end $$;
create trigger attendance_flags_history after update on public.attendance_flags
  for each row execute function private.attendance_flags_history();

-- Same signature as before. Reopening also clears a decision.
create or replace function public.review_attendance_flag(p_flag uuid, p_status public.flag_review_status, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin() then raise exception 'Only an admin can review attendance flags' using errcode = '42501'; end if;
  update public.attendance_flags
     set status = p_status, review_note = left(btrim(coalesce(p_note, '')), 1000),
         decision = case when p_status = 'Open' then null else decision end,
         reviewed_by = case when p_status = 'Open' then null else private.me() end,
         reviewed_at = case when p_status = 'Open' then null else now() end,
         updated_at = now()
   where id = p_flag;
  if not found then raise exception 'Flag not found' using errcode = 'P0002'; end if;
  perform private.audit('attendance_flag', p_flag, lower(p_status::text), jsonb_build_object('note', p_note));
end $$;

-- Approve, reject or waive one or many exceptions. Only undecided ones change, so a double click or
-- two admins deciding at once can never decide the same exception twice.
create or replace function public.decide_attendance_flags(p_ids uuid[], p_decision text, p_note text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.me();
  v_note text := left(btrim(coalesce(p_note, '')), 1000);
  v_total int := (select count(distinct x) from unnest(coalesce(p_ids, '{}'::uuid[])) x where x is not null);
  v_ids uuid[];
begin
  if not private.is_admin() then raise exception 'Only an admin can decide attendance exceptions' using errcode = '42501'; end if;
  if p_decision is null or p_decision not in ('Approved', 'Rejected', 'Waived') then
    raise exception 'Choose Approve, Reject or Waive' using errcode = '22023';
  end if;
  if v_total = 0 then raise exception 'Select at least one exception' using errcode = '22023'; end if;
  if v_total > 500 then raise exception 'Decide up to 500 exceptions at a time' using errcode = '22023'; end if;
  with done as (
    update public.attendance_flags f
       set status = 'Resolved', decision = p_decision, review_note = v_note,
           reviewed_by = v_me, reviewed_at = now(), updated_at = now()
     where f.id = any (p_ids) and f.status <> 'Resolved'
    returning f.id)
  select coalesce(array_agg(done.id), '{}') into v_ids from done;
  if cardinality(v_ids) > 0 then
    perform private.audit('attendance_flag', null, 'bulk_' || lower(p_decision),
                          jsonb_build_object('count', cardinality(v_ids), 'flags', to_jsonb(v_ids), 'note', v_note));
  end if;
  return jsonb_build_object('decided', cardinality(v_ids), 'skipped', v_total - cardinality(v_ids));
end $$;

create or replace function public.reopen_attendance_flag(p_flag uuid, p_note text default '')
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin() then raise exception 'Only an admin can reopen attendance exceptions' using errcode = '42501'; end if;
  update public.attendance_flags
     set status = 'Open', decision = null, review_note = left(btrim(coalesce(p_note, '')), 1000),
         reviewed_by = null, reviewed_at = null, updated_at = now()
   where id = p_flag and status <> 'Open';
  if not found then
    if exists (select 1 from public.attendance_flags where id = p_flag) then return; end if;
    raise exception 'Exception not found' using errcode = 'P0002';
  end if;
  perform private.audit('attendance_flag', p_flag, 'reopened', jsonb_build_object('note', p_note));
end $$;

-- The exception queue. p_status: 'Open' (open or reviewed), 'Approved', 'Rejected', 'Waived',
-- 'Resolved' (closed before decisions existed, or by a correction), or null for all.
-- Admins see everyone; others see only their own.
create or replace function public.attendance_exceptions(p_from date, p_to date, p_member uuid default null,
                                                        p_team uuid default null, p_status text default null,
                                                        p_type text default null)
returns table (
  id uuid, member_id uuid, member_name text, team_id uuid, team_name text, work_date date, flag_type text,
  expected_at timestamptz, actual_at timestamptz, minutes int, reason text, employee_explanation text,
  status text, decision text, review_note text, reviewed_by uuid, reviewer_name text, reviewed_at timestamptz,
  created_at timestamptz, tz text, history jsonb)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare v_me uuid := private.me();
begin
  if v_me is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 365 then
    raise exception 'Choose a date range of up to a year' using errcode = '22023';
  end if;
  if not private.is_admin() then
    if p_member is not null and p_member <> v_me then
      raise exception 'You can only view your own attendance' using errcode = '42501';
    end if;
    p_member := v_me;
  end if;
  return query
  select f.id, f.member_id, mm.name, tm.team, t.name, f.work_date, f.flag_type,
         f.expected_at, f.actual_at, f.minutes, f.reason, f.employee_explanation,
         f.status::text, f.decision, f.review_note, f.reviewed_by, rv.name, f.reviewed_at, f.created_at,
         coalesce(ar.timezone, private.member_timezone(f.member_id)),
         coalesce((select jsonb_agg(jsonb_build_object('action', fa.action, 'note', fa.note,
                                                       'actor', am.name, 'at', fa.created_at) order by fa.created_at)
                     from public.attendance_flag_actions fa
                     left join public.members am on am.id = fa.actor
                    where fa.flag_id = f.id), '[]'::jsonb)
    from public.attendance_flags f
    join public.members mm on mm.id = f.member_id
    cross join lateral (select private.team_for(f.member_id, f.work_date) as team) tm
    left join public.teams t on t.id = tm.team
    left join public.members rv on rv.id = f.reviewed_by
    left join public.attendance_records ar on ar.member_id = f.member_id and ar.work_date = f.work_date
   where f.work_date between p_from and p_to
     and (p_member is null or f.member_id = p_member)
     and (p_team is null or tm.team = p_team)
     and (p_type is null or f.flag_type = p_type)
     and (p_status is null
          or (p_status = 'Open' and f.status in ('Open', 'Reviewed'))
          or (p_status in ('Approved', 'Rejected', 'Waived') and f.decision = p_status)
          or (p_status = 'Resolved' and f.status = 'Resolved' and f.decision is null))
   order by (f.status <> 'Resolved') desc, f.work_date desc, mm.name, f.flag_type
   limit 1000;
end $$;

-- ---------------------------------------------------------------------------
-- Report with the new columns (the existing attendance_report is unchanged for older screens)
-- ---------------------------------------------------------------------------
create or replace function public.attendance_days_report(p_from date, p_to date, p_member uuid default null,
                                                         p_team uuid default null)
returns table (
  member_id uuid, member_name text, work_date date, day_type text, holiday_name text, leave_type text,
  scheduled_start timestamptz, scheduled_end timestamptz, grace_minutes int, break_minutes int, tz text,
  first_login timestamptz, last_logout timestamptz, session_count int, open_session boolean, incomplete_sessions int,
  worked_minutes int, minutes_late int, minutes_early int, minutes_overtime int,
  login_status text, logout_status text, corrected boolean, record_id uuid,
  exempt boolean, break_taken_minutes int, break_count int, on_break boolean, break_started_at timestamptz,
  team_id uuid, team_name text, schedule_source text,
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
           where f.member_id = r.member_id and f.work_date = r.work_date and f.status <> 'Resolved')::int,
         exists (select 1 from public.attendance_corrections c
                  where c.member_id = r.member_id and c.work_date = r.work_date and c.status = 'Pending')
  from private.attendance_days(p_from, p_to, p_member) r
  where p_team is null or r.team_id = p_team
  order by r.work_date desc, r.member_name;
end $$;

-- ---------------------------------------------------------------------------
-- Breaks
-- ---------------------------------------------------------------------------
create or replace function public.start_break(p_note text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.me();
  v_session public.attendance_sessions;
  v_id uuid;
begin
  if v_me is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('attendance_break:' || v_me::text, 0));
  perform private.attendance_expire(v_me);
  select o.* into v_session from public.attendance_sessions o
   where o.member_id = v_me and o.logout_at is null and o.incomplete_at is null and o.corrected_logout_at is null
   order by o.login_at desc limit 1;
  if v_session.id is null then
    raise exception 'Your work session has ended (signed out or expired). Sign out and sign in again to start a new one.'
      using errcode = '22023';
  end if;
  select b.id into v_id from public.attendance_breaks b
   where b.member_id = v_me and b.end_at is null and b.closed_incomplete_at is null and b.voided_at is null;
  if v_id is not null then return jsonb_build_object('id', v_id, 'already_running', true); end if;
  insert into public.attendance_breaks (member_id, work_date, record_id, session_id, source, start_at, note, entered_by)
  values (v_me, v_session.work_date, v_session.record_id, v_session.id, 'app', now(),
          left(btrim(coalesce(p_note, '')), 500), v_me)
  returning id into v_id;
  perform private.audit('attendance_break', v_id, 'started', '{}'::jsonb);
  return jsonb_build_object('id', v_id, 'already_running', false);
end $$;

-- Ends the running break. Repeating it changes nothing.
create or replace function public.end_break()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.me();
  v_id uuid;
  v_minutes int;
begin
  if v_me is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('attendance_break:' || v_me::text, 0));
  update public.attendance_breaks b set end_at = greatest(now(), b.start_at + interval '1 millisecond'), updated_at = now()
   where b.member_id = v_me and b.end_at is null and b.closed_incomplete_at is null and b.voided_at is null
  returning b.id, floor(extract(epoch from (b.end_at - b.start_at)) / 60)::int into v_id, v_minutes;
  if v_id is null then return jsonb_build_object('id', null, 'minutes', null); end if;
  perform private.audit('attendance_break', v_id, 'ended', jsonb_build_object('minutes', v_minutes));
  return jsonb_build_object('id', v_id, 'minutes', v_minutes);
end $$;

-- A break entered by hand. Employees: their own, today only. Admins: anyone, up to 60 days back.
-- Times are local to the person's schedule time zone that day. The break must fall within signed-in
-- time and must not overlap another break.
create or replace function public.add_attendance_break(p_member uuid, p_date date, p_start time, p_end time,
                                                       p_note text default '')
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.me();
  v_admin boolean := private.is_admin();
  v_who uuid := coalesce(p_member, private.me());
  v_tz text;
  v_today date;
  v_a timestamptz;
  v_z timestamptz;
  v_first timestamptz;
  v_upper timestamptz;
  v_id uuid;
begin
  if v_me is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  if v_who <> v_me and not v_admin then
    raise exception 'Only an admin can add a break for someone else' using errcode = '42501';
  end if;
  perform private.assert_active_member(v_who, 'Employee');
  if p_start is null or p_end is null or p_end <= p_start then
    raise exception 'The break must end after it starts' using errcode = '22023';
  end if;
  v_tz := coalesce((select r.timezone from public.attendance_records r where r.member_id = v_who and r.work_date = p_date),
                   (private.schedule_for(v_who, p_date)).timezone, private.member_timezone(v_who));
  v_today := (now() at time zone v_tz)::date;
  if p_date is null or p_date > v_today then
    raise exception 'Breaks can be added for today or earlier' using errcode = '22023';
  end if;
  if not v_admin and p_date <> v_today then
    raise exception 'You can add a missed break for today only. Ask an admin to add one for an earlier day.' using errcode = '22023';
  end if;
  if p_date < v_today - 60 then
    raise exception 'Breaks can be added for the last 60 days' using errcode = '22023';
  end if;
  v_a := (p_date + p_start) at time zone v_tz;
  v_z := (p_date + p_end) at time zone v_tz;
  if v_z > now() then raise exception 'A break cannot end in the future' using errcode = '22023'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('attendance_break:' || v_who::text, 0));
  select min(coalesce(s.corrected_login_at, s.login_at)),
         case when bool_or(coalesce(s.corrected_logout_at, s.logout_at) is null) then now()
              else max(coalesce(s.corrected_logout_at, s.logout_at)) end
    into v_first, v_upper
    from public.attendance_sessions s where s.member_id = v_who and s.work_date = p_date;
  if v_first is null then
    raise exception 'There is no sign-in that day, so there is no break to record' using errcode = '22023';
  end if;
  if v_a < v_first or v_z > v_upper then
    raise exception 'The break must fall between the first sign-in (%) and the last sign-out (%) that day',
      to_char(v_first at time zone v_tz, 'HH24:MI'), to_char(v_upper at time zone v_tz, 'HH24:MI') using errcode = '22023';
  end if;
  if exists (select 1 from public.attendance_breaks b
              where b.member_id = v_who and b.voided_at is null
                and b.start_at < v_z
                and coalesce(b.end_at, case when b.closed_incomplete_at is null then 'infinity'::timestamptz end, b.start_at) > v_a) then
    raise exception 'This overlaps a break that is already recorded' using errcode = '23514';
  end if;
  insert into public.attendance_breaks (member_id, work_date, record_id, source, start_at, end_at, note, entered_by)
  values (v_who, p_date, private.attendance_record_for(v_who, p_date), 'manual', v_a, v_z,
          left(btrim(coalesce(p_note, '')), 500), v_me)
  returning id into v_id;
  perform private.audit('attendance_break', v_id, 'added', jsonb_build_object(
    'member', v_who, 'date', p_date, 'start', v_a, 'end', v_z, 'note', p_note));
  perform private.attendance_sync_flags(p_date, p_date, v_who);
  return v_id;
end $$;

-- Removes a break from the calculations (the row is kept, marked as removed).
create or replace function public.void_attendance_break(p_id uuid, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin() then raise exception 'Only an admin can remove a break' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_note, ''))) < 3 then
    raise exception 'Say why the break is being removed' using errcode = '22023';
  end if;
  update public.attendance_breaks
     set voided_at = now(), voided_by = private.me(), void_note = left(btrim(p_note), 500), updated_at = now()
   where id = p_id and voided_at is null;
  if not found then raise exception 'Break not found' using errcode = 'P0002'; end if;
  perform private.audit('attendance_break', p_id, 'removed', jsonb_build_object('note', p_note));
end $$;

-- ---------------------------------------------------------------------------
-- Teams, default hours and following them
-- ---------------------------------------------------------------------------
create or replace function public.admin_save_team(p_id uuid, p_name text, p_note text default '', p_active boolean default true)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not private.is_admin() then raise exception 'Only an admin can manage teams' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_name, ''))) not between 1 and 60 then
    raise exception 'Give the team a name of up to 60 characters' using errcode = '22023';
  end if;
  begin
    if p_id is null then
      insert into public.teams (name, note, is_active, created_by)
      values (btrim(p_name), left(btrim(coalesce(p_note, '')), 500), coalesce(p_active, true), private.me())
      returning id into v_id;
      perform private.audit('team', v_id, 'created', jsonb_build_object('name', btrim(p_name)));
    else
      update public.teams set name = btrim(p_name), note = left(btrim(coalesce(p_note, '')), 500),
             is_active = coalesce(p_active, is_active), updated_at = now()
       where id = p_id
      returning id into v_id;
      if v_id is null then raise exception 'Team not found' using errcode = 'P0002'; end if;
      perform private.audit('team', v_id, 'updated', jsonb_build_object('name', btrim(p_name), 'active', p_active));
    end if;
  exception when unique_violation then
    raise exception 'A team with that name already exists' using errcode = '23505';
  end;
  return v_id;
end $$;

-- Puts a person in a team (or no team, when p_team is null) from a date: today or later.
create or replace function public.admin_set_member_team(p_member uuid, p_team uuid, p_from date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not private.is_admin() then raise exception 'Only an admin can change teams' using errcode = '42501'; end if;
  perform private.assert_active_member(p_member, 'Employee');
  if p_team is not null and not exists (select 1 from public.teams t where t.id = p_team and t.is_active) then
    raise exception 'Choose an active team' using errcode = '23514';
  end if;
  if p_from is null or p_from < private.today() then
    raise exception 'A team change can start today or later; past days keep the team they had' using errcode = '22023';
  end if;
  insert into public.member_teams (member_id, team_id, effective_from, created_by)
  values (p_member, p_team, p_from, private.me())
  on conflict (member_id, effective_from) do update set team_id = excluded.team_id, created_by = excluded.created_by,
                                                        updated_at = now()
  returning id into v_id;
  perform private.audit('member', p_member, 'team_set', jsonb_build_object('team', p_team, 'from', p_from));
  return v_id;
end $$;

-- Company default (p_team null) or a team's default hours, from today or later.
create or replace function public.admin_set_default_schedule(p_team uuid, p_effective_from date, p_start time, p_end time,
                                                             p_days int[], p_break int, p_grace int, p_timezone text,
                                                             p_note text default '')
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_days smallint[];
begin
  if not private.is_admin() then raise exception 'Only an admin can change default hours' using errcode = '42501'; end if;
  if p_team is not null and not exists (select 1 from public.teams t where t.id = p_team) then
    raise exception 'Team not found' using errcode = 'P0002';
  end if;
  if p_timezone is null or not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = p_timezone) then
    raise exception 'Unknown time zone' using errcode = '22023';
  end if;
  if p_effective_from is null or p_effective_from < (now() at time zone p_timezone)::date then
    raise exception 'A change to default hours can start today or later; past days keep the hours they had' using errcode = '22023';
  end if;
  if p_start is null or p_end is null or p_end <= p_start then
    raise exception 'The end time must be after the start time' using errcode = '22023';
  end if;
  v_days := (select array_agg(distinct x order by x) from unnest(p_days) x where x is not null)::smallint[];
  if v_days is null or not (v_days <@ '{1,2,3,4,5,6,7}'::smallint[]) then
    raise exception 'Choose at least one working day' using errcode = '22023';
  end if;
  insert into public.schedule_defaults (team_id, effective_from, start_time, end_time, working_days,
                                        break_minutes, grace_minutes, timezone, note, created_by)
  values (p_team, p_effective_from, p_start, p_end, v_days, p_break, p_grace, p_timezone,
          left(btrim(coalesce(p_note, '')), 500), private.me())
  on conflict (team_id, effective_from) do update set
    start_time = excluded.start_time, end_time = excluded.end_time, working_days = excluded.working_days,
    break_minutes = excluded.break_minutes, grace_minutes = excluded.grace_minutes, timezone = excluded.timezone,
    note = excluded.note, created_by = excluded.created_by, updated_at = now()
  returning id into v_id;
  perform private.audit('schedule_default', v_id, 'set', jsonb_build_object(
    'team', p_team, 'from', p_effective_from, 'start', p_start, 'end', p_end, 'days', v_days,
    'break', p_break, 'grace', p_grace, 'timezone', p_timezone));
  return v_id;
end $$;

-- From a date, the person's hours come from their team's default (or the company default).
-- The row also stores the hours in force at that moment, used only if no default exists later.
create or replace function public.admin_follow_default(p_member uuid, p_effective_from date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  cur public.work_schedules;
  dflt public.schedule_defaults;
begin
  if not private.is_admin() then raise exception 'Only an admin can change work schedules' using errcode = '42501'; end if;
  perform private.assert_active_member(p_member, 'Employee');
  if p_effective_from is null or p_effective_from < private.today() then
    raise exception 'A schedule change can start today or later; past days keep the schedule they had' using errcode = '22023';
  end if;
  dflt := private.default_for(private.team_for(p_member, p_effective_from), p_effective_from);
  cur := private.schedule_for(p_member, p_effective_from);
  insert into public.work_schedules (member_id, effective_from, start_time, end_time, working_days, break_minutes,
                                     grace_minutes, timezone, note, created_by, follows_default)
  values (p_member, p_effective_from,
          coalesce(dflt.start_time, cur.start_time, '10:00'), coalesce(dflt.end_time, cur.end_time, '19:00'),
          coalesce(dflt.working_days, cur.working_days, '{1,2,3,4,5,6}'),
          coalesce(dflt.break_minutes, cur.break_minutes, 60), coalesce(dflt.grace_minutes, cur.grace_minutes, 10),
          coalesce(dflt.timezone, cur.timezone, (select timezone from public.app_settings limit 1), 'Asia/Kolkata'),
          'Follows the team or company default hours.', private.me(), true)
  on conflict (member_id, effective_from) do update set
    start_time = excluded.start_time, end_time = excluded.end_time, working_days = excluded.working_days,
    break_minutes = excluded.break_minutes, grace_minutes = excluded.grace_minutes, timezone = excluded.timezone,
    note = excluded.note, created_by = excluded.created_by, follows_default = true, updated_at = now()
  returning id into v_id;
  perform private.audit('schedule', v_id, 'follow_default', jsonb_build_object('member', p_member, 'from', p_effective_from));
  return v_id;
end $$;

-- Same signature as before; a personal schedule now also stops following the defaults.
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
                                     break_minutes, grace_minutes, timezone, note, created_by, follows_default)
  values (p_member, p_effective_from, p_start, p_end, p_days::smallint[], p_break, p_grace, p_timezone,
          left(btrim(coalesce(p_note, '')), 500), private.me(), false)
  on conflict (member_id, effective_from) do update set
    start_time = excluded.start_time, end_time = excluded.end_time, working_days = excluded.working_days,
    break_minutes = excluded.break_minutes, grace_minutes = excluded.grace_minutes, timezone = excluded.timezone,
    note = excluded.note, created_by = excluded.created_by, follows_default = false, updated_at = now()
  returning id into v_id;
  perform private.audit('schedule', v_id, 'set', jsonb_build_object(
    'member', p_member, 'from', p_effective_from, 'start', p_start, 'end', p_end, 'days', p_days,
    'break', p_break, 'grace', p_grace, 'timezone', p_timezone));
  return v_id;
end $$;

-- New members follow the defaults from the day they are added.
create or replace function private.default_schedule(p_member uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare dflt public.schedule_defaults := private.default_for(null, private.today());
begin
  insert into public.work_schedules (member_id, effective_from, start_time, end_time, working_days,
                                     break_minutes, grace_minutes, timezone, note, follows_default)
  values (p_member, private.today(), coalesce(dflt.start_time, '10:00'), coalesce(dflt.end_time, '19:00'),
          coalesce(dflt.working_days, '{1,2,3,4,5,6}'), coalesce(dflt.break_minutes, 60), coalesce(dflt.grace_minutes, 10),
          coalesce(dflt.timezone, (select timezone from public.app_settings limit 1), 'Asia/Kolkata'),
          'Follows the team or company default hours. Set a personal schedule on Attendance > Schedules if needed.', true)
  on conflict (member_id, effective_from) do nothing;
end $$;

-- What each person's hours are on a date and where they come from. Admins: everyone; others: themselves.
create or replace function public.schedule_overview(p_date date default null)
returns table (
  member_id uuid, member_name text, is_active boolean, team_id uuid, team_name text, source text,
  follows_default boolean, personal_from date, start_time time, end_time time, working_days smallint[],
  break_minutes int, grace_minutes int, timezone text, exempt boolean)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_me uuid := private.me();
  v_date date := coalesce(p_date, private.today());
begin
  if v_me is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  return query
  select mm.id, mm.name, mm.is_active, pk.team, t.name, pk.source,
         coalesce((pk.sched).follows_default, false), (pk.sched).effective_from,
         (pk.sched).start_time, (pk.sched).end_time, (pk.sched).working_days,
         (pk.sched).break_minutes, (pk.sched).grace_minutes, (pk.sched).timezone,
         private.is_exempt(mm.id, v_date)
    from public.members mm
    cross join lateral private.schedule_pick(mm.id, v_date) pk
    left join public.teams t on t.id = pk.team
   where (private.is_admin() or mm.id = v_me)
   order by mm.is_active desc, mm.name;
end $$;

-- ---------------------------------------------------------------------------
-- Exemptions
-- ---------------------------------------------------------------------------
create or replace function public.admin_add_exemption(p_member uuid, p_start date, p_end date, p_note text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not private.is_admin() then raise exception 'Only an admin can manage exemptions' using errcode = '42501'; end if;
  perform private.assert_active_member(p_member, 'Employee');
  if p_start is null or p_start < private.today() then
    raise exception 'An exemption can start today or later; past days keep the rules they had' using errcode = '22023';
  end if;
  if p_end is not null and p_end < p_start then
    raise exception 'The end date is before the start date' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_note, ''))) < 3 then
    raise exception 'Say why the person is exempt' using errcode = '22023';
  end if;
  insert into public.attendance_exemptions (member_id, start_date, end_date, note, created_by)
  values (p_member, p_start, p_end, left(btrim(p_note), 500), private.me())
  returning id into v_id;
  perform private.audit('attendance_exemption', v_id, 'created', jsonb_build_object(
    'member', p_member, 'start', p_start, 'end', p_end, 'note', p_note));
  return v_id;
end $$;

-- Switches an exemption off from tomorrow (today keeps it, so a day in progress is not re-judged).
create or replace function public.admin_end_exemption(p_id uuid, p_note text default '')
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin() then raise exception 'Only an admin can manage exemptions' using errcode = '42501'; end if;
  update public.attendance_exemptions
     set ended_from = private.today() + 1, ended_by = private.me(), ended_at = now(),
         end_note = left(btrim(coalesce(p_note, '')), 500), updated_at = now()
   where id = p_id and ended_from is null;
  if not found then raise exception 'Exemption not found or already ended' using errcode = 'P0002'; end if;
  perform private.audit('attendance_exemption', p_id, 'ended', jsonb_build_object('note', p_note));
end $$;

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------
create or replace function public.admin_update_attendance_settings(p_late_logout_minutes int, p_long_break_grace int)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin() then raise exception 'Only an admin can change settings' using errcode = '42501'; end if;
  if p_late_logout_minutes is not null and p_late_logout_minutes not between 15 and 600 then
    raise exception 'The late sign-out threshold must be between 15 and 600 minutes, or off' using errcode = '22023';
  end if;
  if p_long_break_grace is null or p_long_break_grace not between 0 and 120 then
    raise exception 'The break grace must be between 0 and 120 minutes' using errcode = '22023';
  end if;
  update public.app_settings set late_logout_flag_minutes = p_late_logout_minutes,
         long_break_grace_minutes = p_long_break_grace, updated_at = now()
   where id;
  perform private.audit('settings', null, 'attendance_updated', jsonb_build_object(
    'late_logout_minutes', p_late_logout_minutes, 'long_break_grace', p_long_break_grace));
end $$;

-- ---------------------------------------------------------------------------
-- Starting point (inserts only): a company default equal to today's default hours, and the people
-- still on the untouched automatic default follow it from today. Nobody's hours change.
-- ---------------------------------------------------------------------------
insert into public.schedule_defaults (team_id, effective_from, start_time, end_time, working_days,
                                      break_minutes, grace_minutes, timezone, note)
select null, private.today(), '10:00', '19:00', '{1,2,3,4,5,6}', 60, 10,
       coalesce((select timezone from public.app_settings limit 1), 'Asia/Kolkata'), 'Company default hours.'
where not exists (select 1 from public.schedule_defaults);

insert into public.work_schedules (member_id, effective_from, start_time, end_time, working_days, break_minutes,
                                   grace_minutes, timezone, note, follows_default)
select s.member_id, private.today(), s.start_time, s.end_time, s.working_days, s.break_minutes, s.grace_minutes,
       s.timezone, 'Follows the team or company default hours.', true
from public.work_schedules s
join public.members m on m.id = s.member_id and m.is_active
where s.created_by is null and not s.follows_default
  and s.note like 'Default schedule.%'
  and s.start_time = '10:00' and s.end_time = '19:00' and s.working_days = '{1,2,3,4,5,6}'
  and s.break_minutes = 60 and s.grace_minutes = 10
  and s.effective_from = (select max(x.effective_from) from public.work_schedules x where x.member_id = s.member_id)
  and s.effective_from < private.today()
on conflict (member_id, effective_from) do nothing;

-- ---------------------------------------------------------------------------
-- Row level security. Nothing new is writable through the API; every change goes through the
-- functions above.
-- ---------------------------------------------------------------------------
alter table public.teams enable row level security;
alter table public.member_teams enable row level security;
alter table public.schedule_defaults enable row level security;
alter table public.attendance_exemptions enable row level security;
alter table public.attendance_flag_actions enable row level security;
alter table public.attendance_breaks enable row level security;

revoke all on public.teams, public.member_teams, public.schedule_defaults, public.attendance_exemptions,
              public.attendance_flag_actions, public.attendance_breaks from anon, authenticated;
grant select on public.teams, public.member_teams, public.schedule_defaults, public.attendance_exemptions,
                public.attendance_flag_actions, public.attendance_breaks to authenticated;

create policy teams_read on public.teams for select to authenticated using (private.me() is not null);
create policy schedule_defaults_read on public.schedule_defaults for select to authenticated using (private.me() is not null);
create policy member_teams_read on public.member_teams for select to authenticated
  using (private.is_admin() or member_id = private.me());
create policy exemptions_read on public.attendance_exemptions for select to authenticated
  using (private.is_admin() or member_id = private.me());
create policy breaks_read on public.attendance_breaks for select to authenticated
  using (private.is_admin() or member_id = private.me());
create policy flag_actions_read on public.attendance_flag_actions for select to authenticated
  using (private.is_admin() or exists (select 1 from public.attendance_flags f
                                        where f.id = flag_id and f.member_id = private.me()));

revoke execute on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated;

revoke execute on function
  public.decide_attendance_flags(uuid[], text, text),
  public.reopen_attendance_flag(uuid, text),
  public.attendance_exceptions(date, date, uuid, uuid, text, text),
  public.attendance_days_report(date, date, uuid, uuid),
  public.start_break(text),
  public.end_break(),
  public.add_attendance_break(uuid, date, time, time, text),
  public.void_attendance_break(uuid, text),
  public.admin_save_team(uuid, text, text, boolean),
  public.admin_set_member_team(uuid, uuid, date),
  public.admin_set_default_schedule(uuid, date, time, time, int[], int, int, text, text),
  public.admin_follow_default(uuid, date),
  public.schedule_overview(date),
  public.admin_add_exemption(uuid, date, date, text),
  public.admin_end_exemption(uuid, text),
  public.admin_update_attendance_settings(int, int)
from public, anon;
grant execute on function
  public.decide_attendance_flags(uuid[], text, text),
  public.reopen_attendance_flag(uuid, text),
  public.attendance_exceptions(date, date, uuid, uuid, text, text),
  public.attendance_days_report(date, date, uuid, uuid),
  public.start_break(text),
  public.end_break(),
  public.add_attendance_break(uuid, date, time, time, text),
  public.void_attendance_break(uuid, text),
  public.admin_save_team(uuid, text, text, boolean),
  public.admin_set_member_team(uuid, uuid, date),
  public.admin_set_default_schedule(uuid, date, time, time, int[], int, int, text, text),
  public.admin_follow_default(uuid, date),
  public.schedule_overview(date),
  public.admin_add_exemption(uuid, date, date, text),
  public.admin_end_exemption(uuid, text),
  public.admin_update_attendance_settings(int, int)
to authenticated;
