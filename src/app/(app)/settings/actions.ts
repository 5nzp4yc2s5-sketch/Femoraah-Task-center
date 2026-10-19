'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireArea } from '@/lib/session';
import { friendlyError } from '@/lib/format';
import type { ActionState } from '@/lib/types';
import { isTimeZone, validDate } from '../attendance/lib';

const TIME = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
const dateField = (msg: string) => z.string().refine((v) => validDate(v), msg);
const optUuid = (msg: string) => z.preprocess((v) => (v === '' || v === null || v === undefined ? null : v), z.uuid(msg).nullable());

/** Create a team, or rename / archive / restore one. */
export async function saveTeamAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireArea('attendance');
  const parsed = z
    .object({
      id: optUuid('Unknown team.'),
      name: z.string().trim().min(1, 'Give the team a name.').max(60, 'Keep the name under 60 characters.'),
      note: z.string().trim().max(500, 'Keep the note under 500 characters.').default(''),
      is_active: z.enum(['1', '0']).default('1'),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_save_team', { p_id: d.id, p_name: d.name, p_note: d.note, p_active: d.is_active === '1' });
  if (error) return { error: friendlyError(error.message) };
  revalidatePath('/', 'layout');
  return { ok: d.id ? (d.is_active === '1' ? 'Team saved.' : 'Team archived. People in it keep it until you move them.') : 'Team added.' };
}

/** Put a person in a team (or no team) from a date. */
export async function setMemberTeamAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireArea('attendance');
  const parsed = z
    .object({
      member_id: z.uuid('Choose an employee.'),
      team_id: optUuid('Choose a team.'),
      effective_from: dateField('Choose the date the change starts.'),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_set_member_team', { p_member: d.member_id, p_team: d.team_id, p_from: d.effective_from });
  if (error) return { error: friendlyError(error.message) };
  revalidatePath('/', 'layout');
  return { ok: 'Team saved. It applies from the chosen date; earlier days keep the team they had.' };
}

/** Company or team default hours and weekly offs, from a date. */
export async function setDefaultHoursAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireArea('attendance');
  const parsed = z
    .object({
      team_id: optUuid('Choose a team.'),
      effective_from: dateField('Choose the date the hours start.'),
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
  const { error } = await supabase.rpc('admin_set_default_schedule', {
    p_team: d.team_id,
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
  return { ok: 'Default hours saved. They apply from the chosen date to everyone who follows them; earlier days keep their old hours.' };
}

/** Late-logout threshold (off when empty) and the grace on top of the break allowance. */
export async function attendanceRulesAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireArea('attendance');
  const parsed = z
    .object({
      late_logout: z.enum(['off', 'on']),
      late_logout_minutes: z.preprocess(
        (v) => (v === '' || v === null || v === undefined ? null : v),
        z.coerce.number('Enter the minutes after the scheduled end.').int().min(15, 'Use 15 to 600 minutes.').max(600, 'Use 15 to 600 minutes.').nullable(),
      ),
      long_break_grace: z.coerce.number('Enter the break grace in minutes.').int().min(0, 'Use 0 to 120 minutes.').max(120, 'Use 0 to 120 minutes.'),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;
  if (d.late_logout === 'on' && d.late_logout_minutes === null) return { error: 'Enter how many minutes after the scheduled end count as a late logout.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_update_attendance_settings', {
    p_late_logout_minutes: d.late_logout === 'on' ? d.late_logout_minutes : null,
    p_long_break_grace: d.long_break_grace,
  });
  if (error) return { error: friendlyError(error.message) };
  revalidatePath('/', 'layout');
  return { ok: 'Attendance rules saved.' };
}
