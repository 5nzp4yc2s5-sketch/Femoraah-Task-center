'use client';

import { startTransition, useActionState, useEffect, useRef, useState } from 'react';
import { quickStatusAction, toggleFlagAction } from '@/app/(app)/tasks/actions';
import { STATUSES, type TaskStatus } from '@/lib/types';

// Same colours as StatusBadge, so a status you can change looks like one you cannot, plus a chevron.
const tone: Record<TaskStatus, string> = {
  'To Do': 'bg-slate-100 text-slate-700 hover:bg-slate-200/70',
  Active: 'bg-blue-50 text-blue-700 hover:bg-blue-100/70',
  Blocked: 'bg-orange-50 text-orange-700 hover:bg-orange-100/70',
  Done: 'bg-green-50 text-green-700 hover:bg-green-100/70',
};

/**
 * Change a task's status in place. Choosing Blocked asks for the blocker reason first;
 * every other status saves straight away.
 */
export function StatusSelect({ id, status, blocker }: { id: string; status: TaskStatus; blocker?: string }) {
  const [state, action, pending] = useActionState(quickStatusAction, undefined);
  const [value, setValue] = useState<TaskStatus>(status);
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState(blocker ?? '');
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => setValue(status), [status]);
  useEffect(() => {
    if (asking) dialog.current?.showModal();
    else dialog.current?.close();
  }, [asking]);
  useEffect(() => {
    if (state?.ok) setAsking(false);
    if (state?.error) setValue(status);
  }, [state, status]);

  const submit = (next: TaskStatus, why = '') => {
    const fd = new FormData();
    fd.set('id', id);
    fd.set('status', next);
    fd.set('blocker_reason', why);
    startTransition(() => action(fd));
  };

  return (
    <>
      <select
        aria-label="Change status"
        className={`cursor-pointer rounded-full border-0 py-0.5 pl-2 pr-1 text-xs font-medium transition-colors ${tone[value]} ${pending ? 'opacity-60' : ''}`}
        value={value}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value as TaskStatus;
          if (next === 'Blocked') {
            setAsking(true);
            return;
          }
          setValue(next);
          submit(next);
        }}
      >
        {STATUSES.map((s) => <option key={s}>{s}</option>)}
      </select>
      {state?.error && !asking && <p className="mt-1 max-w-48 text-xs text-red-700">{state.error}</p>}
      {state?.ok && !pending && (
        <span role="status" className="ml-1 text-xs text-green-700">
          Saved
        </span>
      )}
      <dialog
        ref={dialog}
        onClose={() => setAsking(false)}
        className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-xl p-0 shadow-xl backdrop:bg-slate-900/40"
      >
        <form
          className="p-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (!reason.trim()) return;
            setValue('Blocked');
            submit('Blocked', reason.trim());
          }}
        >
          <h2 className="text-base font-semibold text-slate-900">What is blocking this task?</h2>
          <p className="mt-1 text-sm text-slate-600">The reason is shown on the Task Board and to whoever delegated the task.</p>
          <label className="label mt-3" htmlFor={`blocker-${id}`}>Blocker reason</label>
          <input
            id={`blocker-${id}`}
            className="input"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={1000}
            required
            autoFocus
          />
          {state?.error && <p className="mt-2 text-sm text-red-700">{state.error}</p>}
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setAsking(false)}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={pending || !reason.trim()}>
              {pending ? 'Saving…' : 'Mark Blocked'}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}

/** Star toggle for "Flag as important". */
export function FlagToggle({ id, on }: { id: string; on: boolean }) {
  const [state, action, pending] = useActionState(toggleFlagAction, undefined);
  return (
    <form action={action} className="inline">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="flag" value={on ? '0' : '1'} />
      <button
        type="submit"
        disabled={pending}
        className={`text-lg leading-none ${on ? 'text-amber-500' : 'text-slate-300 hover:text-amber-400'}`}
        title={on ? 'Remove the important flag' : 'Flag as important'}
        aria-label={on ? 'Remove the important flag' : 'Flag as important'}
        aria-pressed={on}
      >
        ★
      </button>
      {state?.error && <span className="ml-1 text-xs text-red-700">{state.error}</span>}
    </form>
  );
}
