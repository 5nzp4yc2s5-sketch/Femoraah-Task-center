import { requireArea } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { fmtDate, friendlyError } from '@/lib/format';
import { ActionForm, SubmitButton } from '@/components/forms';
import { EmptyState, Notice, PageHeader, SectionTitle } from '@/components/ui';
import { dbToday } from '../../attendance/data';
import { SettingsTabs } from '../tabs';
import { saveQuoteAction } from '../company-actions';
import { QuoteRowActions } from './row-actions';

export const metadata = { title: 'Quotes' };

interface QuoteRow {
  id: string;
  body: string;
  author: string;
  sort_order: number;
  is_active: boolean;
  archived_at: string | null;
}

export default async function QuotesPage() {
  const me = await requireArea('settings');
  const supabase = await createClient();
  const [{ today }, quotesRes, daysRes] = await Promise.all([
    dbToday(supabase),
    supabase.from('quotes').select('id, body, author, sort_order, is_active, archived_at').order('sort_order').order('created_at'),
    supabase.from('quote_days').select('day, quote_id').order('day', { ascending: false }).limit(1000),
  ]);
  const quotes = (quotesRes.data ?? []) as QuoteRow[];
  const days = (daysRes.data ?? []) as { day: string; quote_id: string }[];
  const shown = new Map<string, { count: number; last: string }>();
  for (const d of days) {
    const s = shown.get(d.quote_id);
    if (s) s.count += 1;
    else shown.set(d.quote_id, { count: 1, last: d.day });
  }
  const todays = days.find((d) => d.day === today)?.quote_id ?? null;
  const active = quotes.filter((q) => q.is_active);
  const archived = quotes.filter((q) => !q.is_active);

  return (
    <>
      <PageHeader title="Settings" subtitle="Motivational quotes on everyone's dashboard. Everyone sees the same quote each day, and none repeats until all have been shown." />
      <SettingsTabs current="/settings/quotes" areas={me.areas} />
      {(quotesRes.error || daysRes.error) && <Notice tone="error">Could not load the quotes: {friendlyError(quotesRes.error?.message ?? daysRes.error?.message)}</Notice>}

      <SectionTitle>Add a quote</SectionTitle>
      <ActionForm action={saveQuoteAction} resetOnSuccess className="card grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_14rem_auto] sm:items-end">
        <div>
          <label className="label" htmlFor="q-body">Quote</label>
          <textarea id="q-body" name="body" rows={2} maxLength={300} required className="input" placeholder="Well done is better than well said." />
        </div>
        <div>
          <label className="label" htmlFor="q-author">Author (optional)</label>
          <input id="q-author" name="author" maxLength={80} className="input" placeholder="Benjamin Franklin" />
        </div>
        <SubmitButton>Add quote</SubmitButton>
      </ActionForm>

      <SectionTitle>In rotation ({active.length})</SectionTitle>
      {active.length === 0 ? (
        <EmptyState title="No quotes in rotation" body="Add a quote above, or restore an archived one. The dashboard hides the quote card while the list is empty." />
      ) : (
        <ol className="space-y-2">
          {active.map((q, i) => (
            <li key={q.id} className={`card p-3 ${q.id === todays ? 'border-accent ring-1 ring-accent' : ''}`}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                <span className="w-6 shrink-0 text-sm font-semibold tabular-nums text-slate-400">{i + 1}.</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-slate-900">“{q.body}”</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {q.author || 'No author'} ·{' '}
                    {q.id === todays ? <strong className="text-slate-900">Today&apos;s quote</strong> : shown.get(q.id) ? `Shown ${shown.get(q.id)!.count}× · last ${fmtDate(shown.get(q.id)!.last)}` : 'Not shown yet'}
                  </p>
                </div>
                <QuoteRowActions quote={q} first={i === 0} last={i === active.length - 1} />
              </div>
            </li>
          ))}
        </ol>
      )}

      {archived.length > 0 && (
        <>
          <SectionTitle>Archived ({archived.length})</SectionTitle>
          <ul className="space-y-2">
            {archived.map((q) => (
              <li key={q.id} className="card p-3 opacity-80">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-slate-700">“{q.body}”</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {q.author || 'No author'} · archived {q.archived_at ? fmtDate(q.archived_at.slice(0, 10)) : ''}
                    </p>
                  </div>
                  <QuoteRowActions quote={q} first last archived />
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
