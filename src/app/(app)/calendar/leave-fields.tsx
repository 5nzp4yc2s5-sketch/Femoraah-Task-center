'use client';

import { useEffect, useRef, useState } from 'react';
import { fmtDate } from '@/lib/format';
import { LEAVE_TYPES, type MemberOption } from '@/lib/types';

export interface LeaveValues {
  member_id: string;
  member_name: string;
  leave_type: string;
  start_date: string;
  end_date: string;
  backup_member_id: string | null;
  backup_name: string | null;
  swap_for_date: string | null;
  note: string;
}

export interface HolidayOption {
  holiday_date: string;
  name: string;
}

/**
 * Leave form fields. Managers choose anyone; everyone else records only their own leave, so their
 * name is shown fixed and their own member id is sent. The "holiday you will work instead" field
 * only appears for Holiday Swap, and the backup list never offers the person on leave.
 */
export function LeaveFields({
  members,
  holidays,
  isManager,
  me,
  today,
  leave,
}: {
  members: MemberOption[];
  holidays: HolidayOption[];
  isManager: boolean;
  me: MemberOption;
  today: string;
  leave?: LeaveValues;
}) {
  const initialPerson = leave?.member_id ?? (isManager ? '' : me.id);
  const initialType = leave?.leave_type ?? 'Annual Leave';
  const initialStart = leave?.start_date ?? '';
  const [person, setPerson] = useState(initialPerson);
  const [type, setType] = useState(initialType);
  const [start, setStart] = useState(initialStart);
  const wrap = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLInputElement>(null);

  // The form is cleared after a successful save; put the dependent fields back with it.
  useEffect(() => {
    const form = wrap.current?.closest('form');
    if (!form) return;
    const onReset = () => {
      setPerson(initialPerson);
      setType(initialType);
      setStart(initialStart);
    };
    form.addEventListener('reset', onReset);
    return () => form.removeEventListener('reset', onReset);
  }, [initialPerson, initialType, initialStart]);

  // When editing, keep a person or backup who has since left visible (saving then asks for an active one).
  const isActive = (id: string) => members.some((m) => m.id === id);
  const people = leave && !isActive(leave.member_id) ? [...members, { id: leave.member_id, name: `${leave.member_name} (inactive)` }] : members;
  const backupOptions = [
    ...members.filter((m) => m.id !== person),
    ...(leave?.backup_member_id && !isActive(leave.backup_member_id) ? [{ id: leave.backup_member_id, name: `${leave.backup_name ?? 'Former member'} (inactive)` }] : []),
  ];
  const swapOptions =
    leave?.swap_for_date && !holidays.some((h) => h.holiday_date === leave.swap_for_date)
      ? [{ holiday_date: leave.swap_for_date, name: 'not on the holiday list' }, ...holidays]
      : holidays;
  const personName = people.find((m) => m.id === person)?.name;
  const minDate = isManager ? undefined : today;

  return (
    <div ref={wrap} className="grid gap-4 sm:grid-cols-2">
      <div>
        <label className="label" htmlFor="leave-person">Person</label>
        {isManager ? (
          <select id="leave-person" name="member_id" className="input" defaultValue={initialPerson} required onChange={(e) => setPerson(e.target.value)}>
            <option value="" disabled>Choose…</option>
            {people.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        ) : (
          <>
            <input id="leave-person" className="input" value={leave?.member_name ?? me.name} disabled readOnly />
            <input type="hidden" name="member_id" value={initialPerson} />
          </>
        )}
      </div>
      <div>
        <label className="label" htmlFor="leave-type">Leave type</label>
        <select id="leave-type" name="leave_type" className="input" defaultValue={initialType} onChange={(e) => setType(e.target.value)}>
          {LEAVE_TYPES.map((t) => <option key={t}>{t}</option>)}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="leave-start">First day</label>
        <input
          id="leave-start"
          name="start_date"
          type="date"
          className="input"
          required
          min={minDate}
          defaultValue={initialStart}
          onChange={(e) => {
            const v = e.target.value;
            setStart(v);
            const end = endRef.current;
            if (end && v && (!end.value || end.value < v)) end.value = v;
          }}
        />
      </div>
      <div>
        <label className="label" htmlFor="leave-end">Last day</label>
        <input ref={endRef} id="leave-end" name="end_date" type="date" className="input" required min={start || minDate} defaultValue={leave?.end_date} />
      </div>
      {type === 'Holiday Swap' && (
        <div className="sm:col-span-2">
          <label className="label" htmlFor="leave-swap">Holiday you will work instead</label>
          <select id="leave-swap" name="swap_for_date" className="input" defaultValue={leave?.swap_for_date ?? ''}>
            <option value="">Not decided yet</option>
            {swapOptions.map((h) => (
              <option key={h.holiday_date} value={h.holiday_date}>
                {fmtDate(h.holiday_date)} · {h.name}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-slate-500">
            {holidays.length === 0
              ? 'No company holidays are on the calendar for the past or next 12 months. A manager adds them under Add holiday.'
              : `That company holiday becomes a normal working day for ${personName ?? 'this person'}.`}
          </p>
        </div>
      )}
      <div className="sm:col-span-2">
        <label className="label" htmlFor="leave-backup">Backup (optional)</label>
        <select id="leave-backup" name="backup_member_id" className="input" defaultValue={leave?.backup_member_id ?? ''}>
          <option value="">No backup</option>
          {backupOptions.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <p className="mt-1 text-xs text-slate-500">Who covers while they are away. Routines without their own backup go to this person.</p>
      </div>
      <div className="sm:col-span-2">
        <label className="label" htmlFor="leave-note">Note</label>
        <textarea id="leave-note" name="note" rows={2} className="input" maxLength={500} defaultValue={leave?.note} placeholder="Optional, e.g. reachable on phone for urgent dispatch questions" />
        <p className="mt-1 text-xs text-slate-500">The leave type and note are visible only to managers, the person and their backup. Everyone else sees “Leave”.</p>
      </div>
    </div>
  );
}
