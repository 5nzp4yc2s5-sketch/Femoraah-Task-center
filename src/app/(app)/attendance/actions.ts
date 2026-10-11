'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin, requireMe } from '@/lib/session';
import { friendlyError } from '@/lib/format';
import type { ActionState } from '@/lib/types';
import { FLAG_STATUSES, isTimeZone, validDate } from './lib';

const TIME = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
const optTime = z.preprocess((v) => (v === '' || v === null || v === undefined ? null : v), z.string().regex(TIME, 'Enter times as HH:MM').nullable());
const dateField = (msg: string) => z.string().refine((v) => validDate(v), msg);

/** Admin: mark a flag Reviewed or Resolved (or reopen it) with a note. */
export async function reviewFlagAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();
  const parsed = z
    .object({
      id: z.uuid('Unknown flag.'),
      status: z.enum(FLAG_STATUSES, 'Choose a review status.'),
      note: z.string().trim().max(1000, 'Keep the note under 1000 characters.').default(''),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.rpc('review_attendance_flag', { p_flag: parsed.data.id, p_status: parsed.data.status, p_note: parsed.data.note });
  if (error) return { error: friendlyError(error.message) };
  revalidatePath('/', 'layout');
  return { ok: parsed.data.status === 'Open' ? 'Flag reopened.' : `Flag marked ${parsed.data.status}.` };
}

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
