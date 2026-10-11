'use client';

import { startTransition, useActionState, useState } from 'react';
import { fmtDate } from '@/lib/format';
import { approveBacklogAction } from './actions';

export interface OwnerOption {
  id: string;
  name: string;
  onLeave: boolean;
  leaveUntil: string | null;
}

/**
 * The manager's decision on a pending backlog item. Two submit buttons share one form:
 * "Approve and create task" (convert=1) and "Approve only" (convert=0).
 * Inputs are controlled and the form is submitted in a transition, so a validation error
 * (for example "on leave today") keeps the person's choices.
 */
export function ApproveForm({ itemId, suggestedId, options }: { itemId: string; suggestedId: string | null; options: OwnerOption[] }) {
  const [state, formAction, pending] = useActionState(approveBacklogAction, undefined);
  const [owner, setOwner] = useState(suggestedId && options.some((o) => o.id === suggestedId) ? suggestedId : '');
  const [note, setNote] = useState('');
  const [override, setOverride] = useState(false);
  const [mode, setMode] = useState<'1' | '0'>('1');
  const chosen = options.find((o) => o.id === owner);

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (pending) return;
        const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
        const convert = submitter?.value === '0' ? '0' : '1';
        setMode(convert);
        const fd = new FormData(e.currentTarget);
        fd.set('convert', convert);
        startTransition(() => formAction(fd));
      }}
    >
      {state?.error && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {state.error}
        </p>
      )}
      {state?.ok && (
        <p role="status" className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
          {state.ok}
        </p>
      )}
      <input type="hidden" name="id" value={itemId} />
      <div>
        <label className="label" htmlFor="owner_id">Assign to</label>
        <select id="owner_id" name="owner_id" className="input" value={owner} onChange={(e) => setOwner(e.target.value)} required>
          <option value="" disabled>Choose…</option>
          {options.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
              {m.id === suggestedId ? ' (suggested)' : ''}
              {m.onLeave ? ' (on leave today)' : ''}
            </option>
          ))}
        </select>
        {chosen?.onLeave && (
          <p className="mt-1 text-xs text-violet-800">
            {chosen.name} is on leave today{chosen.leaveUntil ? ` (until ${fmtDate(chosen.leaveUntil)})` : ''}. Tick &quot;Assign anyway&quot; to assign them.
          </p>
        )}
      </div>
      <div>
        <label className="label" htmlFor="note">Decision note</label>
        <input id="note" name="note" className="input" maxLength={1000} placeholder="Optional, e.g. why you overrode the suggestion" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="override_leave" value="on" checked={override} onChange={(e) => setOverride(e.target.checked)} /> Assign anyway (on leave)
      </label>
      <button type="submit" value="1" className="btn-primary w-full" disabled={pending} aria-busy={pending && mode === '1'}>
        {pending && mode === '1' ? 'Approving…' : 'Approve and create task'}
      </button>
      <button type="submit" value="0" className="btn-secondary w-full" disabled={pending} aria-busy={pending && mode === '0'}>
        {pending && mode === '0' ? 'Approving…' : 'Approve only'}
      </button>
      <p className="text-xs text-slate-500">Approve only keeps it here as Approved. Convert it to a task later.</p>
    </form>
  );
}
