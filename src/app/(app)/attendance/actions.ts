'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin, requireMe } from '@/lib/session';
import { friendlyError } from '@/lib/format';
import type { ActionState } from '@/lib/types';
import { DECISIONS, isTimeZone, validDate } from './lib';

const TIME = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
const optTime = z.preprocess((v) => (v === '' || v === null || v === undefined ? null : v), z.string().regex(TIME, 'Enter times as HH:MM').nullable());
const dateField = (msg: string) => z.string().refine((v) => validDate(v), msg);

/** Employee: add or edit their own explanation on a flag. */
export async function explainFlagAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireMe();
  const parsed = z
    .object({
      id: z.uuid('Unknown flag.'),
      explanation: z.string().trim().min(3, 'Write a short explanation.').max(1000, 'Keep the explanation under 1000 characters.'),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.rpc('explain_attendance_flag', { p_flag: parsed.data.id, p_explanation: parsed.data.explanation });
  if (error) return { error: friendlyError(error.message) };
  revalidatePath('/', 'layout');
  return { ok: 'Explanation saved. The admin will see it when reviewing this flag.' };
}

/** Employee: ask for a correction to their own record. Original timestamps are never changed. */
export async function requestCorrectionAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireMe();
  const parsed = z
    .object({
      work_date: dateField('Choose the date to correct.'),
      login_time: optTime,
      logout_time: optTime,
      reason: z.string().trim().min(3, 'Explain why the record needs correcting.').max(1000, 'Keep the reason under 1000 characters.'),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;
  if (!d.login_time && !d.logout_time) return { error: 'Enter the correct login time, logout time, or both.' };
  if (d.login_time && d.logout_time && d.logout_time.slice(0, 5) <= d.login_time.slice(0, 5)) {
    return { error: 'The logout time must be after the login time.' };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc('request_attendance_correction', {
    p_date: d.work_date,
    p_login: d.login_time,
    p_logout: d.logout_time,
    p_reason: d.reason,
  });
  if (error) return { error: friendlyError(error.message) };
  revalidatePath('/', 'layout');
  return { ok: 'Correction requested. An admin will review it; your original sign-in and sign-out times are kept either way.' };
}

/** Admin: approve or reject a correction request. */
export async function decideCorrectionAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();
  const parsed = z
    .object({
      id: z.uuid('Unknown request.'),
      approve: z.enum(['1', '0'], 'Choose approve or reject.'),
      note: z.string().trim().max(1000, 'Keep the note under 1000 characters.').default(''),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const approve = parsed.data.approve === '1';
  const supabase = await createClient();
  const { error } = await supabase.rpc('decide_attendance_correction', { p_id: parsed.data.id, p_approve: approve, p_note: parsed.data.note });
  if (error) return { error: friendlyError(error.message) };
  revalidatePath('/', 'layout');
  return { ok: approve ? 'Correction approved.' : 'Correction rejected.' };
}

/** Admin: set a schedule from a date (today or later). Past days keep the schedule they had. */
export async function setScheduleAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();
  const parsed = z
    .object({
      member_id: z.uuid('Choose an employee.'),
      effective_from: dateField('Choose the date the schedule starts.'),
      start_time: z.string().regex(TIME, 'Enter a start time.'),
      end_time: z.string().regex(TIME, 'Enter an end time.'),
      break_minutes: z.coerce.number('Break must be a number of minutes.').int('Break must be whole minutes.').min(0, 'Break must be 0-240 minutes.').max(240, 'Break must be 0-240 minutes.'),
      grace_minutes: z.coerce.number('Grace period must be a number of minutes.').int('Grace period must be whole minutes.').min(0, 'Grace period must be 0-120 minutes.').max(120, 'Grace period must be 0-120 minutes.'),
      timezone: z.string().trim().min(1, 'Choose a time zone.').max(64).refine(isTimeZone, 'Unknown time zone.'),
      note: z.string().trim().max(500, 'Keep the note under 500 characters.').default(''),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;
  const days = Array.from(new Set(formData.getAll('days').map((v) => Number(v)))).filter((n) => Number.isInteger(n) && n >= 1 && n <= 7).sort((a, b) => a - b);
  if (days.length === 0) return { error: 'Choose at least one working day.' };
  if (d.end_time.slice(0, 5) <= d.start_time.slice(0, 5)) return { error: 'The end time must be after the start time (shifts start and end on the same day).' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_set_schedule', {
    p_member: d.member_id,
    p_effective_from: d.effective_from,
    p_start: d.start_time,
    p_end: d.end_time,
    p_days: days,
    p_break: d.break_minutes,
    p_grace: d.grace_minutes,
    p_timezone: d.timezone,
    p_note: d.note,
  });
  if (error) return { error: friendlyError(error.message) };
  revalidatePath('/', 'layout');
  return { ok: 'Schedule saved. It applies from the chosen date; earlier days keep their old schedule.' };
}

/** Admin: approve, reject or waive one or many exceptions. Already-decided ones are skipped. */
export async function decideFlagsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();
  const parsed = z
    .object({
      ids: z.array(z.uuid('Unknown exception.')).min(1, 'Select at least one exception.').max(500, 'Decide up to 500 exceptions at a time.'),
      decision: z.enum(DECISIONS, 'Choose Approve, Reject or Waive.'),
      note: z.string().trim().max(1000, 'Keep the note under 1000 characters.').default(''),
    })
    .safeParse({ ids: formData.getAll('ids'), decision: formData.get('decision'), note: formData.get('note') ?? '' });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('decide_attendance_flags', { p_ids: parsed.data.ids, p_decision: parsed.data.decision, p_note: parsed.data.note });
  if (error) return { error: friendlyError(error.message) };
  revalidatePath('/', 'layout');
  const done = Number(data?.decided ?? 0);
  const skipped = Number(data?.skipped ?? 0);
  const verb = parsed.data.decision.toLowerCase();
  return {
    ok: `${done} exception${done === 1 ? '' : 's'} ${verb}.${skipped ? ` ${skipped} already had a decision and ${skipped === 1 ? 'was' : 'were'} left as ${skipped === 1 ? 'it was' : 'they were'}.` : ''}`,
  };
}

/** Admin: reopen a decided exception (its decision is cleared; the history keeps it). */
export async function reopenFlagAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();
  const parsed = z
    .object({ id: z.uuid('Unknown exception.'), note: z.string().trim().max(1000, 'Keep the note under 1000 characters.').default('') })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.rpc('reopen_attendance_flag', { p_flag: parsed.data.id, p_note: parsed.data.note });
  if (error) return { error: friendlyError(error.message) };
  revalidatePath('/', 'layout');
  return { ok: 'Exception reopened.' };
}

/** Start or end a break for the signed-in person. */
export async function breakAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireMe();
  const op = formData.get('op');
  if (op !== 'start' && op !== 'end') return { error: 'Unknown break action.' };
  const supabase = await createClient();
  const { data, error } = op === 'start' ? await supabase.rpc('start_break', { p_note: '' }) : await supabase.rpc('end_break');
  if (error) return { error: friendlyError(error.message) };
  revalidatePath('/', 'layout');
  if (op === 'start') return { ok: data?.already_running ? 'You are already on a break.' : 'Break started.' };
  if (!data?.id) return { ok: 'You were not on a break.' };
  return { ok: `Break ended (${data.minutes} min).` };
}

/** A missed break entered by hand. Employees: today only; admins: anyone, up to 60 days back. */
export async function addBreakAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireMe();
  const parsed = z
    .object({
      member_id: z.preprocess((v) => (v === '' || v === null ? undefined : v), z.uuid('Choose an employee.').optional()),
      work_date: dateField('Choose the date of the break.'),
      start_time: z.string().regex(TIME, 'Enter the break start as HH:MM.'),
      end_time: z.string().regex(TIME, 'Enter the break end as HH:MM.'),
      note: z.string().trim().max(500, 'Keep the note under 500 characters.').default(''),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;
  if (d.end_time.slice(0, 5) <= d.start_time.slice(0, 5)) return { error: 'The break must end after it starts.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('add_attendance_break', {
    p_member: d.member_id ?? null,
    p_date: d.work_date,
    p_start: d.start_time,
    p_end: d.end_time,
    p_note: d.note,
  });
  if (error) return { error: friendlyError(error.message) };
  revalidatePath('/', 'layout');
  return { ok: 'Break recorded. Hours worked for that day now leave it out.' };
}

/** Admin: remove a break from the calculations (the record is kept, marked as removed). */
export async function voidBreakAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();
  const parsed = z
    .object({ id: z.uuid('Unknown break.'), note: z.string().trim().min(3, 'Say why the break is being removed.').max(500, 'Keep the note under 500 characters.') })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.rpc('void_attendance_break', { p_id: parsed.data.id, p_note: parsed.data.note });
  if (error) return { error: friendlyError(error.message) };
  revalidatePath('/', 'layout');
  return { ok: 'Break removed.' };
}

