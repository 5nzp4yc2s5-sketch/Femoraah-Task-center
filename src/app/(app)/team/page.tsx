import Link from 'next/link';
import { requireMe } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import type { TeamRow } from '@/lib/types';
import { PageHeader, Notice } from '@/components/ui';

export const metadata = { title: 'Team' };

export default async function Team() {
  const me = await requireMe();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('team_overview');
  const rows = (data ?? []) as TeamRow[];
  return (
    <>
      <PageHeader
        title="Team"
        subtitle="Open, Overdue, Blocked and Has Capacity? are calculated live from the Task Board. Open = any task not Done."
        actions={me.isAdmin ? <Link href="/team/new" className="btn-primary">Add member</Link> : undefined}
      />
      {error && <Notice tone="error">{error.message}</Notice>}
      <div className="card overflow-x-auto">
        <table className="sheet">
          <thead>
            <tr>
              <th>Name</th>
              <th>Role</th>
              <th>Expertise / Skills</th>
              <th>Email</th>
              <th className="text-center">Max Open Tasks</th>
              <th className="text-center">Open Tasks</th>
              <th className="text-center">Overdue</th>
              <th className="text-center">Blocked</th>
              <th className="text-center">Has Capacity?</th>
              {me.isAdmin && <th>Login</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.member_id} className={m.is_active ? '' : 'text-slate-400'}>
                <td className="whitespace-nowrap font-medium">
                  {me.isAdmin ? <Link href={`/team/${m.member_id}`} className="text-navy-800 hover:underline">{m.name}</Link> : m.name}
                  {m.access_role !== 'member' && <span className="ml-2 rounded bg-navy-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-navy-800">{m.access_role}</span>}
                  {!m.is_active && <span className="ml-2 text-xs">(inactive)</span>}
                </td>
                <td className="whitespace-nowrap">{m.role_title}</td>
                <td className="min-w-72 max-w-md text-slate-600">{m.expertise}</td>
                <td className="whitespace-nowrap">{m.email ?? <span className="text-slate-400">—</span>}</td>
                <td className="text-center tabular-nums">{m.max_open_tasks}</td>
                <td className="text-center tabular-nums">{m.open_tasks}</td>
                <td className={`text-center tabular-nums ${m.overdue ? 'font-semibold text-red-700' : ''}`}>{m.overdue}</td>
                <td className={`text-center tabular-nums ${m.blocked ? 'font-semibold text-slate-700' : ''}`}>{m.blocked}</td>
                <td className="text-center">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${m.has_capacity ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>{m.has_capacity ? 'Yes' : 'No'}</span>
                </td>
                {me.isAdmin && <td className="whitespace-nowrap text-xs">{m.has_login ? m.username : <span className="text-amber-700">No login</span>}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
