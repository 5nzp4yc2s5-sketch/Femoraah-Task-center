import Link from 'next/link';
import { requireMe } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { activeMembers } from '@/lib/data';
import { addDays, fmtDate, friendlyError, isIsoDate } from '@/lib/format';
import type { CalendarEntry } from '@/lib/types';
import { ActionForm, ConfirmAction, SubmitButton } from '@/components/forms';
import { Avatar, CapacityBadge } from '@/components/badges';
import { EmptyState, Notice, PageHeader, SectionTitle, TableWrap } from '@/components/ui';
import { createHolidayAction, createLeaveAction, deleteHolidayAction, deleteLeaveAction } from './actions';
import { daysBetween, isMonth, leaveDays, monthLabel, monthShort, shiftMonth, weekdayIndex, weekdayShort } from './dates';
import { LeaveFields } from './leave-fields';
import { HOLIDAY_TONE, LEAVE_TONE, MonthView, PILL } from './month-view';

export const metadata = { title: 'Team Calendar' };

type SP = { month?: string; saved?: string; deleted?: string };

const SUBTITLE =
  'Company holidays and who is on leave. While someone is on leave they are not suggested for backlog work, and their routines are covered by the routine’s backup (or the backup named on the leave).';

const smallDanger = 'btn-ghost px-2 py-1 text-xs text-red-700';

function dateRange(start: string, end: string) {
  return start === end ? fmtDate(start) : `${fmtDate(start)} – ${fmtDate(end)}`;
}

function whenLabel(today: string, d: string) {
  const n = daysBetween(today, d);
  return n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : `in ${n} days`;
}

