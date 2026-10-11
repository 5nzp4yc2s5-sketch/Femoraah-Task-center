'use client';

import { useActionState, useState } from 'react';
import { completeRoutineAction } from '@/app/(app)/routines/actions';
import { addDays } from '@/lib/format';
import { SubmitButton } from './forms';

/** One-click tick-off for a routine. "other date" logs a past day (up to 30 days back) with an optional note. */
export function MarkDone({ routineId, today, doneThisCycle }: { routineId: string; today: string; doneThisCycle: boolean }) {
  const [state, action] = useActionState(completeRoutineAction, undefined);
  const [pickDate, setPickDate] = useState(false);
  if (doneThisCycle) {
    return <span className="text-xs font-medium text-green-700">{state?.ok ?? 'Done this cycle ✓'}</span>;
  }
  return (
    <form action={action} className="inline-flex flex-wrap items-center justify-end gap-1.5">
      <input type="hidden" name="routine_id" value={routineId} />
      {pickDate ? (
        <>
          <input type="date" name="done_on" defaultValue={today} min={today ? addDays(today, -30) : undefined} max={today} className="input w-36 py-1" aria-label="Date done" required />
          <input name="note" className="input w-40 py-1" placeholder="Note (optional)" maxLength={500} aria-label="Note" />
        </>
      ) : (
        <>
          <input type="hidden" name="done_on" value={today ?? ''} />
          <button type="button" className="text-xs text-slate-500 underline-offset-2 hover:underline" onClick={() => setPickDate(true)}>
            other date
          </button>
        </>
      )}
      <SubmitButton className="btn-primary px-2.5 py-1 text-xs" pendingText="…">Mark done</SubmitButton>
      {state?.error && <span role="alert" className="basis-full text-right text-xs text-red-700">{state.error}</span>}
      {state?.ok && <span role="status" className="basis-full text-right text-xs text-green-700">{state.ok}</span>}
    </form>
  );
}
