'use client';

import { useState } from 'react';
import { ActionForm, SubmitButton } from '@/components/forms';
import { brandChecks, DEFAULT_BRAND, HEX, primaryScale } from '@/lib/colors';
import { saveBrandingAction } from '../company-actions';

type Key = 'primary' | 'secondary' | 'accent';

const FIELDS: { key: Key; label: string; help: string }[] = [
  { key: 'primary', label: 'Primary colour', help: 'Buttons, links and the workload meter.' },
  { key: 'secondary', label: 'Secondary colour', help: 'The selected menu item, the logo mark and the sign-in page.' },
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
          <div className="grid grid-cols-[9.5rem_1fr]">
            <div className="border-r border-line bg-white p-2.5">
              <div className="mb-3 flex items-center gap-2 px-1">
                {logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logoUrl} alt="" className="h-7 w-7 rounded-lg bg-white object-contain p-0.5 ring-1 ring-line" />
                ) : (
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white" style={{ background: colors.secondary }}>
                    {shownName.slice(0, 2).toUpperCase()}
                  </span>
                )}
                <span className="min-w-0 leading-tight">
                  <span className="block truncate text-xs font-semibold text-slate-900">{shownName}</span>
                  <span className="block truncate text-[11px] text-slate-500">{tagline.trim() || 'Workspace'}</span>
                </span>
              </div>
              <div className="rounded-md px-2 py-1 text-xs font-medium text-white" style={{ background: colors.secondary }}>My Dashboard</div>
              <div className="px-2 py-1 text-xs text-slate-600">Task Board</div>
              <div className="px-2 py-1 text-xs text-slate-600">Team</div>
            </div>
            <div className="min-w-0 space-y-3 p-3" style={{ background: scale[50] }}>
              <p className="text-xs italic text-slate-700">
                <span className="mr-1 not-italic" style={{ color: colors.accent }}>“</span>
                Well done is better than well said. <span className="not-italic text-slate-500">Benjamin Franklin</span>
              </p>
              <div className="overflow-hidden rounded-lg border border-line bg-white text-xs">
                <div className="border-b border-line bg-slate-50 px-3 py-1.5 font-medium text-slate-500">Task</div>
                <div className="px-3 py-2" style={{ boxShadow: 'inset 3px 0 0 #ef4444' }}>
                  Weekly stock count, <span className="underline" style={{ color: scale[700] }}>Sanket</span>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <span className="btn px-3 py-1.5 text-xs text-white" style={{ background: colors.primary }}>Primary button</span>
                <span className="btn border border-line bg-white px-3 py-1.5 text-xs text-slate-800">Secondary</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
