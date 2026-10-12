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

      -- While someone is still signed in, the day has no logout yet (an earlier break is not "the" logout).
      first_login := agg.first_login;
      last_logout := case when agg.any_open then null else agg.last_logout end;
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
