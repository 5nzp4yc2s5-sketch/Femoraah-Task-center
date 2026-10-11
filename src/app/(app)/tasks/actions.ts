'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireMe } from '@/lib/session';
import { friendlyError } from '@/lib/format';
import { PRIORITIES, STATUSES, type ActionState } from '@/lib/types';

const optDate = z.preprocess((v) => (v === '' || v === null ? null : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable());
const pctField = z.coerce.number().int('Use a whole number').min(0, '% Complete must be 0-100').max(100, '% Complete must be 0-100');

const coreSchema = z.object({
  title: z.string().trim().min(1, 'Task is required').max(200),
  details: z.string().max(5000).default(''),
  owner_id: z.uuid('Choose an owner'),
  priority: z.enum(PRIORITIES),
  start_date: optDate,
  due_date: optDate,
});

const progressSchema = z.object({
  status: z.enum(STATUSES),
  percent_complete: pctField,
  progress_note: z.string().max(1000).default(''),
});

function datesOk(d: { start_date: string | null; due_date: string | null }) {
  return !d.start_date || !d.due_date || d.due_date >= d.start_date;
}

export async function createTaskAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireMe();
  const core = coreSchema.safeParse(Object.fromEntries(formData));
  const progress = progressSchema.safeParse(Object.fromEntries(formData));
  if (!core.success) return { error: core.error.issues[0].message };
  if (!progress.success) return { error: progress.error.issues[0].message };
  if (!datesOk(core.data)) return { error: 'Due date cannot be before the start date.' };
  const supabase = await createClient();
  const { data, error } = await supabase.from('tasks').insert({ ...core.data, ...progress.data }).select('id').single();
  if (error) return { error: friendlyError(error.message) };
  const collaborators = formData.getAll('collaborators').map(String).filter((id) => z.uuid().safeParse(id).success && id !== core.data.owner_id);
  if (collaborators.length) {
    await supabase.from('task_collaborators').insert(collaborators.map((member_id) => ({ task_id: data.id, member_id })));
  }
  revalidatePath('/', 'layout');
  redirect(`/tasks/${data.id}?created=1`);
}

export async function updateTaskAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireMe();
  const id = z.uuid().safeParse(formData.get('id'));
  const core = coreSchema.safeParse(Object.fromEntries(formData));
  if (!id.success) return { error: 'Unknown task.' };
  if (!core.success) return { error: core.error.issues[0].message };
  if (!datesOk(core.data)) return { error: 'Due date cannot be before the start date.' };
  const supabase = await createClient();
  const { data, error } = await supabase.from('tasks').update(core.data).eq('id', id.data).select('id');
  if (error) return { error: friendlyError(error.message) };
  if (!data?.length) return { error: 'You do not have permission to edit this task.' };
  revalidatePath('/', 'layout');
  return { ok: 'Task saved.' };
}

export async function updateProgressAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireMe();
  const id = z.uuid().safeParse(formData.get('id'));
  const progress = progressSchema.safeParse(Object.fromEntries(formData));
  if (!id.success) return { error: 'Unknown task.' };
  if (!progress.success) return { error: progress.error.issues[0].message };
  if (progress.data.status === 'Blocked' && !progress.data.progress_note.trim()) {
    return { error: 'Say what is blocking you in the progress note.' };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.from('tasks').update(progress.data).eq('id', id.data).select('id');
  if (error) return { error: friendlyError(error.message) };
  if (!data?.length) return { error: 'You do not have permission to update this task.' };
  revalidatePath('/', 'layout');
  return { ok: 'Progress saved. Last Update set to now.' };
}

export async function setArchivedAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireMe();
  const id = z.uuid().safeParse(formData.get('id'));
  if (!id.success) return { error: 'Unknown task.' };
  const archive = formData.get('archive') === '1';
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('tasks')
    .update({ archived_at: archive ? new Date().toISOString() : null })
    .eq('id', id.data)
    .select('id');
  if (error) return { error: friendlyError(error.message) };
  if (!data?.length) return { error: 'You do not have permission to do that.' };
  revalidatePath('/', 'layout');
  return { ok: archive ? 'Task archived.' : 'Task restored.' };
}

export async function addCollaboratorAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireMe();
  const task = z.uuid().safeParse(formData.get('task_id'));
  const member = z.uuid().safeParse(formData.get('member_id'));
  if (!task.success || !member.success) return { error: 'Choose a person.' };
  const supabase = await createClient();
  const { error } = await supabase.from('task_collaborators').insert({ task_id: task.data, member_id: member.data });
  if (error) return { error: error.code === '23505' ? 'Already a collaborator.' : friendlyError(error.message) };
  revalidatePath(`/tasks/${task.data}`);
  return { ok: 'Collaborator added.' };
}

export async function removeCollaboratorAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireMe();
  const task = z.uuid().safeParse(formData.get('task_id'));
  const member = z.uuid().safeParse(formData.get('member_id'));
  if (!task.success || !member.success) return { error: 'Unknown collaborator.' };
  const supabase = await createClient();
  const { error, count } = await supabase.from('task_collaborators').delete({ count: 'exact' }).eq('task_id', task.data).eq('member_id', member.data);
  if (error || !count) return { error: friendlyError(error?.message ?? 'You do not have permission to do that.') };
  revalidatePath(`/tasks/${task.data}`);
  return { ok: 'Collaborator removed.' };
}
