'use client';

import { useRef, useState } from 'react';

const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*-_=+';

function generate(length = 20): string {
  // Rejection sampling keeps every character equally likely.
  const out: string[] = [];
  const buf = new Uint8Array(1);
  while (out.length < length) {
    crypto.getRandomValues(buf);
    if (buf[0] < Math.floor(256 / CHARS.length) * CHARS.length) out.push(CHARS[buf[0] % CHARS.length]);
  }
  return out.join('');
}

/** A password field with show/hide and a strong-password generator. Nothing leaves the browser here. */
export function PasswordInput({ id, name, label, autoComplete = 'new-password', withGenerate = true }: {
  id: string; name: string; label: string; autoComplete?: string; withGenerate?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [visible, setVisible] = useState(false);
  return (
    <div>
      <label className="label" htmlFor={id}>{label}</label>
      <div className="flex gap-2">
        <input
          id={id}
          name={name}
          type={visible ? 'text' : 'password'}
          className="input min-w-0 flex-1 font-mono"
          autoComplete={autoComplete}
          maxLength={500}
          required
          ref={ref}
        />
        <button type="button" className="btn-secondary shrink-0" onClick={() => setVisible((v) => !v)} aria-pressed={visible}>
          {visible ? 'Hide' : 'Show'}
        </button>
        {withGenerate && (
          <button type="button" className="btn-secondary shrink-0" onClick={() => { if (ref.current) ref.current.value = generate(); setVisible(true); }}>
            Generate
          </button>
        )}
      </div>
    </div>
  );
}

/** For setting up the credential manager: makes a random 32-byte key in this browser only. */
export function KeyGenerator() {
  const [key, setKey] = useState('');
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-2">
      <button
        type="button"
        className="btn-secondary"
        onClick={() => {
          const bytes = new Uint8Array(32);
          crypto.getRandomValues(bytes);
          setKey(btoa(String.fromCharCode(...bytes)));
          setCopied(false);
        }}
      >
        Generate a key
      </button>
      {key && (
        <div className="flex gap-2">
          <input aria-label="New encryption key" className="input min-w-0 flex-1 font-mono text-xs" readOnly value={key} onFocus={(e) => e.currentTarget.select()} />
          <button type="button" className="btn-secondary shrink-0" onClick={() => navigator.clipboard?.writeText(key).then(() => setCopied(true)).catch(() => {})}>
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      )}
      <p className="text-xs text-slate-500">The key is made in your browser and is not sent anywhere by this page.</p>
    </div>
  );
}
