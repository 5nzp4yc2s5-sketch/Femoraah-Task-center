'use client';

import { useActionState, useState } from 'react';
import { completeRoutineAction } from '@/app/(app)/routines/actions';
import { SubmitButton } from './forms';

export function MarkDone({ routineId, today, doneThisCycle }: { routineId: string; today: string; doneThisCycle: boolean }) {
  const [state, action] = useActionState(completeRoutineAction, undefined);
  const [pickDate, setPickDate] = useState(false);
  if (doneThisCycle && !state?.error) {
    return <span className="text-xs font-medium text-green-700">{state?.ok ?? 'Done this cycle ✓'}</span>;
  }
  return (
    <form action={action} className="inline-flex flex-wrap items-center justify-end gap-1.5">
      <input type="hidden" name="routine_id" value={routineId} />
      {pickDate ? (
        <input type="date" name="done_on" defaultValue={today} max={today} className="input w-36 py-1" aria-label="Date done" />
      ) : (
        <>
          <input type="hidden" name="done_on" value={today} />
          <button type="button" className="text-xs text-slate-500 underline-offset-2 hover:underline" onClick={() => setPickDate(true)}>
            other date
          </button>
        </>
      )}
      <SubmitButton className="btn-primary px-2.5 py-1 text-xs" pendingText="…">Mark done</SubmitButton>
      {state?.error && <span className="basis-full text-right text-xs text-red-700">{state.error}</span>}
      {state?.ok && <span className="basis-full text-right text-xs text-green-700">{state.ok}</span>}
    </form>
  );
}
