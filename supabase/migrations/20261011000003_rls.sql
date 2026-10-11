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
