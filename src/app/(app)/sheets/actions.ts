'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireMe } from '@/lib/session';
import { friendlyError } from '@/lib/format';
import type { ActionState } from '@/lib/types';
import { SHEET_URL, SHEET_URL_HELP } from './lib';

const optionalId = z.preprocess((v) => (v === '' || v == null ? null : v), z.uuid().nullable());

const sheetSchema = z.object({
  id: optionalId,
  name: z.string().trim().min(1, 'Give the sheet a name').max(120, 'Keep the name under 120 characters'),
  purpose: z.string().trim().max(500, 'Keep the purpose under 500 characters').default(''),
  category: z.string().trim().max(60, 'Keep the category under 60 characters').default(''),
  team: optionalId,
  owner: optionalId,
  people: z.array(z.uuid()).max(50, 'Up to 50 people can work on one sheet'),
  url: z.string().trim().max(2000, SHEET_URL_HELP).regex(SHEET_URL, SHEET_URL_HELP),
  visibility: z.enum(['everyone', 'assigned']),
});

export async function saveSheetAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireMe();
  const parsed = sheetSchema.safeParse({ ...Object.fromEntries(formData), people: formData.getAll('people') });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const s = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('sheet_save', {
    p_id: s.id,
    p_name: s.name,
    p_purpose: s.purpose,
    p_category: s.category,
    p_team: s.team,
    p_owner: s.owner,
    p_people: s.people,
    p_url: s.url,
    p_visibility: s.visibility,
  });
  if (error) return { error: friendlyError(error.message) };
  revalidatePath('/sheets', 'layout');
  if (!s.id) redirect(`/sheets?added=${data}`);
  return { ok: 'Saved.' };
}

export async function archiveSheetAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireMe();
  const id = z.uuid().safeParse(formData.get('id'));
  if (!id.success) return { error: 'Unknown sheet.' };
  const archived = formData.get('archived') !== '0';
  const supabase = await createClient();
  const { error } = await supabase.rpc('sheet_set_archived', { p_id: id.data, p_archived: archived });
  if (error) return { error: friendlyError(error.message) };
  revalidatePath('/sheets', 'layout');
  return { ok: archived ? 'Sheet removed from the workspace. It can be restored from Removed sheets.' : 'Sheet restored.' };
}
