'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireManager, requireMe } from '@/lib/session';
import { friendlyError } from '@/lib/format';
import { PRIORITIES, type ActionState } from '@/lib/types';

const schema = z.object({
  title: z.string().trim().min(1, 'Task is required').max(200),
  details: z.string().max(5000).default(''),
  skills_needed: z.string().trim().min(1, 'Skills Needed is required').max(500),
  priority: z.enum(PRIORITIES),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Due Date is required'),
});

export async function createBacklogAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireMe();
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { data, error } = await supabase.from('backlog_items').insert(parsed.data).select('id').single();
  if (error) return { error: friendlyError(error.message) };
  revalidatePath('/', 'layout');
  redirect(`/backlog/${data.id}?created=1`);
}

export async function updateBacklogAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireMe();
  const id = z.uuid().safeParse(formData.get('id'));
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!id.success) return { error: 'Unknown item.' };
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { data, error } = await supabase.from('backlog_items').update(parsed.data).eq('id', id.data).select('id');
  if (error) return { error: friendlyError(error.message) };
  if (!data?.length) return { error: 'Only the requester or a manager can edit a pending backlog item.' };
  revalidatePath('/', 'layout');
  return { ok: 'Saved. The suggestion is recalculated when Skills Needed changes.' };
}

export async function refreshSuggestionAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireMe();
  const id = z.uuid().safeParse(formData.get('id'));
  if (!id.success) return { error: 'Unknown item.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('refresh_backlog_suggestion', { p_item: id.data });
  if (error) return { error: friendlyError(error.message) };
  revalidatePath('/', 'layout');
  return { ok: 'Suggestion recalculated with current workloads and leave.' };
}

/**
 * Approve the chosen person. "convert=1" (Approve and create task) also creates the task and opens it;
 * "convert=0" (Approve only) leaves the item Approved so it can be converted later.
 */
export async function approveBacklogAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireManager();
  const id = z.uuid().safeParse(formData.get('id'));
  const owner = z.uuid().safeParse(formData.get('owner_id'));
  if (!id.success) return { error: 'Unknown item.' };
  if (!owner.success) return { error: 'Choose who to assign it to.' };
  const convert = formData.get('convert') !== '0';
  const supabase = await createClient();
  const { data: taskId, error } = await supabase.rpc('approve_backlog_item', {
    p_item: id.data,
    p_owner: owner.data,
    p_note: String(formData.get('note') ?? '').trim().slice(0, 1000),
    p_convert: convert,
    p_override_leave: formData.get('override_leave') === 'on',
  });
  if (error) return { error: friendlyError(error.message) };
  revalidatePath('/', 'layout');
  if (convert && taskId) redirect(`/tasks/${taskId}?created=1`);
  redirect(`/backlog/${id.data}?approved=1`);
}

/** Turn an Approved item into a To Do task (safe to repeat: it returns the same task). */
export async function convertBacklogAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireManager();
  const id = z.uuid().safeParse(formData.get('id'));
  if (!id.success) return { error: 'Unknown item.' };
  const supabase = await createClient();
  const { data: taskId, error } = await supabase.rpc('convert_backlog_item', { p_item: id.data });
  if (error) return { error: friendlyError(error.message) };
  revalidatePath('/', 'layout');
  if (!taskId) return { error: 'The task could not be created. Please try again.' };
  redirect(`/tasks/${taskId}?created=1`);
}

export async function rejectBacklogAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireManager();
  const id = z.uuid().safeParse(formData.get('id'));
  if (!id.success) return { error: 'Unknown item.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('reject_backlog_item', { p_item: id.data, p_note: String(formData.get('note') ?? '').trim().slice(0, 1000) });
  if (error) return { error: friendlyError(error.message) };
  revalidatePath('/', 'layout');
  return { ok: 'Dismissed.' };
}
