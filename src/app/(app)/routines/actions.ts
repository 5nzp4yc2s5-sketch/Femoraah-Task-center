'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireManager, requireMe } from '@/lib/session';
import { fmtDate, friendlyError } from '@/lib/format';
import type { ActionState } from '@/lib/types';

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export async function completeRoutineAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireMe();
  const id = z.uuid().safeParse(formData.get('routine_id'));
  const doneOn = dateStr.safeParse(formData.get('done_on'));
  if (!id.success) return { error: 'Unknown routine.' };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('complete_routine', {
    p_routine: id.data,
    p_done_on: doneOn.success ? doneOn.data : null,
    p_note: String(formData.get('note') ?? '').slice(0, 500),
  });
  if (error) return { error: friendlyError(error.message) };
  if (!data?.ok) return { error: `Already done for this cycle. Next due ${fmtDate(data?.next_due)}.` };
  revalidatePath('/', 'layout');
  return { ok: `Logged. Next due ${fmtDate(data.next_due)}.` };
}

const routineSchema = z.object({
  title: z.string().trim().min(1, 'Routine Task is required').max(200),
  owner_id: z.uuid('Choose an owner'),
  frequency: z.enum(['Daily', 'Weekly', 'Monthly', 'Custom']),
  every_n_days: z.coerce.number().int().min(1).max(366),
  notes: z.string().max(1000).default(''),
  is_active: z.boolean(),
});

function parseRoutine(formData: FormData) {
  const frequency = String(formData.get('frequency'));
  const n = frequency === 'Daily' ? 1 : frequency === 'Weekly' ? 7 : formData.get('every_n_days') || (frequency === 'Monthly' ? 30 : '');
  return routineSchema.safeParse({
    title: formData.get('title'),
    owner_id: formData.get('owner_id'),
    frequency,
    every_n_days: n,
    notes: formData.get('notes') ?? '',
    is_active: formData.get('is_active') !== 'off',
  });
}

export async function createRoutineAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireManager();
  const parsed = parseRoutine(formData);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.from('routines').insert(parsed.data);
  if (error) return { error: friendlyError(error.message) };
  revalidatePath('/routines');
  redirect('/routines');
}

export async function updateRoutineAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireManager();
  const id = z.uuid().safeParse(formData.get('id'));
  const parsed = parseRoutine(formData);
  if (!id.success) return { error: 'Unknown routine.' };
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.from('routines').update(parsed.data).eq('id', id.data);
  if (error) return { error: friendlyError(error.message) };
  revalidatePath('/routines', 'layout');
  return { ok: 'Saved.' };
}

export async function deleteCompletionAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireManager();
  const id = z.uuid().safeParse(formData.get('completion_id'));
  if (!id.success) return { error: 'Unknown entry.' };
  const supabase = await createClient();
  const { error, count } = await supabase.from('routine_completions').delete({ count: 'exact' }).eq('id', id.data);
  if (error || !count) return { error: friendlyError(error?.message ?? 'Not allowed') };
  revalidatePath('/routines', 'layout');
  return { ok: 'Entry removed.' };
}
