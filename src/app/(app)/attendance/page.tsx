import { requireMe } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { friendlyError } from '@/lib/format';
import { Notice, PageHeader } from '@/components/ui';
import { AdminAttendance } from './admin-view';
import { MyAttendance } from './my-view';
import { dbToday } from './data';

export const metadata = { title: 'Attendance' };

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function AttendancePage({ searchParams }: { searchParams: Promise<SP> }) {
  const raw = await searchParams;
  const sp = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, one(v)])) as Record<string, string | undefined>;
  const me = await requireMe();
  const supabase = await createClient();
  // "Today" comes from the database clock, never the web server's.
  const { today, error } = await dbToday(supabase);
  if (!today) {
    return (
      <>
        <PageHeader title={me.isAdmin ? 'Attendance' : 'My attendance'} />
        <Notice tone="error">Could not load today&apos;s date from the database ({friendlyError(error)}). Please refresh the page.</Notice>
      </>
    );
  }
  // Attendance admin is admin-only. Managers who are not admins see their own attendance, like everyone else.
  return me.isAdmin ? <AdminAttendance sp={sp} today={today} /> : <MyAttendance me={me} today={today} correct={sp.correct} />;
}
