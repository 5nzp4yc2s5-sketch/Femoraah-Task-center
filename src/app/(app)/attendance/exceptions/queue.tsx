'use client';

import { startTransition, useActionState, useEffect, useMemo, useState } from 'react';
import { fmtClock, fmtDate } from '@/lib/format';
import { AttendanceBadge } from '@/components/badges';
import { LocalTime } from '@/components/local-time';
import { ConfirmAction } from '@/components/forms';
import { EmptyState } from '@/components/ui';
import { decideFlagsAction, reopenFlagAction } from '../actions';
import type { Decision } from '../lib';

export interface ExceptionRow {
  id: string;
  member_id: string;
  member_name: string;
  team_name: string | null;
  work_date: string;
  flag_type: string;
  expected_at: string | null;
  actual_at: string | null;
  minutes: number | null;
  reason: string;
  employee_explanation: string;
  status: 'Open' | 'Reviewed' | 'Resolved';
  decision: Decision | null;
  review_note: string;
  reviewer_name: string | null;
  reviewed_at: string | null;
  tz: string;
  history: { action: string; note: string; actor: string | null; at: string }[];
}

const BUTTONS: { decision: Decision; label: string; className: string }[] = [
  { decision: 'Approved', label: 'Approve', className: 'btn-primary' },
  { decision: 'Rejected', label: 'Reject', className: 'btn-secondary' },
  { decision: 'Waived', label: 'Waive', className: 'btn-secondary' },
];

function amount(r: ExceptionRow): string {
  if (r.minutes === null) return '—';
  return r.flag_type.startsWith('Repeated') ? `${r.minutes} times` : `${r.minutes} min`;
}

function actual(r: ExceptionRow): string {
  if (r.actual_at) return fmtClock(r.actual_at, r.tz);
  if (r.flag_type === 'No Login') return 'No sign-in';
  if (r.flag_type === 'Incomplete Session') return 'Not signed out';
  return '—';
}

/**
 * The exception queue: tick rows (or one row's own buttons) and approve, reject or waive them with an
 * optional note. Only undecided rows can be ticked; the database skips any that someone else
 * decided in the meantime.
 */
