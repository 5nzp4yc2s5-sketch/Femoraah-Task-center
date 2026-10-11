import type { MemberOption, TeamRow } from '@/lib/types';

export function MemberFields({ m, members }: { m?: Partial<TeamRow> & { accepts_unmatched?: boolean }; members: MemberOption[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <label className="label" htmlFor="name">Name</label>
        <input id="name" name="name" className="input" defaultValue={m?.name} required maxLength={80} />
      </div>
      <div>
        <label className="label" htmlFor="role_title">Role</label>
        <input id="role_title" name="role_title" className="input" defaultValue={m?.role_title} maxLength={120} />
      </div>
      <div className="sm:col-span-2">
        <label className="label" htmlFor="expertise">Expertise / Skills</label>
        <textarea id="expertise" name="expertise" rows={2} className="input" defaultValue={m?.expertise} maxLength={1000} />
        <p className="mt-1 text-xs text-slate-500">Used to suggest owners for backlog items. Separate skills with commas.</p>
      </div>
      <div>
        <label className="label" htmlFor="email">Email</label>
        <input id="email" name="email" type="email" className="input" defaultValue={m?.email ?? ''} />
      </div>
      <div>
        <label className="label" htmlFor="max_open_tasks">Max Open Tasks</label>
        <input id="max_open_tasks" name="max_open_tasks" type="number" min={1} max={200} className="input" defaultValue={m?.max_open_tasks ?? 10} required />
      </div>
      <div>
        <label className="label" htmlFor="access_role">Access level</label>
        <select id="access_role" name="access_role" className="input" defaultValue={m?.access_role ?? 'member'}>
          <option value="member">Member: own dashboard and tasks</option>
          <option value="manager">Manager: team overview, approves backlog</option>
          <option value="admin">Admin: manager + team and logins</option>
        </select>
      </div>
      <div>
        <label className="label" htmlFor="reports_to">Reports to</label>
        <select id="reports_to" name="reports_to" className="input" defaultValue={m?.reports_to ?? ''}>
          <option value="">Nobody</option>
          {members.filter((o) => o.id !== m?.member_id).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        <p className="mt-1 text-xs text-slate-500">The person they report to can see their tasks and routines.</p>
      </div>
      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input type="checkbox" name="accepts_unmatched" defaultChecked={m?.accepts_unmatched ?? false} />
        Fallback owner: suggest this person when nobody&apos;s expertise matches a backlog item
      </label>
    </div>
  );
}

export function LoginFields({ optional = false }: { optional?: boolean }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <label className="label" htmlFor="username">Username</label>
        <input id="username" name="username" className="input" autoComplete="off" pattern="[a-z0-9._\-]{3,32}" required={!optional} placeholder="e.g. zinia" />
      </div>
      <div>
        <label className="label" htmlFor="pin">3-digit PIN</label>
        <input id="pin" name="pin" className="input" inputMode="numeric" pattern="[0-9]{3}" maxLength={3} autoComplete="off" required={!optional} />
      </div>
    </div>
  );
}
