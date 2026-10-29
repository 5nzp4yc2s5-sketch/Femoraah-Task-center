import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireMe } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { activeMembers } from '@/lib/data';
import { addDays, fmtDate, friendlyError, isIsoDate } from '@/lib/format';
import { ActionForm, ConfirmAction, SubmitButton } from '@/components/forms';
import { Notice, PageHeader } from '@/components/ui';
import { deleteLeaveAction, updateLeaveAction } from '../../actions';
import { LeaveFields, type LeaveValues } from '../../leave-fields';
import { leaveDays } from '../../dates';

export const metadata = { title: 'Edit leave' };

export default async function EditLeave({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const me = await requireMe();
  const supabase = await createClient();
  // Row-level security returns the leave only to managers, the person and their backup.
  const [{ data: row }, { data: summary, error: summaryError }] = await Promise.all([
    supabase.from('leaves').select('id, member_id, leave_type, start_date, end_date, backup_member_id, swap_for_date, note').eq('id', id).maybeSingle(),
    supabase.rpc('my_summary'),
  ]);
  if (!row) notFound();
  const today: string | null = isIsoDate(summary?.today) ? summary.today : null;
  const month = String(row.start_date).slice(0, 7);
  const back = `/calendar?month=${month}`;

  const [{ data: names }, members, { data: holidays }] = await Promise.all([
    supabase.from('members').select('id, name').in('id', [row.member_id, row.backup_member_id].filter(Boolean)),
    activeMembers(),
    today
      ? supabase.from('holidays').select('holiday_date, name').gte('holiday_date', addDays(today, -366)).lte('holiday_date', addDays(today, 366)).order('holiday_date')
      : Promise.resolve({ data: [] as { holiday_date: string; name: string }[] }),
  ]);
  const nameOf = (mid: string | null) => names?.find((m) => m.id === mid)?.name ?? (mid ? 'Former member' : null);
  const leave: LeaveValues = {
    member_id: row.member_id,
    member_name: nameOf(row.member_id) ?? 'Former member',
    leave_type: row.leave_type,
    start_date: row.start_date,
    end_date: row.end_date,
    backup_member_id: row.backup_member_id,
    backup_name: nameOf(row.backup_member_id),
    swap_for_date: row.swap_for_date,
    note: row.note ?? '',
  };
  const isMine = leave.member_id === me.memberId;
  const started = today ? leave.start_date < today : true;
  const canEdit = !!today && (me.isManager || (isMine && !started));
  const days = leaveDays(leave.start_date, leave.end_date);
  const dates = leave.start_date === leave.end_date ? fmtDate(leave.start_date) : `${fmtDate(leave.start_date)} – ${fmtDate(leave.end_date)}`;

  return (
    <div className="max-w-3xl">
      <Link href={back} className="link text-sm">← Team Calendar</Link>
      <div className="mt-2">
        <PageHeader
          title={canEdit ? 'Edit leave' : 'Leave'}
          subtitle={`${leave.member_name} · ${leave.leave_type} · ${dates} (${days} day${days === 1 ? '' : 's'})${leave.backup_name ? ` · Backup ${leave.backup_name}` : ''}`}
        />
      </div>

      {!today && <Notice tone="error">Could not load this leave{summaryError ? `: ${friendlyError(summaryError.message)}` : '.'} Please refresh the page.</Notice>}
      {today && !canEdit && (
        <Notice tone="warn">
          {isMine
            ? 'This leave has already started, so only a manager can change or delete it.'
            : `You can see this because you are ${leave.member_name}’s backup. Only ${leave.member_name} (before it starts) or a manager can change it.`}
        </Notice>
      )}
      {!canEdit && leave.note && (
        <div className="card p-4 text-sm text-slate-700">
          <div className="label">Note</div>
          {leave.note}
        </div>
      )}

      {canEdit && today && (
        <>
          <ActionForm action={updateLeaveAction} className="card space-y-5 p-5">
            <input type="hidden" name="id" value={id} />
            <LeaveFields members={members} holidays={holidays ?? []} isManager={me.isManager} me={{ id: me.memberId, name: me.name }} today={today} leave={leave} />
            <div className="flex justify-end gap-2">
              <Link href={back} className="btn-secondary">Cancel</Link>
              <SubmitButton>Save leave</SubmitButton>
            </div>
          </ActionForm>
          <div className="mt-4 flex flex-col gap-2 rounded-xl border border-red-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-slate-600">Remove this leave from the calendar if it was cancelled or added by mistake.</p>
            <ConfirmAction
              action={deleteLeaveAction}
              label="Delete leave"
              title="Delete this leave?"
              body={`${leave.member_name}’s ${leave.leave_type.toLowerCase()} (${dates}) will be removed from the calendar. Backlog suggestions and routine cover go back to normal for those days.`}
              confirmLabel="Delete leave"
              hidden={{ id, back: month }}
            />
          </div>
        </>
      )}
    </div>
  );
}
