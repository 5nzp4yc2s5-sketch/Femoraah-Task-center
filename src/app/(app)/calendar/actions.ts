'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireMe } from '@/lib/session';
import { fmtDate, friendlyError } from '@/lib/format';
import { LEAVE_TYPES, type ActionState } from '@/lib/types';

const blankToNull = (v: unknown) => (v === '' || v === null || v === undefined ? null : v);
const isoDate = (message: string) => z.string().regex(/^\d{4}-\d{2}-\d{2}$/, message);
const monthKey = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

const leaveSchema = z
  .object({
    member_id: z.uuid('Choose the person who is on leave'),
    leave_type: z.enum(LEAVE_TYPES, 'Choose a leave type'),
    start_date: isoDate('Choose the first day of leave'),
    end_date: isoDate('Choose the last day of leave'),
    backup_member_id: z.preprocess(blankToNull, z.uuid('Choose a backup from the list').nullable()),
    swap_for_date: z.preprocess(blankToNull, isoDate('Choose the holiday you will work from the list').nullable()),
    note: z.string().trim().max(500, 'Keep the note under 500 characters').default(''),
  })
  .refine((d) => d.end_date >= d.start_date, { message: 'The end date cannot be before the start date.', path: ['end_date'] })
  .refine((d) => Date.parse(d.end_date) - Date.parse(d.start_date) <= 366 * 86_400_000, {
    message: 'One leave entry can cover at most a year. Split longer leave into two entries.',
    path: ['end_date'],
  })
  .refine((d) => !d.backup_member_id || d.backup_member_id !== d.member_id, {
    message: 'The backup must be someone other than the person on leave.',
    path: ['backup_member_id'],
  });

type LeaveInput = z.infer<typeof leaveSchema>;
type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Validate the leave form. Holiday Swap may name the company holiday the person will work instead. */
async function parseLeave(formData: FormData, supabase: Supabase): Promise<{ error: string } | { data: LeaveInput }> {
  const parsed = leaveSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = { ...parsed.data };
  if (d.leave_type !== 'Holiday Swap') d.swap_for_date = null;
  if (d.swap_for_date) {
    if (d.swap_for_date >= d.start_date && d.swap_for_date <= d.end_date) {
      return { error: 'The holiday you will work cannot fall inside the leave dates.' };
    }
    const { data: holiday, error } = await supabase.from('holidays').select('id').eq('holiday_date', d.swap_for_date).maybeSingle();
    if (error) return { error: friendlyError(error.message) };
    if (!holiday) return { error: `There is no company holiday on ${fmtDate(d.swap_for_date)}. Choose one from the list.` };
  }
  return { data: d };
}

function datesText(start: string, end: string) {
  return start === end ? fmtDate(start) : `${fmtDate(start)} to ${fmtDate(end)}`;
}

export async function createLeaveAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const me = await requireMe();
  const supabase = await createClient();
  const parsed = await parseLeave(formData, supabase);
  if ('error' in parsed) return parsed;
  if (!me.isManager && parsed.data.member_id !== me.memberId) return { error: 'You can only add leave for yourself. Ask a manager to record leave for someone else.' };
  const { error } = await supabase.from('leaves').insert(parsed.data);
  if (error) return { error: friendlyError(error.message) };
  revalidatePath('/', 'layout');
  return { ok: `Leave added: ${parsed.data.leave_type}, ${datesText(parsed.data.start_date, parsed.data.end_date)}.` };
}

export async function updateLeaveAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const me = await requireMe();
  const id = z.uuid().safeParse(formData.get('id'));
  if (!id.success) return { error: 'Unknown leave entry.' };
  const supabase = await createClient();
  const parsed = await parseLeave(formData, supabase);
  if ('error' in parsed) return parsed;
  if (!me.isManager && parsed.data.member_id !== me.memberId) return { error: 'You can only record leave for yourself.' };
  const { data, error } = await supabase.from('leaves').update(parsed.data).eq('id', id.data).select('id');
  if (error) return { error: friendlyError(error.message) };
  if (!data?.length) return { error: 'You do not have permission to change this leave.' };
  revalidatePath('/', 'layout');
  redirect(`/calendar?month=${parsed.data.start_date.slice(0, 7)}&saved=leave`);
}

export async function deleteLeaveAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireMe();
  const id = z.uuid().safeParse(formData.get('id'));
  if (!id.success) return { error: 'Unknown leave entry.' };
  const supabase = await createClient();
  const { error, count } = await supabase.from('leaves').delete({ count: 'exact' }).eq('id', id.data);
  if (error) return { error: friendlyError(error.message) };
  if (!count) return { error: 'You do not have permission to delete this leave.' };
  revalidatePath('/', 'layout');
  // From the edit page, go back to the calendar (the edit page would now be empty).
  const back = monthKey.safeParse(formData.get('back'));
  if (back.success) redirect(`/calendar?month=${back.data}&deleted=leave`);
  return { ok: 'Leave deleted.' };
}

const holidaySchema = z.object({
  holiday_date: isoDate('Choose the holiday date'),
  name: z.string().trim().min(1, 'Holiday name is required').max(120, 'Keep the holiday name under 120 characters'),
  note: z.string().trim().max(500, 'Keep the note under 500 characters').default(''),
});

export async function createHolidayAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const me = await requireMe();
  if (!me.isManager) return { error: 'Only a manager can add company holidays.' };
  const parsed = holidaySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.from('holidays').insert(parsed.data);
  if (error) return { error: friendlyError(error.message) };
  revalidatePath('/', 'layout');
  return { ok: `Holiday added: ${parsed.data.name} on ${fmtDate(parsed.data.holiday_date)}.` };
}

export async function deleteHolidayAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const me = await requireMe();
  if (!me.isManager) return { error: 'Only a manager can remove company holidays.' };
  const id = z.uuid().safeParse(formData.get('id'));
  if (!id.success) return { error: 'Unknown holiday.' };
  const supabase = await createClient();
  const { error, count } = await supabase.from('holidays').delete({ count: 'exact' }).eq('id', id.data);
  if (error) return { error: friendlyError(error.message) };
  if (!count) return { error: 'You do not have permission to remove this holiday.' };
  revalidatePath('/', 'layout');
  return { ok: 'Holiday removed.' };
}
