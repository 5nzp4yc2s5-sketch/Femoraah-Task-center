-- OpsPulse Workspace: phase 4a, roles with admin areas, and the Google Sheets workspace.
--
-- Roles keep their stored values and are only shown under new names: admin = Super Admin,
-- manager = Admin, member = Employee. Nobody's role changes.
--
-- Admin areas: the Super Admin can give an Admin one or more areas: attendance, company settings,
-- Google Sheets and (from phase 4b) credentials. The Super Admin always has every area. With no
-- area given (the state right after this migration), every check behaves exactly as before.
--
-- Safe for a live database: this migration only adds tables, functions and triggers, swaps the
-- Super Admin check for the matching area check inside 24 existing functions (same signatures,
-- nothing else in them changes), and widens 12 read policies the same way. No row is deleted or
-- overwritten.

-- ---------------------------------------------------------------------------
-- Admin areas
-- ---------------------------------------------------------------------------
create table if not exists public.admin_area_grants (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members (id) on delete cascade,
  area text not null check (area in ('attendance', 'settings', 'sheets', 'credentials')),
  granted_by uuid references public.members (id) on delete set null,
  granted_at timestamptz not null default now(),
  revoked_by uuid references public.members (id) on delete set null,
  revoked_at timestamptz
);
create unique index if not exists admin_area_grants_active on public.admin_area_grants (member_id, area) where revoked_at is null;

-- True for the Super Admin, and for an Admin who has been given this area.
create or replace function private.has_area(p_area text)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_admin()
      or (private.my_role() = 'manager'
          and exists (select 1 from public.admin_area_grants g
                       where g.member_id = private.me() and g.area = p_area and g.revoked_at is null))
$$;

create or replace function public.my_admin_areas()
returns text[] language sql stable security definer set search_path = '' as $$
  select case when private.is_admin() then array['attendance', 'settings', 'sheets', 'credentials']
              when private.my_role() = 'manager' then
                coalesce((select array_agg(g.area order by g.area) from public.admin_area_grants g
                           where g.member_id = private.me() and g.revoked_at is null), '{}')
              else '{}'::text[] end
$$;

-- Sets exactly which areas an Admin has. Areas not listed are revoked (kept in history).
create or replace function public.admin_set_areas(p_member uuid, p_areas text[])
returns void language plpgsql security definer set search_path = '' as $$
declare
  m public.members;
  v_areas text[] := coalesce(p_areas, '{}');
  v_added text[];
  v_removed text[];
begin
  if not private.is_admin() then raise exception 'Only the Super Admin can change admin areas' using errcode = '42501'; end if;
  if exists (select 1 from unnest(v_areas) a where a not in ('attendance', 'settings', 'sheets', 'credentials')) then
    raise exception 'Unknown admin area' using errcode = '22023';
  end if;
  select * into m from public.members where id = p_member for update;
  if m.id is null then raise exception 'Team member not found' using errcode = 'P0002'; end if;
  if m.access_role <> 'manager' or not m.is_active then
    raise exception 'Admin areas can only be given to an active Admin' using errcode = '22023';
  end if;
  select coalesce(array_agg(g.area), '{}') into v_removed from public.admin_area_grants g
   where g.member_id = p_member and g.revoked_at is null and not (g.area = any (v_areas));
  update public.admin_area_grants set revoked_at = now(), revoked_by = private.me()
   where member_id = p_member and revoked_at is null and not (area = any (v_areas));
  select coalesce(array_agg(a), '{}') into v_added from (select distinct unnest(v_areas) a) x
   where not exists (select 1 from public.admin_area_grants g where g.member_id = p_member and g.area = x.a and g.revoked_at is null);
  insert into public.admin_area_grants (member_id, area, granted_by)
  select p_member, a, private.me() from unnest(v_added) a;
  if cardinality(v_added) > 0 or cardinality(v_removed) > 0 then
    perform private.audit('member', p_member, 'admin_areas_changed', jsonb_build_object('added', v_added, 'removed', v_removed));
  end if;
end $$;

-- Someone who stops being an active Admin loses their areas (kept in history), so they do not
-- come back unnoticed if the role is given again later.
create or replace function private.members_area_cleanup()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.access_role <> 'manager' or not new.is_active then
    update public.admin_area_grants set revoked_at = now(), revoked_by = private.me()
     where member_id = new.id and revoked_at is null;
  end if;
  return null;
