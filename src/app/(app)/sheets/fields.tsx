import type { MemberOption } from '@/lib/types';
import type { SheetRow } from './lib';

interface TeamOption {
  id: string;
  name: string;
  is_active: boolean;
}

/**
 * Fields for adding or editing a sheet. The responsible person and visibility are only editable by a
 * Sheets admin; for the responsible person themselves they are shown read-only and sent unchanged.
 */
export function SheetFields({
  sheet,
  members,
  teams,
  categories,
  canAdmin,
  idPrefix = 'sheet',
}: {
  sheet?: SheetRow;
  members: MemberOption[];
  teams: TeamOption[];
  categories: string[];
  canAdmin: boolean;
  idPrefix?: string;
}) {
  const id = (f: string) => `${idPrefix}-${f}`;
  const people = new Set(sheet?.people ?? []);
  const ownerName = members.find((m) => m.id === sheet?.owner_id)?.name;
  return (
    <div className="space-y-4">
      {sheet && <input type="hidden" name="id" value={sheet.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor={id('name')}>Sheet name</label>
          <input id={id('name')} name="name" className="input" required maxLength={120} defaultValue={sheet?.name} placeholder="Daily sales tracker" />
        </div>
        <div>
          <label className="label" htmlFor={id('category')}>Category</label>
          <input id={id('category')} name="category" className="input" maxLength={60} defaultValue={sheet?.category} list={id('categories')} placeholder="Department or purpose, e.g. Finance" />
          <datalist id={id('categories')}>
            {categories.map((c) => <option key={c} value={c} />)}
          </datalist>
        </div>
      </div>
      <div>
        <label className="label" htmlFor={id('url')}>Google Sheets link</label>
        <input
          id={id('url')}
          name="url"
          type="url"
          className="input font-mono text-xs"
          required
          maxLength={2000}
          defaultValue={sheet?.url}
          placeholder="https://docs.google.com/spreadsheets/d/…"
          pattern="https://docs\.google\.com/spreadsheets/d/.+"
          title="Paste the full Google Sheets link, starting with https://docs.google.com/spreadsheets/d/"
        />
        <p className="mt-1 text-xs text-slate-500">Only the link is stored. Google still decides who can open the sheet, so share it in Google Sheets as usual.</p>
      </div>
      <div>
        <label className="label" htmlFor={id('purpose')}>Purpose</label>
        <textarea id={id('purpose')} name="purpose" rows={2} className="input" maxLength={500} defaultValue={sheet?.purpose} placeholder="What the sheet is for and how the team uses it" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor={id('owner')}>Responsible person</label>
          {canAdmin ? (
            <select id={id('owner')} name="owner" className="input" defaultValue={sheet?.owner_id ?? ''}>
              <option value="">Nobody yet</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          ) : (
            <>
              <input type="hidden" name="owner" value={sheet?.owner_id ?? ''} />
              <input id={id('owner')} className="input bg-slate-50 text-slate-700" readOnly value={ownerName ?? 'Nobody yet'} />
            </>
          )}
        </div>
        <div>
          <label className="label" htmlFor={id('team')}>Team</label>
          <select id={id('team')} name="team" className="input" defaultValue={sheet?.team_id ?? ''}>
            <option value="">No team</option>
            {teams.filter((t) => t.is_active || t.id === sheet?.team_id).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
      </div>
      <fieldset>
        <legend className="label">Working on it</legend>
        <p className="mb-2 text-xs text-slate-500">Everyone who works in this sheet. The responsible person does not need to be ticked.</p>
        <div className="grid max-h-48 grid-cols-2 gap-x-4 gap-y-1.5 overflow-y-auto rounded-lg border border-line p-3 sm:grid-cols-3">
          {members.map((m) => (
            <label key={m.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="people" value={m.id} defaultChecked={people.has(m.id)} />
              <span className="truncate">{m.name}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="label">Who can see this entry</legend>
        {canAdmin ? (
          <div className="space-y-1.5">
            <label className="flex items-start gap-2 text-sm">
              <input type="radio" name="visibility" value="everyone" defaultChecked={(sheet?.visibility ?? 'everyone') === 'everyone'} className="mt-0.5" />
              <span>Everyone on the team</span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input type="radio" name="visibility" value="assigned" defaultChecked={sheet?.visibility === 'assigned'} className="mt-0.5" />
              <span>Only the responsible person, the people working on it, its team and Sheets admins</span>
            </label>
          </div>
        ) : (
          <>
            <input type="hidden" name="visibility" value={sheet?.visibility ?? 'everyone'} />
            <p className="text-sm text-slate-700">
              {sheet?.visibility === 'assigned' ? 'Only the people on this sheet, its team and Sheets admins' : 'Everyone on the team'}
            </p>
          </>
        )}
      </fieldset>
    </div>
  );
}