export function ExceptionQueue({ rows }: { rows: ExceptionRow[] }) {
  const [state, action, pending] = useActionState(decideFlagsAction, undefined);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [note, setNote] = useState('');
  const open = useMemo(() => rows.filter((r) => r.status !== 'Resolved'), [rows]);
  const allTicked = open.length > 0 && open.every((r) => selected.has(r.id));

  useEffect(() => {
    if (state?.ok) {
      setSelected(new Set());
      setNote('');
    }
  }, [state]);
  // Drop ticks for rows that are gone or decided after a refresh.
  useEffect(() => {
    setSelected((cur) => new Set([...cur].filter((id) => open.some((r) => r.id === id))));
  }, [open]);

  const decide = (decision: Decision, ids: string[]) => {
    if (pending || ids.length === 0) return;
    const fd = new FormData();
    for (const id of ids) fd.append('ids', id);
    fd.set('decision', decision);
    fd.set('note', note);
    startTransition(() => action(fd));
  };
  const toggle = (id: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const messages = (
    <>
      {state?.error && <p role="alert" className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{state.error}</p>}
      {state?.ok && <p role="status" className="mb-3 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">{state.ok}</p>}
    </>
  );
  if (rows.length === 0) {
    return (
      <>
        {messages}
        <EmptyState title="No exceptions match these filters" body="Late logins, early or late logouts, long breaks, missed sign-ins and incomplete sessions appear here." />
      </>
    );
  }

  return (
    <>
      <div className="card sticky top-14 z-20 mb-3 flex flex-col gap-2 p-3 sm:flex-row sm:items-end lg:top-2" aria-label="Decide selected exceptions">
        <div className="flex items-center gap-2 sm:pb-2">
          <input
            id="tick-all"
            type="checkbox"
            className="h-4 w-4"
            checked={allTicked}
            disabled={open.length === 0}
            onChange={() => setSelected(allTicked ? new Set() : new Set(open.map((r) => r.id)))}
          />
          <label htmlFor="tick-all" className="whitespace-nowrap text-sm text-slate-700">
            {selected.size ? `${selected.size} selected` : `Select all open (${open.length})`}
          </label>
        </div>
        <div className="min-w-0 flex-1">
          <label className="label" htmlFor="q-note">Note (optional, saved with the decision)</label>
          <input id="q-note" className="input" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Metro outage confirmed" />
        </div>
        <div className="flex flex-wrap gap-2">
          {BUTTONS.map((b) => (
            <button
              key={b.decision}
              type="button"
              className={b.className}
              disabled={pending || selected.size === 0}
              onClick={() => decide(b.decision, [...selected])}
            >
              {b.label}{selected.size ? ` ${selected.size}` : ''}
            </button>
          ))}
        </div>
      </div>
      {messages}

      <ul className="space-y-2">
        {rows.map((r) => {
          const decided = r.status === 'Resolved';
          const shown = r.decision ?? r.status;
          return (
            <li key={r.id} className={`card border-l-4 p-3 sm:p-4 ${decided ? 'border-l-green-600' : r.status === 'Reviewed' ? 'border-l-slate-400' : 'border-l-amber-500'}`}>
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 shrink-0"
                  aria-label={`Select ${r.flag_type} for ${r.member_name} on ${fmtDate(r.work_date)}`}
                  disabled={decided}
                  checked={selected.has(r.id)}
                  onChange={() => toggle(r.id)}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium text-navy-900">
                        {r.member_name} · {r.flag_type}
                      </div>
                      <div className="text-xs text-slate-500">
                        {fmtDate(r.work_date)}
                        {r.team_name && <> · {r.team_name}</>}
                      </div>
                    </div>
                    <AttendanceBadge status={shown} />
                  </div>
                  <dl className="mt-2 grid grid-cols-3 gap-2 text-sm sm:max-w-md">
                    <div>
                      <dt className="label">{r.flag_type.startsWith('Repeated') ? 'Window' : 'Expected'}</dt>
                      <dd className="tabular-nums">{r.flag_type.startsWith('Repeated') ? 'Recent days' : r.expected_at ? fmtClock(r.expected_at, r.tz) : '—'}</dd>
                    </div>
                    <div>
                      <dt className="label">Actual</dt>
                      <dd className="tabular-nums">{r.flag_type.startsWith('Repeated') ? '—' : actual(r)}</dd>
                    </div>
                    <div>
                      <dt className="label">{r.flag_type.startsWith('Repeated') ? 'Count' : 'Minutes'}</dt>
                      <dd className="tabular-nums">{amount(r)}</dd>
                    </div>
                  </dl>
                  <p className="mt-2 text-sm text-slate-700">{r.reason}</p>
                  <p className="mt-1 text-sm">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Explanation: </span>
                    <span className={r.employee_explanation ? 'text-slate-800' : 'text-slate-500'}>{r.employee_explanation || 'None yet.'}</span>
                  </p>
                  {decided && (
                    <p className="mt-1 text-xs text-slate-600">
                      {shown} by {r.reviewer_name ?? 'an admin'}
                      {r.reviewed_at && <> · <LocalTime iso={r.reviewed_at} /></>}
                      {r.review_note && <span className="block text-sm text-slate-700">Note: {r.review_note}</span>}
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {!decided &&
                      BUTTONS.map((b) => (
                        <button key={b.decision} type="button" className="btn-ghost px-2.5 py-1 text-xs" disabled={pending} onClick={() => decide(b.decision, [r.id])}>
                          {b.label}
                        </button>
                      ))}
                    {decided && (
                      <ConfirmAction
                        action={reopenFlagAction}
                        label="Reopen"
                        title="Reopen this exception?"
                        body="Its decision is cleared and it goes back to the open queue. The history keeps the earlier decision."
                        confirmLabel="Reopen"
                        className="btn-ghost px-2.5 py-1 text-xs"
                        hidden={{ id: r.id }}
                        withNote
                      />
                    )}
                    {r.history.length > 0 && (
                      <details className="text-xs">
                        <summary className="cursor-pointer text-navy-700">History ({r.history.length})</summary>
                        <ol className="mt-1 space-y-0.5 text-slate-600">
                          {r.history.map((h, i) => (
                            <li key={i}>
                              <LocalTime iso={h.at} /> · {h.action} by {h.actor ?? 'an admin'}
                              {h.note && <> · &ldquo;{h.note}&rdquo;</>}
                            </li>
                          ))}
                        </ol>
                      </details>
                    )}
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
