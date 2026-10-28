import Link from 'next/link';
import { requireMe } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { activeMembers } from '@/lib/data';
import { ActionForm, SubmitButton } from '@/components/forms';
import { PageHeader } from '@/components/ui';
import { loadTeams } from '../../attendance/data';
import { saveSheetAction } from '../actions';
import { SheetFields } from '../fields';

export const metadata = { title: 'Add a sheet' };

export default async function NewSheet() {
  const me = await requireMe();
  const canAdmin = me.areas.sheets;
  const supabase = await createClient();
  const [members, teams, { data: cats }] = await Promise.all([
    activeMembers(),
    loadTeams(supabase),
    supabase.from('work_sheets').select('category').is('archived_at', null).neq('category', ''),
  ]);
  const categories = [...new Set((cats ?? []).map((c) => c.category as string))].sort((a, b) => a.localeCompare(b));
  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Add a sheet"
        subtitle={canAdmin ? 'Link a Google Sheet the team works in, and say who is responsible for it.' : 'Link a Google Sheet you work in. You will be responsible for keeping its entry up to date.'}
      />
      <ActionForm action={saveSheetAction} className="card space-y-5 p-5">
        <SheetFields members={members} teams={teams} categories={categories} canAdmin={canAdmin} myName={me.name} />
        <div className="flex justify-end gap-2">
          <Link href="/sheets" className="btn-secondary">Cancel</Link>
          <SubmitButton>Add sheet</SubmitButton>
        </div>
      </ActionForm>
    </div>
  );
}
