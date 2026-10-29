'use client';

import { createContext, startTransition, useActionState, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useFormStatus } from 'react-dom';
import type { ActionState } from '@/lib/types';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

const PendingContext = createContext(false);

export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess = false,
}: {
  action: Action;
  children: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);
  // Submit via a transition instead of <form action>, so React does not clear what the
  // person typed when the server returns a validation error.
  return (
    <PendingContext.Provider value={pending}>
    <form
      ref={ref}
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        if (pending) return;
        const fd = new FormData(e.currentTarget);
        startTransition(() => formAction(fd));
      }}
    >
      {state?.error && (
        <p role="alert" className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {state.error}
        </p>
      )}
      {state?.ok && (
        <p role="status" className="mb-3 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
          {state.ok}
        </p>
      )}
      {children}
    </form>
    </PendingContext.Provider>
  );
}

export function SubmitButton({ children, className = 'btn-primary', pendingText = 'Saving…' }: { children: ReactNode; className?: string; pendingText?: string }) {
  const { pending: formPending } = useFormStatus();
  const ctxPending = useContext(PendingContext);
  const pending = formPending || ctxPending;
  return (
    <button type="submit" className={className} disabled={pending} aria-busy={pending}>
      {pending ? pendingText : children}
    </button>
  );
}

/** A button that asks for confirmation in a modal before submitting its form action. */
export function ConfirmAction({
  action,
  label,
  title,
  body,
  confirmLabel = 'Confirm',
  className = 'btn-danger',
  hidden,
  withNote = false,
}: {
  action: Action;
  label: string;
  title: string;
  body: string;
  confirmLabel?: string;
  className?: string;
  hidden?: Record<string, string>;
  withNote?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(action, undefined);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);
  useEffect(() => {
    if (state?.ok) setOpen(false);
  }, [state]);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        {label}
      </button>
      {state?.error && !open && <p className="mt-2 text-sm text-red-700">{state.error}</p>}
      <dialog
        ref={dialog}
        onClose={() => setOpen(false)}
        className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-xl p-0 shadow-xl backdrop:bg-slate-900/40"
      >
        <form action={formAction} className="p-5">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          <p className="mt-2 text-sm text-slate-600">{body}</p>
          {hidden && Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          {withNote && <textarea name="note" rows={2} className="input mt-3" placeholder="Reason (optional)" maxLength={1000} />}
          {state?.error && <p className="mt-3 text-sm text-red-700">{state.error}</p>}
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <SubmitButton className={className} pendingText="Working…">
              {confirmLabel}
            </SubmitButton>
          </div>
        </form>
      </dialog>
    </>
  );
}