export default async function TeamCalendar({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const me = await requireMe();
  const supabase = await createClient();

  // "Today" is the company date from the database (Asia/Kolkata), never the server clock.
  const { data: summary, error: summaryError } = await supabase.rpc('my_summary');
  const today: string | null = isIsoDate(summary?.today) ? summary.today : null;
  if (!today) {
    return (
      <>
        <PageHeader title="Team Calendar" subtitle={SUBTITLE} />
        <Notice tone="error">Could not load the calendar{summaryError ? `: ${friendlyError(summaryError.message)}` : '.'} Please refresh the page.</Notice>
      </>
    );
  }

  const thisMonth = today.slice(0, 7);
  const month = isMonth(sp.month) ? sp.month : thisMonth;
  const monthStart = `${month}-01`;
  const monthEnd = addDays(`${shiftMonth(month, 1)}-01`, -1);
  const gridStart = addDays(monthStart, -weekdayIndex(monthStart));
  const gridEnd = addDays(monthEnd, 6 - weekdayIndex(monthEnd));
  const prev = shiftMonth(month, -1);
  const next = shiftMonth(month, 1);

  const [{ data: calData, error: calError }, { data: holidayData, error: holidayError }, members] = await Promise.all([
    supabase.rpc('team_calendar', { p_from: gridStart, p_to: gridEnd }),
    // Past and next 12 months: the upcoming list, and the choices for a Holiday Swap.
    supabase.from('holidays').select('id, holiday_date, name, note').gte('holiday_date', addDays(today, -366)).lte('holiday_date', addDays(today, 366)).order('holiday_date'),
    activeMembers(),
  ]);
  const entries = (calData ?? []) as CalendarEntry[];
  const holidays = (holidayData ?? []) as { id: string; holiday_date: string; name: string; note: string }[];
  const upcoming = holidays.filter((h) => h.holiday_date >= today && h.holiday_date <= addDays(today, 365));

  const overlapsMonth = (e: CalendarEntry) => e.start_date <= monthEnd && e.end_date >= monthStart;
  const monthHolidays = entries.filter((e) => e.kind === 'holiday' && overlapsMonth(e));
  const monthLeave = entries.filter((e) => e.kind === 'leave' && overlapsMonth(e));
  const meOption = { id: me.memberId, name: me.name };
  const swapChoices = holidays.map(({ holiday_date, name }) => ({ holiday_date, name }));

  const leaveActions = (e: CalendarEntry) =>
    e.can_edit ? (
      <div className="flex flex-wrap items-start justify-end gap-1">
        <Link href={`/calendar/leave/${e.id}`} className="btn-ghost px-2 py-1 text-xs">Edit</Link>
        <ConfirmAction
          action={deleteLeaveAction}
          label="Delete"
          title="Delete this leave?"
          body={`${e.member_name}’s ${e.label.toLowerCase()} (${dateRange(e.start_date, e.end_date)}) will be removed from the calendar. Backlog suggestions and routine cover go back to normal for those days.`}
          confirmLabel="Delete leave"
          className={smallDanger}
          hidden={{ id: e.id }}
        />
      </div>
    ) : null;

  const holidayDelete = (id: string, name: string, date: string) => (
    <ConfirmAction
      action={deleteHolidayAction}
      label="Delete"
      title="Delete this holiday?"
      body={`${name} on ${fmtDate(date)} will be removed. That day becomes a normal working day for everyone.`}
      confirmLabel="Delete holiday"
      className={smallDanger}
      hidden={{ id }}
    />
  );

  return (
    <>
      <PageHeader
        title="Team Calendar"
        subtitle={SUBTITLE}
        actions={
          <>
            <a href="#add-leave" className="btn-primary">Add leave</a>
            {me.isManager && <a href="#add-holiday" className="btn-secondary">Add holiday</a>}
          </>
        }
      />
      {sp.saved === 'leave' && <Notice>Leave saved.</Notice>}
      {sp.deleted === 'leave' && <Notice>Leave deleted.</Notice>}
      {calError && <Notice tone="error">Could not load the calendar: {friendlyError(calError.message)}</Notice>}
      {holidayError && <Notice tone="error">Could not load company holidays: {friendlyError(holidayError.message)}</Notice>}

      <nav aria-label="Month" className="card mb-3 flex flex-wrap items-center justify-between gap-2 p-2 sm:p-3">
        <div className="flex items-center gap-1">
          <Link href={`/calendar?month=${prev}`} className="btn-ghost px-2.5" aria-label={`Previous month, ${monthLabel(prev)}`}>
            ← <span className="hidden sm:inline">{monthShort(prev)}</span>
          </Link>
          <h2 className="min-w-32 text-center text-base font-semibold text-slate-900 sm:min-w-40">{monthLabel(month)}</h2>
          <Link href={`/calendar?month=${next}`} className="btn-ghost px-2.5" aria-label={`Next month, ${monthLabel(next)}`}>
            <span className="hidden sm:inline">{monthShort(next)}</span> →
          </Link>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="hidden items-center gap-2 text-xs text-slate-600 md:flex">
            <span className={`${PILL} ${HOLIDAY_TONE}`}>Holiday</span>
            <span className={`${PILL} ${LEAVE_TONE}`}>On leave</span>
          </span>
          {month === thisMonth ? (
            <span className="px-1 text-xs text-slate-600">Today: {weekdayShort(today)}, {fmtDate(today)}</span>
          ) : (
            <Link href={`/calendar?month=${thisMonth}`} className="btn-secondary px-3 py-1.5">Today</Link>
          )}
        </div>
      </nav>

      <MonthView month={month} gridStart={gridStart} gridEnd={gridEnd} today={today} entries={entries} />

      <div className="grid gap-x-6 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">
          {monthHolidays.length === 0 && monthLeave.length === 0 ? (
            <>
              <SectionTitle>{monthLabel(month)}</SectionTitle>
              <EmptyState
                title="No leave or holidays this month"
                body={month < thisMonth ? 'Nobody recorded leave and there were no company holidays.' : 'Add leave below when you plan time off, so work can be planned around it.'}
              />
            </>
          ) : (
            <>
              {monthHolidays.length > 0 && (
                <>
                  <SectionTitle>Holidays this month</SectionTitle>
                  <ul className="card divide-y divide-line">
                    {monthHolidays.map((h) => (
                      <li key={h.id} className="flex items-start justify-between gap-3 px-4 py-3">
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-slate-900">{h.label}</div>
                          <div className="text-xs text-slate-600">
                            {weekdayShort(h.start_date)}, {fmtDate(h.start_date)}
                            {h.note ? ` · ${h.note}` : ''}
                          </div>
                        </div>
                        {h.can_edit && holidayDelete(h.id, h.label, h.start_date)}
                      </li>
                    ))}
                  </ul>
                </>
              )}

              <SectionTitle>Leave this month</SectionTitle>
              {monthLeave.length === 0 ? (
                <EmptyState title="Nobody is on leave this month" />
              ) : (
                <>
                  <ul className="space-y-2 md:hidden">
                    {monthLeave.map((e) => (
                      <li key={e.id} className="card p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-2">
                            <Avatar name={e.member_name ?? '?'} size="sm" />
                            <span className="truncate font-medium text-slate-900">{e.member_name}</span>
                          </div>
                          <span className={`${PILL} ${LEAVE_TONE}`}>{e.label}</span>
                        </div>
                        <div className="mt-1 text-xs text-slate-600">
                          {dateRange(e.start_date, e.end_date)} · {leaveDays(e.start_date, e.end_date)} day{leaveDays(e.start_date, e.end_date) === 1 ? '' : 's'}
                          {e.backup_name ? ` · Backup ${e.backup_name}` : ''}
                        </div>
                        {e.note && <p className="mt-1 text-xs text-slate-600">{e.note}</p>}
                        {today >= e.start_date && today <= e.end_date && <div className="mt-2"><CapacityBadge status="On Leave" /></div>}
                        {e.can_edit && <div className="mt-2">{leaveActions(e)}</div>}
                      </li>
                    ))}
                  </ul>
                  <div className="hidden md:block">
                    <TableWrap>
                      <table className="sheet">
                        <thead>
                          <tr>
                            <th>Person</th>
                            <th>Type</th>
                            <th>From</th>
                            <th>To</th>
                            <th className="text-right">Days</th>
                            <th>Backup</th>
                            <th>Note</th>
                            <th className="text-right"><span className="sr-only">Actions</span></th>
                          </tr>
                        </thead>
                        <tbody>
                          {monthLeave.map((e) => (
                            <tr key={e.id}>
                              <td className="whitespace-nowrap">
                                <div className="flex items-center gap-2">
                                  <Avatar name={e.member_name ?? '?'} size="sm" />
                                  <span className="font-medium text-slate-900">{e.member_name}</span>
                                  {today >= e.start_date && today <= e.end_date && <CapacityBadge status="On Leave" />}
                                </div>
                              </td>
                              <td><span className={`${PILL} ${LEAVE_TONE}`}>{e.label}</span></td>
                              <td className="whitespace-nowrap tabular-nums">{fmtDate(e.start_date)}</td>
                              <td className="whitespace-nowrap tabular-nums">{fmtDate(e.end_date)}</td>
                              <td className="text-right tabular-nums">{leaveDays(e.start_date, e.end_date)}</td>
                              <td className="whitespace-nowrap">{e.backup_name ?? '—'}</td>
                              <td className="max-w-56 text-slate-600"><span className="line-clamp-2">{e.note || '—'}</span></td>
                              <td className="text-right">{leaveActions(e) ?? <span className="text-xs text-slate-400">—</span>}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </TableWrap>
                  </div>
                  <p className="mt-2 text-xs text-slate-500">
                    Days are calendar days, first and last day included.
                    {me.isManager ? '' : ' You can change or delete your own leave until it starts; after that, ask a manager.'}
                  </p>
                </>
              )}
            </>
          )}
        </div>

        <aside className="min-w-0">
          <SectionTitle>Upcoming holidays</SectionTitle>
          {upcoming.length === 0 ? (
            <EmptyState
              title="No upcoming holidays"
              body={me.isManager ? 'Add company holidays for the next 12 months so everyone can plan around them.' : 'Company holidays for the next 12 months will appear here once a manager adds them.'}
            />
          ) : (
            <ul className="card divide-y divide-line">
              {upcoming.map((h) => (
                <li key={h.id} className="flex items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <Link href={`/calendar?month=${h.holiday_date.slice(0, 7)}`} className="text-sm font-medium text-slate-900 hover:underline">
                      {h.name}
                    </Link>
                    <div className="text-xs text-slate-600">
                      <span className="tabular-nums">{weekdayShort(h.holiday_date)}, {fmtDate(h.holiday_date)}</span> · {whenLabel(today, h.holiday_date)}
                    </div>
                    {h.note && <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{h.note}</p>}
                  </div>
                  {/* Upcoming holidays are editable by any manager (past ones by admins only). */}
                  {me.isManager && holidayDelete(h.id, h.name, h.holiday_date)}
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>

      <div className="mt-6 grid items-start gap-4 lg:grid-cols-2">
        <section id="add-leave" className="card scroll-mt-4 p-5" aria-labelledby="add-leave-title">
          <h2 id="add-leave-title" className="font-semibold text-slate-900">Add leave</h2>
          <p className="mt-1 text-sm text-slate-600">
            {me.isManager
              ? 'Record leave for anyone, including past dates.'
              : 'Record your own leave, starting today or later. A manager can record leave for someone else or for past dates.'}
          </p>
          <ActionForm action={createLeaveAction} className="mt-4 space-y-4" resetOnSuccess>
            <LeaveFields members={members} holidays={swapChoices} isManager={me.isManager} me={meOption} today={today} />
            <div className="flex justify-end">
              <SubmitButton>Add leave</SubmitButton>
            </div>
          </ActionForm>
        </section>

        {me.isManager && (
          <section id="add-holiday" className="card scroll-mt-4 p-5" aria-labelledby="add-holiday-title">
            <h2 id="add-holiday-title" className="font-semibold text-slate-900">Add holiday</h2>
            <p className="mt-1 text-sm text-slate-600">
              A company holiday is a day off for everyone, except people who swap it for another day.
              {me.isAdmin ? ' As an admin you can also add holidays in the past.' : ' Only an admin can add or change holidays in the past.'}
            </p>
            <ActionForm action={createHolidayAction} className="mt-4 space-y-4" resetOnSuccess>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="label" htmlFor="holiday-date">Date</label>
                  <input id="holiday-date" name="holiday_date" type="date" className="input" required min={me.isAdmin ? undefined : today} />
                </div>
                <div>
                  <label className="label" htmlFor="holiday-name">Holiday</label>
                  <input id="holiday-name" name="name" className="input" required maxLength={120} placeholder="e.g. Diwali" />
                </div>
                <div className="sm:col-span-2">
                  <label className="label" htmlFor="holiday-note">Note</label>
                  <input id="holiday-note" name="note" className="input" maxLength={500} placeholder="Optional, e.g. eligible for swap" />
                </div>
              </div>
              <div className="flex justify-end">
                <SubmitButton>Add holiday</SubmitButton>
              </div>
            </ActionForm>
          </section>
        )}
      </div>
    </>
  );
}
