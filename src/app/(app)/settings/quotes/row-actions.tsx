'use client';

import { startTransition, useActionState, useState } from 'react';
import { ActionForm, SubmitButton } from '@/components/forms';
import { moveQuoteAction, saveQuoteAction, setQuoteActiveAction } from '../company-actions';

interface Quote {
  id: string;
  body: string;
  author: string;
}

function SmallAction({ action, fields, label, title }: { action: typeof moveQuoteAction; fields: Record<string, string>; label: string; title: string }) {
  const [state, run, pending] = useActionState(action, undefined);
  return (
    <>
      <button
        type="button"
        className="btn-ghost px-2 py-1 text-xs"
        title={title}
        // Arrow buttons need a spoken name; worded buttons keep their visible label.
        aria-label={label.length <= 2 ? title : undefined}
        disabled={pending}
        onClick={() => {
          const fd = new FormData();
          for (const [k, v] of Object.entries(fields)) fd.set(k, v);
          startTransition(() => run(fd));
        }}
      >
        {label}
      </button>
      {state?.error && <span role="alert" className="text-xs text-red-700">{state.error}</span>}
    </>
  );
}

export function QuoteRowActions({ quote, first, last, archived = false }: { quote: Quote; first: boolean; last: boolean; archived?: boolean }) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <ActionForm action={saveQuoteAction} className="w-full space-y-2 sm:w-96">
        <input type="hidden" name="id" value={quote.id} />
        <textarea name="body" rows={2} maxLength={300} required className="input" defaultValue={quote.body} aria-label="Quote" />
        <input name="author" maxLength={80} className="input" defaultValue={quote.author} aria-label="Author" placeholder="Author (optional)" />
        <div className="flex gap-2">
          <SubmitButton className="btn-primary px-3 py-1.5 text-xs">Save</SubmitButton>
          <button type="button" className="btn-secondary px-3 py-1.5 text-xs" onClick={() => setEditing(false)}>
            Done
          </button>
        </div>
      </ActionForm>
    );
  }
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1">
      {!archived && !first && <SmallAction action={moveQuoteAction} fields={{ id: quote.id, dir: 'up' }} label="↑" title="Move up" />}
      {!archived && !last && <SmallAction action={moveQuoteAction} fields={{ id: quote.id, dir: 'down' }} label="↓" title="Move down" />}
      <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => setEditing(true)}>
        Edit
      </button>
      <SmallAction
        action={setQuoteActiveAction}
        fields={{ id: quote.id, active: archived ? '1' : '0' }}
        label={archived ? 'Restore' : 'Archive'}
        title={archived ? 'Put this quote back in the rotation' : 'Take this quote out of the rotation'}
      />
    </div>
  );
}
