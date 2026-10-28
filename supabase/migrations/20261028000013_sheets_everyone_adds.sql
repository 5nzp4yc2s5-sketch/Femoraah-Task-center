-- OpsPulse Workspace: everyone can add Google Sheets (28-Oct-2026).
--
-- Until now only the Super Admin, or an Admin given the Google Sheets area, could add a sheet.
-- Now anyone signed in can add one. Someone without the Sheets area becomes the new sheet's
-- responsible person, so they can keep its details up to date; only Sheets admins can change who is
-- responsible or who can see it, and only they can remove or restore sheets, as before.
--
-- Safe for a live database: this replaces one function (public.sheet_save). No table, policy or
-- row changes, and nothing is removed. To undo, run the 011 version of the function again
-- (supabase/migrations/20261019000011_sheets_roles.sql).

-- p_id null adds a sheet. Anyone signed in can add one; someone without the Sheets area becomes its
-- responsible person, whoever they named. Sheets admins can change anything; the responsible person
-- can change the details and who works on it, but not the visibility or the responsible person.
create or replace function public.sheet_save(p_id uuid, p_name text, p_purpose text, p_category text, p_team uuid,
                                             p_owner uuid, p_people uuid[], p_url text, p_visibility text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.me();
  v_admin boolean := private.has_area('sheets');
  v_old public.work_sheets;
  v_id uuid;
  v_owner uuid := case when p_id is null and not v_admin then v_me else p_owner end;
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
  if v_owner is not null and not exists (select 1 from public.members m where m.id = v_owner and m.is_active) then
    raise exception 'Choose an active team member as the responsible person' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(v_people) x where not exists (select 1 from public.members m where m.id = x and m.is_active)) then
    raise exception 'Everyone working on the sheet must be an active team member' using errcode = '22023';
  end if;

  if p_id is null then
    if exists (select 1 from public.work_sheets s where private.sheet_key(s.url) = private.sheet_key(v_url) and s.archived_at is null) then
      raise exception 'This sheet link is already in the workspace' using errcode = '23505';
    end if;
    insert into public.work_sheets (name, purpose, category, team_id, owner_id, people, url, visibility, created_by, updated_by)
    values (v_name, btrim(coalesce(p_purpose, '')), btrim(coalesce(p_category, '')), p_team, v_owner, v_people, v_url,
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
