'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireArea } from '@/lib/session';
import { friendlyError } from '@/lib/format';
import { brandChecks, DEFAULT_BRAND, HEX } from '@/lib/colors';
import type { ActionState } from '@/lib/types';

const MAX_LOGO_BYTES = 300 * 1024;
const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const colour = z.preprocess((v) => (typeof v === 'string' ? v.trim().toLowerCase() : v), z.string().regex(HEX, 'Colours must be written like #1f3a5f.'));

/** Company name, tagline and colours. A colour equal to the default is stored as "not set". */
export async function saveBrandingAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireArea('settings');
  const parsed = z
    .object({
      company_name: z.string().trim().max(60, 'Keep the company name to 60 characters.').default(''),
      tagline: z.string().trim().max(80, 'Keep the tagline to 80 characters.').default(''),
      primary: colour,
      secondary: colour,
      accent: colour,
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;
  const failed = brandChecks(d).filter((c) => !c.ok);
  if (failed.length) {
    const c = failed[0];
    return { error: `Hard to read: ${c.label.toLowerCase()} is ${c.ratio.toFixed(1)}:1, and needs at least ${c.needed}:1. Choose a ${c.key === 'accent' ? 'stronger' : 'darker'} ${c.key} colour.` };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_update_branding', {
    p_company_name: d.company_name,
    p_tagline: d.tagline,
    p_primary: d.primary === DEFAULT_BRAND.primary ? '' : d.primary,
    p_secondary: d.secondary === DEFAULT_BRAND.secondary ? '' : d.secondary,
    p_accent: d.accent === DEFAULT_BRAND.accent ? '' : d.accent,
  });
  if (error) return { error: friendlyError(error.message) };
  revalidatePath('/', 'layout');
  return { ok: 'Company settings saved. Everyone sees the new look on their next page load.' };
}

/** Back to the original name and colours (the logo is kept). */
export async function resetBrandingAction(_prev: ActionState): Promise<ActionState> {
  await requireArea('settings');
  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_update_branding', { p_company_name: '', p_tagline: '', p_primary: '', p_secondary: '', p_accent: '' });
  if (error) return { error: friendlyError(error.message) };
  revalidatePath('/', 'layout');
  return { ok: 'Name and colours are back to the default look.' };
}

export async function uploadLogoAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireArea('settings');
  const file = formData.get('logo');
  if (!(file instanceof File) || file.size === 0) return { error: 'Choose an image file.' };
  if (!LOGO_TYPES.includes(file.type)) return { error: 'The logo must be a PNG, JPEG or WebP image. SVG files are not accepted.' };
  if (file.size > MAX_LOGO_BYTES) return { error: `The logo is ${Math.ceil(file.size / 1024)} KB. It must be 300 KB or smaller.` };
  const data = Buffer.from(await file.arrayBuffer()).toString('base64');
  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_set_logo', { p_mime: file.type, p_data: data });
  if (error) return { error: friendlyError(error.message) };
  revalidatePath('/', 'layout');
  return { ok: 'Logo saved.' };
}

export async function removeLogoAction(_prev: ActionState): Promise<ActionState> {
  await requireArea('settings');
  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_set_logo', { p_mime: null, p_data: null });
  if (error) return { error: friendlyError(error.message) };
  revalidatePath('/', 'layout');
  return { ok: 'Logo removed.' };
}

const quoteFields = z.object({
  id: z.preprocess((v) => (v === '' || v === null || v === undefined ? null : v), z.uuid('Unknown quote.').nullable()),
  body: z.string().trim().min(1, 'Write the quote.').max(300, 'Keep the quote to 300 characters.'),
  author: z.string().trim().max(80, 'Keep the author to 80 characters.').default(''),
});

export async function saveQuoteAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireArea('settings');
  const parsed = quoteFields.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_save_quote', { p_id: d.id, p_body: d.body, p_author: d.author });
  if (error) return { error: friendlyError(error.message) };
  revalidatePath('/', 'layout');
  return { ok: d.id ? 'Quote saved.' : 'Quote added at the end of the list.' };
}

export async function setQuoteActiveAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireArea('settings');
  const parsed = z.object({ id: z.uuid('Unknown quote.'), active: z.enum(['1', '0']) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_set_quote_active', { p_id: parsed.data.id, p_active: parsed.data.active === '1' });
  if (error) return { error: friendlyError(error.message) };
  revalidatePath('/', 'layout');
  return { ok: parsed.data.active === '1' ? 'Quote restored to the rotation.' : 'Quote archived. It no longer appears, and you can restore it.' };
}

export async function moveQuoteAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireArea('settings');
  const parsed = z.object({ id: z.uuid('Unknown quote.'), dir: z.enum(['up', 'down']) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_move_quote', { p_id: parsed.data.id, p_up: parsed.data.dir === 'up' });
  if (error) return { error: friendlyError(error.message) };
  revalidatePath('/settings/quotes');
  return {};
}
