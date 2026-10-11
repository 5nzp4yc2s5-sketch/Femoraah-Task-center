import 'server-only';
import { createClient } from './supabase/server';
import type { MemberOption, TaskRow, RoutineRow } from './types';

export async function activeMembers(): Promise<MemberOption[]> {
  const supabase = await createClient();
  const { data } = await supabase.from('members').select('id, name').eq('is_active', true).order('created_at');
  return data ?? [];
}

const FLAG_ORDER: Record<string, number> = { Overdue: 0, Blocked: 1, 'Due soon': 2, Stale: 3, 'Due in 7 days': 4, 'On track': 5, Done: 6 };
const PRIORITY_ORDER: Record<string, number> = { Critical: 0, High: 1, Medium: 2, Low: 3 };

export function sortTasks(rows: TaskRow[], sort: string = 'flag'): TaskRow[] {
  const due = (r: TaskRow) => (r.due_date ? r.due_date : '9999-12-31');
  const copy = [...rows];
  copy.sort((a, b) => {
    switch (sort) {
      case 'due':
        return due(a).localeCompare(due(b));
      case 'priority':
        return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || due(a).localeCompare(due(b));
      case 'updated':
        return b.last_update_at.localeCompare(a.last_update_at);
      case 'owner':
        return (a.owner_name ?? '').localeCompare(b.owner_name ?? '') || due(a).localeCompare(due(b));
      case 'delegated':
        return (a.assigned_by_name ?? '').localeCompare(b.assigned_by_name ?? '') || due(a).localeCompare(due(b));
      case 'created':
        return b.created_at.localeCompare(a.created_at);
      case 'id':
        return a.task_no - b.task_no;
      default:
        return (
          FLAG_ORDER[a.flag] - FLAG_ORDER[b.flag] ||
          Number(b.is_flagged) - Number(a.is_flagged) ||
          due(a).localeCompare(due(b)) ||
          PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]
        );
    }
  });
  return copy;
}

export async function tasksFor(filter: { owner?: string; involving?: string; includeDone?: boolean; limit?: number }): Promise<TaskRow[]> {
  const supabase = await createClient();
  let q = supabase.from('task_board').select('*').is('archived_at', null);
  if (filter.owner) q = q.eq('owner_id', filter.owner);
  if (!filter.includeDone) q = q.neq('status', 'Done');
  const { data } = await q.limit(filter.limit ?? 500);
  return (data ?? []) as TaskRow[];
}

export async function routinesFor(owner?: string): Promise<RoutineRow[]> {
  const supabase = await createClient();
  let q = supabase.from('routine_board').select('*').order('title');
  if (owner) q = q.eq('owner_id', owner);
  const { data } = await q;
  return (data ?? []) as RoutineRow[];
}
