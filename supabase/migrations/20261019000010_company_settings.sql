-- OpsPulse Workspace: phase 3, company settings.
--
-- Adds the company profile (name, tagline, brand colours, logo), daily motivational quotes, and
-- weekly-off swaps (a Holiday Swap leave can now name a weekly off as well as a company holiday).
--
-- Safe for a live database: this migration only adds tables, a validation trigger, indexes and
-- functions, and replaces two existing functions in place with the same signatures and return
-- types (private.attendance_days and private.attendance_record_for). No row is deleted or
-- overwritten. Starting rows: 20 public-domain starter quotes, which the admin can archive.
--
-- Rules:
--   * With no company profile saved, the app looks exactly as before.
--   * The logo is a PNG, JPEG or WebP image of at most 300 KB, checked by its file signature.
--     SVG is not accepted, because an SVG file can carry scripts.
--   * Everyone sees the same quote on a given day. The next quote is the active one shown the
--     fewest times (then by the admin's order), so no quote repeats until all have been shown.
--   * A weekly off named in a Holiday Swap becomes a normal working day for that person, the same
--     way a swapped company holiday already does. Leave rows without a weekly-off swap, and past
--     days without one, are calculated exactly as before.

-- ---------------------------------------------------------------------------
-- Company profile and branding (one row, id = 1; absent until the admin saves it)
-- ---------------------------------------------------------------------------
create table if not exists public.company_profile (
  id smallint primary key default 1 check (id = 1),
  company_name text check (company_name is null or length(btrim(company_name)) between 1 and 60),
  tagline text check (tagline is null or length(tagline) <= 80),
  brand_primary text check (brand_primary is null or brand_primary ~ '^#[0-9a-f]{6}$'),
  brand_secondary text check (brand_secondary is null or brand_secondary ~ '^#[0-9a-f]{6}$'),
  brand_accent text check (brand_accent is null or brand_accent ~ '^#[0-9a-f]{6}$'),
  logo_mime text check (logo_mime is null or logo_mime in ('image/png', 'image/jpeg', 'image/webp')),
  logo_data text check (logo_data is null or length(logo_data) <= 409600),
  logo_updated_at timestamptz,
  updated_by uuid references public.members (id) on delete set null,
  updated_at timestamptz not null default now(),
  check ((logo_mime is null) = (logo_data is null))
);
comment on column public.company_profile.logo_data is 'Base64 of the logo image (at most 300 KB decoded).';

-- Read by the sign-in page too, so it is available before sign-in. It holds nothing private.
create or replace function public.brand_settings()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce((
    select jsonb_build_object(
             'company_name', p.company_name, 'tagline', p.tagline,
             'primary', p.brand_primary, 'secondary', p.brand_secondary, 'accent', p.brand_accent,
             'logo_version', case when p.logo_data is not null then floor(extract(epoch from p.logo_updated_at))::bigint end)
      from public.company_profile p where p.id = 1), '{}'::jsonb)
$$;

create or replace function public.brand_logo()
returns table (mime text, data text) language sql stable security definer set search_path = '' as $$
  select p.logo_mime, p.logo_data from public.company_profile p where p.id = 1 and p.logo_data is not null
$$;

-- Blank values go back to the default look. Readability (contrast) is checked by the app before
-- saving; here only the format is enforced.
create or replace function public.admin_update_branding(p_company_name text, p_tagline text,
                                                        p_primary text, p_secondary text, p_accent text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_name text := nullif(btrim(coalesce(p_company_name, '')), '');
  v_tagline text := nullif(btrim(coalesce(p_tagline, '')), '');
  v_primary text := nullif(lower(btrim(coalesce(p_primary, ''))), '');
  v_secondary text := nullif(lower(btrim(coalesce(p_secondary, ''))), '');
  v_accent text := nullif(lower(btrim(coalesce(p_accent, ''))), '');
begin
  if not private.is_admin() then raise exception 'Only an admin can change the company settings' using errcode = '42501'; end if;
  if v_name is not null and length(v_name) > 60 then
    raise exception 'Keep the company name to 60 characters' using errcode = '22023';
  end if;
  if v_tagline is not null and length(v_tagline) > 80 then
    raise exception 'Keep the tagline to 80 characters' using errcode = '22023';
  end if;
  if (v_primary is not null and v_primary !~ '^#[0-9a-f]{6}$')
     or (v_secondary is not null and v_secondary !~ '^#[0-9a-f]{6}$')
     or (v_accent is not null and v_accent !~ '^#[0-9a-f]{6}$') then
    raise exception 'Colours must be written like #1f3a5f' using errcode = '22023';
  end if;
  insert into public.company_profile as cp (id, company_name, tagline, brand_primary, brand_secondary, brand_accent, updated_by, updated_at)
  values (1, v_name, v_tagline, v_primary, v_secondary, v_accent, private.me(), now())
  on conflict (id) do update
    set company_name = excluded.company_name, tagline = excluded.tagline,
        brand_primary = excluded.brand_primary, brand_secondary = excluded.brand_secondary,
        brand_accent = excluded.brand_accent, updated_by = excluded.updated_by, updated_at = now();
  perform private.audit('company_profile', null, 'branding_updated', jsonb_build_object(
    'company_name', v_name, 'tagline', v_tagline, 'primary', v_primary, 'secondary', v_secondary, 'accent', v_accent));
end $$;

-- p_data null removes the logo. Otherwise p_data is base64 and must match the declared type.
create or replace function public.admin_set_logo(p_mime text, p_data text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_bytes bytea;
  v_ok boolean;
begin
  if not private.is_admin() then raise exception 'Only an admin can change the logo' using errcode = '42501'; end if;
  if p_data is null then
    insert into public.company_profile as cp (id, logo_mime, logo_data, logo_updated_at, updated_by, updated_at)
    values (1, null, null, now(), private.me(), now())
    on conflict (id) do update
      set logo_mime = null, logo_data = null, logo_updated_at = now(), updated_by = excluded.updated_by, updated_at = now();
    perform private.audit('company_profile', null, 'logo_removed', '{}'::jsonb);
    return;
  end if;
  if p_mime is null or p_mime not in ('image/png', 'image/jpeg', 'image/webp') then
    raise exception 'The logo must be a PNG, JPEG or WebP image' using errcode = '22023';
  end if;
  if length(p_data) > 409600 then
    raise exception 'The logo must be 300 KB or smaller' using errcode = '22023';
  end if;
  begin
    v_bytes := decode(p_data, 'base64');
  exception when others then
    raise exception 'The logo file could not be read' using errcode = '22023';
  end;
  v_ok := case p_mime
            when 'image/png' then substring(v_bytes from 1 for 8) = '\x89504e470d0a1a0a'::bytea
            when 'image/jpeg' then substring(v_bytes from 1 for 3) = '\xffd8ff'::bytea
            when 'image/webp' then substring(v_bytes from 1 for 4) = '\x52494646'::bytea
                               and substring(v_bytes from 9 for 4) = '\x57454250'::bytea
          end;
  if not coalesce(v_ok, false) then
    raise exception 'That file is not a valid PNG, JPEG or WebP image' using errcode = '22023';
  end if;
  insert into public.company_profile as cp (id, logo_mime, logo_data, logo_updated_at, updated_by, updated_at)
  values (1, p_mime, p_data, now(), private.me(), now())
  on conflict (id) do update
    set logo_mime = excluded.logo_mime, logo_data = excluded.logo_data, logo_updated_at = now(),
        updated_by = excluded.updated_by, updated_at = now();
  perform private.audit('company_profile', null, 'logo_updated', jsonb_build_object('type', p_mime, 'bytes', octet_length(v_bytes)));
end $$;

-- ---------------------------------------------------------------------------
-- Motivational quotes
-- ---------------------------------------------------------------------------
create table if not exists public.quotes (
  id uuid primary key default gen_random_uuid(),
  body text not null check (length(btrim(body)) between 1 and 300),
  author text not null default '' check (length(author) <= 80),
  sort_order int not null,
  is_active boolean not null default true,
  archived_at timestamptz,
  created_by uuid references public.members (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists quotes_order on public.quotes (sort_order, created_at);

-- Which quote was shown on which day (kept, so the rotation can avoid repeats).
create table if not exists public.quote_days (
  day date primary key,
  quote_id uuid not null references public.quotes (id) on delete restrict,
  created_at timestamptz not null default now()
);
create index if not exists quote_days_quote on public.quote_days (quote_id);

create or replace function public.quote_of_the_day()
returns table (id uuid, body text, author text)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_day date := private.today();
  v_quote uuid;
begin
  if private.me() is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  select qd.quote_id into v_quote
    from public.quote_days qd join public.quotes q on q.id = qd.quote_id
   where qd.day = v_day and q.is_active;
  if v_quote is null then
    select q.id into v_quote from public.quotes q
     where q.is_active
     order by (select count(*) from public.quote_days d where d.quote_id = q.id and d.day < v_day), q.sort_order, q.created_at
     limit 1;
    if v_quote is null then return; end if;
    -- Today's pick is shared by everyone. It is only replaced if it was archived since.
    insert into public.quote_days as cur (day, quote_id) values (v_day, v_quote)
    on conflict (day) do update set quote_id = excluded.quote_id
      where not exists (select 1 from public.quotes q where q.id = cur.quote_id and q.is_active);
    select qd.quote_id into v_quote from public.quote_days qd where qd.day = v_day;
  end if;
  return query select q.id, q.body, q.author from public.quotes q where q.id = v_quote;
end $$;

-- p_id null adds a quote at the end of the list.
create or replace function public.admin_save_quote(p_id uuid, p_body text, p_author text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_body text := btrim(coalesce(p_body, ''));
  v_author text := btrim(coalesce(p_author, ''));
begin
  if not private.is_admin() then raise exception 'Only an admin can manage quotes' using errcode = '42501'; end if;
  if length(v_body) not between 1 and 300 then
    raise exception 'Write a quote of up to 300 characters' using errcode = '22023';
  end if;
  if length(v_author) > 80 then
    raise exception 'Keep the author to 80 characters' using errcode = '22023';
  end if;
  if p_id is null then
    insert into public.quotes (body, author, sort_order, created_by)
    values (v_body, v_author, coalesce((select max(q.sort_order) from public.quotes q), 0) + 1, private.me())
    returning id into v_id;
    perform private.audit('quote', v_id, 'created', jsonb_build_object('body', v_body, 'author', v_author));
  else
    update public.quotes set body = v_body, author = v_author, updated_at = now() where id = p_id
    returning id into v_id;
    if v_id is null then raise exception 'Quote not found' using errcode = 'P0002'; end if;
    perform private.audit('quote', v_id, 'updated', jsonb_build_object('body', v_body, 'author', v_author));
  end if;
  return v_id;
end $$;

-- Archiving hides a quote from the rotation; it can be restored. Quotes are never deleted.
create or replace function public.admin_set_quote_active(p_id uuid, p_active boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin() then raise exception 'Only an admin can manage quotes' using errcode = '42501'; end if;
  update public.quotes
     set is_active = coalesce(p_active, true),
         archived_at = case when coalesce(p_active, true) then null else now() end,
         updated_at = now()
   where id = p_id;
  if not found then raise exception 'Quote not found' using errcode = 'P0002'; end if;
  perform private.audit('quote', p_id, case when coalesce(p_active, true) then 'restored' else 'archived' end, '{}'::jsonb);
end $$;

-- Swaps a quote with its neighbour in the list (p_up true = earlier).
create or replace function public.admin_move_quote(p_id uuid, p_up boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me_q public.quotes;
  other public.quotes;
begin
  if not private.is_admin() then raise exception 'Only an admin can manage quotes' using errcode = '42501'; end if;
  select q.* into me_q from public.quotes q where q.id = p_id for update;
  if me_q.id is null then raise exception 'Quote not found' using errcode = 'P0002'; end if;
  if p_up then
    select q.* into other from public.quotes q
     where (q.sort_order, q.created_at) < (me_q.sort_order, me_q.created_at)
     order by q.sort_order desc, q.created_at desc limit 1 for update;
  else
    select q.* into other from public.quotes q
     where (q.sort_order, q.created_at) > (me_q.sort_order, me_q.created_at)
     order by q.sort_order, q.created_at limit 1 for update;
  end if;
  if other.id is null then return; end if;
  if other.sort_order = me_q.sort_order then
    -- Same position (should not happen): give this quote its own slot next to the other one.
    update public.quotes set sort_order = other.sort_order + case when p_up then -1 else 1 end, updated_at = now() where id = me_q.id;
  else
    update public.quotes set sort_order = other.sort_order, updated_at = now() where id = me_q.id;
    update public.quotes set sort_order = me_q.sort_order, updated_at = now() where id = other.id;
  end if;
end $$;

insert into public.quotes (body, author, sort_order)
select v.body, v.author, v.n
  from (values
    (1, 'Well done is better than well said.', 'Benjamin Franklin'),
    (2, 'Well begun is half done.', 'Aristotle'),
    (3, 'Knowing is not enough; we must apply. Willing is not enough; we must do.', 'Johann Wolfgang von Goethe'),
    (4, 'Little strokes fell great oaks.', 'Benjamin Franklin'),
    (5, 'A journey of a thousand miles begins with a single step.', 'Laozi'),
    (6, 'Things won are done; joy''s soul lies in the doing.', 'William Shakespeare'),
    (7, 'Great works are performed not by strength but by perseverance.', 'Samuel Johnson'),
    (8, 'It is not enough to be busy; so are the ants. The question is: what are we busy about?', 'Henry David Thoreau'),
    (9, 'Lost time is never found again.', 'Benjamin Franklin'),
    (10, 'Waste no more time arguing about what a good man should be. Be one.', 'Marcus Aurelius'),
    (11, 'Many hands make light work.', 'Proverb'),
    (12, 'Whatever is worth doing at all is worth doing well.', 'Lord Chesterfield'),
    (13, 'The best way out is always through.', 'Robert Frost'),
    (14, 'First say to yourself what you would be; and then do what you have to do.', 'Epictetus'),
    (15, 'Diligence is the mother of good luck.', 'Benjamin Franklin'),
    (16, 'Our doubts are traitors, and make us lose the good we oft might win, by fearing to attempt.', 'William Shakespeare'),
    (17, 'Genius is one per cent inspiration and ninety-nine per cent perspiration.', 'Thomas Edison'),
    (18, 'They can because they think they can.', 'Virgil'),
    (19, 'Rome was not built in a day.', 'Proverb'),
    (20, 'Make hay while the sun shines.', 'Proverb')
  ) as v (n, body, author)
 where not exists (select 1 from public.quotes);

-- ---------------------------------------------------------------------------
-- Weekly-off swaps
-- ---------------------------------------------------------------------------
-- True when the date is outside the person's working days (their schedule in force that day).
create or replace function private.is_weekly_off(p_member uuid, p_date date)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare pk record;
begin
  select * into pk from private.schedule_pick(p_member, p_date);
  if (pk.sched).id is null then return false; end if;
  return not (extract(isodow from p_date)::smallint = any ((pk.sched).working_days));
end $$;

-- True when the person works this day in exchange for a Holiday Swap day off.
create or replace function private.swap_workday(p_member uuid, p_date date)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.leaves l where l.member_id = p_member and l.swap_for_date = p_date)
$$;

-- Checks the day a Holiday Swap names: a company holiday or one of the person's weekly offs,
-- outside the leave dates, and not already swapped. Only runs when that day or the dates change,
-- so editing an existing leave's note never fails.
create or replace function private.leaves_swap_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.swap_for_date is null then return new; end if;
  if tg_op = 'UPDATE' and new.swap_for_date is not distinct from old.swap_for_date
     and new.member_id = old.member_id and new.start_date = old.start_date and new.end_date = old.end_date then
    return new;
  end if;
  if new.swap_for_date between new.start_date and new.end_date then
    raise exception 'The day you will work cannot fall inside the leave dates' using errcode = '22023';
  end if;
  if not exists (select 1 from public.holidays h where h.holiday_date = new.swap_for_date)
     and not private.is_weekly_off(new.member_id, new.swap_for_date) then
    raise exception '% is not a company holiday or a weekly off for this person', to_char(new.swap_for_date, 'FMDD-Mon-YY')
      using errcode = '22023';
  end if;
  if exists (select 1 from public.leaves l
              where l.member_id = new.member_id and l.swap_for_date = new.swap_for_date and l.id <> new.id) then
    raise exception 'This person already has a Holiday Swap for %', to_char(new.swap_for_date, 'FMDD-Mon-YY')
      using errcode = '23505';
  end if;
  return new;
end $$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'leaves_swap_guard' and tgrelid = 'public.leaves'::regclass) then
    create trigger leaves_swap_guard before insert or update on public.leaves
      for each row execute function private.leaves_swap_guard();
  end if;
end $$;

-- Same signature as before; a swapped weekly off is recorded as a working day.
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
          coalesce(extract(isodow from p_date)::smallint = any (s.working_days), false)
            or private.swap_workday(p_member, p_date),
          coalesce(s.timezone, private.member_timezone(p_member)))
  on conflict (member_id, work_date) do nothing
  returning id into v_id;
  if v_id is null then
    select r.id into v_id from public.attendance_records r where r.member_id = p_member and r.work_date = p_date;
  end if;
  return v_id;
end $$;

-- Same signature and columns as before; a swapped weekly off counts as a working day.
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
      -- A weekly off this person swapped (works it in exchange for a Holiday Swap day) is a working day.
      if not v_working and private.swap_workday(m.id, d) then v_working := true; end if;

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
-- ---------------------------------------------------------------------------
-- Row level security. Nothing new is writable through the API; every change goes through the
-- functions above. Only the admin reads these tables directly.
-- ---------------------------------------------------------------------------
alter table public.company_profile enable row level security;
alter table public.quotes enable row level security;
alter table public.quote_days enable row level security;

revoke all on public.company_profile, public.quotes, public.quote_days from anon, authenticated;
grant select on public.company_profile, public.quotes, public.quote_days to authenticated;

create policy company_profile_read on public.company_profile for select to authenticated using (private.is_admin());
create policy quotes_read on public.quotes for select to authenticated using (private.is_admin());
create policy quote_days_read on public.quote_days for select to authenticated using (private.is_admin());

revoke execute on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated;

revoke execute on function
  public.brand_settings(),
  public.brand_logo(),
  public.admin_update_branding(text, text, text, text, text),
  public.admin_set_logo(text, text),
  public.quote_of_the_day(),
  public.admin_save_quote(uuid, text, text),
  public.admin_set_quote_active(uuid, boolean),
  public.admin_move_quote(uuid, boolean)
from public, anon;
grant execute on function
  public.brand_settings(),
  public.brand_logo()
to anon, authenticated;
grant execute on function
  public.admin_update_branding(text, text, text, text, text),
  public.admin_set_logo(text, text),
  public.quote_of_the_day(),
  public.admin_save_quote(uuid, text, text),
  public.admin_set_quote_active(uuid, boolean),
  public.admin_move_quote(uuid, boolean)
to authenticated;
