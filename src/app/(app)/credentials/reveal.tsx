'use client';

import { useEffect, useRef, useState } from 'react';
import { revealCredential, saveNotesAction } from './actions';

const SHOW_FOR_SECONDS = 60;
const CLEAR_CLIPBOARD_AFTER = 30_000;

/**
 * Show or copy a saved password. Each time asks for the person's PIN, which the server checks
 * (5 wrong PINs lock the account) and records. A shown password hides itself after a minute.
 */
export function RevealControls({ id, name, canManage, disabled }: { id: string; name: string; canManage: boolean; disabled?: boolean }) {
  const [mode, setMode] = useState<'view' | 'copy' | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState<{ password: string; notes: string | null } | null>(null);
  const [left, setLeft] = useState(SHOW_FOR_SECONDS);
  const [status, setStatus] = useState<string | null>(null);
  const [notesDraft, setNotesDraft] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  function close() {
    setMode(null);
    setPin('');
    setError(null);
    setShown(null);
    setNotesDraft(null);
    setBusy(false);
  }

  useEffect(() => {
    if (mode) dialog.current?.showModal();
    else dialog.current?.close();
  }, [mode]);

  useEffect(() => {
    if (!shown) return;
    setLeft(SHOW_FOR_SECONDS);
    const t = setInterval(() => setLeft((n) => n - 1), 1000);
    return () => clearInterval(t);
  }, [shown]);

  useEffect(() => {
    if (shown && left <= 0 && notesDraft === null) close();
  }, [left, shown, notesDraft]);

  function scheduleClear() {
    setTimeout(() => {
      if (document.hasFocus()) navigator.clipboard?.writeText('').catch(() => {});
    }, CLEAR_CLIPBOARD_AFTER);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !mode) return;
    setBusy(true);
    setError(null);
    const pending = revealCredential(id, pin, mode);
    if (mode === 'copy') {
      // Start the clipboard write inside the click so phones allow it; it fills in once the server answers.
      const text = pending.then((r) => {
        if (!r.ok) throw new Error(r.error);
        return r.password;
      });
      try {
        if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
          await navigator.clipboard.write([new ClipboardItem({ 'text/plain': text.then((t) => new Blob([t], { type: 'text/plain' })) })]);
        } else {
          await navigator.clipboard.writeText(await text);
        }
        close();
        setStatus('Password copied. The clipboard is cleared in 30 seconds.');
        scheduleClear();
      } catch {
        const r = await pending;
        setError(r.ok ? 'Your browser did not allow copying. Use Show instead.' : r.error);
        setPin('');
        setBusy(false);
      }
      return;
    }
    const r = await pending;
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      setPin('');
      return;
    }
    setShown({ password: r.password, notes: r.notes });
  }

  async function saveNotes() {
    if (notesDraft === null) return;
    setBusy(true);
    setError(null);
    const r = await saveNotesAction(id, pin, notesDraft);
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setShown((s) => (s ? { ...s, notes: notesDraft.trim() ? notesDraft : null } : s));
    setNotesDraft(null);
    setStatus(r.message);
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-secondary" disabled={disabled} onClick={() => { setStatus(null); setMode('view'); }}>
          Show password
        </button>
        <button type="button" className="btn-secondary" disabled={disabled} onClick={() => { setStatus(null); setMode('copy'); }}>
          Copy password
        </button>
      </div>
      {status && <p role="status" className="mt-2 text-sm text-green-800">{status}</p>}
      <dialog
        ref={dialog}
        onClose={close}
        aria-labelledby={`reveal-${id}`}
        className="m-auto w-[min(30rem,calc(100vw-2rem))] rounded-xl p-0 shadow-xl backdrop:bg-navy-950/40"
      >
        <div className="p-5">
          <h2 id={`reveal-${id}`} className="text-base font-semibold text-navy-900">
            {mode === 'copy' ? 'Copy' : 'Show'} the password for {name}
          </h2>
          {!shown ? (
            <form onSubmit={submit} className="mt-3 space-y-3">
              <p className="text-sm text-slate-600">Enter your PIN. This is recorded in the login&apos;s history.</p>
              <div>
                <label className="label" htmlFor={`pin-${id}`}>Your PIN</label>
                <input
                  id={`pin-${id}`}
                  className="input w-28"
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]{3}"
                  maxLength={3}
                  autoComplete="off"
                  required
                  autoFocus
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 3))}
                />
              </div>
              {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
              <div className="flex justify-end gap-2">
                <button type="button" className="btn-secondary" onClick={close}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={busy || pin.length !== 3} aria-busy={busy}>
                  {busy ? 'Checking…' : mode === 'copy' ? 'Copy' : 'Show'}
                </button>
              </div>
            </form>
          ) : (
            <div className="mt-3 space-y-3">
              <div>
                <div className="label">Password</div>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 break-all rounded-lg border border-line bg-slate-50 px-3 py-2 font-mono text-sm text-navy-900" data-testid="revealed-password">
                    {shown.password}
                  </code>
                  <button
                    type="button"
                    className="btn-secondary shrink-0"
                    onClick={() => navigator.clipboard?.writeText(shown.password).then(() => { setStatus('Password copied. The clipboard is cleared in 30 seconds.'); scheduleClear(); }).catch(() => {})}
                  >
                    Copy
                  </button>
                </div>
              </div>
              <div>
                <div className="label">Notes</div>
                {notesDraft === null ? (
                  <p className="whitespace-pre-wrap text-sm text-slate-800">{shown.notes || <span className="text-slate-400">No notes</span>}</p>
                ) : (
                  <textarea
                    aria-label="Notes"
                    className="input"
                    rows={4}
                    maxLength={2000}
                    value={notesDraft}
                    onChange={(e) => setNotesDraft(e.target.value)}
                  />
                )}
              </div>
              {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
              {status && <p role="status" className="text-sm text-green-800">{status}</p>}
              <div className="flex flex-wrap items-center justify-end gap-2">
                {notesDraft === null && <span className="mr-auto text-xs text-slate-500">Hides in {Math.max(left, 0)} s</span>}
                {canManage && notesDraft === null && (
                  <button type="button" className="btn-ghost" onClick={() => { setStatus(null); setNotesDraft(shown.notes ?? ''); }}>Edit notes</button>
                )}
                {notesDraft !== null && (
                  <>
                    <button type="button" className="btn-secondary" onClick={() => setNotesDraft(null)}>Cancel</button>
                    <button type="button" className="btn-primary" disabled={busy} onClick={saveNotes}>{busy ? 'Saving…' : 'Save notes'}</button>
                  </>
                )}
                {notesDraft === null && <button type="button" className="btn-primary" onClick={close}>Hide</button>}
              </div>
            </div>
          )}
        </div>
      </dialog>
    </>
  );
}

/** Copy a value that is not secret (such as a username) without a PIN. */
export function CopyText({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn-ghost px-2 py-1 text-xs"
      aria-label={`Copy ${label}`}
      onClick={() => navigator.clipboard?.writeText(value).then(() => { setDone(true); setTimeout(() => setDone(false), 2000); }).catch(() => {})}
    >
      {done ? 'Copied' : 'Copy'}
    </button>
  );
}