end $$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'members_area_cleanup' and tgrelid = 'public.members'::regclass) then
    create trigger members_area_cleanup after update of access_role, is_active on public.members
      for each row execute function private.members_area_cleanup();
  end if;
end $$;

-- Swap the Super Admin check for the area check in the attendance and company-settings functions.
-- Each function uses the check exactly once; anything else is refused, so nothing unexpected changes.
do $$
declare
  r record;
  v_def text;
begin
  for r in
    select f::regprocedure as fn, a as area from (values
      ('public.add_attendance_break(uuid,date,time,time,text)', 'attendance'),
      ('public.admin_add_exemption(uuid,date,date,text)', 'attendance'),
      ('public.admin_end_exemption(uuid,text)', 'attendance'),
      ('public.admin_follow_default(uuid,date)', 'attendance'),
      ('public.admin_save_team(uuid,text,text,boolean)', 'attendance'),
      ('public.admin_set_default_schedule(uuid,date,time,time,integer[],integer,integer,text,text)', 'attendance'),
      ('public.admin_set_member_team(uuid,uuid,date)', 'attendance'),
      ('public.admin_set_schedule(uuid,date,time,time,integer[],integer,integer,text,text)', 'attendance'),
      ('public.admin_update_attendance_settings(integer,integer)', 'attendance'),
      ('public.attendance_days_report(date,date,uuid,uuid)', 'attendance'),
      ('public.attendance_exceptions(date,date,uuid,uuid,text,text)', 'attendance'),
      ('public.attendance_refresh(date,date)', 'attendance'),
      ('public.attendance_report(date,date,uuid)', 'attendance'),
      ('public.decide_attendance_correction(uuid,boolean,text)', 'attendance'),
      ('public.decide_attendance_flags(uuid[],text,text)', 'attendance'),
      ('public.reopen_attendance_flag(uuid,text)', 'attendance'),
      ('public.review_attendance_flag(uuid,public.flag_review_status,text)', 'attendance'),
      ('public.schedule_overview(date)', 'attendance'),
      ('public.void_attendance_break(uuid,text)', 'attendance'),
      ('public.admin_update_branding(text,text,text,text,text)', 'settings'),
      ('public.admin_set_logo(text,text)', 'settings'),
      ('public.admin_save_quote(uuid,text,text)', 'settings'),
      ('public.admin_set_quote_active(uuid,boolean)', 'settings'),
      ('public.admin_move_quote(uuid,boolean)', 'settings')
    ) v (f, a)
  loop
    v_def := pg_get_functiondef(r.fn);
    if (length(v_def) - length(replace(v_def, 'private.is_admin()', ''))) / length('private.is_admin()') <> 1 then
      raise exception 'Stopped: % does not contain exactly one Super Admin check. Nothing was changed.', r.fn;
    end if;
    execute replace(v_def, 'private.is_admin()', format('private.has_area(%L)', r.area));
  end loop;
end $$;

-- Read policies: an Admin with the area reads what the Super Admin reads.
alter policy breaks_read on public.attendance_breaks using (private.has_area('attendance') or member_id = private.me());
alter policy att_corrections_read on public.attendance_corrections using (private.has_area('attendance') or member_id = private.me());
alter policy exemptions_read on public.attendance_exemptions using (private.has_area('attendance') or member_id = private.me());
alter policy flag_actions_read on public.attendance_flag_actions using (
  private.has_area('attendance')
  or exists (select 1 from public.attendance_flags f where f.id = attendance_flag_actions.flag_id and f.member_id = private.me()));
alter policy att_flags_read on public.attendance_flags using (private.has_area('attendance') or member_id = private.me());
alter policy att_records_read on public.attendance_records using (private.has_area('attendance') or member_id = private.me());
alter policy att_sessions_read on public.attendance_sessions using (private.has_area('attendance') or member_id = private.me());
alter policy member_teams_read on public.member_teams using (private.has_area('attendance') or member_id = private.me());
alter policy schedules_read on public.work_schedules using (private.has_area('attendance') or member_id = private.me());
alter policy company_profile_read on public.company_profile using (private.has_area('settings'));
alter policy quotes_read on public.quotes using (private.has_area('settings'));
alter policy quote_days_read on public.quote_days using (private.has_area('settings'));

