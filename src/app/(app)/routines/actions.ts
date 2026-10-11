'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireManager, requireMe } from '@/lib/session';
import { fmtDate, friendlyError } from '@/lib/format';
import { FREQUENCIES, type ActionState } from '@/lib/types';

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export async function completeRoutineAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireMe();
  const id = z.uuid().safeParse(formData.get('routine_id'));
  if (!id.success) return { error: 'Unknown routine.' };
  const rawDate = formData.get('done_on');
  const doneOn = dateStr.safeParse(rawDate);
  if (rawDate && !doneOn.success) return { error: 'Enter the date it was done.' };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('complete_routine', {
    p_routine: id.data,
    p_done_on: doneOn.success ? doneOn.data : null,
    p_note: String(formData.get('note') ?? '').trim().slice(0, 500),
  });
  if (error) return { error: friendlyError(error.message) };
  if (!data?.ok) {
    // Someone (or another tab) already logged this cycle. Nothing was added; refresh the row.
    revalidatePath('/', 'layout');
    const last = data?.last_done ? ` (last done ${fmtDate(data.last_done)})` : '';
    const next = data?.next_due ? ` The next cycle starts ${fmtDate(data.next_due)}.` : '';
    return { error: `Already done for this cycle${last}.${next}` };
  }
  revalidatePath('/', 'layout');
  return { ok: `Logged. Next due ${fmtDate(data.next_due)}.` };
}

const FIXED_DAYS: Record<string, number> = { Daily: 1, Weekly: 7, Monthly: 30 };

const routineSchema = z
  .object({
    title: z.string().trim().min(1, 'Routine Task is required').max(200, 'Routine Task must be 200 characters or fewer'),
    owner_id: z.uuid('Choose who it is assigned to'),
    backup_member_id: z.uuid('Choose a valid backup').nullable(),
    frequency: z.enum(FREQUENCIES, 'Choose a frequency'),
    every_n_days: z.coerce
      .number('Every N Days must be a number')
      .int('Every N Days must be a whole number')
      .min(1, 'Every N Days must be at least 1')
      .max(366, 'Every N Days can be at most 366'),
    notes: z.string().max(1000, 'Notes must be 1000 characters or fewer').default(''),
    is_active: z.boolean(),
  })
  .refine((r) => r.backup_member_id !== r.owner_id, {
    message: 'The backup must be someone other than the person it is assigned to.',
    path: ['backup_member_id'],
  });

function parseRoutine(formData: FormData) {
  const frequency = String(formData.get('frequency') ?? '');
  const backup = String(formData.get('backup_member_id') ?? '');
  return routineSchema.safeParse({
    title: formData.get('title') ?? '',
    owner_id: formData.get('owner_id') ?? '',
    backup_member_id: backup === '' ? null : backup,
    frequency,
    // Daily, Weekly and Monthly have a fixed interval (the database enforces the same).
    every_n_days: FIXED_DAYS[frequency] ?? (formData.get('every_n_days') || ''),
    notes: String(formData.get('notes') ?? ''),
    // The form sends a hidden "off" first and "on" only when the box is ticked.
    is_active: formData.getAll('is_active').includes('on'),
  });
}

export async function createRoutineAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireManager();
  const parsed = parseRoutine(formData);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.from('routines').insert(parsed.data);
  if (error) return { error: friendlyError(error.message) };
  revalidatePath('/', 'layout');
  redirect('/routines');
}

export async function updateRoutineAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireManager();
  const id = z.uuid().safeParse(formData.get('id'));
  const parsed = parseRoutine(formData);
  if (!id.success) return { error: 'Unknown routine.' };
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { data, error } = await supabase.from('routines').update(parsed.data).eq('id', id.data).select('id');
  if (error) return { error: friendlyError(error.message) };
  if (!data?.length) return { error: 'You do not have permission to edit this routine.' };
  revalidatePath('/', 'layout');
  return { ok: 'Saved.' };
}

/** Pause or resume a routine without touching anything else. */
export async function setRoutineActiveAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireManager();
  const id = z.uuid().safeParse(formData.get('id'));
  if (!id.success) return { error: 'Unknown routine.' };
  const active = formData.get('is_active') === 'on';
  const supabase = await createClient();
  const { data, error } = await supabase.from('routines').update({ is_active: active }).eq('id', id.data).select('id');
  if (error) return { error: friendlyError(error.message) };
  if (!data?.length) return { error: 'You do not have permission to change this routine.' };
  revalidatePath('/', 'layout');
  return { ok: active ? 'Resumed.' : 'Paused.' };
}

export async function deleteCompletionAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireManager();
  const id = z.uuid().safeParse(formData.get('completion_id'));
  if (!id.success) return { error: 'Unknown entry.' };
  const supabase = await createClient();
  const { error, count } = await supabase.from('routine_completions').delete({ count: 'exact' }).eq('id', id.data);
  if (error || !count) return { error: friendlyError(error?.message ?? 'Not allowed') };
  revalidatePath('/', 'layout');
  return { ok: 'Entry removed.' };
}
