import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireMe } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { activeMembers } from '@/lib/data';
import { fmtClock, fmtDate } from '@/lib/format';
import { ActionForm, ConfirmAction, SubmitButton } from '@/components/forms';
import { Notice, SectionTitle } from '@/components/ui';
import { loadTeams, memberNames } from '../../attendance/data';
import { archiveSheetAction, saveSheetAction } from '../actions';
import { SheetFields } from '../fields';
import { localDay, type SheetRow } from '../lib';

export const metadata = { title: 'Google Sheet' };

const ACTIONS: Record<string, string> = { created: 'Added', updated: 'Updated', archived: 'Removed from the workspace', restored: 'Restored' };

export default async function SheetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const me = await requireMe();
  const supabase = await createClient();
  const [{ data }, { data: cats }, members, teams, names] = await Promise.all([
    supabase.from('work_sheets').select('*').eq('id', id).maybeSingle(),
    supabase.from('work_sheets').select('category').is('archived_at', null).neq('category', ''),
    activeMembers(),
    loadTeams(supabase),
    memberNames(supabase),
  ]);
  const s = data as SheetRow | null;
  if (!s) notFound();
  const canAdmin = me.areas.sheets;
  const removed = Boolean(s.archived_at);
  const canEdit = !removed && (canAdmin || s.owner_id === me.memberId);
  const categories = [...new Set((cats ?? []).map((c) => c.category as string))].sort((a, b) => a.localeCompare(b));
  const nameOf = (m: string | null) => (m ? names.get(m) ?? 'Former member' : null);
  const team = teams.find((t) => t.id === s.team_id)?.name;
  const working = s.people.filter((p) => p !== s.owner_id).map(nameOf).filter(Boolean);

  const { data: history } = me.isManager
    ? await supabase
        .from('audit_events')
        .select('id, actor_member_id, action, created_at')
        .eq('entity', 'work_sheet')
        .eq('entity_id', s.id)
        .order('created_at', { ascending: false })
        .limit(20)
    : { data: null };

  return (
    <div className="max-w-3xl space-y-6">
      <Link href={removed ? '/sheets?removed=1' : '/sheets'} className="text-sm text-navy-700 hover:underline">← Google Sheets</Link>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-navy-900 sm:text-2xl">{s.name}</h1>
          <p className="text-sm text-slate-600">
            {s.category && <>{s.category} · </>}
            {team ?? 'No team'} · Responsible: {nameOf(s.owner_id) ?? 'nobody yet'}
          </p>
        </div>
        {!removed && (
          <a href={s.url} target="_blank" rel="noopener noreferrer" className="btn-primary shrink-0 whitespace-nowrap">
            Open in Google Sheets <span aria-hidden>↗</span>
          </a>
        )}
      </div>

      {removed && (
        <Notice tone="warn">
          Removed from the workspace on {fmtDate(localDay(s.archived_at!, me.timezone))}
          {nameOf(s.archived_by) && <> by {nameOf(s.archived_by)}</>}. Restore it to show it to the team again.
        </Notice>
      )}

      {canEdit ? (
        <ActionForm action={saveSheetAction} className="card space-y-5 p-5">
          <SheetFields sheet={s} members={members} teams={teams} categories={categories} canAdmin={canAdmin} />
          {!canAdmin && <p className="text-xs text-slate-500">You are responsible for this sheet, so you can update its details and who works on it. A Sheets admin can change the responsible person.</p>}
          <div className="flex justify-end"><SubmitButton>Save sheet</SubmitButton></div>
        </ActionForm>
      ) : (
        <section className="card space-y-3 p-5 text-sm">
          <div>
            <div className="label">Purpose</div>
            <p className="text-slate-800">{s.purpose || '—'}</p>
          </div>
          <div>
            <div className="label">Working on it</div>
            <p className="text-slate-800">{working.length ? working.join(', ') : '—'}</p>
          </div>
          <div>
            <div className="label">Link</div>
            <p className="break-all font-mono text-xs text-slate-700">{s.url}</p>
          </div>
        </section>
      )}

      {canAdmin && (
        <section className="card p-5">
          <SectionTitle>{removed ? 'Restore' : 'Remove'}</SectionTitle>
          {removed ? (
            <ConfirmAction
              action={archiveSheetAction}
              label="Restore sheet"
              title={`Restore ${s.name}?`}
              body="It shows on the Google Sheets page again for everyone who could see it before."
              confirmLabel="Restore"
              className="btn-primary"
              hidden={{ id: s.id, archived: '0' }}
            />
          ) : (
            <>
              <p className="mb-3 text-sm text-slate-600">Removing hides the entry from the team. Nothing is deleted, and the Google Sheet itself is not touched.</p>
              <ConfirmAction
                action={archiveSheetAction}
                label="Remove from workspace"
                title={`Remove ${s.name}?`}
                body="It moves to Removed sheets, where a Sheets admin can restore it. The Google Sheet itself is not changed."
                confirmLabel="Remove"
                hidden={{ id: s.id, archived: '1' }}
              />
            </>
          )}
        </section>
      )}

      {history && history.length > 0 && (
        <section className="card p-5">
          <SectionTitle>History</SectionTitle>
          <ul className="space-y-1.5 text-sm">
            {history.map((h) => (
              <li key={h.id} className="flex flex-wrap gap-x-2 text-slate-700">
                <span className="tabular-nums text-slate-500">
                  {fmtDate(localDay(h.created_at, me.timezone))} {fmtClock(h.created_at, me.timezone)}
                </span>
                <span>
                  {ACTIONS[h.action] ?? h.action}
                  {nameOf(h.actor_member_id) && <> by {nameOf(h.actor_member_id)}</>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
