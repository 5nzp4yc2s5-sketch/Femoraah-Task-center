import Link from 'next/link';
import { requireArea } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { activeMembers } from '@/lib/data';
import { addDays, fmtDate, friendlyError } from '@/lib/format';
import { AttendanceBadge } from '@/components/badges';
import { LocalTime } from '@/components/local-time';
import { ActionForm, ConfirmAction, SubmitButton } from '@/components/forms';
import { EmptyState, Notice, PageHeader, SectionTitle } from '@/components/ui';
import { addExemptionAction, endExemptionAction } from '../actions';
import { dbToday, memberNames } from '../data';

export const metadata = { title: 'Attendance exemptions' };

interface Exemption {
  id: string;
  member_id: string;
  start_date: string;
  end_date: string | null;
  note: string;
  created_by: string | null;
  created_at: string;
  ended_from: string | null;
  ended_by: string | null;
  ended_at: string | null;
  end_note: string;
}

/** The last day an exemption applies, or null when it is permanent. */
function lastDay(e: Exemption): string | null {
  const stop = e.ended_from ? addDays(e.ended_from, -1) : null;
  if (stop && e.end_date) return stop < e.end_date ? stop : e.end_date;
  return stop ?? e.end_date;
}

function stateOf(e: Exemption, today: string): 'Active' | 'Upcoming' | 'Ended' {
  const last = lastDay(e);
  if (last !== null && (last < today || last < e.start_date)) return 'Ended';
  return e.start_date > today ? 'Upcoming' : 'Active';
}

export default async function ExemptionsPage() {
  await requireArea('attendance');
  const supabase = await createClient();
  const [{ today, error: todayError }, members, names, res] = await Promise.all([
    dbToday(supabase),
    activeMembers(),
    memberNames(supabase),
    supabase.from('attendance_exemptions').select('*').order('start_date', { ascending: false }).limit(300),
  ]);
  const header = (
    <PageHeader
      title="Attendance exemptions"
      subtitle="People who should not get late login, early or late logout, or long break exceptions, permanently or for set dates. Their times are still recorded."
      actions={
        <>
          <Link href="/attendance/exceptions" className="btn-secondary">Exceptions</Link>
          <Link href="/attendance" className="btn-secondary">Back to Attendance</Link>
        </>
      }
    />
  );
  if (!today) {
    return (
      <>
        {header}
        <Notice tone="error">Could not load today&apos;s date from the database ({friendlyError(todayError)}). Please refresh the page.</Notice>
      </>
    );
  }
  const rows = (res.data ?? []) as Exemption[];
  const current = rows.filter((e) => stateOf(e, today) !== 'Ended');
  const ended = rows.filter((e) => stateOf(e, today) === 'Ended');

  const list = (items: Exemption[], allowEnd: boolean) => (
    <ul className="grid gap-3 lg:grid-cols-2">
      {items.map((e) => {
        const state = stateOf(e, today);
        const last = lastDay(e);
        return (
          <li key={e.id} className="card p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-medium text-navy-900">{names.get(e.member_id) ?? 'Former member'}</div>
                <div className="text-xs text-slate-500">
                  {fmtDate(e.start_date)} {last ? `to ${fmtDate(last)}` : 'onwards (permanent)'}
                </div>
              </div>
              <AttendanceBadge status={state === 'Active' ? 'Exempt' : state === 'Upcoming' ? 'Pending' : 'Resolved'} />
            </div>
            <p className="mt-2 text-sm text-slate-700">{e.note}</p>
            <p className="mt-2 text-xs text-slate-500">
              Added by {e.created_by ? names.get(e.created_by) ?? 'an admin' : 'an admin'} · <LocalTime iso={e.created_at} />
              {e.ended_at && (
                <span className="block">
                  Ended by {e.ended_by ? names.get(e.ended_by) ?? 'an admin' : 'an admin'} · <LocalTime iso={e.ended_at} />
                  {e.end_note && <> · &ldquo;{e.end_note}&rdquo;</>}
                </span>
              )}
            </p>
            {allowEnd && !e.ended_from && (
              <div className="mt-3">
                <ConfirmAction
                  action={endExemptionAction}
                  label="End exemption"
                  title="End this exemption?"
                  body="It stops applying from tomorrow. Today and earlier days keep it, so nothing already recorded is re-judged."
                  confirmLabel="End exemption"
                  className="btn-secondary"
                  hidden={{ id: e.id }}
                  withNote
                />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );

  return (
    <>
      {header}
      {res.error && <Notice tone="error">Could not load exemptions: {friendlyError(res.error.message)}</Notice>}
      <Notice>
        An exemption starts today or later, so past days keep the rules they had. Missed sign-ins and incomplete sessions are still flagged for
        exempt people. To clear exceptions raised before an exemption, waive them in the exception queue.
      </Notice>

      <SectionTitle>Current and upcoming ({current.length})</SectionTitle>
      {current.length === 0 ? <EmptyState title="Nobody is exempt" body="Everyone is judged against their schedule." /> : list(current, true)}

      <section id="add" className="scroll-mt-4">
        <SectionTitle>Add an exemption</SectionTitle>
        <ActionForm action={addExemptionAction} resetOnSuccess className="card space-y-3 p-4 sm:p-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="label" htmlFor="e-member">Employee</label>
              <select id="e-member" name="member_id" className="input" required defaultValue="">
                <option value="" disabled>Choose…</option>
                {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="e-start">First exempt day</label>
              <input id="e-start" type="date" name="start_date" className="input" required min={today} defaultValue={today} />
            </div>
            <div>
              <label className="label" htmlFor="e-end">Last exempt day</label>
              <input id="e-end" type="date" name="end_date" className="input" min={today} />
              <p className="mt-1 text-xs text-slate-500">Leave empty for a permanent exemption.</p>
            </div>
          </div>
          <div>
            <label className="label" htmlFor="e-note">Reason</label>
            <input id="e-note" name="note" className="input" required minLength={3} maxLength={500} placeholder="e.g. Field sales, flexible hours agreed" />
          </div>
          <div className="flex justify-end">
            <SubmitButton>Add exemption</SubmitButton>
          </div>
        </ActionForm>
      </section>

      {ended.length > 0 && (
        <details className="mt-6">
          <summary className="cursor-pointer text-sm font-medium text-navy-700">Ended exemptions ({ended.length})</summary>
          <div className="mt-3">{list(ended, false)}</div>
        </details>
      )}
    </>
  );
}
