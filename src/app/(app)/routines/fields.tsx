'use client';

import { useState } from 'react';
import type { MemberOption, RoutineRow } from '@/lib/types';
import { FREQUENCIES } from '@/lib/types';

export function RoutineFields({ routine, members }: { routine?: RoutineRow; members: MemberOption[] }) {
  const [freq, setFreq] = useState<string>(routine?.frequency ?? 'Daily');
  const fixed = freq === 'Daily' ? 1 : freq === 'Weekly' ? 7 : null;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <label className="label" htmlFor="title">Routine Task</label>
        <input id="title" name="title" className="input" defaultValue={routine?.title} required maxLength={200} />
      </div>
      <div>
        <label className="label" htmlFor="owner_id">Owner</label>
        <select id="owner_id" name="owner_id" className="input" defaultValue={routine?.owner_id ?? ''} required>
          <option value="" disabled>Choose…</option>
          {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
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
              className="input"
              min={freq === 'Monthly' ? 28 : 1}
              max={freq === 'Monthly' ? 31 : 366}
              defaultValue={routine && routine.frequency === freq ? routine.every_n_days : freq === 'Monthly' ? 30 : 3}
              required
            />
          )}
        </div>
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
