import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireMe } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { keyStatus } from '@/lib/credentials-crypto';
import { activeMembers } from '@/lib/data';
import { fmtClock, fmtDate } from '@/lib/format';
import { ActionForm, ConfirmAction, SubmitButton } from '@/components/forms';
import { Notice, SectionTitle } from '@/components/ui';
import { loadTeams, memberNames } from '../../attendance/data';
import { localDay } from '../../sheets/lib';
import { archiveCredentialAction, changePasswordAction, shareAction, unshareAction, updateCredentialAction } from '../actions';
import { CredentialFields } from '../fields';
import { PasswordInput } from '../inputs';
import { CopyText, RevealControls } from '../reveal';
import { CRED_COLUMNS, LEVEL_LABELS, hostOf, type AccessRow, type CredentialRow, type MyLevel } from '../lib';
import { KeySetup } from '../setup';

export const metadata = { title: 'Login' };

interface EventRow {
  id: string;
  actor_member_id: string | null;
  action: string;
  member_id: string | null;
  team_id: string | null;
  details: { level?: 'use' | 'manage'; reason?: string; purpose?: string };
  created_at: string;
}

const REFUSED: Record<string, string> = { wrong: 'wrong PIN', locked: 'account locked', no_pin: 'no PIN set', not_allowed: 'no access' };
const REMOVED: Record<string, string> = { deactivated: 'account deactivated', 'role changed': 'role changed' };
const PURPOSE: Record<string, string> = { view: 'show', copy: 'copy', change_password: 'change the password', change_notes: 'change the notes' };

