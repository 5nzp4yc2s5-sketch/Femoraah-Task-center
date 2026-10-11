'use client';

import { useState } from 'react';
import type { MemberOption, RoutineRow } from '@/lib/types';
import { FREQUENCIES } from '@/lib/types';

const FIXED_DAYS: Record<string, number> = { Daily: 1, Weekly: 7, Monthly: 30 };

export function RoutineFields({ routine, members }: { routine?: RoutineRow; members: MemberOption[] }) {
  const [freq, setFreq] = useState<string>(routine?.frequency ?? 'Daily');
  const [owner, setOwner] = useState<string>(routine?.owner_id ?? '');
  const [backup, setBackup] = useState<string>(routine?.backup_member_id ?? '');
  const fixed = FIXED_DAYS[freq] ?? null;
  // Keep a current backup who has since left visible, so saving other fields does not silently clear it.
  const backupOptions =
    routine?.backup_member_id && !members.some((m) => m.id === routine.backup_member_id)
      ? [...members, { id: routine.backup_member_id, name: `${routine.backup_name ?? 'Former member'} (inactive)` }]
      : members;

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <label className="label" htmlFor="title">Routine Task</label>
        <input id="title" name="title" className="input" defaultValue={routine?.title} required maxLength={200} />
      </div>
      <div>
        <label className="label" htmlFor="owner_id">Assigned to</label>
        <select
          id="owner_id"
          name="owner_id"
          className="input"
          value={owner}
          onChange={(e) => {
            setOwner(e.target.value);
            if (e.target.value === backup) setBackup('');
          }}
          required
        >
          <option value="" disabled>Choose…</option>
          {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="backup_member_id">Backup (optional)</label>
        <select id="backup_member_id" name="backup_member_id" className="input" value={backup} onChange={(e) => setBackup(e.target.value)}>
          <option value="">No backup</option>
          {backupOptions.filter((m) => m.id !== owner).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <p className="mt-1 text-xs text-slate-500">Covers it only while the assigned person is on leave. The routine stays assigned to them.</p>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:col-span-2 sm:max-w-md">
        <div>
          <label className="label" htmlFor="frequency">Frequency</label>
          <select id="frequency" name="frequency" className="input" value={freq} onChange={(e) => setFreq(e.target.value)}>
            {FREQUENCIES.map((f) => <option key={f}>{f}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="every_n_days">Every N Days</label>
          {fixed ? (
            <input id="every_n_days" className="input" value={fixed} disabled readOnly />
          ) : (
            <input
              id="every_n_days"
              name="every_n_days"
              type="number"
              inputMode="numeric"
              className="input"
              min={1}
              max={366}
              defaultValue={routine && routine.frequency === 'Custom' ? routine.every_n_days : 3}
              required
            />
          )}
        </div>
        <p className="col-span-2 -mt-1 text-xs text-slate-500">Daily = 1 day, Weekly = 7 days, Monthly = 30 days. Choose Custom for any other number of days. Next Due = Last Done + Every N Days.</p>
      </div>
      <div className="sm:col-span-2">
        <label className="label" htmlFor="notes">Notes</label>
        <input id="notes" name="notes" className="input" defaultValue={routine?.notes} maxLength={1000} />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="hidden" name="is_active" value="off" />
        <input type="checkbox" name="is_active" value="on" defaultChecked={routine?.is_active ?? true} /> Active (uncheck to pause)
      </label>
    </div>
  );
}