-- ---------------------------------------------------------------------------
-- Google Sheets workspace. Links only: Google still decides who can open each sheet.
-- ---------------------------------------------------------------------------
create table if not exists public.work_sheets (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 120),
  purpose text not null default '' check (length(purpose) <= 500),
  category text not null default '' check (length(category) <= 60),
  team_id uuid references public.teams (id) on delete restrict,
  owner_id uuid references public.members (id) on delete set null,
  people uuid[] not null default '{}' check (cardinality(people) <= 50),
  url text not null check (length(url) <= 2000
                           and url ~ '^https://docs\.google\.com/spreadsheets/d/[A-Za-z0-9_-]{20,}([/?#][^[:space:]<>"''\\]*)?$'),
  visibility text not null default 'everyone' check (visibility in ('everyone', 'assigned')),
  created_by uuid references public.members (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid references public.members (id) on delete set null,
  updated_at timestamptz not null default now(),
  archived_by uuid references public.members (id) on delete set null,
  archived_at timestamptz
);
-- The spreadsheet's ID from its link, so /edit, /edit#gid=0 and ?usp=sharing count as the same sheet.
create or replace function private.sheet_key(p_url text)
returns text language sql immutable set search_path = '' as $$
  select substring(p_url from '^https://docs\.google\.com/spreadsheets/d/([A-Za-z0-9_-]+)')
$$;
create unique index if not exists work_sheets_key_active on public.work_sheets (private.sheet_key(url)) where archived_at is null;
create index if not exists work_sheets_people on public.work_sheets using gin (people);

-- Who may open the entry in the app (not the sheet itself): everyone, or for "assigned" sheets the
-- responsible person, the people on it, its team, whoever added it, and Sheets admins.
create or replace function private.can_view_sheet(s public.work_sheets)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.me() is not null
     and (private.has_area('sheets')
          or (s.archived_at is null
              and (s.visibility = 'everyone'
                   or s.owner_id = private.me()
                   or private.me() = any (s.people)
                   or s.created_by = private.me()
                   or (s.team_id is not null and s.team_id = private.team_for(private.me(), private.today())))))
$$;

-- p_id null adds a sheet. Sheets admins can change anything; the responsible person can change
-- the details and who works on it, but not the visibility or the responsible person.
create or replace function public.sheet_save(p_id uuid, p_name text, p_purpose text, p_category text, p_team uuid,
                                             p_owner uuid, p_people uuid[], p_url text, p_visibility text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.me();
  v_admin boolean := private.has_area('sheets');
  v_old public.work_sheets;
  v_id uuid;
  v_name text := btrim(coalesce(p_name, ''));
  v_url text := btrim(coalesce(p_url, ''));
  v_people uuid[] := coalesce((select array_agg(distinct x) from unnest(p_people) x where x is not null), '{}');
begin
  if v_me is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  if length(v_name) not between 1 and 120 then raise exception 'Give the sheet a name of up to 120 characters' using errcode = '22023'; end if;
  if length(coalesce(p_purpose, '')) > 500 then raise exception 'Keep the purpose under 500 characters' using errcode = '22023'; end if;
  if length(coalesce(p_category, '')) > 60 then raise exception 'Keep the category under 60 characters' using errcode = '22023'; end if;
  if coalesce(p_visibility, 'everyone') not in ('everyone', 'assigned') then raise exception 'Unknown visibility' using errcode = '22023'; end if;
  if v_url !~ '^https://docs\.google\.com/spreadsheets/d/[A-Za-z0-9_-]{20,}([/?#][^[:space:]<>"''\\]*)?$' or length(v_url) > 2000 then
    raise exception 'Paste the full Google Sheets link, starting with https://docs.google.com/spreadsheets/d/' using errcode = '22023';
  end if;
  if p_team is not null and not exists (select 1 from public.teams t where t.id = p_team) then
    raise exception 'Team not found' using errcode = '22023';
  end if;
  if p_owner is not null and not exists (select 1 from public.members m where m.id = p_owner and m.is_active) then
    raise exception 'Choose an active team member as the responsible person' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(v_people) x where not exists (select 1 from public.members m where m.id = x and m.is_active)) then
    raise exception 'Everyone working on the sheet must be an active team member' using errcode = '22023';
  end if;

  if p_id is null then
    if not v_admin then raise exception 'Only a Sheets admin can add sheets' using errcode = '42501'; end if;
    if exists (select 1 from public.work_sheets s where private.sheet_key(s.url) = private.sheet_key(v_url) and s.archived_at is null) then
      raise exception 'This sheet link is already in the workspace' using errcode = '23505';
    end if;
    insert into public.work_sheets (name, purpose, category, team_id, owner_id, people, url, visibility, created_by, updated_by)
    values (v_name, btrim(coalesce(p_purpose, '')), btrim(coalesce(p_category, '')), p_team, p_owner, v_people, v_url,
            coalesce(p_visibility, 'everyone'), v_me, v_me)
    returning id into v_id;
    perform private.audit('work_sheet', v_id, 'created', jsonb_build_object('name', v_name, 'url', v_url));
    return v_id;
  end if;

  select * into v_old from public.work_sheets where id = p_id for update;
  if v_old.id is null or not private.can_view_sheet(v_old) then raise exception 'Sheet not found' using errcode = 'P0002'; end if;
  if v_old.archived_at is not null then raise exception 'Restore the sheet before changing it' using errcode = '22023'; end if;
  if not v_admin then
    if v_old.owner_id is distinct from v_me then
      raise exception 'Only the responsible person or a Sheets admin can change this sheet' using errcode = '42501';
    end if;
    if p_owner is distinct from v_old.owner_id or coalesce(p_visibility, 'everyone') <> v_old.visibility then
      raise exception 'Only a Sheets admin can change the responsible person or who can see the sheet' using errcode = '42501';
    end if;
  end if;
  if exists (select 1 from public.work_sheets s where private.sheet_key(s.url) = private.sheet_key(v_url) and s.archived_at is null and s.id <> p_id) then
    raise exception 'This sheet link is already in the workspace' using errcode = '23505';
  end if;
  update public.work_sheets
     set name = v_name, purpose = btrim(coalesce(p_purpose, '')), category = btrim(coalesce(p_category, '')),
         team_id = p_team, owner_id = p_owner, people = v_people, url = v_url,
         visibility = coalesce(p_visibility, 'everyone'), updated_by = v_me, updated_at = now()
   where id = p_id;
  perform private.audit('work_sheet', p_id, 'updated', jsonb_build_object(
    'before', jsonb_build_object('name', v_old.name, 'url', v_old.url, 'owner', v_old.owner_id, 'people', v_old.people,
                                 'team', v_old.team_id, 'visibility', v_old.visibility),
    'after', jsonb_build_object('name', v_name, 'url', v_url, 'owner', p_owner, 'people', v_people,
                                'team', p_team, 'visibility', coalesce(p_visibility, 'everyone'))));
  return p_id;
