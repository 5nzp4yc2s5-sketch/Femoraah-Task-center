export const STATUSES = ['To Do', 'Active', 'Blocked', 'Done'] as const;
export const PRIORITIES = ['Critical', 'High', 'Medium', 'Low'] as const;
export const FREQUENCIES = ['Daily', 'Weekly', 'Monthly', 'Custom'] as const;
export const FLAGS = ['Overdue', 'Blocked', 'Due soon', 'Stale', 'Due in 7 days', 'On track', 'Done'] as const;
export const CAPACITY_STATUSES = ['Available', 'At Capacity', 'Overloaded', 'On Leave'] as const;
export const BACKLOG_STATUSES = ['Pending', 'Approved', 'Converted to Task', 'Dismissed'] as const;
export const ROUTINE_STATUSES = ['OK', 'Due Today', 'Overdue', 'Not Logged', 'Paused'] as const;
export const LEAVE_TYPES = ['Annual Leave', 'Sick Leave', 'Casual Leave', 'Holiday Swap', 'Other'] as const;

export type TaskStatus = (typeof STATUSES)[number];
export type Priority = (typeof PRIORITIES)[number];
export type Flag = (typeof FLAGS)[number];
export type CapacityStatus = (typeof CAPACITY_STATUSES)[number];
export type BacklogStatus = (typeof BACKLOG_STATUSES)[number];
export type RoutineStatus = (typeof ROUTINE_STATUSES)[number];

export interface TaskRow {
  id: string;
  task_no: number;
  task_code: string;
  title: string;
  details: string;
  owner_id: string;
  owner_name: string | null;
  assigned_by: string;
  assigned_by_name: string | null;
  created_by: string;
  created_by_name: string | null;
  priority: Priority;
  status: TaskStatus;
  start_date: string | null;
  due_date: string | null;
  percent_complete: number;
  last_update_at: string;
  progress_note: string;
  completed_at: string | null;
  backlog_item_id: string | null;
  archived_at: string | null;
  created_at: string;
  days_left: number | null;
  flag: Flag;
  is_stale: boolean;
  blocker_reason: string;
  blocked_at: string | null;
  is_flagged: boolean;
  updated_at: string;
  days_since_update: number;
}

export interface BacklogRow {
  id: string;
  backlog_no: number;
  backlog_code: string;
  title: string;
  details: string;
  skills_needed: string;
  priority: Priority;
  due_date: string;
  requested_by: string;
  requested_by_name: string | null;
  date_added: string;
  suggested_owner_id: string | null;
  suggested_owner_name: string | null;
  suggestion_reason: string | null;
  suggestion_score: number | null;
  suggestion_candidates: Candidate[];
  suggested_at: string | null;
  approval: 'Pending' | 'Yes' | 'No';
  status: BacklogStatus;
  decided_by: string | null;
  decided_by_name: string | null;
  decided_at: string | null;
  final_owner_id: string | null;
  final_owner_name: string | null;
  overrode_suggestion: boolean | null;
  decision_note: string | null;
  task_id: string | null;
  converted_by: string | null;
  converted_by_name: string | null;
  converted_at: string | null;
  override_leave: boolean;
}

export interface Candidate {
  member_id: string;
  name: string;
  score: number;
  skill: number;
  matched: string[];
  open: number;
  overdue: number;
  blocked: number;
  max: number;
  has_capacity: boolean;
  on_leave: boolean;
  eligible: boolean;
  fallback: boolean;
}

export interface RoutineRow {
  id: string;
  title: string;
  owner_id: string;
  owner_name: string | null;
  frequency: (typeof FREQUENCIES)[number];
  every_n_days: number;
  notes: string;
  is_active: boolean;
  last_done: string | null;
  times_done: number;
  next_due: string | null;
  status: RoutineStatus;
  routine_no: number;
  routine_code: string;
  backup_member_id: string | null;
  backup_name: string | null;
  owner_on_leave: boolean;
  covered_by_id: string | null;
  covered_by_name: string | null;
  last_completed_at: string | null;
  done_today: boolean;
}

export interface TeamRow {
  member_id: string;
  name: string;
  role_title: string;
  expertise: string;
  email: string | null;
  max_open_tasks: number;
  access_role: 'admin' | 'manager' | 'member';
  is_active: boolean;
  has_login: boolean;
  username: string | null;
  open_tasks: number;
  overdue: number;
  blocked: number;
  has_capacity: boolean;
  routine_overdue: number;
  on_leave: boolean;
  leave_until: string | null;
  capacity_status: CapacityStatus;
}

/** One entry from team_calendar(): a company holiday or someone's leave. */
export interface CalendarEntry {
  kind: 'holiday' | 'leave';
  id: string;
  member_id: string | null;
  member_name: string | null;
  start_date: string;
  end_date: string;
  label: string;
  backup_member_id: string | null;
  backup_name: string | null;
  note: string;
  can_edit: boolean;
}

/** One person-day from attendance_report(). Times are timestamptz ISO strings. */
export interface AttendanceRow {
  member_id: string;
  member_name: string;
  work_date: string;
  day_type: 'On Leave' | 'Holiday' | 'No Schedule' | 'Weekly Off' | 'Working Day';
  holiday_name: string | null;
  leave_type: string | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  grace_minutes: number | null;
  break_minutes: number | null;
  tz: string;
  first_login: string | null;
  last_logout: string | null;
  session_count: number;
  open_session: boolean;
  incomplete_sessions: number;
  worked_minutes: number;
  minutes_late: number | null;
  minutes_early: number | null;
  minutes_overtime: number | null;
  login_status: string;
  logout_status: string | null;
  corrected: boolean;
  record_id: string | null;
  open_flags: number;
  pending_correction: boolean;
}

export interface MemberOption {
  id: string;
  name: string;
}

export type ActionState = { error?: string; ok?: string } | undefined;
