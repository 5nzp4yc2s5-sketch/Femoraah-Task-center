import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdmin } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { fmtDate, friendlyError } from '@/lib/format';
import type { TeamRow } from '@/lib/types';
import { ActionForm, ConfirmAction, SubmitButton } from '@/components/forms';
import { Notice, SectionTitle, StatCard } from '@/components/ui';
import { Avatar, CapacityBadge } from '@/components/badges';
import { createLoginAction, removeLoginAction, resetPinAction, setActiveAction, updateMemberAction } from '../actions';
import { LoginFields, MemberFields } from '../fields';

export const metadata = { title: 'Team member' };

export default async function MemberPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string; loginError?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const me = await requireAdmin();
  const supabase = await createClient();
  const [{ data: team, error }, { data: raw }] = await Promise.all([
    supabase.rpc('team_overview'),
    supabase.from('members').select('accepts_unmatched').eq('id', id).maybeSingle(),
  ]);
  if (error) {
    return (
      <div className="max-w-3xl space-y-6">
        <Link href="/team" className="text-sm text-navy-700 hover:underline">← Team</Link>
        <Notice tone="error">Could not load this member: {friendlyError(error.message)}</Notice>
      </div>
    );
  }
  const m = (team as TeamRow[] | null)?.find((r) => r.member_id === id);
  if (!m || !raw) notFound();
  const isSelf = m.member_id === me.memberId;
  const { data: pinLocked } = m.has_login ? await supabase.rpc('admin_pin_locked', { p_member: m.member_id }) : { data: false };

  return (
    <div className="max-w-3xl space-y-6">
      <Link href="/team" className="text-sm text-navy-700 hover:underline">← Team</Link>
      {sp.created && <Notice>Member added.</Notice>}
      {sp.loginError && <Notice tone="error">Member added, but the login could not be created: {sp.loginError}</Notice>}
      <div className="flex items-start gap-3">
        <Avatar name={m.name} />
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-navy-900 sm:text-2xl">{m.name}</h1>
          <p className="text-sm text-slate-600">
            {m.role_title && <>{m.role_title} · </>}
            {m.open_tasks}/{m.max_open_tasks} open · {m.overdue} overdue · {m.blocked} blocked ·{' '}
            {!m.is_active ? 'Deactivated' : m.on_leave ? `On Leave${m.leave_until ? ` until ${fmtDate(m.leave_until)}` : ''}` : 'Active'}
          </p>
          <div className="mt-1.5"><CapacityBadge status={m.capacity_status} /></div>
        </div>
      </div>

      <section>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Open tasks" value={m.open_tasks} hint={`Max ${m.max_open_tasks}`} href={`/tasks?scope=all&owner=${m.member_id}`} />
          <StatCard label="Overdue" value={m.overdue} tone={m.overdue ? 'red' : 'default'} href={`/tasks?scope=all&owner=${m.member_id}&due=overdue`} />
          <StatCard label="Blocked" value={m.blocked} tone={m.blocked ? 'amber' : 'default'} href={`/tasks?scope=all&owner=${m.member_id}&status=Blocked`} />
          <StatCard label="Overdue routines" value={m.routine_overdue} tone={m.routine_overdue ? 'red' : 'default'} href={`/routines?owner=${m.member_id}&status=Overdue`} />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link href={`/tasks?scope=all&owner=${m.member_id}`} className="btn-secondary">Tasks assigned to {m.name}</Link>
          <Link href={`/routines?owner=${m.member_id}`} className="btn-secondary">{m.name}&apos;s routines</Link>
        </div>
      </section>

      <ActionForm action={updateMemberAction} className="card space-y-5 p-5">
        <input type="hidden" name="id" value={m.member_id} />
        <MemberFields m={{ ...m, accepts_unmatched: raw.accepts_unmatched }} />
        <div className="flex justify-end"><SubmitButton>Save profile</SubmitButton></div>
      </ActionForm>

      <section className="card p-5">
        <SectionTitle>Login</SectionTitle>
        {m.has_login ? (
          <div className="space-y-5">
            <div>
              <p className="text-sm">Username: <strong>{m.username}</strong></p>
              <p className="mt-1 text-xs text-slate-500">Share PINs in person. They can change theirs from Account after signing in.</p>
            </div>
            {pinLocked && <Notice tone="warn">Locked after 5 wrong PINs. Set a new PIN below to unlock.</Notice>}
            <ActionForm action={resetPinAction} className="flex flex-wrap items-end gap-2" resetOnSuccess>
              <input type="hidden" name="id" value={m.member_id} />
              <div>
                <label className="label" htmlFor="new-pin">New PIN</label>
                <input id="new-pin" name="pin" className="input w-28" inputMode="numeric" pattern="[0-9]{3}" maxLength={3} required autoComplete="off" />
              </div>
              <SubmitButton className="btn-secondary">Reset PIN</SubmitButton>
            </ActionForm>
            {!isSelf && (
              <ConfirmAction action={removeLoginAction} label="Remove login" title={`Remove ${m.name}'s login?`} body="They will no longer be able to sign in. Their member record and task history are kept." confirmLabel="Remove login" hidden={{ id: m.member_id }} />
            )}
          </div>
        ) : (
          <ActionForm action={createLoginAction} className="space-y-4">
            <input type="hidden" name="id" value={m.member_id} />
            <p className="text-sm text-slate-600">Create a sign-in for {m.name}. Share the PIN in person, not in a group chat.</p>
            <LoginFields />
            <div className="flex justify-end"><SubmitButton>Create login</SubmitButton></div>
          </ActionForm>
        )}
      </section>

      {!isSelf && (
        <section className="card p-5">
          <SectionTitle>Status</SectionTitle>
          {m.is_active ? (
            <ConfirmAction action={setActiveAction} label="Deactivate member" title={`Deactivate ${m.name}?`} body="They lose access immediately on every device. Their tasks stay on the board for reassignment and their history is kept." confirmLabel="Deactivate" hidden={{ id: m.member_id, active: '0' }} />
          ) : (
            <ConfirmAction action={setActiveAction} label="Reactivate member" title={`Reactivate ${m.name}?`} body="They will be able to sign in again with their existing login." confirmLabel="Reactivate" className="btn-primary" hidden={{ id: m.member_id, active: '1' }} />
          )}
        </section>
      )}
    </div>
  );
}