export default async function CredentialPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const { id } = await params;
  const { created } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const me = await requireMe();
  const supabase = await createClient();
  const [{ data }, { data: access }, names] = await Promise.all([
    supabase.from('credentials').select(CRED_COLUMNS).eq('id', id).maybeSingle(),
    supabase.from('credential_access').select('id, credential_id, member_id, team_id, level, granted_by, granted_at').eq('credential_id', id).is('revoked_at', null),
    memberNames(supabase),
  ]);
  const c = data as CredentialRow | null;
  if (!c) notFound();
  const grants = (access ?? []) as AccessRow[];
  const level: MyLevel = me.areas.credentials ? 'admin' : grants.some((g) => g.member_id === me.memberId && g.level === 'manage') ? 'manage' : 'use';
  const canAdmin = level === 'admin';
  const canManage = level !== 'use';
  const removed = Boolean(c.archived_at);
  const status = keyStatus();

  const [{ data: cats }, members, teams, { data: events }] = await Promise.all([
    canManage ? supabase.from('credentials').select('category').is('archived_at', null).neq('category', '') : Promise.resolve({ data: [] }),
    canManage ? activeMembers() : Promise.resolve([]),
    loadTeams(supabase),
    canManage
      ? supabase.from('credential_events').select('id, actor_member_id, action, member_id, team_id, details, created_at').eq('credential_id', id).order('created_at', { ascending: false }).limit(50)
      : Promise.resolve({ data: [] }),
  ]);
  const categories = [...new Set((cats ?? []).map((x) => x.category as string))].sort((a, b) => a.localeCompare(b));
  const nameOf = (m: string | null) => (m ? names.get(m) ?? 'Former member' : null);
  const teamOf = (t: string | null) => (t ? teams.find((x) => x.id === t)?.name ?? 'Former team' : null);
  const whoOf = (m: string | null, t: string | null) => nameOf(m) ?? (t ? `the ${teamOf(t)} team` : 'someone');
  const when = (iso: string) => `${fmtDate(localDay(iso, me.timezone))} ${fmtClock(iso, me.timezone)}`;
  const levelName = (l?: string) => (l === 'manage' ? 'access manager' : 'can use');
  const describe = (e: EventRow): string => {
    switch (e.action) {
      case 'created': return 'Added';
      case 'updated': return 'Details changed';
      case 'password_changed': return 'Password changed';
      case 'notes_changed': return 'Notes changed';
      case 'shown': return 'Password shown';
      case 'copied': return 'Password copied';
      case 'refused': return `Refused: ${REFUSED[e.details.reason ?? ''] ?? 'not allowed'} (tried to ${PURPOSE[e.details.purpose ?? ''] ?? 'open it'})`;
      case 'shared': return `Shared with ${whoOf(e.member_id, e.team_id)} (${levelName(e.details.level)})`;
      case 'unshared': return `Access removed for ${whoOf(e.member_id, e.team_id)}`;
      case 'access_removed': return `Access removed for ${whoOf(e.member_id, e.team_id)} (${REMOVED[e.details.reason ?? ''] ?? e.details.reason ?? 'automatic'})`;
      case 'archived': return 'Removed from use';
      case 'restored': return 'Restored';
      default: return e.action;
    }
  };
  const people = grants.filter((g) => g.member_id).sort((a, b) => (nameOf(a.member_id) ?? '').localeCompare(nameOf(b.member_id) ?? ''));
  const teamGrants = grants.filter((g) => g.team_id).sort((a, b) => (teamOf(a.team_id) ?? '').localeCompare(teamOf(b.team_id) ?? ''));
  const activeTeams = teams.filter((t) => t.is_active);

  return (
    <div className="max-w-3xl space-y-6">
      <Link href={removed ? '/credentials?removed=1' : '/credentials'} className="link text-sm">← Credentials</Link>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">{c.name}</h1>
          <p className="text-sm text-slate-600">
            {c.category && <>{c.category} · </>}Your access: {LEVEL_LABELS[level]}
          </p>
        </div>
        {c.url && !removed && (
          <a href={c.url} target="_blank" rel="noopener noreferrer" className="btn-secondary shrink-0 whitespace-nowrap">
            Open {hostOf(c.url)} <span aria-hidden>↗</span>
          </a>
        )}
      </div>

      {created === '1' && !removed && (
        <Notice>Login saved and encrypted. Nobody else can see it yet: share it below with the people or teams who need it.</Notice>
      )}
      {removed && (
        <Notice tone="warn">
          Removed from use on {fmtDate(localDay(c.archived_at!, me.timezone))}
          {nameOf(c.archived_by) && <> by {nameOf(c.archived_by)}</>}. Only Credentials admins can see it. Restore it to give back the access it had.
        </Notice>
      )}
      {status !== 'ok' && <KeySetup status={status} isSuperAdmin={me.isAdmin} />}

      <section className="card space-y-4 p-5">
        <dl className="grid gap-4 text-sm sm:grid-cols-2">
          <div className="min-w-0">
            <dt className="label">Username or email</dt>
            <dd className="flex items-center gap-2">
              <span className="min-w-0 break-all font-mono text-slate-900">{c.username || '—'}</span>
              {c.username && <CopyText value={c.username} label="username" />}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="label">Website</dt>
            <dd className="break-all">{c.url ? <a href={c.url} target="_blank" rel="noopener noreferrer" className="text-navy-700 hover:underline">{c.url}</a> : '—'}</dd>
          </div>
          <div>
            <dt className="label">Password</dt>
            <dd className="font-mono tracking-widest text-slate-500" aria-label="Hidden">••••••••••</dd>
          </div>
          <div>
            <dt className="label">Password last changed</dt>
            <dd className="text-slate-800">
              {when(c.password_changed_at)}
              {nameOf(c.password_changed_by) && <> by {nameOf(c.password_changed_by)}</>}
            </dd>
          </div>
        </dl>
        {!removed && <RevealControls id={c.id} name={c.name} canManage={canManage} disabled={status !== 'ok'} />}
        <p className="text-xs text-slate-500">Every time the password is shown or copied, the app asks for your PIN and records it. Five wrong PINs lock your account.</p>
      </section>

      {canManage && !removed && (
        <>
          <section className="card p-5">
            <SectionTitle>Change the saved password</SectionTitle>
            <p className="mb-3 text-sm text-slate-600">
              First change it on the website itself, then save the new one here. Saving here only changes the copy kept in this app; it does not change the password on {c.url ? hostOf(c.url) : 'the website'}.
            </p>
            <ActionForm action={changePasswordAction} className="space-y-4" resetOnSuccess>
              <input type="hidden" name="id" value={c.id} />
              <PasswordInput id="new-password" name="password" label="New password" />
              <div className="max-w-40">
                <label className="label" htmlFor="change-pin">Your PIN</label>
                <input id="change-pin" name="pin" type="password" inputMode="numeric" pattern="\d{3}" maxLength={3} autoComplete="off" required className="input font-mono tracking-widest" />
              </div>
              <div className="flex justify-end"><SubmitButton>Save new password</SubmitButton></div>
            </ActionForm>
          </section>

          <section className="card p-5">
            <SectionTitle>Details</SectionTitle>
            <ActionForm action={updateCredentialAction} className="space-y-4">
              <input type="hidden" name="id" value={c.id} />
              <CredentialFields c={c} categories={categories} idPrefix="edit" />
              <div className="flex justify-end"><SubmitButton>Save details</SubmitButton></div>
            </ActionForm>
          </section>

          <section className="card p-5">
            <SectionTitle>Who can use it</SectionTitle>
            {grants.length === 0 ? (
              <p className="mb-4 text-sm text-slate-600">{canAdmin ? 'Only Credentials admins can see this login so far.' : 'Nobody else has been given this login yet.'}</p>
            ) : (
              <ul className="mb-4 divide-y divide-line">
                {[...people, ...teamGrants].map((g) => (
                  <li key={g.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                    <div className="min-w-0">
                      <div className="font-medium text-slate-900">{g.member_id ? nameOf(g.member_id) : `${teamOf(g.team_id)} team`}</div>
                      <div className="text-xs text-slate-500">
                        {g.level === 'manage' ? 'Access manager: can show, copy, change and share' : g.team_id ? 'Everyone in the team can show and copy' : 'Can show and copy'}
                        {nameOf(g.granted_by) && <> · added by {nameOf(g.granted_by)}</>} · {fmtDate(localDay(g.granted_at, me.timezone))}
                      </div>
                    </div>
                    {(canAdmin || g.level === 'use') && g.member_id !== me.memberId && (
                      <ConfirmAction
                        action={unshareAction}
                        label="Remove"
                        title={`Remove access for ${g.member_id ? nameOf(g.member_id) : `the ${teamOf(g.team_id)} team`}?`}
                        body="They will no longer see this login. It is recorded in the history. If they might have the password already, change it on the website."
                        confirmLabel="Remove access"
                        className="btn-ghost text-red-700"
                        hidden={{ access: g.id }}
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}
            <ActionForm action={shareAction} className="flex flex-col gap-3 sm:flex-row sm:items-end" resetOnSuccess>
              <input type="hidden" name="id" value={c.id} />
              <div className="min-w-0 flex-1">
                <label className="label" htmlFor="share-target">Share with</label>
                <select id="share-target" name="target" className="input" required defaultValue="">
                  <option value="" disabled>Choose a person or team…</option>
                  <optgroup label="People">
                    {members.filter((m) => m.id !== me.memberId).map((m) => <option key={m.id} value={`m:${m.id}`}>{m.name}</option>)}
                  </optgroup>
                  {activeTeams.length > 0 && (
                    <optgroup label="Teams">
                      {activeTeams.map((t) => <option key={t.id} value={`t:${t.id}`}>{t.name} team</option>)}
                    </optgroup>
                  )}
                </select>
              </div>
              {canAdmin ? (
                <div>
                  <label className="label" htmlFor="share-level">Access</label>
                  <select id="share-level" name="level" className="input" defaultValue="use">
                    <option value="use">Can use</option>
                    <option value="manage">Access manager (people only)</option>
                  </select>
                </div>
              ) : (
                <input type="hidden" name="level" value="use" />
              )}
              <SubmitButton>Share</SubmitButton>
            </ActionForm>
            <p className="mt-3 text-xs text-slate-500">
              Can use: show and copy the password. Access manager: also change it and share it with others.
              {canAdmin ? ' Only Credentials admins can make someone an access manager.' : ''} Access ends automatically when someone&apos;s role changes or their account is deactivated.
            </p>
          </section>
        </>
      )}

      {canAdmin && (
        <section className="card p-5">
          <SectionTitle>{removed ? 'Restore' : 'Remove from use'}</SectionTitle>
          {removed ? (
            <ConfirmAction
              action={archiveCredentialAction}
              label="Restore login"
              title={`Restore ${c.name}?`}
              body="Everyone it is still shared with can see it again."
              confirmLabel="Restore"
              className="btn-primary"
              hidden={{ id: c.id, archived: '0' }}
            />
          ) : (
            <>
              <p className="mb-3 text-sm text-slate-600">Removing hides the login from everyone except Credentials admins. Nothing is deleted, and it can be restored.</p>
              <ConfirmAction
                action={archiveCredentialAction}
                label="Remove from use"
                title={`Remove ${c.name}?`}
                body="It moves to Removed, where a Credentials admin can restore it. The account on the website is not changed."
                confirmLabel="Remove"
                hidden={{ id: c.id, archived: '1' }}
              />
            </>
          )}
        </section>
      )}

      {canManage && (events ?? []).length > 0 && (
        <section className="card p-5">
          <SectionTitle>History</SectionTitle>
          <ul className="space-y-1.5 text-sm">
            {(events as EventRow[]).map((e) => (
              <li key={e.id} className="flex flex-wrap gap-x-2 text-slate-700">
                <span className="tabular-nums text-slate-500">{when(e.created_at)}</span>
                <span className={e.action === 'refused' ? 'text-red-700' : undefined}>
                  {describe(e)}
                  {nameOf(e.actor_member_id) && <> by {nameOf(e.actor_member_id)}</>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
