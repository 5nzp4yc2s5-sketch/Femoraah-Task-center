'use client';

import { useState } from 'react';
import { ActionForm, SubmitButton } from '@/components/forms';
import { brandChecks, DEFAULT_BRAND, HEX, primaryScale } from '@/lib/colors';
import { saveBrandingAction } from '../company-actions';

type Key = 'primary' | 'secondary' | 'accent';

const FIELDS: { key: Key; label: string; help: string }[] = [
  { key: 'primary', label: 'Primary colour', help: 'Buttons, table headers and links.' },
  { key: 'secondary', label: 'Secondary colour', help: 'The menu bar and the sign-in page.' },
  { key: 'accent', label: 'Accent colour', help: 'Highlights such as the daily quote and dashboard charts.' },
];

export function BrandingForm({
  initial,
  logoUrl,
}: {
  initial: { company_name: string; tagline: string; primary: string; secondary: string; accent: string };
  logoUrl: string | null;
}) {
  const [name, setName] = useState(initial.company_name);
  const [tagline, setTagline] = useState(initial.tagline);
  const [colors, setColors] = useState<Record<Key, string>>({ primary: initial.primary, secondary: initial.secondary, accent: initial.accent });
  // What is typed in the hex boxes, which may be half-written.
  const [typed, setTyped] = useState<Record<Key, string>>(colors);

  const setColor = (key: Key, value: string) => {
    const v = value.trim().toLowerCase();
    setTyped((t) => ({ ...t, [key]: value }));
    if (HEX.test(v)) setColors((c) => ({ ...c, [key]: v }));
  };
  const resetColors = () => {
    setColors({ ...DEFAULT_BRAND });
    setTyped({ ...DEFAULT_BRAND });
  };

  const checks = brandChecks(colors);
  const scale = primaryScale(colors.primary);
  const shownName = name.trim() || 'OpsPulse';

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
      <ActionForm action={saveBrandingAction} className="card space-y-4 p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="b-name">Company name</label>
            <input id="b-name" name="company_name" className="input" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="OpsPulse Workspace" />
            <p className="mt-1 text-xs text-slate-500">Shown in the menu, on the sign-in page and in the browser tab.</p>
          </div>
          <div>
            <label className="label" htmlFor="b-tagline">Tagline (optional)</label>
            <input id="b-tagline" name="tagline" className="input" maxLength={80} value={tagline} onChange={(e) => setTagline(e.target.value)} placeholder="Team task command center" />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          {FIELDS.map((f) => (
            <div key={f.key}>
              <label className="label" htmlFor={`b-${f.key}`}>{f.label}</label>
              <div className="flex gap-2">
                <input
                  type="color"
                  aria-label={`${f.label} picker`}
                  className="h-9 w-11 shrink-0 cursor-pointer rounded-lg border border-line bg-white p-1"
                  value={colors[f.key]}
                  onChange={(e) => setColor(f.key, e.target.value)}
                />
                <input
                  id={`b-${f.key}`}
                  name={f.key}
                  className="input font-mono"
                  value={typed[f.key]}
                  onChange={(e) => setColor(f.key, e.target.value)}
                  onBlur={() => setTyped((t) => ({ ...t, [f.key]: colors[f.key] }))}
                  pattern="#[0-9a-fA-F]{6}"
                  required
                  spellCheck={false}
                />
              </div>
              <p className="mt-1 text-xs text-slate-500">{f.help}</p>
            </div>
          ))}
        </div>

        <div>
          <h3 className="label">Readability</h3>
          <ul className="space-y-1 text-sm">
            {checks.map((c) => (
              <li key={c.key} className={`flex items-center gap-2 ${c.ok ? 'text-green-800' : 'text-red-700'}`}>
                <span aria-hidden>{c.ok ? '✓' : '✕'}</span>
                <span>
                  {c.label}: {c.ratio.toFixed(1)}:1 {c.ok ? '' : `(needs ${c.needed}:1)`}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex flex-wrap gap-2">
          <SubmitButton>Save company settings</SubmitButton>
          <button type="button" className="btn-secondary" onClick={resetColors}>
            Use the default colours
          </button>
        </div>
      </ActionForm>

      <div>
        <h3 className="label">Preview</h3>
        <div className="card overflow-hidden" aria-label="Preview of the new look">
          <div className="flex items-center gap-2.5 px-4 py-3" style={{ background: colors.secondary }}>
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt="" className="h-8 w-8 rounded-lg bg-white object-contain p-0.5" />
            ) : (
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-sm font-bold" style={{ color: colors.primary }}>
                {shownName.slice(0, 2).toUpperCase()}
              </span>
            )}
            <span className="min-w-0 leading-tight">
              <span className="block truncate text-sm font-semibold text-white">{shownName}</span>
              <span className="block truncate text-[11px] uppercase tracking-wider text-white/75">{tagline.trim() || 'Workspace'}</span>
            </span>
          </div>
          <div className="space-y-3 p-4" style={{ background: scale[50] }}>
            <div className="rounded-lg border-l-4 bg-white px-3 py-2 text-sm italic text-slate-700" style={{ borderColor: colors.accent }}>
              “Well done is better than well said.”
              <span className="mt-0.5 block text-xs not-italic" style={{ color: colors.accent }}>Benjamin Franklin</span>
            </div>
            <div className="overflow-hidden rounded-lg border border-line bg-white text-sm">
              <div className="px-3 py-2 text-xs font-semibold text-white" style={{ background: colors.primary }}>Task · Owner · Due</div>
              <div className="px-3 py-2">
                Weekly stock count · <span className="underline" style={{ color: scale[700] }}>Sanket</span>
              </div>
            </div>
            <div className="flex gap-2">
              <span className="btn text-white" style={{ background: colors.primary }}>Primary button</span>
              <span className="btn border border-line bg-white" style={{ color: scale[900] }}>Secondary</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
