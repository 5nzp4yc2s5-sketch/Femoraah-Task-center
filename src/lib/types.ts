export const STATUSES = ['Not Started', 'In Progress', 'Blocked', 'Done'] as const;
export const PRIORITIES = ['High', 'Medium', 'Low'] as const;
export const FREQUENCIES = ['Daily', 'Weekly', 'Monthly', 'Custom'] as const;
export const FLAGS = ['Overdue', 'Due soon', 'Stale', 'Blocked', 'On track', 'Done'] as const;

export type TaskStatus = (typeof STATUSES)[number];
export type Priority = (typeof PRIORITIES)[number];
export type Flag = (typeof FLAGS)[number];

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
  status: 'Open' | 'Assigned' | 'Rejected';
  decided_by_name: string | null;
  decided_at: string | null;
  final_owner_id: string | null;
  final_owner_name: string | null;
  overrode_suggestion: boolean | null;
  decision_note: string | null;
  task_id: string | null;
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
  status: 'OK' | 'Due today' | 'Overdue' | 'Not logged yet' | 'Paused';
}

export interface TeamRow {
  member_id: string;
  name: string;
  role_title: string;
  expertise: string;
  email: string | null;
  max_open_tasks: number;
  access_role: 'admin' | 'manager' | 'member';
  reports_to: string | null;
  is_active: boolean;
  has_login: boolean;
  username: string | null;
  open_tasks: number;
  overdue: number;
  blocked: number;
  has_capacity: boolean;
}

export interface MemberOption {
  id: string;
  name: string;
}

export type ActionState = { error?: string; ok?: string } | undefined;
