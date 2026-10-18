'use client';

import { startTransition, useActionState, useEffect, useState } from 'react';
import { fmtClock, fmtMinutes } from '@/lib/format';
import { breakAction } from './actions';

/** Minutes since an instant, refreshed every 15 seconds while shown. */
function useMinutesSince(iso: string | null): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (!iso) return;
    const tick = () => setNow(Date.now());
    tick();
    const id = window.setInterval(tick, 15_000);
    return () => window.clearInterval(id);
  }, [iso]);
  if (!iso || now === null) return null;
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
}

/**
 * Start / End break for the signed-in person, with a live timer. The times are taken by the
 * database when the button is pressed; this only shows them.
 */
export function BreakControl({
  canBreak,
  onBreak,
  startedAt,
  takenMinutes,
  allowance,
  tz,
}: {
  canBreak: boolean;
  onBreak: boolean;
  startedAt: string | null;
  takenMinutes: number;
  allowance: number | null;
  tz: string;
}) {
  const [state, action, pending] = useActionState(breakAction, undefined);
  const running = useMinutesSince(onBreak ? startedAt : null);
  const press = (op: 'start' | 'end') => {
    if (pending) return;
    const fd = new FormData();
    fd.set('op', op);
    startTransition(() => action(fd));
  };
  // The server figure already includes the running break up to the moment the page was rendered.
  const shownTotal = takenMinutes;
  const over = allowance !== null && shownTotal > allowance;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        {onBreak ? (
          <button type="button" className="btn-primary" disabled={pending} onClick={() => press('end')} aria-busy={pending}>
            {pending ? 'Ending…' : 'End break'}
          </button>
        ) : (
          <button type="button" className="btn-secondary" disabled={pending || !canBreak} onClick={() => press('start')} aria-busy={pending}>
            {pending ? 'Starting…' : 'Start break'}
          </button>
        )}
        <p className="text-sm text-slate-700" aria-live="polite">
          {onBreak && startedAt ? (
            <>
              On a break since <span className="font-semibold tabular-nums">{fmtClock(startedAt, tz)}</span>
              {running !== null && <> ({fmtMinutes(running)})</>}
            </>
          ) : canBreak ? (
            'Not on a break.'
          ) : (
            'Sign in for work to take a break.'
          )}
        </p>
      </div>
      <p className={`text-xs ${over ? 'text-amber-800' : 'text-slate-500'}`}>
        Breaks today: {fmtMinutes(shownTotal)}
        {allowance !== null && <> of {fmtMinutes(allowance)} allowed</>}. Hours worked leave out break time.
      </p>
      {state?.error && <p role="alert" className="text-sm text-red-700">{state.error}</p>}
    </div>
  );
}
