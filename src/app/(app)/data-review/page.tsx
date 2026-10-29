import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { requireManager } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { friendlyError } from '@/lib/format';
import type { ActionState } from '@/lib/types';
import { ActionForm, SubmitButton } from '@/components/forms';
import { EmptyState, PageHeader } from '@/components/ui';

export const metadata = { title: 'Data Review' };

async function resolveIssue(_prev: ActionState, formData: FormData): Promise<ActionState> {
  'use server';
  await requireManager();
  const id = z.uuid().safeParse(formData.get('id'));
  const status = z.enum(['Open', 'Resolved', 'Dismissed']).safeParse(formData.get('status'));
  if (!id.success || !status.success) return { error: 'Invalid request.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('resolve_data_issue', { p_issue: id.data, p_status: status.data, p_note: String(formData.get('note') ?? '') });
  if (error) return { error: friendlyError(error.message) };
  revalidatePath('/', 'layout');
  return { ok: 'Updated.' };
}

export default async function DataReview() {
  await requireManager();
  const supabase = await createClient();
  const { data } = await supabase.from('data_issues').select('*').order('status').order('source_file').order('source_row');
  const rows = data ?? [];
  return (
    <>
      <PageHeader title="Data Review" subtitle="Rows from the Google Sheets export that were not valid records. They were kept here instead of being imported as spreadsheet errors." />
      {rows.length === 0 && <EmptyState title="Nothing to review" />}
      <div className="space-y-3">
        {rows.map((r) => (
          <div key={r.id} className={`card p-4 ${r.status === 'Open' ? '' : 'opacity-70'}`}>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded bg-navy-100 px-1.5 py-0.5 font-semibold text-navy-800">{r.source_file}{r.source_row ? ` · row ${r.source_row}` : ''}</span>
              <span className={`rounded px-1.5 py-0.5 font-semibold ${r.status === 'Open' ? 'bg-amber-100 text-amber-900' : 'bg-green-100 text-green-800'}`}>{r.status}</span>
            </div>
            <p className="mt-2 font-medium text-slate-900">{r.issue}</p>
            <p className="mt-1 text-sm text-slate-600">{r.suggested_action}</p>
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-slate-500">Original row</summary>
              <pre className="mt-1 overflow-x-auto rounded bg-slate-50 p-2 text-xs">{JSON.stringify(r.raw, null, 2)}</pre>
            </details>
            {r.resolution_note && <p className="mt-2 text-sm text-slate-700">Resolution: {r.resolution_note}</p>}
            <ActionForm action={resolveIssue} className="mt-3 flex flex-wrap items-center gap-2">
              <input type="hidden" name="id" value={r.id} />
              <input name="note" className="input max-w-sm flex-1" placeholder="Note (optional)" maxLength={500} />
              <select name="status" defaultValue={r.status === 'Open' ? 'Resolved' : 'Open'} className="input w-auto">
                <option value="Resolved">Mark resolved</option>
                <option value="Dismissed">Dismiss</option>
                <option value="Open">Reopen</option>
              </select>
              <SubmitButton className="btn-secondary">Save</SubmitButton>
            </ActionForm>
          </div>
        ))}
      </div>
    </>
  );
}