end $$;

-- Removing a sheet archives it; a Sheets admin can restore it. Entries are never deleted.
create or replace function public.sheet_set_archived(p_id uuid, p_archived boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_old public.work_sheets;
begin
  if not private.has_area('sheets') then raise exception 'Only a Sheets admin can remove or restore sheets' using errcode = '42501'; end if;
  select * into v_old from public.work_sheets where id = p_id for update;
  if v_old.id is null then raise exception 'Sheet not found' using errcode = 'P0002'; end if;
  if coalesce(p_archived, true) then
    update public.work_sheets set archived_at = coalesce(archived_at, now()), archived_by = coalesce(archived_by, private.me()) where id = p_id;
  else
    if exists (select 1 from public.work_sheets s where private.sheet_key(s.url) = private.sheet_key(v_old.url) and s.archived_at is null and s.id <> p_id) then
      raise exception 'Another entry already has this link' using errcode = '23505';
    end if;
    update public.work_sheets set archived_at = null, archived_by = null, updated_by = private.me(), updated_at = now() where id = p_id;
  end if;
  perform private.audit('work_sheet', p_id, case when coalesce(p_archived, true) then 'archived' else 'restored' end, '{}'::jsonb);
end $$;

alter table public.admin_area_grants enable row level security;
alter table public.work_sheets enable row level security;
revoke all on public.admin_area_grants, public.work_sheets from anon, authenticated;
grant select on public.admin_area_grants, public.work_sheets to authenticated;
create policy admin_area_grants_read on public.admin_area_grants for select to authenticated
  using (private.is_admin() or member_id = private.me());
create policy work_sheets_read on public.work_sheets for select to authenticated using (private.can_view_sheet(work_sheets));

revoke execute on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated;
revoke execute on function
  public.my_admin_areas(), public.admin_set_areas(uuid, text[]),
  public.sheet_save(uuid, text, text, text, uuid, uuid, uuid[], text, text), public.sheet_set_archived(uuid, boolean)
from public, anon;
grant execute on function
  public.my_admin_areas(), public.admin_set_areas(uuid, text[]),
  public.sheet_save(uuid, text, text, text, uuid, uuid, uuid[], text, text), public.sheet_set_archived(uuid, boolean)
to authenticated;
