import Link from 'next/link';
import { requireMe } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { activeMembers } from '@/lib/data';
import { fmtDate, friendlyError } from '@/lib/format';
import { EmptyState, Notice, PageHeader } from '@/components/ui';
import { Avatar } from '@/components/badges';
import { loadTeams, memberNames } from '../attendance/data';
import { SHEET_SORTS, localDay, type SheetRow } from './lib';

export const metadata = { title: 'Google Sheets' };

type SP = { q?: string; team?: string; category?: string; person?: string; mine?: string; sort?: string; removed?: string; added?: string };

const UUID = /^[0-9a-f-]{36}$/i;

export default async function SheetsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const me = await requireMe();
  const supabase = await createClient();
  const canAdmin = me.areas.sheets;
  const showRemoved = canAdmin && sp.removed === '1';

  let q = supabase.from('work_sheets').select('*');
  q = showRemoved ? q.not('archived_at', 'is', null) : q.is('archived_at', null);
  const [{ data, error }, members, teams, names] = await Promise.all([q.limit(1000), activeMembers(), loadTeams(supabase), memberNames(supabase)]);
  const all = (data ?? []) as SheetRow[];
  const teamName = new Map(teams.map((t) => [t.id, t.name]));
  const nameOf = (id: string | null) => (id ? names.get(id) ?? null : null);
  const categories = [...new Set(all.map((s) => s.category).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const added = sp.added ? all.find((s) => s.id === sp.added) : undefined;

  const term = (sp.q ?? '').trim().toLowerCase().slice(0, 80);
  const team = sp.team && UUID.test(sp.team) ? sp.team : sp.team === 'none' ? 'none' : '';
  const person = sp.person && UUID.test(sp.person) ? sp.person : '';
  const category = categories.includes(sp.category ?? '') ? sp.category! : '';
  const mine = sp.mine === '1';
  const sort = SHEET_SORTS.some((s) => s.key === sp.sort) ? sp.sort! : 'name';

  const rows = all
    .filter((s) => {
      if (mine && s.owner_id !== me.memberId && !s.people.includes(me.memberId)) return false;
      if (person && s.owner_id !== person && !s.people.includes(person)) return false;
      if (team === 'none' ? s.team_id : team && s.team_id !== team) return false;
      if (category && s.category !== category) return false;
      if (!term) return true;
      const hay = [s.name, s.purpose, s.category, teamName.get(s.team_id ?? ''), nameOf(s.owner_id), ...s.people.map(nameOf)].join(' ').toLowerCase();
      return hay.includes(term);
    })
    .sort((a, b) => {
      const by = (x: string | null | undefined, y: string | null | undefined) => (x ?? '￿').localeCompare(y ?? '￿');
      if (sort === 'updated') return b.updated_at.localeCompare(a.updated_at);
      if (sort === 'owner') return by(nameOf(a.owner_id), nameOf(b.owner_id)) || a.name.localeCompare(b.name);
      if (sort === 'team') return by(teamName.get(a.team_id ?? ''), teamName.get(b.team_id ?? '')) || a.name.localeCompare(b.name);
      if (sort === 'category') return by(a.category || null, b.category || null) || a.name.localeCompare(b.name);
      return a.name.localeCompare(b.name);
    });

  const hasFilters = Boolean(term || team || person || category || mine || (sp.sort && sp.sort !== 'name'));
  const clearHref = showRemoved ? '/sheets?removed=1' : '/sheets';
  const canEdit = (s: SheetRow) => !s.archived_at && (canAdmin || s.owner_id === me.memberId);
  const working = (s: SheetRow) => s.people.filter((p) => p !== s.owner_id).map(nameOf).filter((n): n is string => Boolean(n));

  const openLink = (s: SheetRow, compact = false) => (
    <a href={s.url} target="_blank" rel="noopener noreferrer" className={`btn-secondary whitespace-nowrap ${compact ? 'px-2.5 py-1 text-xs' : ''}`}>
      Open sheet <span aria-hidden>↗</span>
      <span className="sr-only">(opens Google Sheets in a new tab)</span>
    </a>
  );

  return (
    <>
      <PageHeader
        title="Google Sheets"
        subtitle="Every working sheet in one place: what it is for, who is responsible and who works on it. Google still controls who can open each sheet."
        actions={!showRemoved ? <Link href="/sheets/new" className="btn-primary whitespace-nowrap">Add a sheet</Link> : undefined}
      />
      {canAdmin && (
        <div className="mb-3 flex flex-wrap gap-1">
          <Link href="/sheets" aria-current={!showRemoved ? 'page' : undefined} className={`rounded-lg px-3 py-1.5 text-sm font-medium ${!showRemoved ? 'bg-navy-800 text-white' : 'text-navy-800 hover:bg-navy-100'}`}>
            In use
          </Link>
          <Link href="/sheets?removed=1" aria-current={showRemoved ? 'page' : undefined} className={`rounded-lg px-3 py-1.5 text-sm font-medium ${showRemoved ? 'bg-navy-800 text-white' : 'text-navy-800 hover:bg-navy-100'}`}>
            Removed sheets
          </Link>
        </div>
      )}

      {added && (
        <Notice>
          Added {added.name}.{' '}
          <Link href="/sheets/new" className="underline">Add another sheet</Link>
        </Notice>
      )}

      <form className="card mb-4 grid grid-cols-2 gap-2 p-3 sm:grid-cols-3 lg:grid-cols-6" role="search">
        {showRemoved && <input type="hidden" name="removed" value="1" />}
        <input name="q" defaultValue={sp.q} placeholder="Search name, purpose or person…" className="input col-span-2" aria-label="Search sheets" />
        <select name="team" defaultValue={team} className="input" aria-label="Team">
          <option value="">All teams</option>
          {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          <option value="none">No team</option>
        </select>
        <select name="category" defaultValue={category} className="input" aria-label="Category">
          <option value="">All categories</option>
          {categories.map((c) => <option key={c}>{c}</option>)}
        </select>
        <select name="person" defaultValue={person} className="input" aria-label="Person">
          <option value="">Anyone</option>
          {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <select name="sort" defaultValue={sort} className="input" aria-label="Sort">
          {SHEET_SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <div className="col-span-2 flex flex-wrap items-center gap-3 sm:col-span-3 lg:col-span-6">
          <label className="flex items-center gap-1.5 text-sm text-slate-700">
            <input type="checkbox" name="mine" value="1" defaultChecked={mine} /> Only sheets I work on
          </label>
          <div className="ml-auto flex gap-2">
            {hasFilters && <Link href={clearHref} className="btn-ghost">Clear</Link>}
            <button className="btn-secondary" type="submit">Apply</button>
          </div>
        </div>
      </form>

      {error && <Notice tone="error">Could not load sheets: {friendlyError(error.message)}</Notice>}
      {!error && (
        <p className="mb-2 text-xs text-slate-500">
          {rows.length} sheet{rows.length === 1 ? '' : 's'}
          {hasFilters && all.length !== rows.length ? ` of ${all.length}` : ''}
        </p>
      )}

      {rows.length === 0 ? (
        error ? null : hasFilters ? (
          <EmptyState title="No sheets match" body="Try another name, team, category or person." action={<Link href={clearHref} className="btn-secondary">Clear filters</Link>} />
        ) : showRemoved ? (
          <EmptyState title="No removed sheets" body="Sheets you remove from the workspace are kept here and can be restored." />
        ) : (
          <EmptyState
            title="No sheets yet"
            body={canAdmin ? 'Add the Google Sheets your team works in, with who is responsible for each one.' : 'Add a Google Sheet you work in, or wait for sheets shared with you to appear here.'}
            action={<Link href="/sheets/new" className="btn-primary">Add a sheet</Link>}
          />
        )
      ) : (
        <>
          {/* Phones: cards */}
          <ul className="space-y-2 md:hidden">
            {rows.map((s) => {
              const w = working(s);
              return (
                <li key={s.id} className="card p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      {canEdit(s) || canAdmin ? (
                        <Link href={`/sheets/${s.id}`} className="font-medium text-navy-900 hover:underline">{s.name}</Link>
                      ) : (
                        <span className="font-medium text-navy-900">{s.name}</span>
                      )}
                      {s.purpose && <p className="mt-0.5 line-clamp-2 text-xs text-slate-600">{s.purpose}</p>}
                    </div>
                    {s.category && <span className="shrink-0 rounded-full bg-navy-100 px-2 py-0.5 text-xs font-medium text-navy-800">{s.category}</span>}
                  </div>
                  <div className="mt-2 space-y-0.5 text-xs text-slate-700">
                    <div>Responsible: <strong>{nameOf(s.owner_id) ?? 'Nobody yet'}</strong></div>
                    {w.length > 0 && <div>Working on it: {w.join(', ')}</div>}
                    <div className="text-slate-500">
                      {teamName.get(s.team_id ?? '') ?? 'No team'} · Updated {fmtDate(localDay(s.updated_at, me.timezone))}
                      {s.visibility === 'assigned' && ' · Only people on it'}
                    </div>
                  </div>
                  {!s.archived_at && <div className="mt-2">{openLink(s, true)}</div>}
                </li>
              );
            })}
          </ul>

          {/* Tablet / desktop: sheet */}
          <div className="card hidden overflow-x-auto md:block">
            <table className="sheet">
              <thead>
                <tr>
                  <th>Sheet Name</th>
                  <th>Purpose</th>
                  <th>Responsible</th>
                  <th>Working on it</th>
                  <th>Team</th>
                  <th>Category</th>
                  <th>Last Updated</th>
                  <th><span className="sr-only">Link</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => {
                  const w = working(s);
                  const owner = nameOf(s.owner_id);
                  return (
                    <tr key={s.id}>
                      <td className="min-w-40">
                        {canEdit(s) || canAdmin ? (
                          <Link href={`/sheets/${s.id}`} className="font-medium text-navy-900 hover:underline">{s.name}</Link>
                        ) : (
                          <span className="font-medium text-navy-900">{s.name}</span>
                        )}
                        {s.visibility === 'assigned' && <div className="text-xs text-slate-500">Only people on it</div>}
                      </td>
                      <td className="max-w-72 text-sm text-slate-700">{s.purpose || <span className="text-slate-400">—</span>}</td>
                      <td>
                        {owner ? (
                          <span className="flex items-center gap-1.5 whitespace-nowrap"><Avatar name={owner} size="sm" />{owner}</span>
                        ) : (
                          <span className="text-slate-400">Nobody yet</span>
                        )}
                      </td>
                      <td className="max-w-56 text-sm">{w.length ? w.join(', ') : <span className="text-slate-400">—</span>}</td>
                      <td className="whitespace-nowrap">{teamName.get(s.team_id ?? '') ?? <span className="text-slate-400">—</span>}</td>
                      <td className="whitespace-nowrap">{s.category || <span className="text-slate-400">—</span>}</td>
                      <td className="whitespace-nowrap text-sm">
                        {fmtDate(localDay(s.updated_at, me.timezone))}
                        {nameOf(s.updated_by) && <div className="text-xs text-slate-500">by {nameOf(s.updated_by)}</div>}
                      </td>
                      <td>{s.archived_at ? <span className="text-xs text-slate-500">Removed {fmtDate(localDay(s.archived_at, me.timezone))}</span> : openLink(s, true)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