/** Admin: exempt someone from late / early / long-break flags, permanently or for dates. */
export async function addExemptionAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();
  const parsed = z
    .object({
      member_id: z.uuid('Choose an employee.'),
      start_date: dateField('Choose the first exempt day.'),
      end_date: z.preprocess((v) => (v === '' || v === null ? null : v), z.string().refine((v) => validDate(v), 'Choose a real end date.').nullable()),
      note: z.string().trim().min(3, 'Say why the person is exempt.').max(500, 'Keep the note under 500 characters.'),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;
  if (d.end_date && d.end_date < d.start_date) return { error: 'The end date is before the start date.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_add_exemption', { p_member: d.member_id, p_start: d.start_date, p_end: d.end_date, p_note: d.note });
  if (error) return { error: friendlyError(error.message) };
  revalidatePath('/', 'layout');
  return { ok: d.end_date ? 'Exemption added for those dates.' : 'Permanent exemption added. End it here whenever it should stop.' };
}

/** Admin: switch an exemption off from tomorrow. */
export async function endExemptionAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();
  const parsed = z
    .object({ id: z.uuid('Unknown exemption.'), note: z.string().trim().max(500, 'Keep the note under 500 characters.').default('') })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_end_exemption', { p_id: parsed.data.id, p_note: parsed.data.note });
  if (error) return { error: friendlyError(error.message) };
  revalidatePath('/', 'layout');
  return { ok: 'Exemption ended. It no longer applies from tomorrow.' };
}

/** Admin: from a date, take the person's hours from their team or company default. */
export async function followDefaultAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();
  const parsed = z
    .object({ member_id: z.uuid('Choose an employee.'), effective_from: dateField('Choose the date to start from.') })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_follow_default', { p_member: parsed.data.member_id, p_effective_from: parsed.data.effective_from });
  if (error) return { error: friendlyError(error.message) };
  revalidatePath('/', 'layout');
  return { ok: 'From that date this person follows the team or company default hours. Earlier days keep their old schedule.' };
}
