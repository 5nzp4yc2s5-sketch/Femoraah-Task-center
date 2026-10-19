'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Meter } from '@/components/charts';
import { fmtMinutes as hm } from '@/lib/format';

export type PresenceState = 'working' | 'break' | 'out' | 'not_in' | 'leave' | 'off';

export interface Presence {
  id: string;
  name: string;
  teamId: string | null;
  teamName: string | null;
  state: PresenceState;
  /** "09:42", already in the person's time zone. */
  signedIn: string | null;
  signedOut: string | null;
  late: number | null;
  breakSince: string | null;
  workedMinutes: number;
  targetMinutes: number | null;
  /** Leave type, holiday name or "Weekly off". */
  note: string | null;
  exempt: boolean;
  openFlags: number;
}

const STATES: { key: PresenceState; label: string; dot: string; chip: string }[] = [
  { key: 'working', label: 'Working', dot: 'bg-emerald-500', chip: 'bg-emerald-50 text-emerald-800 ring-emerald-200' },
  { key: 'break', label: 'On a break', dot: 'bg-amber-400', chip: 'bg-amber-50 text-amber-900 ring-amber-200' },
  { key: 'not_in', label: 'Not signed in', dot: 'bg-red-400', chip: 'bg-red-50 text-red-800 ring-red-200' },
  { key: 'out', label: 'Signed out', dot: 'bg-slate-400', chip: 'bg-slate-100 text-slate-700 ring-slate-300' },
  { key: 'leave', label: 'On leave', dot: 'bg-violet-400', chip: 'bg-violet-50 text-violet-800 ring-violet-200' },
  { key: 'off', label: 'Day off', dot: 'bg-slate-200', chip: 'bg-white text-slate-500 ring-slate-200' },
];

/** Everyone's state today, filterable by team and by state without reloading the page. */
export function WhoIsIn({ people, teams }: { people: Presence[]; teams: { id: string; name: string }[] }) {
  const [team, setTeam] = useState<string>('all');
  const [state, setState] = useState<PresenceState | 'all'>('all');
  const inTeam = people.filter((p) => team === 'all' || (team === 'none' ? !p.teamId : p.teamId === team));
  const shown = inTeam.filter((p) => state === 'all' || p.state === state);
  const counts = Object.fromEntries(STATES.map((s) => [s.key, inTeam.filter((p) => p.state === s.key).length])) as Record<PresenceState, number>;
  const hasNoTeam = people.some((p) => !p.teamId);
  const order = new Map(STATES.map((s, i) => [s.key, i]));

  return (
    <div className="card p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        {teams.length > 0 && (
          <div className="flex flex-wrap gap-1" role="group" aria-label="Team">
            {[{ id: 'all', name: 'All teams' }, ...teams, ...(hasNoTeam ? [{ id: 'none', name: 'No team' }] : [])].map((t) => (
              <button
                key={t.id}
                type="button"
                aria-pressed={team === t.id}
                onClick={() => setTeam(t.id)}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${team === t.id ? 'bg-navy-800 text-white' : 'text-navy-800 hover:bg-navy-100'}`}
              >
                {t.name}
              </button>
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Show">
          <button
            type="button"
            aria-pressed={state === 'all'}
            onClick={() => setState('all')}
            className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset transition-colors ${state === 'all' ? 'bg-navy-800 text-white ring-navy-800' : 'bg-white text-navy-800 ring-line hover:bg-navy-50'}`}
          >
            Everyone · {inTeam.length}
          </button>
          {STATES.filter((s) => counts[s.key] > 0 || state === s.key).map((s) => (
            <button
              key={s.key}
              type="button"
              aria-pressed={state === s.key}
              onClick={() => setState(state === s.key ? 'all' : s.key)}
              className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset transition-colors ${state === s.key ? 'bg-navy-800 text-white ring-navy-800' : `${s.chip} hover:brightness-95`}`}
            >
              <span className={`h-2 w-2 rounded-full ${s.dot}`} aria-hidden />
              {s.label} · {counts[s.key]}
            </button>
          ))}
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-line px-4 py-6 text-center text-sm text-slate-500">Nobody matches. Choose another team or state.</p>
      ) : (
        <ul className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3" aria-live="polite">
          {[...shown]
            .sort((a, b) => (order.get(a.state)! - order.get(b.state)!) || a.name.localeCompare(b.name))
            .map((p) => {
              const s = STATES.find((x) => x.key === p.state)!;
              return (
                <li key={p.id} className="fade-up">
                  <Link
                    href={`/attendance?member=${p.id}`}
                    className="flex h-full flex-col gap-2 rounded-lg border border-line bg-white p-3 transition hover:-translate-y-0.5 hover:border-navy-600/40 hover:shadow-sm focus-visible:outline-2 focus-visible:outline-navy-600"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate font-medium text-navy-900">{p.name}</div>
                        <div className="truncate text-xs text-slate-500">{p.teamName ?? 'No team'}{p.exempt ? ' · Exempt from timing' : ''}</div>
                      </div>
                      <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${s.chip}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${s.dot} ${p.state === 'working' ? 'animate-pulse' : ''}`} aria-hidden />
                        {s.label}
                      </span>
                    </div>
                    <div className="text-xs text-slate-600">
                      {p.state === 'leave' || p.state === 'off' ? (
                        p.note ?? '—'
                      ) : p.state === 'not_in' ? (
                        'No sign-in yet today'
                      ) : (
                        <>
                          In {p.signedIn}
                          {p.late ? <span className="font-medium text-red-700"> · {hm(p.late)} late</span> : null}
                          {p.state === 'break' && p.breakSince && <> · break since {p.breakSince}</>}
                          {p.state === 'out' && p.signedOut && <> · out {p.signedOut}</>}
                        </>
                      )}
                      {p.openFlags > 0 && <span className="ml-1 font-medium text-amber-800">· {p.openFlags} open exception{p.openFlags === 1 ? '' : 's'}</span>}
                    </div>
                    {p.targetMinutes !== null && p.state !== 'leave' && p.state !== 'off' && (
                      <div>
                        <div className="mb-1 flex justify-between text-[11px] tabular-nums text-slate-500">
                          <span>Worked {hm(p.workedMinutes)}</span>
                          <span>of {hm(p.targetMinutes)}</span>
                        </div>
                        <Meter
                          value={p.workedMinutes}
                          max={p.targetMinutes}
                          label={`${p.name} worked ${hm(p.workedMinutes)} of ${hm(p.targetMinutes)}`}
                          className={p.workedMinutes >= p.targetMinutes ? 'bg-emerald-500' : 'bg-accent'}
                        />
                      </div>
                    )}
                  </Link>
                </li>
              );
            })}
        </ul>
      )}
    </div>
  );
}
