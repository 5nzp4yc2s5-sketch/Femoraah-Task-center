import Link from 'next/link';
import { requireMe } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { keyStatus } from '@/lib/credentials-crypto';
import { fmtDate, friendlyError } from '@/lib/format';
import { EmptyState, Notice, PageHeader } from '@/components/ui';
import { memberNames } from '../attendance/data';
import { localDay } from '../sheets/lib';
import { CRED_COLUMNS, LEVEL_LABELS, hostOf, type AccessRow, type CredentialRow, type MyLevel } from './lib';
import { KeySetup } from './setup';

export const metadata = { title: 'Credentials' };

type SP = { q?: string; category?: string; sort?: string; removed?: string };

export default async function CredentialsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const me = await requireMe();
  const supabase = await createClient();
  const canAdmin = me.areas.credentials;
  const showRemoved = canAdmin && sp.removed === '1';
  const status = keyStatus();

  let q = supabase.from('credentials').select(CRED_COLUMNS);
  q = showRemoved ? q.not('archived_at', 'is', null) : q.is('archived_at', null);
  const [{ data, error }, { data: access }, names] = await Promise.all([
    q.limit(1000),
    supabase.from('credential_access').select('id, credential_id, member_id, team_id, level, granted_by, granted_at').is('revoked_at', null),
    memberNames(supabase),
  ]);
  const all = (data ?? []) as CredentialRow[];
  const grants = (access ?? []) as AccessRow[];
  const levelOf = (c: CredentialRow): MyLevel =>
    canAdmin ? 'admin' : grants.some((g) => g.credential_id === c.id && g.member_id === me.memberId && g.level === 'manage') ? 'manage' : 'use';
  const sharedWith = (c: CredentialRow) => {
    const gs = grants.filter((g) => g.credential_id === c.id);
    const people = gs.filter((g) => g.member_id).length;
    const teams = gs.filter((g) => g.team_id).length;
    const parts = [people && `${people} ${people === 1 ? 'person' : 'people'}`, teams && `${teams} ${teams === 1 ? 'team' : 'teams'}`].filter(Boolean);
    return parts.length ? parts.join(', ') : 'Nobody yet';
  };
  const categories = [...new Set(all.map((c) => c.category).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const term = (sp.q ?? '').trim().toLowerCase().slice(0, 80);
  const category = categories.includes(sp.category ?? '') ? sp.category! : '';
  const sort = sp.sort === 'changed' || sp.sort === 'category' ? sp.sort : 'name';
  const rows = all
    .filter((c) => (!category || c.category === category) && (!term || [c.name, c.url, c.username, c.category].join(' ').toLowerCase().includes(term)))
    .sort((a, b) =>
      sort === 'changed'
        ? a.password_changed_at.localeCompare(b.password_changed_at)
        : sort === 'category'
          ? (a.category || '￿').localeCompare(b.category || '￿') || a.name.localeCompare(b.name)
          : a.name.localeCompare(b.name),
    );
  const hasFilters = Boolean(term || category || sp.sort);
  const clearHref = showRemoved ? '/credentials?removed=1' : '/credentials';
  const changed = (c: CredentialRow) => fmtDate(localDay(c.password_changed_at, me.timezone));

  return (
    <>
      <PageHeader
        title="Credentials"
        subtitle="Shared logins for the team's websites and tools. Passwords are encrypted, hidden until you enter your PIN, and every look is recorded."
        actions={canAdmin && !showRemoved && status === 'ok' ? <Link href="/credentials/new" className="btn-primary whitespace-nowrap">Add a login</Link> : undefined}
      />
      {status !== 'ok' && (canAdmin || all.length > 0) && <KeySetup status={status} isSuperAdmin={me.isAdmin} />}
      {canAdmin && (
        <div className="mb-3 flex flex-wrap gap-1">
          <Link href="/credentials" aria-current={!showRemoved ? 'page' : undefined} className={`rounded-lg px-3 py-1.5 text-sm font-medium ${!showRemoved ? 'bg-navy-800 text-white' : 'text-navy-800 hover:bg-navy-100'}`}>In use</Link>
          <Link href="/credentials?removed=1" aria-current={showRemoved ? 'page' : undefined} className={`rounded-lg px-3 py-1.5 text-sm font-medium ${showRemoved ? 'bg-navy-800 text-white' : 'text-navy-800 hover:bg-navy-100'}`}>Removed</Link>
        </div>
      )}
      {(all.length > 0 || hasFilters) && (
        <form className="card mb-4 flex flex-wrap items-center gap-2 p-3" role="search">
          {showRemoved && <input type="hidden" name="removed" value="1" />}
          <input name="q" defaultValue={sp.q} placeholder="Search name, website or username…" className="input w-full sm:w-72" aria-label="Search logins" />
          <select name="category" defaultValue={category} className="input w-auto" aria-label="Category">
            <option value="">All categories</option>
            {categories.map((c) => <option key={c}>{c}</option>)}
          </select>
          <select name="sort" defaultValue={sort} className="input w-auto" aria-label="Sort">
            <option value="name">Sort: name</option>
            <option value="category">Sort: category</option>
            <option value="changed">Sort: password oldest first</option>
          </select>
          <button className="btn-secondary" type="submit">Apply</button>
          {hasFilters && <Link href={clearHref} className="btn-ghost">Clear</Link>}
        </form>
      )}
      {error && <Notice tone="error">Could not load logins: {friendlyError(error.message)}</Notice>}
      {rows.length === 0 ? (
        error ? null : hasFilters ? (
          <EmptyState title="No logins match" body="Try another name, website or category." action={<Link href={clearHref} className="btn-secondary">Clear filters</Link>} />
        ) : showRemoved ? (
          <EmptyState title="No removed logins" body="Logins taken out of use are kept here and can be restored." />
        ) : (
          <EmptyState
            title={canAdmin ? 'No logins saved yet' : 'No logins shared with you'}
            body={canAdmin ? 'Save a shared login, then choose who can use it.' : 'When the Super Admin or an access manager shares a login with you or your team, it appears here.'}
            action={canAdmin && status === 'ok' ? <Link href="/credentials/new" className="btn-primary">Add a login</Link> : undefined}
          />
        )
      ) : (
        <>
          <p className="mb-2 text-xs text-slate-500">{rows.length} login{rows.length === 1 ? '' : 's'}</p>
          <ul className="space-y-2 md:hidden">
            {rows.map((c) => (
              <li key={c.id}>
                <Link href={`/credentials/${c.id}`} className="card block p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium text-slate-900">{c.name}</div>
                      <div className="truncate text-xs text-slate-600">{c.username || '—'}{c.url && ` · ${hostOf(c.url)}`}</div>
                    </div>
                    {c.category && <span className="shrink-0 rounded-full bg-navy-100 px-2 py-0.5 text-xs font-medium text-navy-800">{c.category}</span>}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {canAdmin ? `Shared with ${sharedWith(c).toLowerCase()}` : LEVEL_LABELS[levelOf(c)]} · Password changed {changed(c)}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          <div className="card hidden overflow-x-auto md:block">
            <table className="sheet">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Website</th>
                  <th>Username</th>
                  <th>Category</th>
                  <th>{canAdmin ? 'Shared with' : 'Your access'}</th>
                  <th>Password changed</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id}>
                    <td><Link href={`/credentials/${c.id}`} className="font-medium text-slate-900 hover:underline">{c.name}</Link></td>
                    <td className="whitespace-nowrap">
                      {c.url ? <a href={c.url} target="_blank" rel="noopener noreferrer" className="text-navy-700 hover:underline">{hostOf(c.url)} <span aria-hidden>↗</span></a> : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="max-w-56 truncate">{c.username || <span className="text-slate-400">—</span>}</td>
                    <td className="whitespace-nowrap">{c.category || <span className="text-slate-400">—</span>}</td>
                    <td className="whitespace-nowrap text-sm">{canAdmin ? sharedWith(c) : LEVEL_LABELS[levelOf(c)]}</td>
                    <td className="whitespace-nowrap text-sm">
                      {changed(c)}
                      {names.get(c.password_changed_by ?? '') && <div className="text-xs text-slate-500">by {names.get(c.password_changed_by ?? '')}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
